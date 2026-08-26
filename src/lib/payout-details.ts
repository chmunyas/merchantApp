// A staff member's own payout destination (roadmap B4.1).
//
// Rules this module exists to enforce:
//   * The account number is NEVER stored in plaintext and NEVER returned by any
//     endpoint — not to the staff member, not to a manager, not in a log line.
//     Callers only ever see the 4-digit tail via `maskedAccount`.
//   * Ciphertext is AES-GCM under STAFF_PAYOUT_KEY (32 raw bytes, base64). No
//     key means we refuse to store details rather than degrade to plaintext.
//   * Decryption happens in exactly one place: submitting a payout to the
//     provider.

export type PayoutMethod = "mpesa" | "bank";

export const PAYOUT_METHODS: readonly PayoutMethod[] = ["mpesa", "bank"];

export function isPayoutMethod(value: unknown): value is PayoutMethod {
  return value === "mpesa" || value === "bank";
}

/** Strip the spaces and dashes people type; keep the alphanumerics. */
export function normalizeAccountNumber(raw: string): string {
  return String(raw ?? "").replace(/[\s-]/g, "");
}

export function accountLast4(account: string): string | null {
  const digits = normalizeAccountNumber(account).replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}

export function maskedAccount(last4: string): string {
  return `•••• ${last4}`;
}

export type PayoutDetailsInput = {
  method: PayoutMethod;
  accountName: string;
  bankName?: string | null;
  accountNumber: string;
};

export type ValidatedPayoutDetails = {
  method: PayoutMethod;
  accountName: string;
  bankName: string | null;
  accountNumber: string;
  last4: string;
};

/** Boundary validation. Throws a message safe to show the staff member. */
export function validatePayoutDetails(input: PayoutDetailsInput): ValidatedPayoutDetails {
  if (!isPayoutMethod(input.method)) {
    throw new Error("Choose M-Pesa or a bank account.");
  }
  const accountName = String(input.accountName ?? "").trim();
  if (accountName.length < 2 || accountName.length > 120) {
    throw new Error("Enter the account holder's full name.");
  }
  const bankName = input.bankName == null ? null : String(input.bankName).trim();
  if (input.method === "bank" && (!bankName || bankName.length > 120)) {
    throw new Error("Enter your bank's name.");
  }
  if (bankName && bankName.length > 120) throw new Error("Bank name is too long.");

  const accountNumber = normalizeAccountNumber(input.accountNumber);
  if (input.method === "mpesa") {
    if (!/^\+?\d{9,15}$/.test(accountNumber)) {
      throw new Error("Enter the M-Pesa number that receives your tips.");
    }
  } else if (!/^[A-Za-z0-9]{6,34}$/.test(accountNumber)) {
    throw new Error("Enter a valid account number or IBAN.");
  }
  const last4 = accountLast4(accountNumber);
  if (!last4) throw new Error("An account number needs at least four digits.");

  return {
    method: input.method,
    accountName,
    bankName: input.method === "bank" ? bankName : null,
    accountNumber,
    last4,
  };
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importKey(secret: string): Promise<CryptoKey> {
  const raw = fromBase64(secret.trim());
  if (raw.length !== 32) {
    throw new Error("STAFF_PAYOUT_KEY must be 32 random bytes, base64-encoded.");
  }
  return crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptAccountNumber(
  secret: string,
  accountNumber: string,
): Promise<string> {
  const key = await importKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(accountNumber),
    ),
  );
  return `v1.${toBase64(iv)}.${toBase64(cipher)}`;
}

export async function decryptAccountNumber(
  secret: string,
  stored: string,
): Promise<string> {
  const [version, iv, cipher] = String(stored ?? "").split(".");
  if (version !== "v1" || !iv || !cipher) {
    throw new Error("unreadable payout destination");
  }
  const key = await importKey(secret);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(iv) as BufferSource },
    key,
    fromBase64(cipher) as BufferSource,
  );
  return new TextDecoder().decode(plain);
}
