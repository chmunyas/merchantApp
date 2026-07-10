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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { authFetch } from "@/lib/auth";

export const Route = createFileRoute("/dashboard/api-keys")({
  component: ApiKeysPage,
});

type Token = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  role: string;
  createdBy: string | null;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

function ApiKeysPage() {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [catalog, setCatalog] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [role, setRole] = useState("staff");
  const [expiresInDays, setExpiresInDays] = useState("");
  const [scopes, setScopes] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);

  async function load() {
    const res = await authFetch("/api/tokens");
    if (res.ok) {
      const data = (await res.json()) as { tokens: Token[]; scopes: string[] };
      setTokens(data.tokens ?? []);
      setCatalog(data.scopes ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  function toggleScope(s: string) {
    setScopes((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  async function create() {
    if (!name.trim()) {
      toast.error("Give the token a name.");
      return;
    }
    if (scopes.size === 0) {
      toast.error("Select at least one scope.");
      return;
    }
    setCreating(true);
    try {
      const res = await authFetch("/api/tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          scopes: [...scopes],
          role,
          expiresInDays: expiresInDays ? Number(expiresInDays) : undefined,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        token?: string;
        error?: string;
      };
      if (!res.ok || !body.token) {
        toast.error(body.error ?? "Could not create the token.");
        return;
      }
      setNewToken(body.token);
      setName("");
      setScopes(new Set());
      setExpiresInDays("");
      await load();
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string) {
    const res = await authFetch(`/api/tokens/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Could not revoke.");
      return;
    }
    toast.success("Token revoked.");
    await load();
  }

  function statusOf(t: Token): { label: string; variant: "secondary" | "destructive" | "outline" } {
    if (t.revokedAt) return { label: "Revoked", variant: "outline" };
    if (t.expiresAt && new Date(t.expiresAt) < new Date())
      return { label: "Expired", variant: "outline" };
    return { label: "Active", variant: "secondary" };
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">API keys</h1>
        <p className="text-sm text-muted-foreground">
          Scoped, revocable tokens so agents and integrations can act on your behalf —
          separate from your login. Use as{" "}
          <code className="text-xs">Authorization: Bearer pat_…</code>
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Create a token</CardTitle>
          <CardDescription>
            The token is shown once. Grant only the scopes it needs.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Input
              placeholder="Name (e.g. Ordering bot)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="sm:col-span-1"
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="h-10 rounded-md border border-border bg-background px-3 text-sm"
            >
              <option value="staff">Staff</option>
              <option value="supervisor">Supervisor</option>
              <option value="manager">Manager</option>
            </select>
            <Input
              type="number"
              min={1}
              placeholder="Expires in days (optional)"
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(e.target.value)}
            />
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">Scopes</p>
            <div className="flex flex-wrap gap-2">
              {catalog.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleScope(s)}
                  className={`rounded-full border px-3 py-1 text-xs ${
                    scopes.has(s)
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <Button onClick={() => void create()} disabled={creating}>
            {creating ? "Creating…" : "Create token"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your tokens</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : tokens.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No tokens yet. Create one above to let an agent act for you.
            </p>
          ) : (
            tokens.map((t) => {
              const st = statusOf(t);
              return (
                <div
                  key={t.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{t.name}</span>
                      <Badge variant={st.variant}>{st.label}</Badge>
                      <code className="text-xs text-muted-foreground">{t.prefix}…</code>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Badge variant="outline">{t.role}</Badge>
                      {t.scopes.map((s) => (
                        <Badge key={s} variant="outline" className="font-normal">
                          {s}
                        </Badge>
                      ))}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t.lastUsedAt
                        ? `Last used ${new Date(t.lastUsedAt).toLocaleString()}`
                        : "Never used"}
                      {t.expiresAt
                        ? ` · expires ${new Date(t.expiresAt).toLocaleDateString()}`
                        : ""}
                    </p>
                  </div>
                  {!t.revokedAt && (
                    <Button
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => void revoke(t.id)}
                    >
                      Revoke
                    </Button>
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <Dialog open={!!newToken} onOpenChange={(o) => !o && setNewToken(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copy your token now</DialogTitle>
            <DialogDescription>
              This is the only time you'll see it. Store it somewhere safe.
            </DialogDescription>
          </DialogHeader>
          <div className="break-all rounded-lg bg-muted p-3 font-mono text-sm">
            {newToken}
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                void navigator.clipboard?.writeText(newToken ?? "");
                toast.success("Copied");
                setNewToken(null);
              }}
            >
              Copy &amp; close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
