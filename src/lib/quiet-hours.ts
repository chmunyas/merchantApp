// TCPA-style quiet-hours gate: no MARKETING messages during the configured window
// (e.g. 21:00–08:00 in the venue timezone). Pure + unit-tested. Transactional
// replies (opt-out confirmations, agent answers to an inbound) are NOT gated —
// only bulk/marketing sends consult this.

// Is `hour` (0–23) inside the [start, end) window? The window may wrap past
// midnight (start 21, end 8 → quiet 21:00–07:59). start === end means "no window".
export function withinQuietHours(
  hour: number,
  startHour: number,
  endHour: number,
): boolean {
  const norm = (h: number) => ((Math.floor(h) % 24) + 24) % 24;
  const h = norm(hour);
  const s = norm(startHour);
  const e = norm(endHour);
  if (s === e) return false;
  return s < e ? h >= s && h < e : h >= s || h < e;
}

// The wall-clock hour (0–23) at a fixed UTC offset (minutes). Kenya/EAT = +180.
export function hourAtOffset(date: Date, offsetMinutes: number): number {
  const utcMs = date.getTime() + date.getTimezoneOffset() * 60_000;
  return new Date(utcMs + offsetMinutes * 60_000).getHours();
}
