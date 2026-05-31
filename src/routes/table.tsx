import { createFileRoute } from "@tanstack/react-router";
import { QrCode, ScanLine } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";

export const Route = createFileRoute("/table")({
  component: TableLandingPage,
});

function TableLandingPage() {
  const [tableNumber, setTableNumber] = useState("");
  const [error, setError] = useState("");

  const search = useMemo(() => {
    if (typeof window === "undefined") return new URLSearchParams();
    return new URLSearchParams(window.location.search);
  }, []);

  useEffect(() => {
    const encoded = search.get("t");
    if (!encoded) return;

    try {
      const decoded = JSON.parse(atob(encoded)) as Record<string, unknown>;
      const rawTable =
        decoded.table ??
        decoded.tableId ??
        decoded.tableNumber ??
        (typeof decoded.meta === "object" &&
        decoded.meta &&
        "table" in decoded.meta
          ? decoded.meta.table
          : undefined);

      const resolvedTable = String(rawTable ?? "").trim();
      if (!resolvedTable) {
        setError("We couldn't read a table number from that QR code.");
        return;
      }

      const params = new URLSearchParams(window.location.search);
      params.delete("t");
      const nextSearch = params.toString();
      window.location.replace(
        `/table/${encodeURIComponent(resolvedTable)}${
          nextSearch ? `?${nextSearch}` : ""
        }`,
      );
    } catch {
      setError("That QR code link looks invalid. Enter your table manually.");
    }
  }, [search]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = tableNumber.trim();
    if (!normalized) {
      setError("Enter a table number to continue.");
      return;
    }

    const params = new URLSearchParams(window.location.search);
    params.delete("t");
    const nextSearch = params.toString();
    window.location.assign(
      `/table/${encodeURIComponent(normalized)}${
        nextSearch ? `?${nextSearch}` : ""
      }`,
    );
  };

  return (
    <main className="min-h-screen bg-slate-950 px-5 py-10 text-white">
      <div className="mx-auto flex min-h-[80vh] w-full max-w-[390px] flex-col justify-center gap-6">
        <div className="rounded-[28px] border border-white/10 bg-white/5 p-6 shadow-2xl shadow-emerald-950/20">
          <div className="mb-5 inline-flex rounded-full bg-emerald-500/15 p-3 text-emerald-300">
            <QrCode className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-semibold">Start your table order</h1>
          <p className="mt-2 text-sm text-slate-300">
            Scan the QR code on your table or enter the table number manually.
          </p>

          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            <label className="block text-sm font-medium text-slate-200">
              Table number
              <input
                autoComplete="off"
                className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-slate-900 px-4 text-base outline-none ring-0 transition focus:border-emerald-400"
                inputMode="numeric"
                onChange={(event) => setTableNumber(event.target.value)}
                placeholder="e.g. 5"
                value={tableNumber}
              />
            </label>
            {error ? <p className="text-sm text-amber-300">{error}</p> : null}
            <button
              className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 text-base font-semibold text-slate-950 transition hover:bg-emerald-400"
              type="submit"
            >
              <ScanLine className="h-5 w-5" />
              Continue to table
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-slate-400">
          Tip: if you scanned an older QR format, we’ll automatically forward
          you to the correct table page.
        </p>
      </div>
    </main>
  );
}
