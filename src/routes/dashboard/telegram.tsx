import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, RefreshCw, Send } from "lucide-react";
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

export const Route = createFileRoute("/dashboard/telegram")({
  component: TelegramPage,
});

type Status = {
  connected: boolean;
  username?: string;
  name?: string;
  error?: string;
};

function TelegramPage() {
  const venue = useMemo(() => getCurrentVenueId(), []);
  const [hasToken, setHasToken] = useState(false);
  const [bridgeEnabled, setBridgeEnabled] = useState(false);
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);

  async function loadConfig() {
    try {
      const res = await fetch(`/api/telegram/config?venue=${venue}`);
      const data = (await res.json()) as {
        hasToken: boolean;
        bridgeEnabled: boolean;
      };
      setHasToken(data.hasToken);
      setBridgeEnabled(data.bridgeEnabled);
    } catch {
      /* offline */
    }
  }

  async function checkStatus() {
    setChecking(true);
    try {
      const res = await fetch(`/api/telegram/status?venue=${venue}`);
      setStatus((await res.json()) as Status);
    } catch {
      setStatus({ connected: false, error: "offline" });
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    loadConfig();
    checkStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venue]);

  async function save() {
    if (!token.trim()) {
      toast.error("Paste your bot token from @BotFather.");
      return;
    }
    setSaving(true);
    try {
      const res = await authFetch(`/api/telegram/config?venue=${venue}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ botToken: token.trim() }),
      });
      if (!res.ok) throw new Error("failed");
      toast.success("Token saved. Connecting…");
      setToken("");
      await loadConfig();
      await checkStatus();
    } catch {
      toast.error("Could not save (cloud backend offline).");
    } finally {
      setSaving(false);
    }
  }

  async function useWebhook() {
    try {
      const res = await authFetch("/api/telegram/webhook/set", { method: "POST" });
      const data = (await res.json()) as { ok?: boolean; description?: string };
      if (data.ok) toast.success("Production webhook registered.");
      else toast.error(data.description ?? "Webhook needs a public HTTPS URL.");
    } catch {
      toast.error("Could not set webhook.");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">
            Telegram connection
          </h2>
          <p className="text-sm text-muted-foreground">
            The same AI agent — bookings, menu, FAQ, bills — on Telegram. Uses the
            official Bot API.
          </p>
        </div>
        {status?.connected ? (
          <Badge className="gap-1 bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
            <CheckCircle2 className="h-3.5 w-3.5" /> @{status.username}
          </Badge>
        ) : (
          <Badge variant="outline">Not connected</Badge>
        )}
      </div>

      <Card className="border-slate-200 bg-white/90 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Send className="h-4 w-4 text-sky-500" /> Connect your bot
          </CardTitle>
          <CardDescription>
            In Telegram, message <b>@BotFather</b> → <code>/newbot</code> → copy
            the token it gives you and paste it below.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="space-y-1">
            <span className="text-xs font-medium text-slate-600">Bot token</span>
            <Input
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder={hasToken ? "•••••• (saved)" : "123456:ABC-DEF…"}
            />
          </label>

          {status && !status.connected && status.error && hasToken && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              {status.error}
            </p>
          )}
          {status?.connected && (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
              Connected as <b>@{status.username}</b>
              {status.name ? ` (${status.name})` : ""}.{" "}
              {bridgeEnabled
                ? "Receiving messages via the bridge (long polling)."
                : "Start the bridge to receive messages, or set a production webhook."}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1"
              onClick={checkStatus}
              disabled={checking}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {checking ? "Checking…" : "Recheck"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={useWebhook}
              disabled={!hasToken}
            >
              Use webhook (production)
            </Button>
            <Button type="button" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save &amp; connect"}
            </Button>
          </div>

          <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-[12px] text-slate-600">
            <b>Quick start (local):</b> save your token and keep the bridge
            running (<code>docker compose up -d whatsapp-bridge</code>) — it polls
            Telegram for you, no public URL needed. <b>Production:</b> deploy with
            a public HTTPS URL and click <i>Use webhook</i>.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
