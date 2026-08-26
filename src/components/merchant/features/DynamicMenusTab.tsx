// C6.3/C6.8-C6.11 — the merchant's real, server-authoritative menus.
//
// This replaces a localStorage-backed editor. Every mutation goes to
// /api/menu/menus and the server's response is the new state, so two devices
// cannot disagree about what a guest is being shown.
//
// Visibility is set per MENU, never per category — Sunday's own rule, and the
// one `menu_visibility_windows` enforces. A venue wanting dessert-only hours
// creates a second menu.

import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Loader2, Lock, Plus, Trash2 } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { authFetch } from "@/lib/auth";
import { cn } from "@/lib/utils";

export type VisibilityWindow = {
  day: number;
  startMinutes: number;
  endMinutes: number;
};

export type ServerMenu = {
  id: string;
  name: string;
  description: string | null;
  headerImageUrl: string | null;
  headerImageAlt: string | null;
  isActive: boolean;
  visibleOnPayAtTable: boolean;
  displayOrder: number;
  source: "local" | "pos";
  categories: string[];
  windows: VisibilityWindow[];
  revision: number;
};

type Draft = {
  id: string | null;
  name: string;
  description: string;
  headerImageUrl: string;
  headerImageAlt: string;
  isActive: boolean;
  visibleOnPayAtTable: boolean;
  categories: string[];
  windows: VisibilityWindow[];
};

const DAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

/** Sunday documents lunch as 09:00–14:59, so the end minute is INCLUSIVE. */
function toClock(minutes: number): string {
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

function toMinutes(clock: string, fallback: number): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(clock.trim());
  if (!match) return fallback;
  const value = Number(match[1]) * 60 + Number(match[2]);
  return value >= 0 && value < 1440 ? value : fallback;
}

function emptyDraft(): Draft {
  return {
    id: null,
    name: "",
    description: "",
    headerImageUrl: "",
    headerImageAlt: "",
    isActive: false,
    visibleOnPayAtTable: true,
    categories: [],
    windows: [],
  };
}

function toDraft(menu: ServerMenu): Draft {
  return {
    id: menu.id,
    name: menu.name,
    description: menu.description ?? "",
    headerImageUrl: menu.headerImageUrl ?? "",
    headerImageAlt: menu.headerImageAlt ?? "",
    isActive: menu.isActive,
    visibleOnPayAtTable: menu.visibleOnPayAtTable,
    categories: [...menu.categories],
    windows: menu.windows.map((window) => ({ ...window })),
  };
}

function describeWindows(windows: VisibilityWindow[]): string {
  if (windows.length === 0) return "Always visible while active.";
  return windows
    .map((window) => {
      const day = DAYS.find((entry) => entry.value === window.day)?.label ?? "?";
      return `${day} ${toClock(window.startMinutes)}–${toClock(window.endMinutes)}`;
    })
    .join(" · ");
}

export function DynamicMenusTab({
  categories,
  onMenusChange,
}: {
  categories: string[];
  onMenusChange?: (menus: ServerMenu[]) => void;
}) {
  const [menus, setMenus] = useState<ServerMenu[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  const apply = useCallback(
    (next: ServerMenu[]) => {
      setMenus(next);
      onMenusChange?.(next);
    },
    [onMenusChange],
  );

  const load = useCallback(async () => {
    try {
      const res = await authFetch("/api/menu/menus");
      if (!res.ok) {
        setUnavailable(true);
        return;
      }
      const data = (await res.json()) as { menus?: ServerMenu[] };
      setUnavailable(false);
      apply(data.menus ?? []);
    } catch {
      setUnavailable(true);
    } finally {
      setLoading(false);
    }
  }, [apply]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Every mutating endpoint answers with the full menu list, so the server's
   * reply — not local optimism — becomes the new state.
   */
  async function mutate(
    path: string,
    init: RequestInit,
    successMessage: string,
  ): Promise<boolean> {
    setBusy(true);
    try {
      const res = await authFetch(path, init);
      const data = (await res.json().catch(() => ({}))) as {
        menus?: ServerMenu[];
        error?: string;
      };
      if (!res.ok) {
        toast.error(data.error ?? "Could not save the menu.");
        return false;
      }
      if (data.menus) apply(data.menus);
      else await load();
      toast.success(successMessage);
      return true;
    } catch {
      toast.error("Could not reach the server.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    const name = draft.name.trim();
    if (!name) {
      toast.error("Give the menu a name.");
      return;
    }
    let menuId = draft.id;
    if (!menuId) {
      // Creating and configuring are two calls because POST only takes a name:
      // Sunday creates a menu INACTIVE and never publishes it on creation.
      setBusy(true);
      try {
        const res = await authFetch("/api/menu/menus", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name, description: draft.description.trim() }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          menus?: ServerMenu[];
          error?: string;
        };
        if (!res.ok) {
          toast.error(data.error ?? "Could not create the menu.");
          return;
        }
        const created = (data.menus ?? []).find((menu) => menu.name === name);
        if (!created) {
          await load();
          return;
        }
        apply(data.menus ?? []);
        menuId = created.id;
      } catch {
        toast.error("Could not reach the server.");
        return;
      } finally {
        setBusy(false);
      }
    }

    const saved = await mutate(
      `/api/menu/menus/${encodeURIComponent(menuId)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          description: draft.description.trim(),
          headerImageUrl: draft.headerImageUrl.trim(),
          headerImageAlt: draft.headerImageAlt.trim(),
          isActive: draft.isActive,
          visibleOnPayAtTable: draft.visibleOnPayAtTable,
          categories: draft.categories,
          windows: draft.windows,
        }),
      },
      draft.id ? "Menu updated." : "Menu created.",
    );
    if (saved) setDraft(emptyDraft());
  }

  async function move(menuId: string, direction: -1 | 1) {
    const index = menus.findIndex((menu) => menu.id === menuId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= menus.length) return;
    const order = menus.map((menu) => menu.id);
    [order[index], order[target]] = [order[target], order[index]];
    await mutate(
      "/api/menu/menus/reorder",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ menuIds: order }),
      },
      "Order saved.",
    );
  }

  function toggleWindowDay(day: number) {
    setDraft((current) => {
      const has = current.windows.some((window) => window.day === day);
      if (has) {
        return {
          ...current,
          windows: current.windows.filter((window) => window.day !== day),
        };
      }
      // Seed a new day from the last window the merchant set, so setting
      // Mon–Fri lunch is five taps and not five time entries.
      const seed = current.windows[current.windows.length - 1];
      return {
        ...current,
        windows: [
          ...current.windows,
          {
            day,
            startMinutes: seed?.startMinutes ?? 9 * 60,
            endMinutes: seed?.endMinutes ?? 14 * 60 + 59,
          },
        ].sort((a, b) => a.day - b.day),
      };
    });
  }

  function setWindowTime(day: number, field: "start" | "end", clock: string) {
    setDraft((current) => ({
      ...current,
      windows: current.windows.map((window) =>
        window.day === day
          ? field === "start"
            ? { ...window, startMinutes: toMinutes(clock, window.startMinutes) }
            : { ...window, endMinutes: toMinutes(clock, window.endMinutes) }
          : window,
      ),
    }));
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading menus…
      </div>
    );
  }

  if (unavailable) {
    return (
      <Card className="border-amber-200 bg-amber-50/60">
        <CardContent className="p-5 text-sm text-amber-900">
          <p className="font-semibold">Menus are not available on this account.</p>
          <p className="mt-1">
            Building customer-facing menus needs a manager sign-in and the
            dynamic-menu migration applied. Nothing was changed.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
      <Card className="border-slate-200 bg-white/90 shadow-sm">
        <CardHeader>
          <CardTitle>{draft.id ? "Edit menu" : "Create menu"}</CardTitle>
          <CardDescription>
            Bundle categories into a customer-facing menu. A new menu is created
            inactive — nothing reaches a guest until you activate it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Menu name">
            <Input
              value={draft.name}
              onChange={(event) =>
                setDraft((current) => ({ ...current, name: event.target.value }))
              }
              placeholder="Lunch Menu"
            />
          </Field>
          <Field label="Description">
            <Textarea
              value={draft.description}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
              rows={2}
              placeholder="Shown to the guest under the menu name"
            />
          </Field>

          <Field label="Header image URL">
            <Input
              value={draft.headerImageUrl}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  headerImageUrl: event.target.value,
                }))
              }
              placeholder="https://…/lunch-cover.jpg"
            />
          </Field>
          {draft.headerImageUrl.trim() ? (
            <Field label="Image description (read to screen-reader guests)">
              <Input
                value={draft.headerImageAlt}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    headerImageAlt: event.target.value,
                  }))
                }
                placeholder="Terrace tables at midday"
              />
            </Field>
          ) : null}

          <div className="space-y-2">
            <ToggleRow
              label="Active"
              hint="Inactive menus are never shown to a guest."
              checked={draft.isActive}
              onChange={(next) =>
                setDraft((current) => ({ ...current, isActive: next }))
              }
            />
            <ToggleRow
              label="Visible on Pay at Table"
              hint="Off means QR ordering only."
              checked={draft.visibleOnPayAtTable}
              onChange={(next) =>
                setDraft((current) => ({
                  ...current,
                  visibleOnPayAtTable: next,
                }))
              }
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm font-medium text-slate-700">
                Included categories
              </p>
              <Badge variant="outline" className="border-slate-200 text-slate-600">
                {draft.categories.length} selected
              </Badge>
            </div>
            {categories.length === 0 ? (
              <p className="text-sm text-slate-500">
                Add catalogue items first — categories come from your items.
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {categories.map((category) => {
                  const selected = draft.categories.includes(category);
                  return (
                    <label
                      key={category}
                      className={cn(
                        "flex items-center justify-between rounded-2xl border px-3 py-3 text-sm",
                        selected
                          ? "border-purple-300 bg-purple-50"
                          : "border-slate-200 bg-white",
                      )}
                    >
                      <span>{category}</span>
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() =>
                          setDraft((current) => ({
                            ...current,
                            categories: selected
                              ? current.categories.filter(
                                  (entry) => entry !== category,
                                )
                              : [...current.categories, category],
                          }))
                        }
                      />
                    </label>
                  );
                })}
              </div>
            )}
            <p className="text-xs text-slate-500">
              No categories selected means the whole catalogue shows on this menu.
            </p>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium text-slate-700">
              Visibility schedule
            </p>
            <p className="text-xs text-slate-500">
              Pick the days this menu appears and the hours on each. No days
              selected means it is visible whenever it is active. End times are
              inclusive, so 14:59 is still lunch.
            </p>
            <div className="flex flex-wrap gap-2">
              {DAYS.map((day) => {
                const on = draft.windows.some(
                  (window) => window.day === day.value,
                );
                return (
                  <button
                    key={day.value}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleWindowDay(day.value)}
                    className={cn(
                      "min-h-11 rounded-full border px-4 text-sm font-semibold",
                      on
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-200 bg-white text-slate-700",
                    )}
                  >
                    {day.label}
                  </button>
                );
              })}
            </div>
            {draft.windows.map((window) => {
              const label =
                DAYS.find((day) => day.value === window.day)?.label ?? "";
              return (
                <div
                  key={window.day}
                  className="flex items-center gap-2 text-sm"
                >
                  <span className="w-10 font-medium text-slate-700">{label}</span>
                  <Input
                    type="time"
                    aria-label={`${label} start time`}
                    value={toClock(window.startMinutes)}
                    onChange={(event) =>
                      setWindowTime(window.day, "start", event.target.value)
                    }
                    className="w-32"
                  />
                  <span className="text-slate-400">to</span>
                  <Input
                    type="time"
                    aria-label={`${label} end time`}
                    value={toClock(window.endMinutes)}
                    onChange={(event) =>
                      setWindowTime(window.day, "end", event.target.value)
                    }
                    className="w-32"
                  />
                </div>
              );
            })}
          </div>

          <div className="flex justify-end gap-3">
            {draft.id ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => setDraft(emptyDraft())}
              >
                Cancel
              </Button>
            ) : null}
            <Button type="button" onClick={() => void saveDraft()} disabled={busy}>
              {draft.id ? "Save menu" : "Create menu"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {menus.length === 0 ? (
          <Card className="border-dashed border-slate-300 bg-white/60 md:col-span-2">
            <CardContent className="flex flex-col items-center gap-2 p-8 text-center text-sm text-slate-500">
              <Plus className="h-5 w-5" />
              <p className="font-medium text-slate-700">No menus yet.</p>
              <p>
                Guests currently see your whole catalogue grouped by category.
                Create a menu to control exactly what they see, and when.
              </p>
            </CardContent>
          </Card>
        ) : null}
        {menus.map((menu, index) => (
          <Card key={menu.id} className="border-slate-200 bg-white/90 shadow-sm">
            <CardContent className="space-y-4 p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-semibold text-slate-950">
                      {menu.name}
                    </h3>
                    <Badge
                      className={
                        menu.isActive
                          ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100"
                          : "bg-slate-100 text-slate-700 hover:bg-slate-100"
                      }
                    >
                      {menu.isActive ? "Active" : "Inactive"}
                    </Badge>
                    {menu.source === "pos" ? (
                      <Badge className="gap-1 bg-sky-100 text-sky-700 hover:bg-sky-100">
                        <Lock className="h-3 w-3" /> From POS
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-2 text-sm text-slate-500">
                    {menu.description || "No description yet."}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    disabled={busy || index === 0}
                    onClick={() => void move(menu.id, -1)}
                    aria-label={`Move ${menu.name} up`}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    disabled={busy || index === menus.length - 1}
                    onClick={() => void move(menu.id, 1)}
                    aria-label={`Move ${menu.name} down`}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {menu.headerImageUrl ? (
                <img
                  src={menu.headerImageUrl}
                  alt={menu.headerImageAlt ?? ""}
                  className="h-24 w-full rounded-2xl object-cover"
                />
              ) : null}

              <div className="flex flex-wrap gap-2">
                {menu.categories.length === 0 ? (
                  <Badge variant="outline" className="border-slate-200 text-slate-600">
                    Whole catalogue
                  </Badge>
                ) : (
                  menu.categories.map((category) => (
                    <Badge
                      key={`${menu.id}-${category}`}
                      variant="outline"
                      className="border-slate-200 text-slate-600"
                    >
                      {category}
                    </Badge>
                  ))
                )}
              </div>

              <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
                <p className="font-medium text-slate-800">When it shows</p>
                <p className="mt-1">{describeWindows(menu.windows)}</p>
                {menu.visibleOnPayAtTable ? null : (
                  <p className="mt-1 text-xs">Hidden on Pay at Table.</p>
                )}
              </div>

              <div className="flex justify-between gap-3">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void mutate(
                      `/api/menu/menus/${encodeURIComponent(menu.id)}`,
                      {
                        method: "PATCH",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ isActive: !menu.isActive }),
                      },
                      menu.isActive ? "Menu deactivated." : "Menu is live.",
                    )
                  }
                >
                  {menu.isActive ? "Deactivate" : "Activate"}
                </Button>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setDraft(toDraft(menu))}
                  >
                    Edit
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    className="border-rose-200 text-rose-600 hover:bg-rose-50"
                    onClick={() =>
                      void mutate(
                        `/api/menu/menus/${encodeURIComponent(menu.id)}`,
                        { method: "DELETE" },
                        "Menu deleted.",
                      )
                    }
                    aria-label={`Delete ${menu.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white px-3 py-3">
      <span className="text-sm">
        <span className="font-medium text-slate-800">{label}</span>
        <span className="mt-0.5 block text-xs text-slate-500">{hint}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}
