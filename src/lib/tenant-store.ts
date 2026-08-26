export type Venue = {
  id: string;
  name: string;
  code: string;
  active: boolean;
  timezone?: string;
};

const VENUES_KEY = "fxengine.merchant.venues";
const CURRENT_VENUE_KEY = "fxengine.merchant.currentVenue";
const DEMO_VENUE_IDS = new Set(["main", "cbd", "kisumu"]);

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function read<T>(key: string, fallback: T): T {
  if (!canUseStorage()) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  if (!canUseStorage()) return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function demoVenues(): Venue[] {
  return [
    { id: "main", name: "Sade's Atelier — Westlands", code: "WL-001", active: true },
    { id: "cbd", name: "Sade's Atelier — CBD", code: "CBD-002", active: true },
    { id: "kisumu", name: "Sade's Lakeside — Kisumu", code: "KSM-003", active: true },
  ];
}

export function getVenues(): Venue[] {
  return read(VENUES_KEY, demoVenues());
}

export function getCurrentVenueId(): string {
  return read(CURRENT_VENUE_KEY, "main");
}

export function setCurrentVenueId(id: string): void {
  write(CURRENT_VENUE_KEY, id);
}

export function getCurrentVenue(): Venue {
  const venues = getVenues();
  return venues.find((venue) => venue.id === getCurrentVenueId()) ?? venues[0];
}

export function setVenues(venues: Venue[]): void {
  write(VENUES_KEY, venues);
}

export function isDemoVenue(id: string): boolean {
  return DEMO_VENUE_IDS.has(id);
}

export function resetTenant(): void {
  setCurrentVenueId("main");
  if (canUseStorage()) window.localStorage.removeItem(VENUES_KEY);
}
