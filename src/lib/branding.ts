import { useEffect, useState } from "react";

import { authFetch } from "@/lib/auth";

export type Branding = {
  businessName: string;
  logoUrl: string | null;
  primaryColor: string | null;
  reseller: {
    name: string;
    poweredBy: string | null;
    logoUrl: string | null;
  } | null;
};

// Fetch branding for the current authed merchant (token-pinned) or, when a venue
// is given, for that venue publicly (used by pay links + booking pages).
export async function fetchBranding(venue?: string): Promise<Branding | null> {
  try {
    const res = venue
      ? await fetch(`/api/branding?venue=${encodeURIComponent(venue)}`)
      : await authFetch("/api/branding");
    if (!res.ok) return null;
    const data = (await res.json()) as { branding: Branding | null };
    return data.branding;
  } catch {
    return null;
  }
}

// React hook: returns the branding once loaded (null until then / on failure).
export function useBranding(venue?: string): Branding | null {
  const [branding, setBranding] = useState<Branding | null>(null);
  useEffect(() => {
    let active = true;
    fetchBranding(venue).then((b) => {
      if (active) setBranding(b);
    });
    return () => {
      active = false;
    };
  }, [venue]);
  return branding;
}
