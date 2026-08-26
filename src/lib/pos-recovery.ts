// C5.5 / C5.11 — scheduled recovery for the vendor-neutral POS contract.
//
// POS network calls must never happen inside the payment transaction. This job
// first refreshes each connected venue's open checks, then lets the existing
// leased tender worker deliver queued PesaSwap settlements to the provider's
// mapped tender. A failure for one venue is recorded by its connector and does
// not prevent the remaining venues from being serviced.

import type { Sql } from "@/lib/db";
import { syncOpenChecks } from "@/lib/pos-checks";
import { runTenderPushWorker, type TenderWorkerResult } from "@/lib/pos-tender-jobs";

export type PosRecoveryResult = {
  venues: number;
  synced: number;
  syncFailed: number;
  tender: TenderWorkerResult;
};

export async function runPosRecovery(
  sql: Sql,
  env: unknown,
  tenderLimit = 50,
): Promise<PosRecoveryResult> {
  const venues = await sql`
    SELECT DISTINCT venue_id
    FROM pos_connections
    WHERE status = 'connected'
    ORDER BY venue_id`;

  let synced = 0;
  let syncFailed = 0;
  for (const row of venues) {
    try {
      const outcome = await syncOpenChecks(sql, env, String(row.venue_id));
      if (outcome.ok) synced += 1;
      else syncFailed += 1;
    } catch (error) {
      syncFailed += 1;
      console.error(`[pos-recovery:${String(row.venue_id)}]`, error);
    }
  }

  // The worker claims due rows under its own lease, so it is safe for cron and
  // a manager-triggered run to overlap without double-tendering a POS check.
  const tender = await runTenderPushWorker(sql, env, tenderLimit);
  return { venues: venues.length, synced, syncFailed, tender };
}
