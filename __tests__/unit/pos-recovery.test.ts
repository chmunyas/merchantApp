import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  rows: [{ venue_id: "venue-a" }, { venue_id: "venue-b" }] as Array<{
    venue_id: string;
  }>,
  sync: vi.fn(),
  tender: vi.fn(),
}));

vi.mock("../../src/lib/pos-checks", () => ({
  syncOpenChecks: harness.sync,
}));

vi.mock("../../src/lib/pos-tender-jobs", () => ({
  runTenderPushWorker: harness.tender,
}));

import { runPosRecovery } from "../../src/lib/pos-recovery";

function sqlStub() {
  return ((_: TemplateStringsArray) => Promise.resolve(harness.rows)) as never;
}

describe("POS scheduled recovery", () => {
  beforeEach(() => {
    harness.rows = [{ venue_id: "venue-a" }, { venue_id: "venue-b" }];
    harness.sync.mockReset();
    harness.tender.mockReset();
    harness.tender.mockResolvedValue({
      claimed: 2,
      notified: 1,
      unsynced: 0,
      retrying: 1,
    });
  });

  it("refreshes every connected venue before delivering leased tender pushes", async () => {
    harness.sync.mockResolvedValue({ ok: true, pulled: 1, saved: 1 });

    const result = await runPosRecovery(sqlStub(), {}, 17);

    expect(harness.sync).toHaveBeenCalledTimes(2);
    expect(harness.sync).toHaveBeenNthCalledWith(1, expect.anything(), {}, "venue-a");
    expect(harness.sync).toHaveBeenNthCalledWith(2, expect.anything(), {}, "venue-b");
    expect(harness.tender).toHaveBeenCalledWith(expect.anything(), {}, 17);
    expect(result).toEqual({
      venues: 2,
      synced: 2,
      syncFailed: 0,
      tender: { claimed: 2, notified: 1, unsynced: 0, retrying: 1 },
    });
  });

  it("isolates a failed venue sync and still delivers tender pushes", async () => {
    harness.sync
      .mockResolvedValueOnce({ ok: false, error: "provider_error" })
      .mockResolvedValueOnce({ ok: true, pulled: 3, saved: 3 });

    const result = await runPosRecovery(sqlStub(), {});

    expect(harness.tender).toHaveBeenCalledOnce();
    expect(result.synced).toBe(1);
    expect(result.syncFailed).toBe(1);
  });

  it("runs tender delivery even when no venue currently has a connected POS", async () => {
    harness.rows = [];

    const result = await runPosRecovery(sqlStub(), {});

    expect(harness.sync).not.toHaveBeenCalled();
    expect(harness.tender).toHaveBeenCalledOnce();
    expect(result.venues).toBe(0);
  });
});
