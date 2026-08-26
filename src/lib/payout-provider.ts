// Builds the PesaSwap payout request for a destination, for both tips and
// salaries. One place decides how a destination becomes a provider payload, so
// adding a channel does not mean finding every caller.
//
// Channels (https://docs.pesaswap.io/api-reference/payouts/payouts--create.md):
//   wallet   -> M-Pesa Express, routed on a phone number
//   pesalink -> bank transfer via PesaPay, routed on a 2-digit bank code
//               (https://docs.pesaswap.io/api-reference/payouts/pesapay--bank-codes.md)

import { isSupportedBankCode } from "@/lib/pesaswap-banks";

export type PayoutDestination =
  | { method: "mpesa"; accountNumber: string }
  | { method: "bank"; accountNumber: string; bankCode: string | null };

export type PayoutRequestResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; heldReason: "no_payout_details" | "bank_code_missing" | "unsupported_method" };

/**
 * Kenyan MSISDN as the wallet rail wants it: national significant number, with
 * the country code carried separately.
 */
export function kenyanNationalNumber(raw: string): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.startsWith("254")) return digits.slice(3);
  return digits.replace(/^0/, "");
}

export function buildPayoutRequest(input: {
  destination: PayoutDestination;
  amountMinor: number;
  profileId: string;
  metadata: Record<string, string>;
}): PayoutRequestResult {
  const { destination, amountMinor, profileId, metadata } = input;
  const base = {
    amount: amountMinor,
    currency: "KES",
    profile_id: profileId,
    confirm: true,
    metadata,
  };

  if (destination.method === "mpesa") {
    const number = kenyanNationalNumber(destination.accountNumber);
    if (!number) return { ok: false, heldReason: "no_payout_details" };
    return {
      ok: true,
      body: {
        ...base,
        payout_type: "wallet",
        phone: number,
        phone_country_code: "254",
        payout_method_data: { wallet: { m_pesa_express: {} } },
      },
    };
  }

  if (destination.method === "bank") {
    // A bank name typed by a human cannot be routed; only the code can.
    if (!isSupportedBankCode(destination.bankCode)) {
      return { ok: false, heldReason: "bank_code_missing" };
    }
    if (!destination.accountNumber) return { ok: false, heldReason: "no_payout_details" };
    return {
      ok: true,
      body: {
        ...base,
        payout_type: "bank",
        payout_method_data: {
          bank: {
            payout_method: "pesalink",
            bank_code: destination.bankCode,
            account_number: destination.accountNumber,
          },
        },
      },
    };
  }

  return { ok: false, heldReason: "unsupported_method" };
}

/** Maps the provider's payout status onto ours. Anything unrecognised stays in flight. */
export function mapProviderStatus(
  providerStatus: string,
): "confirmed" | "failed" | "processing" {
  if (providerStatus === "success") return "confirmed";
  if (providerStatus === "failed") return "failed";
  return "processing";
}
