import { Link } from "@tanstack/react-router";
import { CheckCircle2, Circle, X } from "lucide-react";
import { useState } from "react";

import { useBranding } from "@/lib/branding";
import {
  getCurrentVenueId,
  isDemoVenue,
  type MerchantSnapshot,
} from "@/lib/merchant-dashboard";

const DISMISS_KEY = "pesaswap.onboarding.dismissed";

// First-run setup checklist for a NEW merchant — guides them from an empty account
// to taking payments. Only shows for a real venue that isn't fully set up, and is
// dismissible (per-venue). Completion is derived from their own data.
export function OnboardingChecklist({
  snapshot,
}: {
  snapshot: MerchantSnapshot | null;
}) {
  const branding = useBranding();
  const venue = typeof window !== "undefined" ? getCurrentVenueId() : "main";
  const [dismissed, setDismissed] = useState(
    () =>
      typeof window !== "undefined" &&
      localStorage.getItem(`${DISMISS_KEY}::${venue}`) === "1",
  );

  if (!snapshot || isDemoVenue(venue) || dismissed) return null;

  const steps = [
    {
      id: "menu",
      label: "Add your first menu item or product",
      done: snapshot.catalogue.length > 0,
      to: "/dashboard/menu" as const,
    },
    {
      id: "till",
      label: "Set your M-Pesa till number",
      done: Boolean(snapshot.settings?.businessProfile?.tillNumber),
      to: "/dashboard/settings" as const,
    },
    {
      id: "brand",
      label: "Add your logo & brand colour",
      done: Boolean(branding?.logoUrl),
      to: "/dashboard/settings" as const,
    },
    {
      id: "team",
      label: "Invite a team member",
      done: snapshot.staffMembers.length > 0,
      to: "/dashboard/team" as const,
    },
    {
      id: "tables",
      label: "Set up tables or a QR to take payments",
      done: snapshot.tables.length > 0,
      to: "/dashboard/qr" as const,
    },
  ];
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;

  function dismiss() {
    if (typeof window !== "undefined") {
      localStorage.setItem(`${DISMISS_KEY}::${venue}`, "1");
    }
    setDismissed(true);
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">
            Finish setting up your business
          </h2>
          <p className="text-sm text-muted-foreground">
            {done} of {steps.length} done — a few quick steps to start taking
            payments.
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss checklist"
          className="shrink-0 text-muted-foreground transition hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-emerald-500 transition-all"
          style={{ width: `${(done / steps.length) * 100}%` }}
        />
      </div>
      <ul className="mt-4 space-y-1">
        {steps.map((s) => (
          <li key={s.id}>
            <Link
              to={s.to}
              className={`flex items-center gap-3 rounded-lg px-2 py-2 text-sm transition hover:bg-muted ${
                s.done ? "text-muted-foreground" : "font-medium"
              }`}
            >
              {s.done ? (
                <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
              ) : (
                <Circle className="size-4 shrink-0 text-muted-foreground" />
              )}
              <span className={s.done ? "line-through" : ""}>{s.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
