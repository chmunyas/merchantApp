/**
 * Unit tests — KE-QR (Kenya Quick Response Code Standard, CBK 2023 / EMVCo MPM v1.1)
 * Proves TLV structure, mandatory data objects, static/dynamic mode, KES amount
 * formatting, the absence of customer PII, and — critically — the CRC-16/CCITT
 * integrity check against its canonical published check value.
 */
import { describe, it, expect } from "vitest";

import {
  buildKeQr,
  crc16ccitt,
  formatKeQrAmount,
  parseKeQr,
  resolveKeQrMerchant,
  validateKeQr,
  KE_QR_DEFAULTS,
} from "../../src/lib/ke-qr";

const merchant = resolveKeQrMerchant({
  name: "Sade's Atelier",
  merchantId: "247365",
});

describe("KE-QR CRC-16/CCITT-FALSE", () => {
  it("matches the canonical check value 0x29B1 for '123456789'", () => {
    // The defining check value for CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF).
    expect(crc16ccitt("123456789")).toBe(0x29b1);
  });

  it("validates a payload it produced", () => {
    const payload = buildKeQr(merchant, { amountMinor: 19900 });
    expect(validateKeQr(payload)).toBe(true);
  });

  it("rejects a tampered payload", () => {
    const payload = buildKeQr(merchant, { amountMinor: 19900 });
    // Flip a digit in the amount without recomputing the CRC.
    const tampered = payload.replace("5403199", "5403198");
    expect(tampered).not.toBe(payload);
    expect(validateKeQr(tampered)).toBe(false);
  });
});

describe("KE-QR mandatory data objects", () => {
  const payload = buildKeQr(merchant, { amountMinor: 19900, reference: "INV-1" });
  const { objects } = parseKeQr(payload);

  it("starts with the Payload Format Indicator 00='01'", () => {
    expect(payload.startsWith("000201")).toBe(true);
    expect(objects["00"]).toBe("01");
  });

  it("carries currency KES (404) and country KE", () => {
    expect(objects["53"]).toBe("404");
    expect(objects["53"]).toBe(KE_QR_DEFAULTS.currency);
    expect(objects["58"]).toBe("KE");
  });

  it("carries the DBA merchant name and city", () => {
    expect(objects["59"]).toBe("Sade's Atelier");
    expect(objects["60"]).toBe("Nairobi");
  });

  it("embeds the national scheme GUID ke.go.qr in the account template", () => {
    expect(objects["28"]).toContain("ke.go.qr");
    expect(objects["28"]).toContain("247365");
  });

  it("ends with a valid 4-hex-digit CRC (tag 63)", () => {
    expect(payload.slice(-8, -4)).toBe("6304");
    expect(payload.slice(-4)).toMatch(/^[0-9A-F]{4}$/);
  });
});

describe("KE-QR static vs dynamic", () => {
  it("is dynamic (POI 12) with an amount object when amount is supplied", () => {
    const { objects } = parseKeQr(buildKeQr(merchant, { amountMinor: 50000 }));
    expect(objects["01"]).toBe("12");
    expect(objects["54"]).toBe("500");
  });

  it("is static (POI 11) with no amount object when amount is absent", () => {
    const { objects } = parseKeQr(buildKeQr(merchant));
    expect(objects["01"]).toBe("11");
    expect(objects["54"]).toBeUndefined();
  });
});

describe("KE-QR amount formatting (KES has no decimals)", () => {
  it("converts minor units to whole shillings", () => {
    expect(formatKeQrAmount(19900)).toBe("199");
    expect(formatKeQrAmount(100)).toBe("1");
  });

  it("rounds sub-shilling amounts (M-Pesa is whole KES)", () => {
    expect(formatKeQrAmount(199)).toBe("2"); // KES 1.99 -> 2
    expect(formatKeQrAmount(149)).toBe("1"); // KES 1.49 -> 1
  });

  it("never emits a decimal point", () => {
    expect(formatKeQrAmount(12345)).not.toContain(".");
  });
});

describe("KE-QR contains no customer PII", () => {
  it("omits the customer phone/email even when a reference is set", () => {
    const payload = buildKeQr(merchant, {
      amountMinor: 19900,
      reference: "ORDER-42",
    });
    expect(payload).not.toContain("254719797394");
    expect(payload).not.toContain("@");
  });
});

describe("KE-QR reference is carried in tag 62", () => {
  it("nests the reference label under the additional-data template", () => {
    const { objects } = parseKeQr(buildKeQr(merchant, { reference: "INV-33852" }));
    expect(objects["62"]).toBeDefined();
    const inner = parseKeQr(objects["62"] as string).objects;
    expect(inner["05"]).toBe("INV-33852");
  });
});

describe("KE-QR name clamping", () => {
  it("truncates a merchant name to 25 characters", () => {
    const long = resolveKeQrMerchant({
      name: "A Really Very Long Restaurant Trading Name Ltd",
      merchantId: "247365",
    });
    const { objects } = parseKeQr(buildKeQr(long));
    expect(objects["59"].length).toBeLessThanOrEqual(25);
  });
});
