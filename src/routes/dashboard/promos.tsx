import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
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

export const Route = createFileRoute("/dashboard/promos")({
  component: DashboardPromosPage,
});

type PromoRow = {
  id: string;
  code: string;
  kind: "percent" | "fixed";
  value: number;
  min_order: number;
  max_discount: number;
  active: boolean;
  expires_at: string | null;
  usage_limit: number;
  used_count: number;
};

const empty = {
  code: "",
  kind: "percent" as "percent" | "fixed",
  value: "",
  minOrder: "",
  usageLimit: "",
  expiresAt: "",
};

function DashboardPromosPage() {
  const [codes, setCodes] = useState<PromoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState(empty);
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const res = await authFetch("/api/promo");
      if (res.ok) {
        setCodes(((await res.json()) as { codes: PromoRow[] }).codes ?? []);
      }
    } catch {
      toast.error("Couldn't load promo codes");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function create() {
    if (!draft.code.trim() || !Number(draft.value)) {
      toast.error("Code and value are required");
      return;
    }
    setSaving(true);
    try {
      const value =
        draft.kind === "fixed"
          ? Math.round(Number(draft.value) * 100)
          : Math.round(Number(draft.value));
      const res = await authFetch("/api/promo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: draft.code,
          kind: draft.kind,
          value,
          min_order: Math.round((Number(draft.minOrder) || 0) * 100),
          usage_limit: Math.round(Number(draft.usageLimit) || 0),
          expires_at: draft.expiresAt || undefined,
        }),
      });
      if (res.ok) {
        toast.success("Promo code created");
        setDraft(empty);
        void load();
      } else {
        const e = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(e.error ?? "Couldn't create the code");
      }
    } finally {
      setSaving(false);
    }
  }

  async function deactivate(id: string) {
    const res = await authFetch(`/api/promo/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Code deactivated");
      void load();
    }
  }

  function describe(c: PromoRow): string {
    const off =
      c.kind === "percent"
        ? `${c.value}% off`
        : `KES ${(c.value / 100).toLocaleString()} off`;
    const min =
      c.min_order > 0 ? ` · min KES ${(c.min_order / 100).toLocaleString()}` : "";
    return off + min;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Promo codes</h1>
        <p className="text-sm text-slate-500">
          Discount codes guests can apply when they order. Percentage or fixed
          amount, with optional minimum order, usage cap and expiry.
        </p>
      </div>

      <Card className="border-slate-200 bg-white/90 shadow-sm">
        <CardHeader>
          <CardTitle>New code</CardTitle>
          <CardDescription>
            Fixed amounts are in KES. Percentage is 0–100.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Input
              placeholder="CODE (e.g. WELCOME10)"
              value={draft.code}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  code: e.target.value.toUpperCase().replace(/\s+/g, ""),
                }))
              }
            />
            <select
              value={draft.kind}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  kind: e.target.value as "percent" | "fixed",
                }))
              }
              className="rounded-xl border border-slate-200 bg-background px-3 py-2 text-sm"
            >
              <option value="percent">Percentage %</option>
              <option value="fixed">Fixed KES</option>
            </select>
            <Input
              type="number"
              placeholder={draft.kind === "percent" ? "Percent (10)" : "KES off"}
              value={draft.value}
              onChange={(e) =>
                setDraft((d) => ({ ...d, value: e.target.value }))
              }
            />
            <Input
              type="number"
              placeholder="Min order KES (optional)"
              value={draft.minOrder}
              onChange={(e) =>
                setDraft((d) => ({ ...d, minOrder: e.target.value }))
              }
            />
            <Input
              type="number"
              placeholder="Usage limit (0 = ∞)"
              value={draft.usageLimit}
              onChange={(e) =>
                setDraft((d) => ({ ...d, usageLimit: e.target.value }))
              }
            />
            <Input
              type="date"
              value={draft.expiresAt}
              onChange={(e) =>
                setDraft((d) => ({ ...d, expiresAt: e.target.value }))
              }
            />
          </div>
          <div className="mt-3">
            <Button type="button" onClick={() => void create()} disabled={saving}>
              {saving ? "Creating…" : "Create code"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200 bg-white/90 shadow-sm">
        <CardHeader>
          <CardTitle>Your codes</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : codes.length === 0 ? (
            <p className="text-sm text-slate-500">No promo codes yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-slate-500">
                    <th className="py-2 pr-2">Code</th>
                    <th className="pr-2">Offer</th>
                    <th className="pr-2 text-right">Used</th>
                    <th className="pr-2">Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {codes.map((c) => (
                    <tr key={c.id} className="border-t border-slate-100">
                      <td className="py-2 pr-2 font-mono font-semibold text-slate-800">
                        {c.code}
                      </td>
                      <td className="pr-2 text-slate-600">{describe(c)}</td>
                      <td className="pr-2 text-right tabular-nums text-slate-500">
                        {c.used_count}
                        {c.usage_limit > 0 ? ` / ${c.usage_limit}` : ""}
                      </td>
                      <td className="pr-2">
                        <Badge
                          className={
                            c.active
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-slate-100 text-slate-500"
                          }
                        >
                          {c.active ? "active" : "off"}
                        </Badge>
                      </td>
                      <td className="text-right">
                        {c.active ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="border-rose-200 text-rose-600 hover:bg-rose-50"
                            onClick={() => void deactivate(c.id)}
                          >
                            Deactivate
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
