// C6.1/C6.12/C6.13 + C6.7 — venue-level menu settings.
//
// The dynamic menu and the external (PDF/link) menu are mutually exclusive at
// serve time, which is why the toggle carries Sunday's own warning. The external
// menu is retained rather than erased, so turning the dynamic menu off restores
// it.

import { useCallback, useEffect, useState } from "react";
import { Loader2, Languages } from "lucide-react";
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
import { cn } from "@/lib/utils";

const MAX_CHECKOUT_UPSELLS = 5;

// Offered rather than free-typed so a merchant cannot enable a tag the AI
// translator will not honour. The default language is chosen from the same list.
const LANGUAGE_OPTIONS = [
  { tag: "en", label: "English" },
  { tag: "sw", label: "Kiswahili" },
  { tag: "fr", label: "Français" },
  { tag: "ar", label: "العربية" },
  { tag: "de", label: "Deutsch" },
  { tag: "es", label: "Español" },
  { tag: "it", label: "Italiano" },
  { tag: "zh", label: "中文" },
];

type MenuSettings = {
  dynamicMenuEnabled: boolean;
  defaultLanguage: string;
  languages: string[];
  externalMenu: { name: string; kind: "pdf" | "link"; url: string } | null;
  checkoutUpsellTitle: string | null;
};

export function MenuSettingsTab({
  items,
}: {
  items: Array<{ id: string; name: string; category: string }>;
}) {
  const [settings, setSettings] = useState<MenuSettings | null>(null);
  const [upsellIds, setUpsellIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [translating, setTranslating] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await authFetch("/api/menu/settings");
      if (!res.ok) {
        setUnavailable(true);
        return;
      }
      const data = (await res.json()) as {
        settings: MenuSettings;
        checkoutUpsellItemIds: string[];
      };
      setSettings(data.settings);
      setUpsellIds(data.checkoutUpsellItemIds ?? []);
      setUnavailable(false);
    } catch {
      setUnavailable(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(next: MenuSettings, nextUpsellIds = upsellIds) {
    setBusy(true);
    try {
      const res = await authFetch("/api/menu/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dynamicMenuEnabled: next.dynamicMenuEnabled,
          defaultLanguage: next.defaultLanguage,
          languages: next.languages,
          externalMenuName: next.externalMenu?.name ?? "",
          externalMenuKind: next.externalMenu?.kind ?? null,
          externalMenuUrl: next.externalMenu?.url ?? "",
          checkoutUpsellTitle: next.checkoutUpsellTitle ?? "",
          checkoutUpsellItemIds: nextUpsellIds,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        settings?: MenuSettings;
        checkoutUpsellItemIds?: string[];
        error?: string;
      };
      if (!res.ok || !data.settings) {
        toast.error(data.error ?? "Could not save menu settings.");
        return;
      }
      setSettings(data.settings);
      setUpsellIds(data.checkoutUpsellItemIds ?? []);
      toast.success("Menu settings saved.");
    } catch {
      toast.error("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function translate(tag: string) {
    setTranslating(tag);
    try {
      const res = await authFetch("/api/menu/translate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lang: tag }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        translated?: boolean;
        error?: string;
      };
      if (!res.ok) {
        toast.error(data.error ?? "Could not translate the menu.");
        return;
      }
      toast[data.translated ? "success" : "warning"](
        data.translated
          ? "Menu translated and cached."
          : "Nothing was translated — guests keep the original language.",
      );
    } catch {
      toast.error("Could not reach the server.");
    } finally {
      setTranslating(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading menu settings…
      </div>
    );
  }

  if (unavailable || !settings) {
    return (
      <Card className="border-amber-200 bg-amber-50/60">
        <CardContent className="p-5 text-sm text-amber-900">
          <p className="font-semibold">Menu settings are not available.</p>
          <p className="mt-1">
            These settings need a manager sign-in and the dynamic-menu migration
            applied. Nothing was changed.
          </p>
        </CardContent>
      </Card>
    );
  }

  const external = settings.externalMenu;

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card className="border-slate-200 bg-white/90 shadow-sm">
        <CardHeader>
          <CardTitle>Dynamic menu</CardTitle>
          <CardDescription>
            Serve the menus you built here instead of a PDF or a link.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-white px-3 py-3">
            <span className="text-sm">
              <span className="font-medium text-slate-800">
                Enable the dynamic menu
              </span>
              <span className="mt-0.5 block text-xs text-slate-500">
                This disables the PDF/link menu and can be turned off at any
                time — the external menu is kept, not deleted.
              </span>
            </span>
            <input
              type="checkbox"
              checked={settings.dynamicMenuEnabled}
              disabled={busy}
              onChange={(event) =>
                void save({
                  ...settings,
                  dynamicMenuEnabled: event.target.checked,
                })
              }
            />
          </label>

          {settings.dynamicMenuEnabled ? (
            <p className="rounded-2xl bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              Guests see your active, in-window menus. A venue with no menus
              still sees the whole catalogue grouped by category.
            </p>
          ) : (
            <p className="rounded-2xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
              {external
                ? "Guests are sent to your external menu and cannot order from their phone."
                : "Guests see your whole catalogue grouped by category."}
            </p>
          )}

          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-700">
              External menu (used when the dynamic menu is off)
            </p>
            <Input
              value={external?.name ?? ""}
              placeholder="Menu name, e.g. À la carte"
              onChange={(event) =>
                setSettings({
                  ...settings,
                  externalMenu: {
                    kind: external?.kind ?? "link",
                    url: external?.url ?? "",
                    name: event.target.value,
                  },
                })
              }
            />
            <Input
              value={external?.url ?? ""}
              placeholder="https://…/menu.pdf"
              onChange={(event) =>
                setSettings({
                  ...settings,
                  externalMenu: {
                    kind: event.target.value.trim().toLowerCase().endsWith(".pdf")
                      ? "pdf"
                      : "link",
                    name: external?.name ?? "Menu",
                    url: event.target.value,
                  },
                })
              }
            />
            <p className="text-xs text-slate-500">
              Must be an https address — it is opened in a guest's browser.
              Clearing it removes the external menu.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void save(settings)}
            >
              Save external menu
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200 bg-white/90 shadow-sm">
        <CardHeader>
          <CardTitle>Guest languages</CardTitle>
          <CardDescription>
            Item names and descriptions are translated by AI and cached. A guest
            reading an untranslated dish sees the original text, never a blank.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-slate-700">
              Your menu is written in
            </p>
            <div className="flex flex-wrap gap-2">
              {LANGUAGE_OPTIONS.map((option) => (
                <button
                  key={option.tag}
                  type="button"
                  aria-pressed={settings.defaultLanguage === option.tag}
                  disabled={busy}
                  onClick={() =>
                    void save({
                      ...settings,
                      defaultLanguage: option.tag,
                      languages: settings.languages.filter(
                        (tag) => tag !== option.tag,
                      ),
                    })
                  }
                  className={cn(
                    "min-h-11 rounded-full border px-4 text-sm font-semibold disabled:opacity-50",
                    settings.defaultLanguage === option.tag
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-700",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-sm font-medium text-slate-700">
              Also offer guests
            </p>
            <div className="flex flex-wrap gap-2">
              {LANGUAGE_OPTIONS.filter(
                (option) => option.tag !== settings.defaultLanguage,
              ).map((option) => {
                const on = settings.languages.includes(option.tag);
                return (
                  <button
                    key={option.tag}
                    type="button"
                    aria-pressed={on}
                    disabled={busy}
                    onClick={() =>
                      void save({
                        ...settings,
                        languages: on
                          ? settings.languages.filter((tag) => tag !== option.tag)
                          : [...settings.languages, option.tag],
                      })
                    }
                    className={cn(
                      "min-h-11 rounded-full border px-4 text-sm font-semibold disabled:opacity-50",
                      on
                        ? "border-purple-400 bg-purple-50 text-purple-800"
                        : "border-slate-200 bg-white text-slate-700",
                    )}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          {settings.languages.length > 0 ? (
            <div className="space-y-2 rounded-2xl bg-slate-50 p-3">
              <p className="text-xs text-slate-600">
                Translate now so the first guest to switch language does not wait.
              </p>
              <div className="flex flex-wrap gap-2">
                {settings.languages.map((tag) => (
                  <Button
                    key={tag}
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={translating !== null}
                    onClick={() => void translate(tag)}
                  >
                    {translating === tag ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Languages className="h-4 w-4" />
                    )}
                    {LANGUAGE_OPTIONS.find((option) => option.tag === tag)?.label ??
                      tag}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="border-slate-200 bg-white/90 shadow-sm xl:col-span-2">
        <CardHeader>
          <CardTitle>Checkout recommendations</CardTitle>
          <CardDescription>
            Up to {MAX_CHECKOUT_UPSELLS} products offered to every guest before
            they pay. Products without a photo are skipped automatically — the
            card would otherwise be an empty box.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            value={settings.checkoutUpsellTitle ?? ""}
            placeholder="Before you go…"
            onChange={(event) =>
              setSettings({
                ...settings,
                checkoutUpsellTitle: event.target.value,
              })
            }
          />
          <div className="flex flex-wrap gap-2">
            {items.length === 0 ? (
              <p className="text-sm text-slate-500">
                Add catalogue items first.
              </p>
            ) : (
              items.map((item) => {
                const on = upsellIds.includes(item.id);
                const full =
                  !on && upsellIds.length >= MAX_CHECKOUT_UPSELLS;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={on}
                    disabled={full}
                    onClick={() =>
                      setUpsellIds((current) =>
                        on
                          ? current.filter((id) => id !== item.id)
                          : [...current, item.id],
                      )
                    }
                    className={cn(
                      "min-h-11 rounded-full border px-4 text-sm disabled:opacity-40",
                      on
                        ? "border-purple-400 bg-purple-50 font-semibold text-purple-800"
                        : "border-slate-200 bg-white text-slate-700",
                    )}
                  >
                    {item.name}
                  </button>
                );
              })
            )}
          </div>
          <div className="flex items-center justify-between gap-4">
            <Badge variant="outline" className="border-slate-200 text-slate-600">
              {upsellIds.length} / {MAX_CHECKOUT_UPSELLS} selected
            </Badge>
            <Button
              type="button"
              disabled={busy}
              onClick={() => void save(settings)}
            >
              Save recommendations
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
