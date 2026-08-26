// Sunday-parity staff service notifications (roadmap B2).
//
// Pure, dependency-free: the catalogue of notification types, the copy for each,
// and the recipient filter. The filter is the load-bearing part — on a busy floor
// a server must receive alerts ONLY for the tables they personally follow, so a
// broadcast to every staff member is a defect, not a fallback.
//
// Source of truth for the names/semantics:
// https://intercom.help/sundayapp-help/en/articles/12397461-how-to-get-notified-of-qr-code-payments

export type StaffNotificationType =
  | "payment.full"
  | "payment.partial"
  | "payment.failed"
  | "payment.failed_3ds"
  | "payment.fraud"
  | "payment.received"
  | "order.new"
  | "order.failed"
  | "tip.new"
  | "review.new"
  | "table.paid"
  | "walkout.potential"
  | "payment.unsynced";

export type StaffNotificationSpec = {
  /** Sunday's own name for the alert. Shown verbatim in the opt-in UI. */
  label: string;
  description: string;
  /**
   * True when the alert is meaningless without a table. Table-scoped types are
   * NEVER broadcast: with no table (and no direct attribution) nobody is
   * notified, because there is no server who owns the event.
   */
  tableScoped: boolean;
  defaultEnabled: boolean;
};

export const STAFF_NOTIFICATION_TYPES: Readonly<
  Record<StaffNotificationType, StaffNotificationSpec>
> = {
  "payment.full": {
    label: "Full Payment",
    description: "The entire bill has been paid.",
    tableScoped: true,
    defaultEnabled: true,
  },
  "payment.partial": {
    label: "Partial Payment (Split Bill)",
    description: "One guest paid their share — a balance is still outstanding.",
    tableScoped: true,
    defaultEnabled: true,
  },
  "payment.failed": {
    label: "Payment Failed",
    description: "A guest's payment was declined.",
    tableScoped: true,
    defaultEnabled: true,
  },
  "payment.failed_3ds": {
    label: "3DS Payment Failed",
    description: "The card's 3D Secure authentication did not complete.",
    tableScoped: true,
    defaultEnabled: true,
  },
  "payment.fraud": {
    label: "Potential Fraud",
    description: "A payment was flagged by fraud screening.",
    tableScoped: true,
    defaultEnabled: true,
  },
  "payment.received": {
    label: "New Payment Received on Table",
    description: "Any payment lands on a table you follow.",
    tableScoped: true,
    // Off by default: it duplicates Full/Partial Payment for most servers.
    defaultEnabled: false,
  },
  "order.new": {
    label: "New Order on Table",
    description: "A guest placed an order from the QR menu.",
    tableScoped: true,
    defaultEnabled: true,
  },
  "order.failed": {
    label: "Order Failed on Table",
    description: "An order could not be completed and needs attention.",
    tableScoped: true,
    defaultEnabled: true,
  },
  "tip.new": {
    label: "New Tip Received",
    description: "A guest left you a tip.",
    tableScoped: false,
    defaultEnabled: true,
  },
  "review.new": {
    label: "New Review Received",
    description: "A guest left feedback — negative reviews are highlighted.",
    tableScoped: false,
    defaultEnabled: true,
  },
  "table.paid": {
    label: "Table fully paid",
    description: "The bill is settled — the guests are ready to leave.",
    tableScoped: true,
    defaultEnabled: true,
  },
  // B2.8, fed by the C9.1 detector: QR scanned, balance outstanding, table idle
  // past the venue's threshold. Table-scoped like every other floor alert, so it
  // reaches the server who owns the table rather than the whole venue.
  "walkout.potential": {
    label: "Potential Walkout",
    description:
      "A table with an outstanding balance has gone quiet. Check the table before the guests leave.",
    tableScoped: true,
    defaultEnabled: true,
  },
  // B2.9. The money IS collected — this is not a failed payment, it is the POS
  // not knowing. Someone must record it by hand or the check will not close and
  // the day will not reconcile.
  "payment.unsynced": {
    label: "Unsynced Payment",
    description:
      "A payment succeeded but did not reach the POS. Record it manually using the sunday payment method.",
    tableScoped: true,
    defaultEnabled: true,
  },
};

export const STAFF_NOTIFICATION_TYPE_LIST = Object.keys(
  STAFF_NOTIFICATION_TYPES,
) as readonly StaffNotificationType[];

export function isStaffNotificationType(
  value: unknown,
): value is StaffNotificationType {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(STAFF_NOTIFICATION_TYPES, value)
  );
}

/** Explicit per-staff overrides. Absent means "use the type's default". */
export type StaffNotificationPrefs = Readonly<Record<string, boolean>>;

export function typeEnabled(
  type: StaffNotificationType,
  prefs: StaffNotificationPrefs | null | undefined,
): boolean {
  const explicit = prefs?.[type];
  if (typeof explicit === "boolean") return explicit;
  return STAFF_NOTIFICATION_TYPES[type].defaultEnabled;
}

/** A table the server has tapped to follow at the start of their shift (B2.13). */
export type FollowedTable = {
  /** `dining_tables.id` when resolvable, otherwise the raw table reference. */
  key: string | null;
  /** Human label ("12", "Terrace 4"). Matched case-insensitively. */
  label: string | null;
};

export type NotificationCandidate = {
  staffId: string;
  venue: string;
  follows: readonly FollowedTable[];
  prefs: StaffNotificationPrefs;
  /**
   * `false` only when the venue tracks shifts for this person AND they are
   * clocked out. `true` when on shift, `null` when shifts are not in use.
   */
  onShift: boolean | null;
};

export type StaffNotificationEvent = {
  venue: string;
  type: StaffNotificationType;
  tableKey?: string | null;
  tableLabel?: string | null;
  /** Direct attribution (e.g. the server a tip belongs to). Beats table follows. */
  targetStaffId?: string | null;
};

function sameTable(follow: FollowedTable, event: StaffNotificationEvent): boolean {
  if (follow.key && event.tableKey && follow.key === event.tableKey) return true;
  if (
    follow.label &&
    event.tableLabel &&
    follow.label.trim().toLowerCase() === event.tableLabel.trim().toLowerCase()
  ) {
    return true;
  }
  return false;
}

/**
 * Decide who receives an event.
 *
 * Order matters:
 *  1. cross-venue candidates are dropped outright — a notification must never
 *     leak between tenants, even if a caller mixes rows;
 *  2. the type must be enabled for that staff member (B2.14);
 *  3. a clocked-out staff member is skipped (B2.15, cheap shift gate);
 *  4. direct attribution wins; otherwise a table-bearing event goes to that
 *     table's followers only (B2.13); a table-less event goes venue-wide, but
 *     only for types that are not table-scoped.
 */
export function selectRecipients(
  event: StaffNotificationEvent,
  candidates: readonly NotificationCandidate[],
): string[] {
  const spec = STAFF_NOTIFICATION_TYPES[event.type];
  if (!spec) return [];
  const hasTable = Boolean(event.tableKey || event.tableLabel);
  const target = event.targetStaffId?.trim() || null;
  if (!target && !hasTable && spec.tableScoped) return [];

  const recipients: string[] = [];
  for (const candidate of candidates) {
    if (candidate.venue !== event.venue) continue;
    if (!candidate.staffId) continue;
    if (!typeEnabled(event.type, candidate.prefs)) continue;
    if (candidate.onShift === false) continue;
    if (target) {
      if (candidate.staffId !== target) continue;
    } else if (hasTable) {
      if (!candidate.follows.some((follow) => sameTable(follow, event))) continue;
    }
    if (!recipients.includes(candidate.staffId)) recipients.push(candidate.staffId);
  }
  return recipients;
}

// --- Failure classification ---------------------------------------------

/**
 * Split a declined payment into Sunday's three distinct alerts. Fraud outranks
 * 3DS: a risk rejection is the one a server must physically act on before the
 * guest leaves.
 */
export function classifyPaymentFailure(signals: {
  errorCode?: unknown;
  errorMessage?: unknown;
  errorReason?: unknown;
  fraudDecision?: unknown;
  status?: unknown;
}): Extract<
  StaffNotificationType,
  "payment.failed" | "payment.failed_3ds" | "payment.fraud"
> {
  const text = [
    signals.errorCode,
    signals.errorMessage,
    signals.errorReason,
    signals.status,
  ]
    .map((value) => (typeof value === "string" ? value : ""))
    .join(" ")
    .toLowerCase();
  const decision =
    typeof signals.fraudDecision === "string"
      ? signals.fraudDecision.toLowerCase()
      : "";

  if (
    decision === "reject" ||
    decision === "fraud" ||
    /fraud|blocked_by_risk|risk_decline|stolen_card|lost_card|pickup_card|do_not_honou?r/.test(
      text,
    )
  ) {
    return "payment.fraud";
  }
  if (
    /3ds|three_?ds|3d_?secure|authentication_failed|authentication_required|acs_|liability_shift/.test(
      text,
    )
  ) {
    return "payment.failed_3ds";
  }
  return "payment.failed";
}

// --- Copy ---------------------------------------------------------------

function money(minor: number | null | undefined, currency = "KES"): string {
  const value = Math.round(Number(minor ?? 0)) / 100;
  return `${currency} ${value.toLocaleString("en-KE", {
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function tableSuffix(label: string | null | undefined): string {
  return label ? ` on Table "${label}"` : "";
}

export type StaffNotificationContext = {
  tableLabel?: string | null;
  currency?: string | null;
  /** Amount that moved, in minor units. */
  amountMinor?: number | null;
  /** Outstanding balance after this event, in minor units (split bills). */
  remainingMinor?: number | null;
  itemCount?: number | null;
  rating?: number | null;
  comment?: string | null;
  reason?: string | null;
  /** Minutes the table has been idle (potential walkout). */
  idleMinutes?: number | null;
};

/**
 * Render the push title/body. Titles use Sunday's exact names so a server who
 * has used Sunday recognises the alert immediately.
 */
export function formatStaffNotification(
  type: StaffNotificationType,
  ctx: StaffNotificationContext = {},
): { title: string; body: string } {
  const currency = ctx.currency || "KES";
  const table = ctx.tableLabel ?? null;
  const amount = money(ctx.amountMinor, currency);
  const at = table ? `Table "${table}"` : "This bill";

  switch (type) {
    case "payment.full":
      return {
        title: "Full Payment",
        body: `${at} — ${amount} paid. The bill is settled in full.`,
      };
    case "payment.partial":
      return {
        title: "Partial Payment (Split Bill)",
        body: `${at} — ${amount} paid. ${money(
          ctx.remainingMinor,
          currency,
        )} still outstanding.`,
      };
    case "payment.failed":
      return {
        title: "Payment Failed",
        body: `${at} — ${amount} was declined.${
          ctx.reason ? ` ${ctx.reason}` : " Ask the guest to try again."
        }`,
      };
    case "payment.failed_3ds":
      return {
        title: "3DS Payment Failed",
        body: `${at} — ${amount} failed 3D Secure authentication. The guest must re-authenticate.`,
      };
    case "payment.fraud":
      return {
        title: "Potential Fraud",
        body: `${at} — ${amount} was flagged by fraud screening. Do not release the guest.`,
      };
    case "payment.received":
      return {
        title: `New Payment Received${tableSuffix(table)}`,
        body: `${amount} received.`,
      };
    case "order.new":
      return {
        title: `New Order${tableSuffix(table)}`,
        body: `${ctx.itemCount ?? 0} item${
          ctx.itemCount === 1 ? "" : "s"
        } — ${amount}.`,
      };
    case "order.failed":
      return {
        title: `Order Failed${tableSuffix(table)}`,
        body: ctx.reason
          ? `${ctx.reason} Check with the guest.`
          : "The order did not go through. Check with the guest.",
      };
    case "tip.new":
      return {
        title: "New Tip Received",
        body: `${amount} tip${table ? ` from Table "${table}"` : ""}. Nice one.`,
      };
    case "review.new": {
      const stars = Math.max(0, Math.min(5, Math.round(Number(ctx.rating ?? 0))));
      const quote = ctx.comment ? ` "${ctx.comment.slice(0, 100)}"` : "";
      return {
        title: "New Review Received",
        body: `${stars}★${quote}${stars > 0 && stars <= 2 ? " — needs a reply." : ""}`,
      };
    }
    case "table.paid":
      return {
        title: table ? `Table "${table}" fully paid` : "Bill fully paid",
        body: "The guests are ready to leave.",
      };
    case "walkout.potential": {
      const idle = Math.max(0, Math.round(Number(ctx.idleMinutes ?? 0)));
      const quiet = idle > 0 ? `quiet for ${idle} min` : "gone quiet";
      return {
        title: `Potential Walkout${tableSuffix(table)}`,
        body: `${money(ctx.remainingMinor, currency)} still on the bill and ${quiet}. Check the table — leave the check open.`,
      };
    }
    // The money IS collected. Say so first, so nobody chases the guest.
    case "payment.unsynced":
      return {
        title: `Unsynced Payment${tableSuffix(table)}`,
        body: `${amount} was paid but did not reach the POS. The money is collected — record it on the POS using the "sunday" payment method so the check closes.`,
      };
  }
}
