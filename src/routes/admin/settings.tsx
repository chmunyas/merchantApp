import { createFileRoute } from "@tanstack/react-router";
import { Loader2, QrCode, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authFetch } from "@/lib/auth";
import { clearKeQrConfigCache } from "@/lib/ke-qr-config";

export const Route = createFileRoute("/admin/settings")({
  component: AdminSettingsPage,
});

type KeQrConfig = { pspId: string | null; mcc: string | null; city: string | null };

function AdminSettingsPage() {
  const [pspId, setPspId] = useState("");
  const [mcc, setMcc] = useState("");
  const [city, setCity] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await authFetch("/api/ke-qr-config");
        if (res.ok) {
          const cfg = (await res.json()) as KeQrConfig;
          setPspId(cfg.pspId ?? "");
          setMcc(cfg.mcc ?? "");
          setCity(cfg.city ?? "");
        }
      } catch {
        /* leave blank */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function save() {
    setSaving(true);
    try {
      const res = await authFetch("/api/ke-qr-config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pspId: pspId.trim() || null,
          mcc: mcc.trim() || null,
          city: city.trim() || null,
        }),
      });
      if (!res.ok) throw new Error("save failed");
      clearKeQrConfigCache();
      toast.success("KE-QR settings saved");
    } catch {
      toast.error("Could not save settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-500/15 text-violet-300">
            <QrCode className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-xl font-semibold text-white">
              KE-QR (CBK national standard)
            </h3>
            <p className="mt-1 text-sm text-slate-400">
              Platform-wide identifiers embedded in every KE-QR payment code. All
              fields are optional — leave blank to use the national defaults.
            </p>
          </div>
        </div>

        <div className="mt-6 max-w-xl space-y-5">
          <div>
            <label className="text-sm font-medium text-slate-200">
              Acquiring PSP ID (from the CBK directory)
            </label>
            <p className="mb-2 text-xs text-slate-500">
              Issued once PesaSwap completes PSP registration. Until set, KE-QR
              codes are structurally valid and CRC-verified but not yet routable
              by other banks. Flipping this in makes them interoperable — no
              deploy required.
            </p>
            <Input
              value={pspId}
              onChange={(e) => setPspId(e.target.value)}
              placeholder="e.g. PSP0001 (optional)"
              className="border-slate-700 bg-slate-950 text-slate-100"
              disabled={loading}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium text-slate-200">
                Merchant Category Code (MCC)
              </label>
              <Input
                value={mcc}
                onChange={(e) => setMcc(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))}
                placeholder="5812 (default)"
                className="mt-2 border-slate-700 bg-slate-950 text-slate-100"
                disabled={loading}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-200">
                Merchant City
              </label>
              <Input
                value={city}
                onChange={(e) => setCity(e.target.value.slice(0, 15))}
                placeholder="Nairobi (default)"
                className="mt-2 border-slate-700 bg-slate-950 text-slate-100"
                disabled={loading}
              />
            </div>
          </div>

          <Button
            onClick={save}
            disabled={saving || loading}
            className="rounded-xl bg-violet-500 text-white hover:bg-violet-400"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save KE-QR settings
          </Button>
        </div>
      </section>
    </div>
  );
}
