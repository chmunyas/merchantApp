import { createFileRoute } from "@tanstack/react-router";
import { Copy, Loader2, Plus, Printer, QrCode } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { authFetch } from "@/lib/auth";

export const Route = createFileRoute("/dashboard/qr")({
  component: DashboardQrPage,
});

type QrCodeRow = {
  id: string;
  venue_id: string;
  label: string | null;
  table_id: string | null;
  table_label: string | null;
  kind: string;
  created_at: string;
};

type DiningTable = {
  id: string;
  label: string;
};

function DashboardQrPage() {
  const [origin, setOrigin] = useState("");
  const [codes, setCodes] = useState<QrCodeRow[]>([]);
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState("venue");
  const [tableId, setTableId] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
    void load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const [codesRes, tablesRes] = await Promise.all([
        authFetch("/api/qr"),
        authFetch("/api/tables"),
      ]);
      if (codesRes.ok) {
        const data = (await codesRes.json()) as { codes?: QrCodeRow[] };
        setCodes(data.codes ?? []);
      }
      if (tablesRes.ok) {
        const data = (await tablesRes.json()) as { tables?: DiningTable[] };
        setTables(data.tables ?? []);
      }
    } catch {
      toast.error("Could not load QR codes");
    } finally {
      setLoading(false);
    }
  }

  async function createCode() {
    setCreating(true);
    try {
      const res = await authFetch("/api/qr", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          label: label.trim() || null,
          kind,
          table_id: tableId || null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        code?: QrCodeRow;
        error?: string;
      };
      const created = data.code;
      if (!res.ok || !created) throw new Error(data.error ?? "Create failed");
      setCodes((current) => [created, ...current]);
      setLabel("");
      setKind("venue");
      setTableId("");
      toast.success("QR code created");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create QR");
    } finally {
      setCreating(false);
    }
  }

  const latestUrl = useMemo(
    () => (codes[0] && origin ? `${origin}/q/${codes[0].id}` : ""),
    [codes, origin],
  );

  return (
    <div className="space-y-6">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .qr-print, .qr-print * { visibility: visible; }
          .qr-print { position: absolute; inset: 0; padding: 32px; background: white; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-black">
            <QrCode className="h-6 w-6" />
            Unified QR codes
          </h1>
          <p className="text-sm text-muted-foreground">
            One scan lets guests browse, order, pay, enroll, and keep receipts.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => window.print()}
          className="no-print"
          disabled={!latestUrl}
        >
          <Printer className="h-4 w-4" />
          Print
        </Button>
      </div>

      <Card className="no-print">
        <CardHeader>
          <CardTitle>Create a QR code</CardTitle>
          <CardDescription>
            Use a venue code for counter service or attach it to a dining table.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[1fr_160px_220px_auto]">
          <Input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Label, e.g. Patio table 4"
          />
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value)}
            className="h-9 rounded-md border bg-background px-3 text-sm"
          >
            <option value="venue">Venue</option>
            <option value="table">Table</option>
            <option value="counter">Counter</option>
          </select>
          <select
            value={tableId}
            onChange={(event) => setTableId(event.target.value)}
            className="h-9 rounded-md border bg-background px-3 text-sm"
          >
            <option value="">No table</option>
            {tables.map((table) => (
              <option key={table.id} value={table.id}>
                {table.label}
              </option>
            ))}
          </select>
          <Button type="button" onClick={createCode} disabled={creating}>
            {creating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Create
          </Button>
        </CardContent>
      </Card>

      {latestUrl ? (
        <Card className="qr-print">
          <CardHeader className="text-center">
            <CardTitle>Scan to order and pay</CardTitle>
            <CardDescription>{codes[0]?.label ?? "Venue QR"}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4">
            <div className="rounded-3xl bg-white p-4 shadow-sm">
              <QRCodeSVG value={latestUrl} size={220} level="M" />
            </div>
            <p className="break-all text-center font-mono text-xs text-muted-foreground">
              {latestUrl}
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card className="no-print">
        <CardHeader>
          <CardTitle>Existing codes</CardTitle>
          <CardDescription>
            Print or copy the guest URL for any active code.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : codes.length === 0 ? (
            <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              No QR codes yet. Create your first one above.
            </p>
          ) : (
            <div className="space-y-3">
              {codes.map((code) => {
                const url = origin ? `${origin}/q/${code.id}` : `/q/${code.id}`;
                return (
                  <div
                    key={code.id}
                    className="flex flex-col gap-3 rounded-2xl border p-4 md:flex-row md:items-center md:justify-between"
                  >
                    <div>
                      <p className="font-semibold">
                        {code.label ?? code.table_label ?? "Venue QR"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {code.kind} {code.table_label ? `• ${code.table_label}` : ""}
                      </p>
                      <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                        {url}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <QRCodeSVG value={url} size={80} level="M" />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          void navigator.clipboard?.writeText(url);
                          toast.success("Copied QR URL");
                        }}
                      >
                        <Copy className="h-4 w-4" />
                        Copy
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
