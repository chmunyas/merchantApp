import { beforeEach, describe, expect, it, vi } from "vitest";

// B4.1 hardening — changing where your tips are paid requires a code sent to the
// phone on YOUR staff record.
//
// The three properties pinned here are the ones that make the check worth
// having. Lose any one and the step-up becomes theatre:
//
//   1. The destination phone comes from the database, never the request. A
//      caller-supplied number would let an attacker send the code to themselves.
//   2. The code is bound to the staff member's own purpose, so a login code
//      cannot be replayed to move bank details.
//   3. No code, a wrong code, or an expired code means NO WRITE. The account
//      number never reaches staff_payout_details on an unconfirmed request.

const h = vi.hoisted(() => {
  const queries: { text: string; values: unknown[] }[] = [];
  const state = {
    staffPhone: "+254712345678" as string | null,
    otp: { id: "otp_1", code_hash: "hash", attempts: 0 } as
      | { id: string; code_hash: string; attempts: number }
      | null,
    codeMatches: true,
  };

  function run(text: string, values: unknown[]): unknown[] {
    queries.push({ text, values });
    if (/SELECT id, phone FROM staff/i.test(text)) {
      return [{ id: values[0], phone: state.staffPhone }];
    }
    if (/SELECT id, code_hash, attempts FROM auth_otps/i.test(text)) {
      return state.otp ? [state.otp] : [];
    }
    if (/INSERT INTO staff_payout_details/i.test(text)) return [];
    if (/UPDATE tip_payouts/i.test(text)) return [];
    return [];
  }

  type Tag = ((s: TemplateStringsArray, ...v: unknown[]) => Promise<unknown[]>) & {
    begin: <T>(cb: (tx: Tag) => Promise<T> | T) => Promise<T>;
  };
  const sql = ((s: TemplateStringsArray, ...v: unknown[]) =>
    Promise.resolve(run(s.join("?"), v))) as Tag;
  sql.begin = async (cb) => cb(sql);

  return { sql, queries, state };
});

vi.mock("../../src/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return { ...actual, getSql: () => h.sql };
});

vi.mock("../../src/api/auth", () => ({
  requireAuth: vi.fn(async () => ({
    role: "staff",
    venue: "v_1",
    staff_id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
  })),
  getAuthConfig: vi.fn(async () => ({ secret: "pepper" })),
}));

vi.mock("../../src/lib/outbound-jobs", () => ({
  queueOutbound: vi.fn(async () => ({ id: "d1", queued: true })),
  hasVerifiedChannelAccount: vi.fn(async (_env: unknown, _v: string, c: string) =>
    c === "whatsapp",
  ),
}));

vi.mock("../../src/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return {
    ...actual,
    rateLimit: vi.fn(async () => ({ limited: false, remaining: 3, retryAfter: 0 })),
  };
});

vi.mock("../../src/lib/runtime-security", () => ({ otpDebugAllowed: () => false }));

vi.mock("../../src/lib/otp", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/otp")>();
  return { ...actual, timingSafeEqualHex: () => h.state.codeMatches };
});

import { handleTipsRoute } from "../../src/api/tips";
import { queueOutbound } from "../../src/lib/outbound-jobs";
import { ROUTE_POLICIES } from "../../src/lib/route-policy";

const ENV = { STAFF_PAYOUT_KEY: Buffer.alloc(32, 7).toString("base64") };
const STAFF = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";

function challenge() {
  return handleTipsRoute(
    new Request("https://merchant.test/api/tips/me/payout-details/challenge", {
      method: "POST",
    }),
    ENV,
  );
}

function save(body: Record<string, unknown>) {
  return handleTipsRoute(
    new Request("https://merchant.test/api/tips/me/payout-details", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    ENV,
  );
}

const GOOD = {
  method: "mpesa",
  accountName: "Amina Otieno",
  bankName: null,
  accountNumber: "+254712345678",
  code: "123456",
};

function wroteDestination(): boolean {
  return h.queries.some(({ text }) => /INSERT INTO staff_payout_details/i.test(text));
}

beforeEach(() => {
  h.queries.length = 0;
  h.state.staffPhone = "+254712345678";
  h.state.otp = { id: "otp_1", code_hash: "hash", attempts: 0 };
  h.state.codeMatches = true;
  vi.clearAllMocks();
});

describe("payout step-up — the code goes to the record, not the request", () => {
  it("sends to the phone stored on the staff row", async () => {
    const res = await challenge();
    expect(res.status).toBe(200);
    const sent = vi.mocked(queueOutbound).mock.calls[0][1];
    expect(sent.handle).toBe("+254712345678");
    expect(sent.channel).toBe("whatsapp");
    // Security codes must bypass marketing consent, or a staff member who opted
    // out of marketing could never be paid.
    expect(sent.purpose).toBe("authentication");
  });

  it("returns only a masked number, never the full one", async () => {
    const body = (await (await challenge()).json()) as { sentTo: string };
    expect(body.sentTo).not.toContain("254712");
    expect(body.sentTo.endsWith("5678")).toBe(true);
  });

  it("ignores any phone the caller tries to supply", async () => {
    const res = await handleTipsRoute(
      new Request("https://merchant.test/api/tips/me/payout-details/challenge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: "+254799999999" }),
      }),
      ENV,
    );
    expect(res.status).toBe(200);
    expect(vi.mocked(queueOutbound).mock.calls[0][1].handle).toBe("+254712345678");
  });

  it("refuses to issue a code when the staff record has no phone", async () => {
    h.state.staffPhone = null;
    const res = await challenge();
    expect(res.status).toBe(409);
    expect(queueOutbound).not.toHaveBeenCalled();
  });

  it("binds the stored code to this staff member's own purpose", async () => {
    await challenge();
    const insert = h.queries.find(({ text }) => /INSERT INTO auth_otps/i.test(text));
    expect(insert).toBeDefined();
    expect(insert?.values).toContain(`payout:${STAFF}`);
  });

  it("invalidates any older live code so a stale message cannot be used", async () => {
    await challenge();
    const supersede = h.queries.find(
      ({ text }) => /UPDATE auth_otps SET consumed_at/i.test(text) && /purpose/i.test(text),
    );
    expect(supersede).toBeDefined();
  });
});

describe("payout step-up — no confirmation, no write", () => {
  it("rejects a request with no code and writes nothing", async () => {
    const { code: _omitted, ...noCode } = GOOD;
    const res = await save(noCode);
    expect(res.status).toBe(401);
    expect(wroteDestination()).toBe(false);
  });

  it("rejects a wrong code and writes nothing", async () => {
    h.state.codeMatches = false;
    const res = await save(GOOD);
    expect(res.status).toBe(401);
    expect(wroteDestination()).toBe(false);
  });

  it("counts a wrong code against the attempt budget", async () => {
    h.state.codeMatches = false;
    await save(GOOD);
    expect(
      h.queries.some(({ text }) => /SET attempts = attempts \+ 1/i.test(text)),
    ).toBe(true);
  });

  it("rejects an expired code and writes nothing", async () => {
    h.state.otp = null;
    const res = await save(GOOD);
    expect(res.status).toBe(401);
    expect(wroteDestination()).toBe(false);
  });

  it("locks out after too many attempts rather than allowing unlimited guesses", async () => {
    h.state.otp = { id: "otp_1", code_hash: "hash", attempts: 5 };
    const res = await save(GOOD);
    expect(res.status).toBe(429);
    expect(wroteDestination()).toBe(false);
  });

  it("refuses when the staff phone was removed after the code was issued", async () => {
    h.state.staffPhone = null;
    const res = await save(GOOD);
    expect(res.status).toBe(409);
    expect(wroteDestination()).toBe(false);
  });
});

describe("payout step-up — the happy path still works", () => {
  it("writes the destination and records which number confirmed it", async () => {
    const res = await save(GOOD);
    expect(res.status).toBe(200);
    const insert = h.queries.find(({ text }) =>
      /INSERT INTO staff_payout_details/i.test(text),
    );
    expect(insert).toBeDefined();
    expect(insert?.values).toContain("+254712345678");
  });

  it("burns the code so it cannot be replayed", async () => {
    await save(GOOD);
    expect(
      h.queries.some(({ text }) => /UPDATE auth_otps SET consumed_at = now\(\) WHERE id/i.test(text)),
    ).toBe(true);
  });

  it("never returns the account number it was given", async () => {
    const body = JSON.stringify(await (await save(GOOD)).json());
    expect(body).not.toContain("254712345678");
  });

  it("does not burn the code when the details themselves are invalid", async () => {
    // Otherwise a typo costs the staff member a code and a fresh WhatsApp round trip.
    const res = await save({ ...GOOD, accountName: "" });
    expect(res.status).toBe(400);
    expect(
      h.queries.some(({ text }) => /UPDATE auth_otps SET consumed_at = now\(\) WHERE id/i.test(text)),
    ).toBe(false);
  });
});

describe("payout step-up — route policy", () => {
  it("registers the challenge as human-only and credential-class", () => {
    const policy = ROUTE_POLICIES.find(
      (r) => r.path === "/api/tips/me/payout-details/challenge",
    );
    expect(policy).toBeDefined();
    // A personal access token has no person behind it and must never be able to
    // start a payout change.
    expect(policy?.access).toBe("human-only");
    expect(policy?.sensitivity).toBe("credential");
    expect(policy?.minimumVenueRole).toBe("staff");
  });
});
