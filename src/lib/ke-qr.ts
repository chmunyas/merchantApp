// KE-QR — Kenya Quick Response Code Standard (Central Bank of Kenya, 2023).
//
// The national standard is a profile of **EMVCo Merchant-Presented Mode (MPM)
// QR Code Specification v1.1**. A conformant code is a compact **TLV** string
// (each data object = 2-digit ID + 2-digit length + value) that ANY licensed
// DFSP / bank / PSP app can parse and route over existing rails — the customer
// scans it *inside their own banking app*, verifies the merchant name + amount,
// and authorises with their own PIN. No customer PII ever goes in the code.
//
// This module is pure + isomorphic (runs unchanged in a Cloudflare Worker and in
// the browser) so the same conformant payload is produced everywhere a QR is
// presented. It intentionally does NOT build URLs — our closed-loop scan-to-order
// URL QR lives elsewhere; this is the open-loop, interoperable payment artefact.
//
// Mandatory root data objects (CBK KE-QR):
//   00 Payload Format Indicator ...... "01"
//   01 Point of Initiation Method .... "11" static | "12" dynamic (amount bound)
//   28 Merchant Account Information ... domestic PSP template, GUID = "ke.go.qr"
//   52 Merchant Category Code ......... ISO 18245 (4 digits; "0000" for MNOs)
//   53 Transaction Currency ........... "404" (KES, ISO 4217 numeric)
//   54 Transaction Amount ............. present only when dynamic; KES => no dp
//   58 Country Code ................... "KE"
//   59 Merchant Name .................. DBA name, <= 25 chars
//   60 Merchant City .................. <= 15 chars
//   63 CRC ............................ CRC-16/CCITT-FALSE over everything incl "6304"

/** Merchant identity + scheme details encoded into the QR (never customer PII). */
export type KeQrMerchant = {
  /** GUID sub-tag (00) of the account template — the national scheme id. */
  guid?: string; // default "ke.go.qr"
  /** Acquiring-PSP identifier issued from the CBK directory (optional sub-tag). */
  pspId?: string;
  /** Merchant account / till / paybill number (the routable merchant id). */
  merchantId: string;
  /** Account template tag: "28" domestic PSP (default) or "29" domestic bank. */
  merchantAccountTag?: "28" | "29";
  /** Merchant Category Code (ISO 18245). "0000" when unknown / MNO-routed. */
  mcc?: string;
  /** 59 Merchant Name — the DBA / trading name shown to the payer (<= 25). */
  name: string;
  /** 60 Merchant City (<= 15). */
  city?: string;
  /** 58 Country Code (ISO 3166-1 alpha-2). */
  countryCode?: string; // default "KE"
  /** 61 Postal Code. Kenya guidance uses "00" when not applicable. */
  postalCode?: string;
};

/** Per-transaction options. Amount presence flips the code static → dynamic. */
export type KeQrOptions = {
  /** Amount in MINOR units (cents). Absent/0 => static (payer enters amount). */
  amountMinor?: number | null;
  /** 62/05 Reference Label — an order/invoice reference (<= 25). No PII. */
  reference?: string | null;
  /** 62/01 Bill Number (<= 25). */
  billNumber?: string | null;
  /** 62/03 Store Label (<= 25). */
  storeLabel?: string | null;
  /** 62/07 Terminal Label (<= 25). */
  terminalLabel?: string | null;
};

/** National defaults so a conformant code can be produced from just name + till. */
export const KE_QR_DEFAULTS = {
  guid: "ke.go.qr",
  merchantAccountTag: "28" as const,
  mcc: "5812", // Eating places / restaurants (ISO 18245) — override per vertical.
  countryCode: "KE",
  currency: "404", // KES (ISO 4217 numeric)
  city: "Nairobi",
  postalCode: "00",
};

/** Build one TLV data object: `ID` + 2-digit length + `value`. */
function tlv(id: string, value: string): string {
  const len = value.length;
  if (len > 99) {
    // EMVCo lengths are two decimal digits; callers must keep values <= 99 chars.
    throw new Error(`KE-QR value for tag ${id} too long (${len} > 99)`);
  }
  return id + String(len).padStart(2, "0") + value;
}

/** Keep only printable ASCII the standard expects, trimmed to `max` chars. */
function clamp(value: string, max: number): string {
  return value
    .replace(/[^\x20-\x7e]/g, "")
    .trim()
    .slice(0, max);
}

/**
 * Transaction Amount (tag 54). KES carries **no decimals** per KE-QR, so a minor
 * value is rounded to whole shillings — which also matches the M-Pesa rail, where
 * cents are not transactable.
 */
export function formatKeQrAmount(amountMinor: number): string {
  const shillings = Math.round(amountMinor / 100);
  return String(Math.max(0, shillings));
}

/** Merchant Account Information template value (inside tag 28 / 29). */
function accountTemplate(m: KeQrMerchant): string {
  const parts = [tlv("00", m.guid ?? KE_QR_DEFAULTS.guid)];
  if (m.pspId) parts.push(tlv("01", clamp(m.pspId, 32)));
  parts.push(tlv(m.pspId ? "02" : "01", clamp(m.merchantId, 32)));
  return parts.join("");
}

/** Additional Data Field Template (tag 62) — built only from present labels. */
function additionalData(o: KeQrOptions): string {
  const parts: string[] = [];
  if (o.billNumber) parts.push(tlv("01", clamp(o.billNumber, 25)));
  if (o.storeLabel) parts.push(tlv("03", clamp(o.storeLabel, 25)));
  if (o.reference) parts.push(tlv("05", clamp(o.reference, 25)));
  if (o.terminalLabel) parts.push(tlv("07", clamp(o.terminalLabel, 25)));
  return parts.join("");
}

/**
 * CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF, no reflection, xorout 0x0000)
 * over the UTF-8 bytes of `input`. The canonical check value for "123456789" is
 * 0x29B1 — asserted in the unit tests. This is the algorithm EMVCo/KE-QR mandate
 * for tag 63.
 */
export function crc16ccitt(input: string): number {
  const bytes = new TextEncoder().encode(input);
  let crc = 0xffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i] << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc & 0xffff;
}

/**
 * Build a conformant KE-QR TLV payload. Dynamic (amount-bound, POI "12") when an
 * amount is supplied, otherwise static (POI "11", payer enters the amount).
 */
export function buildKeQr(merchant: KeQrMerchant, options: KeQrOptions = {}): string {
  const dynamic =
    options.amountMinor != null && Number(options.amountMinor) > 0;

  const objects: string[] = [];
  objects.push(tlv("00", "01")); // Payload Format Indicator
  objects.push(tlv("01", dynamic ? "12" : "11")); // Point of Initiation Method
  objects.push(
    tlv(merchant.merchantAccountTag ?? KE_QR_DEFAULTS.merchantAccountTag, accountTemplate(merchant)),
  );
  objects.push(tlv("52", merchant.mcc ?? KE_QR_DEFAULTS.mcc)); // MCC
  objects.push(tlv("53", KE_QR_DEFAULTS.currency)); // Currency (KES 404)
  if (dynamic) objects.push(tlv("54", formatKeQrAmount(Number(options.amountMinor)))); // Amount
  objects.push(tlv("58", merchant.countryCode ?? KE_QR_DEFAULTS.countryCode)); // Country
  objects.push(tlv("59", clamp(merchant.name || "Merchant", 25))); // Merchant Name
  objects.push(tlv("60", clamp(merchant.city ?? KE_QR_DEFAULTS.city, 15))); // City
  objects.push(tlv("61", clamp(merchant.postalCode ?? KE_QR_DEFAULTS.postalCode, 10))); // Postal
  const add = additionalData(options);
  if (add) objects.push(tlv("62", add)); // Additional Data Field Template

  // CRC (tag 63) is computed over the ENTIRE preceding payload INCLUDING the
  // "6304" id+length prefix, then appended as 4 uppercase hex digits.
  const withoutCrc = objects.join("") + "6304";
  const crc = crc16ccitt(withoutCrc).toString(16).toUpperCase().padStart(4, "0");
  return withoutCrc + crc;
}

/** Fill a partial merchant spec with the national KE defaults. */
export function resolveKeQrMerchant(
  input: Partial<KeQrMerchant> & { name: string; merchantId: string },
): KeQrMerchant {
  return {
    guid: input.guid ?? KE_QR_DEFAULTS.guid,
    pspId: input.pspId,
    merchantId: input.merchantId,
    merchantAccountTag: input.merchantAccountTag ?? KE_QR_DEFAULTS.merchantAccountTag,
    mcc: input.mcc ?? KE_QR_DEFAULTS.mcc,
    name: input.name,
    city: input.city ?? KE_QR_DEFAULTS.city,
    countryCode: input.countryCode ?? KE_QR_DEFAULTS.countryCode,
    postalCode: input.postalCode ?? KE_QR_DEFAULTS.postalCode,
  };
}

/** Parsed representation of a KE-QR payload (top-level objects, CRC-validated). */
export type KeQrParsed = {
  objects: Record<string, string>;
  crcValid: boolean;
};

/** Parse a KE-QR payload into its top-level TLV objects and check the CRC. */
export function parseKeQr(payload: string): KeQrParsed {
  const objects: Record<string, string> = {};
  let i = 0;
  while (i + 4 <= payload.length) {
    const id = payload.slice(i, i + 2);
    const len = Number(payload.slice(i + 2, i + 4));
    if (!Number.isFinite(len)) break;
    const value = payload.slice(i + 4, i + 4 + len);
    objects[id] = value;
    i += 4 + len;
  }
  return { objects, crcValid: validateKeQr(payload) };
}

/** True when the appended CRC-16 matches a recomputation over the payload body. */
export function validateKeQr(payload: string): boolean {
  if (payload.length < 8) return false;
  const body = payload.slice(0, -4); // everything up to and including "6304"
  const provided = payload.slice(-4).toUpperCase();
  const expected = crc16ccitt(body).toString(16).toUpperCase().padStart(4, "0");
  return provided === expected;
}
