// Step-up confirmation for a staff member's payout destination (B4.1).
//
// The threat this closes: a staff session alone used to be enough to repoint
// every future tip payout to an attacker's M-Pesa number. Requiring a one-time
// code means the attacker must ALSO hold the phone on the victim's staff record.
//
// The rule that makes it work is that the destination is read from the database,
// never from the request. A caller-supplied phone would let the attacker send
// the code to themselves, which is no check at all.

export const PAYOUT_OTP_TTL_MS = 10 * 60 * 1000;
export const PAYOUT_OTP_MAX_ATTEMPTS = 5;
/** Codes per staff member per hour. Low: this is a rare, deliberate action. */
export const PAYOUT_OTP_RATE_LIMIT = 3;

/**
 * Binds a code to one staff member AND one purpose, so a login code can never be
 * replayed to move bank details and a payout code can never be used to log in.
 */
export function payoutOtpPurpose(staffId: string): string {
  return `payout:${staffId}`;
}

/**
 * Shows enough of the number for the staff member to recognise it, and not
 * enough for someone reading over their shoulder to learn it.
 */
export function maskPhone(e164: string): string {
  const trimmed = String(e164 ?? "").trim();
  if (trimmed.length < 4) return "•••";
  return `${"•".repeat(Math.max(3, trimmed.length - 4))}${trimmed.slice(-4)}`;
}

export type PayoutChallengeTarget =
  | { ok: true; phone: string }
  | { ok: false; reason: "no-phone" | "unusable-phone" };

/**
 * Resolves where a payout confirmation code may be sent.
 *
 * A staff member cannot supply or correct this themselves — if the number is
 * missing or unusable a manager must fix the staff record, because letting the
 * person set their own destination phone would re-open the hole this closes.
 */
export function resolveChallengeTarget(
  storedPhone: string | null | undefined,
  normalize: (channel: string, value: string) => string,
): PayoutChallengeTarget {
  const raw = String(storedPhone ?? "").trim();
  if (!raw) return { ok: false, reason: "no-phone" };
  const normalized = normalize("whatsapp", raw);
  // E.164: a leading + and 8–15 digits. Anything else cannot be dialled.
  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
    return { ok: false, reason: "unusable-phone" };
  }
  return { ok: true, phone: normalized };
}

export function payoutChallengeMessage(code: string, last4: string): string {
  return (
    `PesaSwap: ${code} is your code to change where your tips are paid. ` +
    `It expires in 10 minutes. ` +
    `If you did NOT request this, someone may have your login — tell your manager now. ` +
    `Never share this code. (ref ${last4})`
  );
}
