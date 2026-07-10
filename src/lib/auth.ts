import { createContext, useContext, useEffect, useMemo, useState } from "react";

import type { StaffMember } from "@/components/merchant/features/types";
import {
  ensureMerchantDemoData,
  loadMerchantSnapshot,
  resetTenant,
  setCurrentVenueId,
  setVenues,
} from "@/lib/merchant-dashboard";

export type UserRole =
  | "admin"
  | "merchant"
  | "manager"
  | "supervisor"
  | "staff"
  | "customer"
  | "reseller_admin";

export type AuthUser = {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  role: UserRole;
  merchantId?: string;
  staffId?: string;
  avatar?: string;
};

type AuthContextValue = {
  user: AuthUser | null;
  isLoaded: boolean;
  isSignedIn: boolean;
  signOut: () => void;
};

const DEMO_AUTH_KEY = "pesaswap.auth.demo-user";
const STAFF_AUTH_KEY = "pesaswap.auth.staff-user";

export const AuthContext = createContext<AuthContextValue>({
  user: null,
  isLoaded: false,
  isSignedIn: false,
  signOut: () => {},
});

export function isDemoMode(): boolean {
  const key =
    typeof import.meta !== "undefined"
      ? import.meta.env?.VITE_CLERK_PUBLISHABLE_KEY?.trim()
      : undefined;
  return !key || key.toLowerCase() === "demo";
}

function canUseStorage() {
  return (
    typeof window !== "undefined" && typeof window.localStorage !== "undefined"
  );
}

function readUser(key: string): AuthUser | null {
  if (!canUseStorage()) return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

function writeUser(key: string, user: AuthUser | null) {
  if (!canUseStorage()) return;
  if (user) {
    localStorage.setItem(key, JSON.stringify(user));
  } else {
    localStorage.removeItem(key);
  }
  window.dispatchEvent(new Event("pesaswap:auth-changed"));
}

// --- Real JWT session (server-verified) -------------------------------------
const JWT_KEY = "pesaswap.auth.jwt";

export function getToken(): string | null {
  return canUseStorage() ? localStorage.getItem(JWT_KEY) : null;
}

function setToken(token: string | null): void {
  if (!canUseStorage()) return;
  if (token) localStorage.setItem(JWT_KEY, token);
  else localStorage.removeItem(JWT_KEY);
}

// Pin the browser's active tenant to the logged-in merchant's own venue, so the
// per-venue localStorage namespace + venue picker + POS identity all reflect this
// merchant (never the shared demo venue). A no-op for venue-less principals
// (platform admin, demo/session tokens), which stay on the demo venue.
function applyTenant(venue: string | null | undefined, name: string): void {
  if (!venue) return;
  setCurrentVenueId(venue);
  const code =
    venue.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toUpperCase() || "VEN";
  setVenues([{ id: venue, name: name || "My Business", code, active: true }]);
}

// Log in with email + password against the server (PBKDF2-verified), storing a
// real JWT. Returns { user } on success, { totpRequired } when a second factor is
// needed, or {} on failure.
export async function jwtLogin(
  email: string,
  password: string,
  totp?: string,
): Promise<{ user?: AuthUser; totpRequired?: boolean }> {
  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, totp }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      token?: string;
      totpRequired?: boolean;
      user?: { email: string; name?: string; role?: string; venue?: string };
    };
    if (data.totpRequired) return { totpRequired: true };
    if (!res.ok || !data.token || !data.user) return {};
    setToken(data.token);
    applyTenant(data.user.venue, data.user.name ?? "");
    const user: AuthUser = {
      id: data.user.email,
      name: data.user.name ?? "Admin",
      email: data.user.email,
      role: (data.user.role as UserRole) ?? "admin",
      merchantId: data.user.venue,
    };
    writeUser(DEMO_AUTH_KEY, user);
    return { user };
  } catch {
    return {};
  }
}

export type OtpChannel = "email" | "whatsapp" | "sms";

// Complete an OIDC SSO handoff: the IdP callback redirects back with the app JWT
// in the URL fragment. Decode its claims, store the token + user, and return the
// role so the caller can route the user to the right home.
export function completeSso(token: string): { role: UserRole } | null {
  try {
    const payloadB64 = token.split(".")[1];
    if (!payloadB64) return null;
    const b64 = payloadB64.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "=");
    const claims = JSON.parse(atob(padded)) as {
      sub?: string;
      role?: string;
      name?: string;
      venue?: string;
    };
    setToken(token);
    const user: AuthUser = {
      id: claims.sub ?? "",
      name: claims.name ?? claims.sub ?? "",
      email: claims.sub ?? "",
      role: (claims.role as UserRole) ?? "reseller_admin",
      merchantId: claims.venue,
    };
    if (claims.venue) applyTenant(claims.venue, claims.name ?? "");
    writeUser(DEMO_AUTH_KEY, user);
    return { role: user.role };
  } catch {
    return null;
  }
}

// Passwordless: request a one-time code over a channel. `devCode` is returned only
// in non-production so dev/demo can complete the flow without a live ESP/WhatsApp.
export async function requestOtp(
  channel: OtpChannel,
  destination: string,
  turnstileToken?: string,
): Promise<{ sent: boolean; devCode?: string; error?: string }> {
  try {
    const res = await fetch("/api/auth/otp/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channel, destination, turnstileToken }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      sent?: boolean;
      devCode?: string;
      error?: string;
    };
    if (!res.ok) return { sent: false, error: data.error ?? "Could not send code." };
    return { sent: true, devCode: data.devCode };
  } catch {
    return { sent: false, error: "Network error. Please try again." };
  }
}

// Passwordless: verify a code → store the JWT (provisioning the account if new).
export async function verifyOtp(
  channel: OtpChannel,
  destination: string,
  code: string,
  opts?: { name?: string; totp?: string },
): Promise<{ user?: AuthUser; totpRequired?: boolean; error?: string }> {
  try {
    const res = await fetch("/api/auth/otp/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channel, destination, code, ...opts }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      token?: string;
      totpRequired?: boolean;
      error?: string;
      user?: { email: string; name?: string; role?: string; venue?: string };
    };
    if (data.totpRequired) return { totpRequired: true };
    if (!res.ok || !data.token || !data.user) {
      return { error: data.error ?? "Verification failed." };
    }
    setToken(data.token);
    applyTenant(data.user.venue, data.user.name ?? "");
    const user: AuthUser = {
      id: data.user.email,
      name: data.user.name ?? data.user.email,
      email: data.user.email,
      role: (data.user.role as UserRole) ?? "merchant",
      merchantId: data.user.venue,
    };
    writeUser(DEMO_AUTH_KEY, user);
    return { user };
  } catch {
    return { error: "Network error. Please try again." };
  }
}

// Exchange a Google ID token for our JWT (Google sign-in).
export async function googleLogin(idToken: string): Promise<AuthUser | null> {
  try {
    const res = await fetch("/api/auth/google", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      token: string;
      user: { email: string; name?: string; role?: string; picture?: string; venue?: string | null };
    };
    setToken(data.token);
    if (data.user.venue) applyTenant(data.user.venue, data.user.name ?? "");
    const user: AuthUser = {
      id: data.user.email,
      name: data.user.name ?? data.user.email,
      email: data.user.email,
      role: (data.user.role as UserRole) ?? "merchant",
      avatar: data.user.picture,
      merchantId: data.user.venue ?? undefined,
    };
    writeUser(DEMO_AUTH_KEY, user);
    return user;
  } catch {
    return null;
  }
}

// Self-serve signup: creates a merchant account + venue and stores a real JWT.
export async function signup(input: {
  businessName: string;
  email: string;
  password: string;
  phone?: string;
  org?: string;
  invite?: string;
  turnstileToken?: string;
}): Promise<{ user: AuthUser; venue?: string } | { error: string }> {
  try {
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const data = (await res.json()) as {
      token?: string;
      user?: { email: string; name?: string; role?: string; venue?: string };
      error?: string;
    };
    if (!res.ok || !data.token || !data.user) {
      return { error: data.error ?? "Could not create your account." };
    }
    setToken(data.token);
    applyTenant(data.user.venue, data.user.name ?? input.businessName);
    const user: AuthUser = {
      id: data.user.email,
      name: data.user.name ?? data.user.email,
      email: data.user.email,
      role: (data.user.role as UserRole) ?? "merchant",
      merchantId: data.user.venue,
    };
    writeUser(DEMO_AUTH_KEY, user);
    return { user, venue: data.user.venue };
  } catch {
    return { error: "Network error. Please try again." };
  }
}

// Staff PIN login: verify a PIN against the staff table and store a real staff
// JWT (role=staff, venue + staff_id) so authFetch works for staff.
export async function staffLogin(pin: string): Promise<AuthUser | null> {
  try {
    const res = await fetch("/api/auth/staff-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pin }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      token: string;
      user: { name?: string; venue?: string; staffId?: string };
    };
    setToken(data.token);
    applyTenant(data.user.venue, data.user.name ?? "");
    const user: AuthUser = {
      id: data.user.staffId ?? "staff",
      name: data.user.name ?? "Staff",
      role: "staff",
      staffId: data.user.staffId,
      merchantId: data.user.venue,
    };
    writeUser(DEMO_AUTH_KEY, user);
    return user;
  } catch {
    return null;
  }
}

// Multi-venue staff: the stores this staff member is assigned to (linked by their
// phone across per-venue staff rows).
export type StaffVenue = { id: string; name: string; current: boolean };

export async function staffMyVenues(): Promise<StaffVenue[]> {
  try {
    const res = await authFetch("/api/staff/my-venues");
    if (!res.ok) return [];
    const data = (await res.json()) as { venues?: StaffVenue[] };
    return data.venues ?? [];
  } catch {
    return [];
  }
}

// Switch the staff session to another assigned store (server re-mints the staff
// JWT for that store's staff row). Caller reloads to re-scope every panel.
export async function staffSwitchVenue(venue: string): Promise<boolean> {
  try {
    const res = await authFetch("/api/auth/staff-switch-venue", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ venue }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as {
      token?: string;
      user?: { venue?: string; name?: string };
    };
    if (data.token) setToken(data.token);
    if (data.user?.venue) applyTenant(data.user.venue, data.user.name ?? "");
    return true;
  } catch {
    return false;
  }
}

// fetch() that attaches the JWT — use for protected admin/config calls.
export function authFetch(
  input: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

// Multi-store: switch the active store by re-minting the JWT for a venue the user
// is a member of (server-verified), then pinning local state to it. Caller reloads.
export async function switchVenue(venue: string): Promise<boolean> {
  try {
    const res = await authFetch("/api/auth/switch-venue", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ venue }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { token?: string; user?: { venue?: string } };
    if (data.token) setToken(data.token);
    setCurrentVenueId(data.user?.venue ?? venue);
    return true;
  } catch {
    return false;
  }
}

// Refresh the JWT from current server state (e.g. after a plan change) so a new
// plan claim takes effect immediately, without a full re-login.
export async function refreshToken(): Promise<{ plan?: string } | null> {
  try {
    const res = await authFetch("/api/auth/refresh", { method: "POST" });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      token?: string;
      user?: { plan?: string };
    };
    if (data.token) setToken(data.token);
    return { plan: data.user?.plan };
  } catch {
    return null;
  }
}

// Multi-store: create a new store under the current account (becomes a member).
export async function addStore(
  name: string,
): Promise<{ id: string; name: string } | { error: string }> {
  try {
    const res = await authFetch("/api/venues", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      venue?: { id: string; name: string };
      error?: string;
    };
    if (!res.ok || !data.venue) {
      return { error: data.error ?? "Could not create the store." };
    }
    return data.venue;
  } catch {
    return { error: "Network error. Please try again." };
  }
}

// --- Multi-store team (owner/manager per store) -----------------------------
export type TeamMember = {
  email: string;
  name: string | null;
  role: string;
  you?: boolean;
};

export async function listMembers(
  venue: string,
): Promise<{ members: TeamMember[]; callerRole: string } | null> {
  try {
    const res = await authFetch(
      `/api/venues/members?venue=${encodeURIComponent(venue)}`,
    );
    if (!res.ok) return null;
    return (await res.json()) as { members: TeamMember[]; callerRole: string };
  } catch {
    return null;
  }
}

export async function saveMember(
  venue: string,
  email: string,
  role: string,
  name?: string,
): Promise<{ invited: boolean } | { error: string }> {
  try {
    const res = await authFetch(
      `/api/venues/members?venue=${encodeURIComponent(venue)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, role, name }),
      },
    );
    const data = (await res.json().catch(() => ({}))) as {
      member?: { invited: boolean };
      error?: string;
    };
    if (!res.ok || !data.member) {
      return { error: data.error ?? "Could not save the team member." };
    }
    return { invited: data.member.invited };
  } catch {
    return { error: "Network error. Please try again." };
  }
}

export async function removeMember(
  venue: string,
  email: string,
): Promise<{ ok: true } | { error: string }> {
  try {
    const res = await authFetch(
      `/api/venues/members?venue=${encodeURIComponent(
        venue,
      )}&email=${encodeURIComponent(email)}`,
      { method: "DELETE" },
    );
    if (res.ok) return { ok: true };
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { error: data.error ?? "Could not remove the team member." };
  } catch {
    return { error: "Network error. Please try again." };
  }
}

// --- Multi-store chain rollup ------------------------------------------------
export type ChainStore = {
  id: string;
  name: string;
  gross: number;
  tips: number;
  refunds: number;
  net: number;
  txns: number;
};

export async function chainRollup(): Promise<{
  currency: string;
  stores: ChainStore[];
  total: Omit<ChainStore, "id" | "name">;
} | null> {
  try {
    const res = await authFetch("/api/venues/rollup");
    if (!res.ok) return null;
    return (await res.json()) as {
      currency: string;
      stores: ChainStore[];
      total: Omit<ChainStore, "id" | "name">;
    };
  } catch {
    return null;
  }
}

// Bootstrap a dashboard session token. The SPA still uses demo-role logins that
// carry no password, so protected endpoints would 401 without this. Skips when a
// real token already exists (admin email / Google login) and no-ops silently in
// production where the server has AUTH_REQUIRE_LOGIN set (returns 403).
export async function ensureSessionToken(
  role: UserRole = "merchant",
): Promise<void> {
  if (getToken()) return;
  try {
    const res = await fetch("/api/auth/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: role === "staff" ? "staff" : "merchant" }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { token?: string };
    if (data.token) setToken(data.token);
  } catch {
    /* offline — the open endpoints still work */
  }
}

// Launch handoff: when the standalone app is opened from the dashboard with the
// session in the URL fragment (#token=…), adopt it so an installed/standalone PWA
// starts ALREADY SIGNED IN — even if it doesn't share storage with the tab that
// launched it. The fragment is stripped immediately (never hits a server).
export function adoptLaunchToken(): void {
  if (typeof window === "undefined") return;
  const m = window.location.hash.match(/token=([^&]+)/);
  if (!m) return;
  try {
    const token = decodeURIComponent(m[1]);
    if (token) setToken(token);
  } catch {
    /* ignore a malformed token */
  }
  window.history.replaceState(
    null,
    "",
    window.location.pathname + window.location.search,
  );
}

// A launch URL for the standalone app that carries the CURRENT session, so it
// opens already signed in with the logged-in merchant's account.
export function launchAppUrl(): string {
  const token = getToken();
  return token
    ? `/pesaswapApp#token=${encodeURIComponent(token)}`
    : "/pesaswapApp";
}

export function getDefaultRouteForRole(role: UserRole) {
  switch (role) {
    case "admin":
      return "/admin";
    case "staff":
    case "supervisor":
      return "/staff-console";
    case "manager":
    case "merchant":
      return "/dashboard";
    case "reseller_admin":
      return "/reseller";
    default:
      return "/";
  }
}

export function getDemoUser(): AuthUser | null {
  return readUser(DEMO_AUTH_KEY);
}

export function getStaffSession(): AuthUser | null {
  return readUser(STAFF_AUTH_KEY);
}

export function setStaffSession(user: AuthUser): void {
  writeUser(STAFF_AUTH_KEY, user);
}

export function clearStaffSession(): void {
  writeUser(STAFF_AUTH_KEY, null);
}

export function demoLogin(
  role: UserRole,
  options: { email?: string; merchantId?: string; staffId?: string } = {},
): void {
  // The demo/marketing experience always runs on the demo venue.
  resetTenant();
  let user: AuthUser;

  switch (role) {
    case "admin":
      user = {
        id: "demo-admin",
        name: "Demo Admin",
        email: options.email ?? "admin@pesaswap.io",
        role: "admin",
        avatar: undefined,
      };
      break;
    case "merchant":
      user = {
        id: "demo-merchant-user",
        name: "Demo Merchant",
        email: options.email ?? "merchant@demo.com",
        role: "merchant",
        merchantId: options.merchantId ?? "demo-merchant",
      };
      break;
    case "staff": {
      ensureMerchantDemoData();
      const snapshot = loadMerchantSnapshot();
      const staff = options.staffId
        ? snapshot.staffMembers.find(
            (m: StaffMember) => m.id === options.staffId,
          )
        : snapshot.staffMembers[0];
      user = staff
        ? {
            id: staff.id,
            name: staff.name,
            phone: staff.phone,
            role: "staff",
            merchantId: "demo-merchant",
            staffId: staff.id,
            avatar: staff.avatar,
          }
        : {
            id: "demo-staff",
            name: "Demo Staff",
            role: "staff",
            merchantId: "demo-merchant",
            staffId: options.staffId,
          };
      break;
    }
    default:
      user = { id: "demo-customer", name: "Demo Customer", role: "customer" };
  }

  clearStaffSession();
  writeUser(DEMO_AUTH_KEY, user);
}

export function demoLogout(): void {
  writeUser(DEMO_AUTH_KEY, null);
  clearStaffSession();
  setToken(null);
  resetTenant();
}

export function getDemoStaffByPin(pin: string): AuthUser | null {
  ensureMerchantDemoData();
  const snapshot = loadMerchantSnapshot();
  const staff = snapshot.staffMembers.find((m: StaffMember) => m.pin === pin);
  if (!staff) return null;
  return {
    id: staff.id,
    name: staff.name,
    phone: staff.phone,
    role: "staff",
    merchantId: "demo-merchant",
    staffId: staff.id,
    avatar: staff.avatar,
  };
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

export function useDemoAuth(): AuthContextValue {
  // Initialise to null on BOTH server and first client render to avoid a
  // hydration mismatch (localStorage is unavailable during SSR). The effect
  // below populates the real user immediately after mount.
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const sync = () => {
      setUser(readUser(DEMO_AUTH_KEY) ?? readUser(STAFF_AUTH_KEY));
      setIsLoaded(true);
    };
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener("pesaswap:auth-changed", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("pesaswap:auth-changed", sync);
    };
  }, []);

  return useMemo(
    () => ({
      user,
      isLoaded,
      isSignedIn: Boolean(user),
      signOut: () => {
        demoLogout();
        setUser(null);
      },
    }),
    [user, isLoaded],
  );
}
