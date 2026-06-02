import { createContext, useContext, useEffect, useMemo, useState } from "react";

import type { StaffMember } from "@/components/merchant/features/types";
import {
  ensureMerchantDemoData,
  loadMerchantSnapshot,
} from "@/lib/merchant-dashboard";

export type UserRole = "admin" | "merchant" | "staff" | "customer";

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

export function getDefaultRouteForRole(role: UserRole) {
  switch (role) {
    case "admin":
      return "/admin";
    case "staff":
      return "/merchant";
    case "merchant":
      return "/dashboard";
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
  const [user, setUser] = useState<AuthUser | null>(
    () => readUser(DEMO_AUTH_KEY) ?? readUser(STAFF_AUTH_KEY),
  );
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
