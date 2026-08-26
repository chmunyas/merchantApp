export type ServiceName = "lunch" | "dinner";

export type ServiceHour = {
  day: number;
  service: ServiceName;
  startMinutes: number;
  endMinutes: number;
};

export type VenueServiceSettings = {
  businessDayStartMinutes: number;
  serviceHours: ServiceHour[];
};

export const DEFAULT_VENUE_SERVICE_SETTINGS: VenueServiceSettings = {
  businessDayStartMinutes: 4 * 60,
  serviceHours: [],
};

const MINUTES_PER_DAY = 24 * 60;

export function isMinuteOfDay(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) < MINUTES_PER_DAY;
}

export function isServiceHour(value: unknown): value is ServiceHour {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const hour = value as Record<string, unknown>;
  return (
    Number.isInteger(hour.day) &&
    Number(hour.day) >= 0 &&
    Number(hour.day) <= 6 &&
    (hour.service === "lunch" || hour.service === "dinner") &&
    isMinuteOfDay(hour.startMinutes) &&
    isMinuteOfDay(hour.endMinutes) &&
    Number(hour.startMinutes) !== Number(hour.endMinutes)
  );
}

export function isVenueServiceSettings(value: unknown): value is VenueServiceSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const settings = value as Record<string, unknown>;
  return (
    isMinuteOfDay(settings.businessDayStartMinutes) &&
    Array.isArray(settings.serviceHours) &&
    settings.serviceHours.every(isServiceHour)
  );
}

function localDateAndMinutes(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    minutes: Number(value("hour")) * 60 + Number(value("minute")),
  };
}

// Venue-local weekday (0 = Sunday) and minute-of-day. Menu visibility windows
// (C6.10) are expressed in venue-local time, so they resolve through the same
// timezone machinery as the business day rather than the Worker's UTC clock.
export function localDayAndMinutes(
  now: Date,
  timeZone: string,
): { day: number; minutes: number } {
  const local = localDateAndMinutes(now, timeZone);
  return {
    day: new Date(`${local.date}T00:00:00Z`).getUTCDay(),
    minutes: local.minutes,
  };
}

export function businessDateFor(
  now: Date,
  timeZone: string,
  businessDayStartMinutes: number,
): string {
  const local = localDateAndMinutes(now, timeZone);
  if (local.minutes >= businessDayStartMinutes) return local.date;
  const yesterday = new Date(`${local.date}T12:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return yesterday.toISOString().slice(0, 10);
}

export function formatMinutes(value: number): string {
  const hours = Math.floor(value / 60).toString().padStart(2, "0");
  const minutes = (value % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

export function parseTime(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return isMinuteOfDay(minutes) ? minutes : null;
}
