/**
 * Unit tests — consent / opt-out keyword classification (compliance).
 */
import { describe, it, expect } from "vitest";

import { consentKeyword } from "../../src/lib/consent";

describe("consentKeyword", () => {
  it("detects opt-out (STOP) keywords, case-insensitively", () => {
    for (const w of [
      "STOP",
      "stop",
      "unsubscribe",
      "cancel",
      "end",
      "quit",
      "optout",
      "opt out",
    ]) {
      expect(consentKeyword(w)).toBe("stop");
    }
  });

  it("detects opt-in (START) keywords", () => {
    for (const w of ["START", "subscribe", "unstop", "optin", "opt in"]) {
      expect(consentKeyword(w)).toBe("start");
    }
  });

  it("detects HELP", () => {
    expect(consentKeyword("HELP")).toBe("help");
    expect(consentKeyword("info")).toBe("help");
  });

  it("returns null for an ordinary message (only exact keywords opt out)", () => {
    expect(consentKeyword("what time do you open?")).toBeNull();
    expect(consentKeyword("stop by later for a drink")).toBeNull();
  });
});
