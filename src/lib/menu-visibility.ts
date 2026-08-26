// C6.1 / C6.9 / C6.10 / C6.11 / C6.12 — which menu a guest should be shown, right
// now, in the venue's own timezone.
//
// Pure by design: the schedule is the contractual bit of Sunday's dynamic menu
// ("select Monday through Friday and set the hours from 9:00 AM to 2:59 PM"),
// so it is resolved by testable functions and never by ad-hoc date maths in a
// route handler.
//
// Two Sunday rules are encoded here and are not negotiable downstream:
//   1. Visibility is set at MENU level, never at category level. Sunday's own
//      FAQ tells a venue that wants dessert-only hours to create a second menu.
//   2. Enabling the dynamic menu disables the external (PDF/link) menu. The
//      external menu is retained, not erased, so the toggle is reversible.

import { localDayAndMinutes } from "@/lib/business-day";

export const MINUTES_PER_DAY = 24 * 60;

export type VisibilityWindow = {
  /** 0 = Sunday … 6 = Saturday, in the venue's local timezone. */
  day: number;
  /** Minutes past local midnight, inclusive. */
  startMinutes: number;
  /**
   * Minutes past local midnight, INCLUSIVE — Sunday documents lunch as
   * 09:00–14:59, so 14:59 is inside the window. A value lower than
   * `startMinutes` means the window runs past midnight into the next day.
   */
  endMinutes: number;
};

export type MenuSurface = "qr" | "pay-at-table";

export type SchedulableMenu = {
  id: string;
  name: string;
  isActive: boolean;
  visibleOnPayAtTable: boolean;
  displayOrder: number;
  windows: VisibilityWindow[];
};

export type ExternalMenu = {
  name: string;
  kind: "pdf" | "link";
  url: string;
};

export type MenuModeInput = {
  dynamicMenuEnabled: boolean;
  externalMenu: ExternalMenu | null;
};

export type MenuMode =
  | { mode: "dynamic"; external: null }
  | { mode: "external"; external: ExternalMenu }
  | { mode: "none"; external: null };

function isMinuteOfDay(value: unknown): boolean {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) < MINUTES_PER_DAY;
}

export function isVisibilityWindow(value: unknown): value is VisibilityWindow {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const window = value as Record<string, unknown>;
  return (
    Number.isInteger(window.day) &&
    Number(window.day) >= 0 &&
    Number(window.day) <= 6 &&
    isMinuteOfDay(window.startMinutes) &&
    isMinuteOfDay(window.endMinutes)
  );
}

/**
 * Does a single window cover this local weekday + minute?
 *
 * A window whose end is before its start spans midnight: it covers
 * `[start, 23:59]` on its own day and `[00:00, end]` on the following day. A
 * window whose start equals its end is a one-minute window, not a 24h one —
 * "always visible" is expressed by having no windows at all, which is how
 * Sunday behaves before a schedule is added.
 */
export function windowCoversLocal(
  window: VisibilityWindow,
  day: number,
  minutes: number,
): boolean {
  if (!isVisibilityWindow(window)) return false;
  if (window.endMinutes >= window.startMinutes) {
    return (
      day === window.day &&
      minutes >= window.startMinutes &&
      minutes <= window.endMinutes
    );
  }
  // Overnight: tail of the window's own day, or head of the next day.
  if (day === window.day) return minutes >= window.startMinutes;
  const nextDay = (window.day + 1) % 7;
  return day === nextDay && minutes <= window.endMinutes;
}

/** No windows means "no schedule set" — visible whenever the menu is active. */
export function menuVisibleAtLocal(
  windows: readonly VisibilityWindow[],
  day: number,
  minutes: number,
): boolean {
  const valid = windows.filter(isVisibilityWindow);
  if (valid.length === 0) return true;
  return valid.some((window) => windowCoversLocal(window, day, minutes));
}

export function menuVisibleAt(
  windows: readonly VisibilityWindow[],
  now: Date,
  timeZone: string,
): boolean {
  const { day, minutes } = localDayAndMinutes(now, timeZone);
  return menuVisibleAtLocal(windows, day, minutes);
}

/**
 * The menus a guest should see on `surface`, in the merchant's configured
 * display order (C6.11: "the top menu on the dashboard will be the leftmost
 * menu on the landing page"). Ties break on name so the order is stable.
 */
export function visibleMenus<T extends SchedulableMenu>(
  menus: readonly T[],
  now: Date,
  timeZone: string,
  surface: MenuSurface = "qr",
): T[] {
  return menus
    .filter((menu) => menu.isActive)
    .filter((menu) => surface !== "pay-at-table" || menu.visibleOnPayAtTable)
    .filter((menu) => menuVisibleAt(menu.windows ?? [], now, timeZone))
    .sort(
      (a, b) =>
        a.displayOrder - b.displayOrder || a.name.localeCompare(b.name),
    );
}

/**
 * C6.1 + C6.12. Sunday's toggle copy is "Enable dynamic menu (this will disable
 * the PDF menu and can be turned off at any time)", so the two are mutually
 * exclusive at serve time and the external menu survives the toggle.
 */
export function resolveMenuMode(input: MenuModeInput): MenuMode {
  if (input.dynamicMenuEnabled) return { mode: "dynamic", external: null };
  if (input.externalMenu) return { mode: "external", external: input.externalMenu };
  return { mode: "none", external: null };
}

/** `HH:MM` for display, and the inverse of `parseTime` in business-day.ts. */
export function formatWindow(window: VisibilityWindow): string {
  const hhmm = (value: number) =>
    `${Math.floor(value / 60)
      .toString()
      .padStart(2, "0")}:${(value % 60).toString().padStart(2, "0")}`;
  return `${hhmm(window.startMinutes)}–${hhmm(window.endMinutes)}`;
}
