import { CloudOff, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Distinguishes "there is nothing here" from "we could not reach the server".
 *
 * Several list pages caught a failed load and set an empty array, so a backend
 * outage was indistinguishable from an empty account: the operator sat looking
 * at "no invoices" while invoices existed. This says which it is and offers the
 * way out, rather than leaving a dead end.
 */
export function LoadFailure({
  what,
  onRetry,
  retrying = false,
}: {
  /** The thing that failed to load, lower case: "invoices", "conversations". */
  what: string;
  onRetry: () => void;
  retrying?: boolean;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card/50 p-8 text-center"
    >
      <CloudOff className="size-8 text-muted-foreground" aria-hidden="true" />
      <div>
        <p className="text-sm font-medium">Couldn&apos;t load your {what}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          This is a connection problem, not missing data — nothing has been lost.
        </p>
      </div>
      <Button variant="outline" className="gap-2" onClick={onRetry} disabled={retrying}>
        <RotateCcw className={`size-4 ${retrying ? "animate-spin" : ""}`} />
        {retrying ? "Retrying…" : "Try again"}
      </Button>
    </div>
  );
}
