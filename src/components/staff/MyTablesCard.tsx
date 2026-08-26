import { useCallback, useEffect, useState } from "react";
import { Bell, BellRing, Check, Loader2 } from "lucide-react";

import { authFetch } from "@/lib/auth";

type TableOption = { key: string; label: string; section: string | null };
type TypeOption = {
  type: string;
  label: string;
  description: string;
  tableScoped: boolean;
  enabled: boolean;
};

type Settings = {
  tables: TableOption[];
  following: string[];
  types: TypeOption[];
};

/**
 * Shift-start control for a server's own alerts (roadmap B2.13 / B2.14).
 *
 * Sunday's model: the person working the floor taps the tables they are serving,
 * and only those tables page them. Two taps from opening the console — pick your
 * tables, done — because anything slower does not survive a real service.
 */
export function MyTablesCard() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [following, setFollowing] = useState<Set<string>>(new Set());
  const [unread, setUnread] = useState(0);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [showTypes, setShowTypes] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    authFetch("/api/staff-alerts/settings")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: Settings) => {
        if (cancelled) return;
        setSettings(data);
        setFollowing(new Set(data.following ?? []));
      })
      .catch(() => {
        if (!cancelled) setUnavailable(true);
      });
    authFetch("/api/staff-alerts")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d) setUnread(Number(d.unread) || 0);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(
    async (nextFollowing: Set<string>, nextTypes?: TypeOption[]) => {
      setStatus("saving");
      try {
        const body: Record<string, unknown> = {
          following: Array.from(nextFollowing),
        };
        if (nextTypes) {
          body.types = Object.fromEntries(
            nextTypes.map((t) => [t.type, t.enabled]),
          );
        }
        const res = await authFetch("/api/staff-alerts/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        setStatus(res.ok ? "saved" : "error");
      } catch {
        setStatus("error");
      }
    },
    [],
  );

  const toggleTable = (key: string) => {
    const next = new Set(following);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setFollowing(next);
    void save(next);
  };

  const toggleType = (type: string) => {
    if (!settings) return;
    const nextTypes = settings.types.map((t) =>
      t.type === type ? { ...t, enabled: !t.enabled } : t,
    );
    setSettings({ ...settings, types: nextTypes });
    void save(following, nextTypes);
  };

  if (unavailable) return null;

  return (
    <section
      className="rounded-2xl border border-border bg-card p-6"
      aria-labelledby="my-tables-heading"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {unread > 0 ? (
            <BellRing className="size-5 text-primary" aria-hidden="true" />
          ) : (
            <Bell className="size-5 text-muted-foreground" aria-hidden="true" />
          )}
          <h2 id="my-tables-heading" className="text-lg font-semibold">
            My tables
          </h2>
          {unread > 0 && (
            <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
              {unread} new
            </span>
          )}
        </div>
        <p aria-live="polite" className="text-sm text-muted-foreground">
          {status === "saving" && (
            <span className="inline-flex items-center gap-1">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              Saving
            </span>
          )}
          {status === "saved" && (
            <span className="inline-flex items-center gap-1 text-emerald-600">
              <Check className="size-3.5" aria-hidden="true" />
              Saved
            </span>
          )}
          {status === "error" && (
            <span className="text-destructive">Could not save — try again</span>
          )}
        </p>
      </div>

      <p className="mt-1 text-sm text-muted-foreground">
        Tap the tables you are serving. You will only be paged for these.
      </p>

      {settings == null ? (
        <p className="mt-4 text-sm text-muted-foreground">Loading your floor…</p>
      ) : settings.tables.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          No tables have been set up for this venue yet.
        </p>
      ) : (
        <ul className="mt-4 flex flex-wrap gap-2">
          {settings.tables.map((table) => {
            const on = following.has(table.key);
            return (
              <li key={table.key}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleTable(table.key)}
                  className={`min-h-11 min-w-11 rounded-xl border px-4 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    on
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background hover:border-foreground/30"
                  }`}
                >
                  {table.label}
                  {table.section ? (
                    <span className="ml-1 opacity-70">· {table.section}</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {settings != null && (
        <div className="mt-5 border-t border-border pt-4">
          <button
            type="button"
            onClick={() => setShowTypes((v) => !v)}
            aria-expanded={showTypes}
            className="min-h-11 text-sm font-medium text-primary underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {showTypes ? "Hide alert types" : "Choose which alerts I get"}
          </button>

          {showTypes && (
            <fieldset className="mt-3 space-y-3">
              <legend className="sr-only">Notification types</legend>
              {settings.types.map((t) => (
                <label
                  key={t.type}
                  className="flex cursor-pointer items-start gap-3 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={t.enabled}
                    onChange={() => toggleType(t.type)}
                    className="mt-1 size-4 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <span>
                    <span className="font-medium">{t.label}</span>
                    <span className="block text-muted-foreground">
                      {t.description}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
        </div>
      )}
    </section>
  );
}
