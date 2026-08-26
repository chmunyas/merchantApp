import { scryptAsync } from "@noble/hashes/scrypt.js";
import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils.js";

const encoder = new TextEncoder();
const SCRYPT_N = 1 << 15;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const MAX_MEMORY_BYTES = 64 * 1024 * 1024;
const DUMMY_SALT = new Uint8Array(SALT_LENGTH);

export type StaffPinVerification = {
  valid: boolean;
  needsUpgrade: boolean;
};

export function isValidStaffPin(pin: string): boolean {
  return /^\d{6,8}$/.test(pin);
}

/**
 * Rejects PINs that are trivially guessable when one is being SET.
 *
 * Deliberately not folded into `isValidStaffPin`: that function also guards the
 * login path, so tightening it there would lock out every existing staff member
 * whose PIN happens to be weak, rather than asking them to change it.
 */
export function isWeakStaffPin(pin: string): boolean {
  if (!isValidStaffPin(pin)) return false;
  if (/^(\d)\1+$/.test(pin)) return true;
  const digits = [...pin].map(Number);
  const ascending = digits.every((d, i) => i === 0 || d === (digits[i - 1] + 1) % 10);
  const descending = digits.every((d, i) => i === 0 || d === (digits[i - 1] + 9) % 10);
  if (ascending || descending) return true;
  // A short repeated block ("123123", "1212...") is as guessable as a sequence.
  for (const block of [1, 2, 3, 4]) {
    if (pin.length % block !== 0 || pin.length === block) continue;
    const head = pin.slice(0, block);
    if (pin === head.repeat(pin.length / block)) return true;
  }
  return false;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function derive(
  pin: string,
  salt: Uint8Array,
  N: number,
  r: number,
  p: number,
): Promise<Uint8Array> {
  return scryptAsync(encoder.encode(pin), salt, {
    N,
    r,
    p,
    dkLen: KEY_LENGTH,
    maxmem: MAX_MEMORY_BYTES,
    asyncTick: 10,
  });
}

export async function hashStaffPin(pin: string): Promise<string> {
  if (!isValidStaffPin(pin)) {
    throw new Error("Staff PIN must contain 6 to 8 digits.");
  }
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(pin, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P);
  return `scrypt$v1$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${bytesToHex(salt)}$${bytesToHex(key)}`;
}

export async function dummyVerifyStaffPin(pin: string): Promise<void> {
  await derive(pin || "000000", DUMMY_SALT, SCRYPT_N, SCRYPT_R, SCRYPT_P);
}

export async function verifyStaffPin(
  pin: string,
  stored: string,
): Promise<StaffPinVerification> {
  const parts = stored.split("$");
  if (parts.length !== 7 || parts[0] !== "scrypt" || parts[1] !== "v1") {
    return { valid: false, needsUpgrade: false };
  }
  const N = Number(parts[2]);
  const r = Number(parts[3]);
  const p = Number(parts[4]);
  if (
    !Number.isInteger(N) ||
    !Number.isInteger(r) ||
    !Number.isInteger(p) ||
    N < 2 ||
    r < 1 ||
    p < 1
  ) {
    return { valid: false, needsUpgrade: false };
  }
  try {
    const salt = hexToBytes(parts[5]);
    const expected = hexToBytes(parts[6]);
    const actual = await derive(pin, salt, N, r, p);
    return {
      valid: timingSafeEqual(actual, expected),
      needsUpgrade: N !== SCRYPT_N || r !== SCRYPT_R || p !== SCRYPT_P,
    };
  } catch {
    return { valid: false, needsUpgrade: false };
  }
}
