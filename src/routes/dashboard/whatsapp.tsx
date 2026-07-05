import { createFileRoute } from "@tanstack/react-router";
import {
  CheckCircle2,
  Cloud,
  Copy,
  QrCode,
  RefreshCw,
  Smartphone,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import { getCurrentVenueId } from "@/lib/merchant-dashboard";
import { authFetch } from "@/lib/auth";

export const Route = createFileRoute("/dashboard/whatsapp")({
  component: WhatsappPage,
});

type BridgeStatus = {
  enabled: boolean;
  status?: string;
  connected?: boolean;
  number?: string | null;
  hasQR?: boolean;
};

type CloudConfig = {
  hasToken: boolean;
  phoneId: string;
  verifyToken: string;
  webhookUrl: string;
  bridgeEnabled: boolean;
  transport: string;
};

const STATUS_LABEL: Record<string, string> = {
  open: "Connected",
  qr: "Awaiting scan",
  connecting: "Connecting…",
  starting: "Starting…",
  logged_out: "Not linked",
  offline: "Bridge offline",
};

function WhatsappPage() {
  const venue = useMemo(() => getCurrentVenueId(), []);
  const [bridge, setBridge] = useState<BridgeStatus | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [cloud, setCloud] = useState<CloudConfig | null>(null);
  const [token, setToken] = useState("");
  const [phoneId, setPhoneId] = useState("");
  const [verifyToken, setVerifyToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [transport, setTransport] = useState("auto");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  async function loadBridge() {
    try {
      const res = await fetch("/api/whatsapp/bridge/status");
      const data = (await res.json()) as BridgeStatus;
      setBridge(data);
      if (data.enabled && data.status === "qr") {
        const qrRes = await fetch("/api/whatsapp/bridge/qr");
        const qrData = (await qrRes.json()) as { qr?: string | null };
        setQr(qrData.qr ?? null);
      } else {
        setQr(null);
      }
    } catch {
      setBridge({ enabled: false });
    }
  }

  async function loadCloud() {
    try {
      const res = await fetch(`/api/whatsapp/config?venue=${venue}`);
      const data = (await res.json()) as CloudConfig;
      setCloud(data);
      setPhoneId(data.phoneId ?? "");
      setVerifyToken(data.verifyToken ?? "");
      setTransport(data.transport ?? "auto");
    } catch {
      setCloud(null);
    }
  }

  useEffect(() => {
    loadBridge();
    loadCloud();
    const timer = setInterval(loadBridge, 3000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venue]);

  async function saveCloud() {
    setSaving(true);
    try {
      const res = await authFetch(`/api/whatsapp/config?venue=${venue}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, phoneId, verifyToken, transport }),
      });
      if (!res.ok) throw new Error("failed");
      toast.success("WhatsApp Cloud API settings saved.");
      setToken("");
      await loadCloud();
    } catch {
      toast.error("Could not save (cloud backend offline).");
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await authFetch(`/api/whatsapp/test?venue=${venue}`, {
        method: "POST",
      });
      const data = (await res.json()) as {
        ok?: boolean;
        number?: string;
        name?: string;
        error?: string;
      };
      if (data.ok) {
        setTestResult(
          `Connected: ${data.number}${data.name ? ` (${data.name})` : ""}`,
        );
        toast.success("Cloud API verified.");
      } else {
        setTestResult(data.error ?? "Verification failed.");
        toast.error(data.error ?? "Verification failed.");
      }
    } catch {
      setTestResult("Could not reach the server.");
    } finally {
      setTesting(false);
    }
  }

  async function updateTransport(next: string) {
    setTransport(next);
    try {
      await authFetch(`/api/whatsapp/config?venue=${venue}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transport: next }),
      });
      toast.success("Active WhatsApp transport updated.");
      await loadCloud();
    } catch {
      toast.error("Could not update transport.");
    }
  }

  async function logoutBridge() {
    try {
      await fetch("/api/whatsapp/bridge/logout", { method: "POST" });
      toast.success("Unlinked. A new QR will appear shortly.");
      await loadBridge();
    } catch {
      toast.error("Could not unlink.");
    }
  }

  function copy(value: string) {
    navigator.clipboard?.writeText(value).then(
      () => toast.success("Copied."),
      () => toast.error("Copy failed."),
    );
  }

  const bridgeStatus = bridge?.status ?? (bridge?.enabled ? "starting" : "off");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-950">
          WhatsApp connection
        </h2>
        <p className="text-sm text-muted-foreground">
          Link your business line two ways: scan a QR to go live now, or connect
          the official Cloud API for production.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Baileys QR bridge */}
        <Card className="border-slate-200 bg-white/90 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Smartphone className="h-4 w-4 text-emerald-600" /> Link by QR
              (quick start)
              {bridge?.connected ? (
                <Badge className="ml-auto gap-1 bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {bridge.number ?? "Connected"}
                </Badge>
              ) : (
                <Badge variant="outline" className="ml-auto">
                  {STATUS_LABEL[bridgeStatus] ?? "Off"}
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              Scan from your phone: WhatsApp → Linked Devices → Link a device.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!bridge?.enabled ? (
              <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-sm text-muted-foreground">
                The bridge service isn't running. Start it with{" "}
                <code className="rounded bg-slate-200 px-1">
                  docker compose up -d whatsapp-bridge
                </code>
                .
              </p>
            ) : bridge.connected ? (
              <div className="space-y-3 text-center">
                <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
                <p className="text-sm text-slate-700">
                  Linked as{" "}
                  <span className="font-semibold">{bridge.number}</span>. Message
                  this number to run the CRM.
                </p>
                <Button type="button" variant="outline" onClick={logoutBridge}>
                  Unlink device
                </Button>
              </div>
            ) : qr ? (
              <div className="flex flex-col items-center gap-2">
                <img
                  src={qr}
                  alt="WhatsApp pairing QR"
                  className="h-56 w-56 rounded-lg ring-1 ring-slate-100"
                />
                <p className="text-xs text-muted-foreground">
                  Waiting for you to scan…
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
                <QrCode className="h-10 w-10 opacity-40" />
                <p className="text-sm">{STATUS_LABEL[bridgeStatus] ?? "…"}</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="gap-1"
                  onClick={loadBridge}
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Refresh
                </Button>
              </div>
            )}
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-700">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Uses the unofficial WhatsApp Web protocol (against WhatsApp ToS —
              ban risk). Great for a quick start; use the Cloud API for
              production.
            </div>
          </CardContent>
        </Card>

        {/* Cloud API wizard */}
        <Card className="border-slate-200 bg-white/90 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Cloud className="h-4 w-4 text-blue-600" /> Official Cloud API
              (production)
              {cloud?.hasToken ? (
                <Badge className="ml-auto gap-1 bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Configured
                </Badge>
              ) : (
                <Badge variant="outline" className="ml-auto">
                  Not set
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              From Meta Business → WhatsApp → API setup. Compliant and stable.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-600">
                Access token
              </span>
              <Input
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder={cloud?.hasToken ? "•••••• (saved)" : "EAAG…"}
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-600">
                Phone number ID
              </span>
              <Input
                value={phoneId}
                onChange={(event) => setPhoneId(event.target.value)}
                placeholder="1234567890"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-600">
                Verify token
              </span>
              <Input
                value={verifyToken}
                onChange={(event) => setVerifyToken(event.target.value)}
                placeholder="pesaswap-verify"
              />
            </label>
            {cloud?.webhookUrl && (
              <div className="space-y-1">
                <span className="text-xs font-medium text-slate-600">
                  Webhook callback URL
                </span>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded-md bg-slate-100 px-2 py-1.5 text-xs">
                    {cloud.webhookUrl}
                  </code>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() => copy(cloud.webhookUrl)}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
            <div className="space-y-1">
              <span className="text-xs font-medium text-slate-600">
                Active outbound transport
              </span>
              <select
                value={transport}
                onChange={(event) => updateTransport(event.target.value)}
                className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm"
              >
                <option value="auto">Auto — bridge, then Cloud API</option>
                <option value="bridge">Baileys bridge only (quick start)</option>
                <option value="cloud">Cloud API only (production)</option>
              </select>
            </div>
            {testResult && (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">
                {testResult}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={testConnection}
                disabled={testing}
              >
                {testing ? "Testing…" : "Test connection"}
              </Button>
              <Button type="button" onClick={saveCloud} disabled={saving}>
                {saving ? "Saving…" : "Save Cloud API settings"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
