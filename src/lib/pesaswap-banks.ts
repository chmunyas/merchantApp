// Pesalink bank codes supported by PesaSwap's PesaPay payout rail.
// Source: https://docs.pesaswap.io/api-reference/payouts/pesapay--bank-codes.md
//
// The code is what the rail routes on. A free-text bank name cannot be sent, and
// must never be guessed into a code — the failure mode is someone's wages
// arriving at the wrong institution.

export type PesalinkBank = { code: string; name: string };

export const PESALINK_BANKS: readonly PesalinkBank[] = [
  { code: "01", name: "KCB Bank Kenya" },
  { code: "02", name: "Standard Chartered Bank Kenya" },
  { code: "03", name: "ABSA Bank Kenya" },
  { code: "07", name: "NCBA Bank Kenya" },
  { code: "10", name: "Prime Bank" },
  { code: "11", name: "Co-operative Bank of Kenya" },
  { code: "12", name: "National Bank of Kenya" },
  { code: "14", name: "M-Oriental Bank" },
  { code: "16", name: "Citibank N.A. Kenya" },
  { code: "18", name: "Middle East Bank Kenya" },
  { code: "19", name: "Bank of Africa Kenya" },
  { code: "23", name: "Consolidated Bank of Kenya" },
  { code: "25", name: "Credit Bank" },
  { code: "31", name: "Stanbic Bank Kenya" },
  { code: "35", name: "African Banking Corporation" },
  { code: "43", name: "ECO Bank" },
  { code: "46", name: "Choice Microfinance Bank" },
  { code: "50", name: "Paramount Universal Bank" },
  { code: "51", name: "Kingdom Bank" },
  { code: "53", name: "Guaranty Trust Bank" },
  { code: "54", name: "Victoria Commercial Bank" },
  { code: "55", name: "Guardian Bank" },
  { code: "57", name: "I&M Bank" },
  { code: "60", name: "SBM Bank Kenya" },
  { code: "61", name: "Housing Finance Bank" },
  { code: "63", name: "Diamond Trust Bank" },
  { code: "65", name: "Mayfair CIB Bank" },
  { code: "66", name: "Sidian Bank" },
  { code: "68", name: "Equity Bank Kenya" },
  { code: "70", name: "Family Bank" },
  { code: "72", name: "Gulf African Bank" },
  { code: "74", name: "Premier Bank Kenya Limited" },
  { code: "75", name: "DIB Bank Kenya" },
  { code: "76", name: "UBA Kenya Bank" },
  { code: "78", name: "Kenya Women Microfinance Bank" },
  { code: "84", name: "Caritas Microfinance Bank" },
  { code: "85", name: "Unaitas Sacco" },
  { code: "86", name: "VOOMA" },
  { code: "87", name: "Faulu Microfinance Bank" },
  { code: "88", name: "Gladys Technologies" },
];

const BY_CODE = new Map(PESALINK_BANKS.map((bank) => [bank.code, bank]));

export function isSupportedBankCode(code: string | null | undefined): boolean {
  return typeof code === "string" && BY_CODE.has(code);
}

export function bankName(code: string | null | undefined): string | null {
  return BY_CODE.get(String(code ?? ""))?.name ?? null;
}
