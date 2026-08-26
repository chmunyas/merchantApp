// Shared, dependency-free payment status and settlement helpers. Keeping these
// outside the large payment route provides a bounded seam for further extraction.

export function normalizeKenyanPhone(
  phone: string,
): { number: string; country_code: string } | null {
  const digits = (phone || "").replace(/\D/g, "");
  let local = "";
  if (digits.startsWith("254")) local = digits.slice(3);
  else if (digits.startsWith("0")) local = digits.slice(1);
  else local = digits;
  if (!/^[71]\d{8}$/.test(local)) return null;
  return { number: local, country_code: "+254" };
}

export function canonicalKenyanPhone(phone: unknown): string | null {
  if (typeof phone !== "string") return null;
  const normalized = normalizeKenyanPhone(phone);
  return normalized
    ? `${normalized.country_code}${normalized.number}`
    : phone.trim() || null;
}

export function mapPesaSwapStatus(status: unknown): string {
  switch (String(status)) {
    case "succeeded":
    case "partially_captured":
    case "partially_captured_and_capturable":
      return "succeeded";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "requires_capture":
      return "requires_capture";
    default:
      return "processing";
  }
}

export function settledAmount(
  payment: Record<string, unknown>,
  mappedStatus: string,
): number {
  const requested = Number(payment.amount) || 0;
  if (mappedStatus !== "succeeded") return requested;
  const received = Number(payment.amount_received);
  return received > 0 ? received : requested;
}
