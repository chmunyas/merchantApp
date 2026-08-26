// Sunday's weekly tip-jar cadence (roadmap D5.8).
//
// Source of truth — https://intercom.help/sundayapp-help/en/articles/9979247
// ("Tips Management at sunday"):
//   * Servers collect tips throughout the week.
//   * "The Tipjar distribution is available every Monday at 6 PM under the
//     Distribution section of the Tips tab."
//   * "Managers can perform the distribution at any time between Monday and
//     Sunday. All tips allocated during this period will be paid to employees
//     the following Monday."
//   * "If the distribution is delayed to the next week, servers will receive
//     their tips with a two-week delay, i.e., on Monday of the second week
//     (S+2)."
//
// Which collapses to one rule, and one rule only:
//
//     payout Monday = the Monday that starts the week AFTER the week in which
//     the manager actually distributed.
//
// Everything else (the on-time deadline, the S+2 slip) falls out of that. This
// module is pure and venue-local: a venue in Africa/Nairobi opens its jar at
// 18:00 Nairobi time, not 18:00 UTC.

/** Sunday opens the jar at 18:00 venue-local on the Monday after the week closes. */
export const JAR_OPEN_HOUR = 18;

const DAY_MS = 24 * 60 * 60 * 1000;

export type TipWeek = {
  /** Venue-local ISO date (YYYY-MM-DD) of the Monday that opened the week. */
  weekStart: string;
  /** Instant of Monday 00:00 venue-local. */
  collectionStart: Date;
  /** Instant of the following Monday 00:00 venue-local (exclusive). */
  collectionEnd: Date;
  /** Instant the jar becomes distributable: Monday 18:00 venue-local, week + 1. */
  opensAt: Date;
  /** Distribute before this instant (Monday 00:00 local, week + 2) to stay on time. */
  onTimeDeadline: Date;
  /** Monday the money is due in staff accounts when distribution is on time. */
  scheduledPayoutAt: Date;
};

type Wall = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function wallClock(instant: Date, timeZone: string): Wall {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

/** Zone offset at `instant`, rounded to the whole minute all real zones use. */
function offsetMs(instant: Date, timeZone: string): number {
  const wall = wallClock(instant, timeZone);
  const asUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );
  return Math.round((asUtc - instant.getTime()) / 60_000) * 60_000;
}

/**
 * The instant at which the given venue-local wall-clock time occurs. Two passes
 * so a DST transition between the guess and the real offset still resolves.
 */
function instantFromWall(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = offsetMs(new Date(guess), timeZone);
  const second = offsetMs(new Date(guess - first), timeZone);
  return new Date(guess - second);
}

function isoDate(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

export function addDaysToIsoDate(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

export function isoDateDiffInDays(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS,
  );
}

/** Venue-local ISO date of the Monday on or before `instant`. */
export function localWeekStart(instant: Date, timeZone: string): string {
  const wall = wallClock(instant, timeZone);
  const date = isoDate(wall.year, wall.month, wall.day);
  // Date.UTC of a plain date gives that date's weekday regardless of zone.
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDaysToIsoDate(date, weekday === 0 ? -6 : 1 - weekday);
}

function instantAtLocalMidnight(date: string, timeZone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  return instantFromWall(year, month, day, 0, 0, timeZone);
}

function instantAtLocalHour(date: string, hour: number, timeZone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  return instantFromWall(year, month, day, hour, 0, timeZone);
}

/** Build the full cadence for the collection week starting on `weekStart`. */
export function tipWeek(weekStart: string, timeZone: string): TipWeek {
  const nextMonday = addDaysToIsoDate(weekStart, 7);
  const mondayAfter = addDaysToIsoDate(weekStart, 14);
  return {
    weekStart,
    collectionStart: instantAtLocalMidnight(weekStart, timeZone),
    collectionEnd: instantAtLocalMidnight(nextMonday, timeZone),
    opensAt: instantAtLocalHour(nextMonday, JAR_OPEN_HOUR, timeZone),
    onTimeDeadline: instantAtLocalMidnight(mondayAfter, timeZone),
    scheduledPayoutAt: instantAtLocalMidnight(mondayAfter, timeZone),
  };
}

/** The collection week currently being served by guests (no jar yet). */
export function currentCollectionWeek(now: Date, timeZone: string): TipWeek {
  return tipWeek(localWeekStart(now, timeZone), timeZone);
}

/**
 * The most recent collection week whose jar has opened. Before the first
 * Monday 18:00 of a venue's life this still returns a (necessarily empty) week,
 * which is what the Distribution view wants to render.
 */
export function openJarWeek(now: Date, timeZone: string): TipWeek {
  const thisMonday = localWeekStart(now, timeZone);
  const openedThisWeek =
    now.getTime() >= instantAtLocalHour(thisMonday, JAR_OPEN_HOUR, timeZone).getTime();
  return tipWeek(addDaysToIsoDate(thisMonday, openedThisWeek ? -7 : -14), timeZone);
}

/** Has the jar for this collection week become distributable yet? */
export function jarIsOpen(week: TipWeek, now: Date): boolean {
  return now.getTime() >= week.opensAt.getTime();
}

/**
 * The Monday the money lands, given when the manager actually distributed:
 * the start of the week AFTER the distribution week.
 */
export function payoutMondayFor(distributedAt: Date, timeZone: string): Date {
  const monday = localWeekStart(distributedAt, timeZone);
  return instantAtLocalMidnight(addDaysToIsoDate(monday, 7), timeZone);
}

/**
 * Whole weeks by which the payout slipped past the on-time Monday. 0 = paid on
 * the Monday Sunday promises; 1 = the S+2 case in the help centre.
 */
export function weeksLateFor(
  week: TipWeek,
  distributedAt: Date,
  timeZone: string,
): number {
  const onTime = localWeekStart(week.scheduledPayoutAt, timeZone);
  const actual = localWeekStart(payoutMondayFor(distributedAt, timeZone), timeZone);
  return Math.max(0, isoDateDiffInDays(onTime, actual) / 7);
}

export type TipCadenceStatus = {
  week: TipWeek;
  isOpen: boolean;
  /** True once the on-time Monday–Sunday distribution window has elapsed. */
  isLate: boolean;
  /** Payout Monday if the manager distributed right now. */
  payoutIfDistributedNow: Date;
  weeksLateIfDistributedNow: number;
};

export function tipCadenceStatus(
  now: Date,
  timeZone: string,
  week = openJarWeek(now, timeZone),
): TipCadenceStatus {
  const payoutIfDistributedNow = payoutMondayFor(now, timeZone);
  return {
    week,
    isOpen: jarIsOpen(week, now),
    isLate: now.getTime() >= week.onTimeDeadline.getTime(),
    payoutIfDistributedNow,
    weeksLateIfDistributedNow: weeksLateFor(week, now, timeZone),
  };
}
