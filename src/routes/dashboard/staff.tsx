import { createFileRoute } from "@tanstack/react-router";
import {
  addDays,
  differenceInMinutes,
  format,
  isSameDay,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import {
  BellRing,
  Bot,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Coffee,
  Eye,
  Flame,
  LoaderCircle,
  Medal,
  Pencil,
  Plus,
  Send,
  Smartphone,
  Sparkles,
  Target,
  Trophy,
  UserRoundX,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  AIStaffInsight,
  StaffMember,
  StaffNotification,
  StaffPerformanceChallenge,
  StaffPayout,
  StaffRole,
  StaffShift,
} from "@/components/merchant/features/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { TipsPanel } from "@/components/staff/TipsPanel";
import {
  ensureMerchantDemoData,
  flattenTransactions,
  generateAIStaffInsights,
  getStaffPayoutSummary,
  loadMerchantSnapshot,
  readStorage,
  saveMerchantStaffChallenges,
  saveMerchantStaffInsights,
  saveMerchantStaffMembers,
  saveMerchantStaffNotifications,
  saveMerchantStaffPayouts,
  saveMerchantStaffShifts,
  writeStorage,
} from "@/lib/merchant-dashboard";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/dashboard/staff")({
  component: StaffDashboardPage,
});

type StaffTab = "team" | "performance" | "shifts" | "tips" | "payouts" | "notifications";
type PerformancePeriod = "today" | "week" | "month";
type AutoPayoutMode = "manual" | "daily" | "weekly";
type StaffNotificationPreferences = Record<
  string,
  Record<StaffNotification["type"], boolean>
>;

type StaffFormState = {
  id?: string;
  name: string;
  phone: string;
  role: StaffRole;
  assignedZones: string[];
};

type ChallengeFormState = {
  title: string;
  description: string;
  metric: StaffPerformanceChallenge["metric"];
  target: string;
  reward: string;
  startDate: string;
  endDate: string;
};

type IndividualPayoutForm = {
  staffId: string;
  amount: string;
  type: StaffPayout["type"];
};

type WalkoutFormState = {
  staffId: string;
  tableNumber: string;
  amount: string;
  note: string;
};

type LeaderboardEntry = {
  staff: StaffMember;
  tablesServed: number;
  totalTips: number;
  todayTips: number;
  avgRating: number;
  avgTurnTime: number;
  avgTipPercent: number;
  upsellRate: number;
  ticketAverage: number;
};

type AchievementCard = {
  title: string;
  subtitle: string;
  winner?: string;
  icon: LucideIcon;
  tone: string;
};

const currency = new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
  maximumFractionDigits: 0,
});

const mpesaGreen = "#00A651";
const autoPayoutStorageKey = "fxengine.staff.autoPayoutMode";
const notificationPrefsStorageKey = "fxengine.staff.notificationPrefs";
const challengeMetricLabels: Record<
  StaffPerformanceChallenge["metric"],
  string
> = {
  tables_served: "Tables served",
  avg_rating: "Avg rating",
  tip_percentage: "Tip %",
  speed: "Speed",
  upsell_rate: "Upsell rate",
};
const challengeMetricHints: Record<
  StaffPerformanceChallenge["metric"],
  string
> = {
  tables_served: "Push more covers without hurting guest experience.",
  avg_rating: "Keep reviews above your guest love target.",
  tip_percentage: "Lift tips as a share of total sales.",
  speed: "Trim service time and keep courses moving.",
  upsell_rate: "Convert more guests into premium pairings.",
};
const chartColors = [
  "#f59e0b",
  "#0f766e",
  "#2563eb",
  "#7c3aed",
  mpesaGreen,
  "#ef4444",
];

function formatKes(amount: number) {
  return currency.format(amount);
}

function formatRole(role: StaffRole) {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function formatLabel(value: string) {
  return value
    .replaceAll("_", " ")
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getInitials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function todayKey() {
  return format(new Date(), "yyyy-MM-dd");
}

function createId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseTimeToMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function defaultNotificationPreferences(): Record<
  StaffNotification["type"],
  boolean
> {
  return {
    order_ready: true,
    table_seated: true,
    payment_received: true,
    tip_received: true,
    walkout: true,
    schedule_change: true,
    ai_suggestion: true,
    payout_sent: true,
  };
}

function mergeInsights(
  current: AIStaffInsight[],
  next: AIStaffInsight[],
): AIStaffInsight[] {
  const dismissed = new Set(
    current.filter((insight) => insight.dismissed).map((insight) => insight.id),
  );
  return next.map((insight) =>
    dismissed.has(insight.id) ? { ...insight, dismissed: true } : insight,
  );
}

function buildDefaultShift(
  staffId: string,
  role: StaffRole,
  date: string,
): StaffShift {
  const presets: Record<StaffRole, [string, string]> = {
    waiter: ["15:00", "23:00"],
    bartender: ["16:00", "23:00"],
    kitchen: ["11:00", "20:00"],
    host: ["12:00", "20:00"],
    manager: ["10:00", "19:00"],
    admin: ["09:00", "17:00"],
  };
  const [startTime, endTime] = presets[role];
  return {
    id: createId("shift"),
    staffId,
    date,
    startTime,
    endTime,
    breakMinutes: 0,
    status: "scheduled",
  };
}

function emptyStaffForm(): StaffFormState {
  return {
    name: "",
    phone: "2547",
    role: "waiter",
    assignedZones: [],
  };
}

function emptyChallengeForm(): ChallengeFormState {
  const startDate = todayKey();
  const endDate = format(addDays(new Date(), 7), "yyyy-MM-dd");
  return {
    title: "",
    description: "",
    metric: "tables_served",
    target: "18",
    reward: "2500",
    startDate,
    endDate,
  };
}

function emptyPayoutForm(staffId = ""): IndividualPayoutForm {
  return {
    staffId,
    amount: "",
    type: "tip",
  };
}

function emptyWalkoutForm(staffId = ""): WalkoutFormState {
  return {
    staffId,
    tableNumber: "",
    amount: "",
    note: "",
  };
}

function SummaryCard({
  title,
  value,
  subtitle,
  icon: Icon,
  tone,
}: {
  title: string;
  value: string;
  subtitle: string;
  icon: LucideIcon;
  tone: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-slate-500">{title}</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
          <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
        </div>
        <div className={cn("rounded-2xl p-3", tone)}>
          <Icon className="size-5" />
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ label, tone }: { label: string; tone: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium",
        tone,
      )}
    >
      {label}
    </span>
  );
}

function ProgressPill({
  value,
  max = 100,
  tone,
}: {
  value: number;
  max?: number;
  tone: string;
}) {
  const width = Math.max(6, Math.min(100, max > 0 ? (value / max) * 100 : 0));
  return (
    <div className="space-y-2">
      <div className="h-2.5 rounded-full bg-slate-100">
        <div
          className={cn("h-2.5 rounded-full transition-all", tone)}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

function SectionTitle({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <p className="text-sm text-slate-500">{description}</p>
      </div>
      {action}
    </div>
  );
}

function StaffDashboardPage() {
  const initialSnapshot = (() => {
    ensureMerchantDemoData();
    return loadMerchantSnapshot();
  })();
  const [activeTab, setActiveTab] = useState<StaffTab>("team");
  const [period, setPeriod] = useState<PerformancePeriod>("week");
  const [staffMembers, setStaffMembers] = useState<StaffMember[]>(
    initialSnapshot.staffMembers,
  );
  const [staffShifts, setStaffShifts] = useState<StaffShift[]>(
    initialSnapshot.staffShifts,
  );
  const [notifications, setNotifications] = useState<StaffNotification[]>(
    initialSnapshot.staffNotifications,
  );
  const [payouts, setPayouts] = useState<StaffPayout[]>(
    initialSnapshot.staffPayouts,
  );
  const [challenges, setChallenges] = useState<StaffPerformanceChallenge[]>(
    initialSnapshot.staffChallenges,
  );
  const [insights, setInsights] = useState<AIStaffInsight[]>(
    initialSnapshot.staffInsights.length
      ? initialSnapshot.staffInsights
      : generateAIStaffInsights(
          initialSnapshot.staffMembers,
          initialSnapshot.staffShifts,
        ),
  );
  const [autoPayoutMode, setAutoPayoutMode] = useState<AutoPayoutMode>(() =>
    readStorage<AutoPayoutMode>(autoPayoutStorageKey, "manual"),
  );
  const [notificationPrefs, setNotificationPrefs] =
    useState<StaffNotificationPreferences>(() => {
      const stored = readStorage<StaffNotificationPreferences>(
        notificationPrefsStorageKey,
        {},
      );
      return initialSnapshot.staffMembers.reduce<StaffNotificationPreferences>(
        (acc, staff) => {
          acc[staff.id] = stored[staff.id] ?? defaultNotificationPreferences();
          return acc;
        },
        {},
      );
    });
  const [staffDialogOpen, setStaffDialogOpen] = useState(false);
  const [challengeDialogOpen, setChallengeDialogOpen] = useState(false);
  const [profileStaffId, setProfileStaffId] = useState<string | null>(null);
  const [staffForm, setStaffForm] = useState<StaffFormState>(emptyStaffForm);
  const [challengeForm, setChallengeForm] =
    useState<ChallengeFormState>(emptyChallengeForm);
  const [payoutForm, setPayoutForm] =
    useState<IndividualPayoutForm>(emptyPayoutForm);
  const [walkoutForm, setWalkoutForm] =
    useState<WalkoutFormState>(emptyWalkoutForm);
  const [sendingBatch, setSendingBatch] = useState(false);
  const [sendingPayoutTo] = useState<string | null>(null);

  const snapshot = initialSnapshot;
  const zoneMap = useMemo(
    () => new Map(snapshot.zones.map((zone) => [zone.id, zone])),
    [snapshot.zones],
  );
  const staffById = useMemo(
    () => new Map(staffMembers.map((member) => [member.id, member])),
    [staffMembers],
  );
  const today = todayKey();
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const weekDays = Array.from({ length: 7 }, (_, index) =>
    addDays(weekStart, index),
  );

  const transactions = useMemo(
    () =>
      flattenTransactions(snapshot.tables).filter(
        (payment) => payment.status === "succeeded",
      ),
    [snapshot.tables],
  );
  const reviewsByServer = useMemo(() => {
    return snapshot.reviews.reduce<Record<string, number[]>>((acc, review) => {
      if (!acc[review.server]) acc[review.server] = [];
      acc[review.server]?.push(review.rating);
      return acc;
    }, {});
  }, [snapshot.reviews]);

  const periodStart = useMemo(() => {
    if (period === "today") return startOfDay(new Date());
    if (period === "week") return startOfWeek(new Date(), { weekStartsOn: 1 });
    return startOfMonth(new Date());
  }, [period]);

  const filteredTransactions = useMemo(
    () =>
      transactions.filter(
        (payment) => new Date(payment.createdAt) >= periodStart,
      ),
    [periodStart, transactions],
  );
  const filteredOrders = useMemo(
    () =>
      snapshot.orders.filter(
        (order) => new Date(order.orderedAt) >= periodStart,
      ),
    [periodStart, snapshot.orders],
  );

  const leaderboard = useMemo<LeaderboardEntry[]>(() => {
    return staffMembers
      .map((staff) => {
        const staffTransactions = filteredTransactions.filter(
          (payment) => payment.server === staff.name,
        );
        const todayTransactions = transactions.filter(
          (payment) =>
            payment.server === staff.name &&
            isSameDay(new Date(payment.createdAt), new Date()),
        );
        const staffOrders = filteredOrders.filter(
          (order) => order.server === staff.name && order.servedAt,
        );
        const totalSales = staffTransactions.reduce(
          (sum, payment) => sum + payment.amount,
          0,
        );
        const totalTips = staffTransactions.reduce(
          (sum, payment) => sum + payment.tip,
          0,
        );
        const todayTips = todayTransactions.reduce(
          (sum, payment) => sum + payment.tip,
          0,
        );
        const ratings = reviewsByServer[staff.name] ?? [];
        const avgRating = ratings.length
          ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length
          : 0;
        const turnTimes = staffOrders
          .filter((order) => order.servedAt)
          .map((order) =>
            differenceInMinutes(
              new Date(order.servedAt || order.orderedAt),
              new Date(order.orderedAt),
            ),
          );
        const avgTurnTime = turnTimes.length
          ? turnTimes.reduce((sum, value) => sum + value, 0) / turnTimes.length
          : 0;
        const ticketAverage = staffTransactions.length
          ? totalSales / staffTransactions.length
          : 0;
        const upsellRate = staffTransactions.length
          ? (staffTransactions.filter((payment) => payment.amount >= 3500)
              .length /
              staffTransactions.length) *
            100
          : 0;
        return {
          staff,
          tablesServed: staffTransactions.length,
          totalTips,
          todayTips,
          avgRating,
          avgTurnTime,
          avgTipPercent: totalSales ? (totalTips / totalSales) * 100 : 0,
          upsellRate,
          ticketAverage,
        };
      })
      .sort((left, right) => right.totalTips - left.totalTips);
  }, [
    filteredOrders,
    filteredTransactions,
    reviewsByServer,
    staffMembers,
    transactions,
  ]);

  const leaderboardMap = useMemo(
    () => new Map(leaderboard.map((entry) => [entry.staff.id, entry])),
    [leaderboard],
  );

  const activeChallenges = useMemo(
    () => challenges.filter((challenge) => challenge.endDate >= today),
    [challenges, today],
  );
  const todayShifts = useMemo(
    () => staffShifts.filter((shift) => shift.date === today),
    [staffShifts, today],
  );
  const roster = useMemo(
    () =>
      todayShifts
        .map((shift) => ({ shift, staff: staffById.get(shift.staffId) }))
        .filter((item): item is { shift: StaffShift; staff: StaffMember } =>
          Boolean(item.staff),
        )
        .sort(
          (left, right) =>
            parseTimeToMinutes(left.shift.startTime) -
            parseTimeToMinutes(right.shift.startTime),
        ),
    [staffById, todayShifts],
  );
  const payoutSummary = useMemo(
    () => getStaffPayoutSummary(payouts),
    [payouts],
  );
  const visibleInsights = useMemo(
    () => insights.filter((insight) => !insight.dismissed),
    [insights],
  );
  const profileStaff = profileStaffId
    ? (staffById.get(profileStaffId) ?? null)
    : null;
  const schedulingInsight = visibleInsights.find(
    (insight) => insight.type === "scheduling",
  );

  const achievementCards = useMemo<AchievementCard[]>(() => {
    const tipLeader = [...leaderboard].sort(
      (left, right) => right.totalTips - left.totalTips,
    )[0];
    const fastest = [...leaderboard]
      .filter((entry) => entry.avgTurnTime > 0)
      .sort((left, right) => left.avgTurnTime - right.avgTurnTime)[0];
    const busiest = [...leaderboard].sort(
      (left, right) => right.tablesServed - left.tablesServed,
    )[0];
    const highestRated = [...leaderboard]
      .filter((entry) => entry.avgRating > 0)
      .sort((left, right) => right.avgRating - left.avgRating)[0];
    const upsell = [...leaderboard].sort(
      (left, right) => right.upsellRate - left.upsellRate,
    )[0];
    return [
      {
        title: "Top Tipper",
        subtitle: tipLeader
          ? `${formatKes(tipLeader.totalTips)} in tips`
          : "No tips yet",
        winner: tipLeader?.staff.name,
        icon: Wallet,
        tone: "bg-emerald-50 text-emerald-700",
      },
      {
        title: "Fastest Service",
        subtitle: fastest
          ? `${fastest.avgTurnTime.toFixed(0)} min avg turn`
          : "Awaiting service data",
        winner: fastest?.staff.name,
        icon: Flame,
        tone: "bg-amber-50 text-amber-700",
      },
      {
        title: "Most Tables",
        subtitle: busiest ? `${busiest.tablesServed} tables` : "No covers yet",
        winner: busiest?.staff.name,
        icon: Trophy,
        tone: "bg-blue-50 text-blue-700",
      },
      {
        title: "Best Rating",
        subtitle: highestRated
          ? `${highestRated.avgRating.toFixed(1)} guest rating`
          : "No reviews yet",
        winner: highestRated?.staff.name,
        icon: Medal,
        tone: "bg-violet-50 text-violet-700",
      },
      {
        title: "Upsell Champion",
        subtitle: upsell
          ? `${upsell.upsellRate.toFixed(0)}% premium tickets`
          : "No upsells yet",
        winner: upsell?.staff.name,
        icon: Sparkles,
        tone: "bg-rose-50 text-rose-700",
      },
    ];
  }, [leaderboard]);

  const challengeCards = useMemo(
    () =>
      activeChallenges.map((challenge) => ({
        ...challenge,
        participants: challenge.participants
          .map((participant) => ({
            ...participant,
            progress: leaderboardMap.get(participant.staffId)
              ? (() => {
                  const entry = leaderboardMap.get(participant.staffId)!;
                  if (challenge.metric === "tables_served")
                    return entry.tablesServed;
                  if (challenge.metric === "avg_rating") return entry.avgRating;
                  if (challenge.metric === "tip_percentage")
                    return entry.avgTipPercent;
                  if (challenge.metric === "upsell_rate")
                    return entry.upsellRate;
                  return entry.avgTurnTime
                    ? Math.max(0, 60 - entry.avgTurnTime)
                    : participant.progress;
                })()
              : participant.progress,
          }))
          .sort((left, right) => right.progress - left.progress),
      })),
    [activeChallenges, leaderboardMap],
  );

  const performanceChartData = leaderboard.map((entry) => ({
    name: entry.staff.name.split(" ")[0],
    Tips: Math.round(entry.totalTips),
    Rating: Number(entry.avgRating.toFixed(1)),
    Tables: entry.tablesServed,
  }));

  const trendData = useMemo(() => {
    const labels =
      period === "today"
        ? Array.from({ length: 6 }, (_, index) => `${11 + index}:00`)
        : Array.from({ length: 7 }, (_, index) =>
            format(addDays(weekStart, index), "EEE"),
          );

    return labels.map((label, labelIndex) => {
      const datum: Record<string, number | string> = { label };
      staffMembers.forEach((member, memberIndex) => {
        const base =
          leaderboardMap.get(member.id)?.todayTips ??
          leaderboardMap.get(member.id)?.totalTips ??
          0;
        datum[member.name] =
          period === "today"
            ? Math.round(base / 6 + labelIndex * (memberIndex + 1) * 35)
            : Math.round(base / 2 + labelIndex * (memberIndex + 1) * 45);
      });
      return datum;
    });
  }, [leaderboardMap, period, staffMembers, weekStart]);

  const teamPendingPayout = staffMembers.reduce(
    (sum, staff) => sum + staff.pendingPayout,
    0,
  );
  const teamActiveCount = staffMembers.filter((staff) => staff.isActive).length;
  const onShiftCount = roster.filter(
    (item) => item.shift.status !== "absent",
  ).length;

  const persistInsights = (
    nextStaff: StaffMember[],
    nextShifts: StaffShift[],
  ) => {
    const nextInsights = mergeInsights(
      insights,
      generateAIStaffInsights(nextStaff, nextShifts),
    );
    setInsights(nextInsights);
    saveMerchantStaffInsights(nextInsights);
    return nextInsights;
  };

  const updateStaffAndShifts = (
    nextStaff: StaffMember[],
    nextShifts: StaffShift[],
  ) => {
    setStaffMembers(nextStaff);
    setStaffShifts(nextShifts);
    saveMerchantStaffMembers(nextStaff);
    saveMerchantStaffShifts(nextShifts);
    persistInsights(nextStaff, nextShifts);
  };

  const updateStaffOnly = (nextStaff: StaffMember[]) => {
    setStaffMembers(nextStaff);
    saveMerchantStaffMembers(nextStaff);
    persistInsights(nextStaff, staffShifts);
  };

  const updateShiftsOnly = (nextShifts: StaffShift[]) => {
    setStaffShifts(nextShifts);
    saveMerchantStaffShifts(nextShifts);
    persistInsights(staffMembers, nextShifts);
  };

  const updateNotifications = (nextNotifications: StaffNotification[]) => {
    setNotifications(nextNotifications);
    saveMerchantStaffNotifications(nextNotifications);
  };

  const updatePayouts = (nextPayouts: StaffPayout[]) => {
    setPayouts(nextPayouts);
    saveMerchantStaffPayouts(nextPayouts);
  };

  const updateChallenges = (nextChallenges: StaffPerformanceChallenge[]) => {
    setChallenges(nextChallenges);
    saveMerchantStaffChallenges(nextChallenges);
  };

  const syncNotificationPrefs = (nextStaff: StaffMember[]) => {
    const nextPrefs = nextStaff.reduce<StaffNotificationPreferences>(
      (acc, staff) => {
        acc[staff.id] =
          notificationPrefs[staff.id] ?? defaultNotificationPreferences();
        return acc;
      },
      {},
    );
    setNotificationPrefs(nextPrefs);
    writeStorage(notificationPrefsStorageKey, nextPrefs);
  };

  const staffZones = (staff: StaffMember) =>
    (staff.assignedZones ?? [])
      .map((zoneId) => zoneMap.get(zoneId)?.name)
      .filter((value): value is string => Boolean(value));

  const openCreateStaff = () => {
    setStaffForm(emptyStaffForm());
    setStaffDialogOpen(true);
  };

  const openEditStaff = (staff: StaffMember) => {
    setStaffForm({
      id: staff.id,
      name: staff.name,
      phone: staff.phone,
      role: staff.role,
      assignedZones: staff.assignedZones ?? [],
    });
    setStaffDialogOpen(true);
  };

  const handleSaveStaff = () => {
    const name = staffForm.name.trim();
    const phone = staffForm.phone.trim();
    if (!name || !/^254\d{9}$/.test(phone)) {
      toast.error(
        "Use a name and a valid 254XXXXXXXXX M-Pesa number.",
      );
      return;
    }
    const assignedTables = staffForm.assignedZones.flatMap((zoneId) => {
      const zone = zoneMap.get(zoneId);
      if (!zone) return [];
      return Array.from(
        { length: zone.tableRange[1] - zone.tableRange[0] + 1 },
        (_, index) => zone.tableRange[0] + index,
      );
    });
    const existing = staffMembers.find((staff) => staff.id === staffForm.id);
    const nextStaff = existing
      ? staffMembers.map((staff) =>
          staff.id === existing.id
            ? {
                ...staff,
                name,
                phone,
                role: staffForm.role,
                assignedZones: staffForm.assignedZones,
                assignedTables,
                mpesaPayoutEnabled: true,
              }
            : staff,
        )
      : [
          {
            id: createId("staff"),
            name,
            phone,
            role: staffForm.role,
            isActive: true,
            hiredAt: new Date().toISOString(),
            assignedZones: staffForm.assignedZones,
            assignedTables,
            mpesaPayoutEnabled: true,
            totalEarnings: 0,
            pendingPayout: 0,
          },
          ...staffMembers,
        ];
    updateStaffOnly(nextStaff);
    syncNotificationPrefs(nextStaff);
    setStaffDialogOpen(false);
    setStaffForm(emptyStaffForm());
    toast.success(
      existing ? "Staff profile updated." : "Staff member added to the team.",
    );
  };

  const handleToggleActive = (staffId: string) => {
    const nextStaff = staffMembers.map((staff) =>
      staff.id === staffId ? { ...staff, isActive: !staff.isActive } : staff,
    );
    updateStaffOnly(nextStaff);
    toast.success("Staff status updated.");
  };

  const handleCreateChallenge = () => {
    const title = challengeForm.title.trim();
    const description = challengeForm.description.trim();
    const target = Number(challengeForm.target);
    const reward = Number(challengeForm.reward);
    if (!title || !description || target <= 0 || reward <= 0) {
      toast.error("Add a title, description, target and reward.");
      return;
    }
    const participants = staffMembers
      .filter((staff) => staff.isActive)
      .map((staff) => {
        const entry = leaderboardMap.get(staff.id);
        let progress = 0;
        if (entry) {
          if (challengeForm.metric === "tables_served")
            progress = entry.tablesServed;
          if (challengeForm.metric === "avg_rating") progress = entry.avgRating;
          if (challengeForm.metric === "tip_percentage")
            progress = entry.avgTipPercent;
          if (challengeForm.metric === "upsell_rate")
            progress = entry.upsellRate;
          if (challengeForm.metric === "speed")
            progress = entry.avgTurnTime
              ? Math.max(0, 60 - entry.avgTurnTime)
              : 0;
        }
        return { staffId: staff.id, progress };
      });
    const nextChallenges = [
      {
        id: createId("challenge"),
        title,
        description,
        metric: challengeForm.metric,
        target,
        reward,
        startDate: challengeForm.startDate,
        endDate: challengeForm.endDate,
        participants,
      },
      ...challenges,
    ];
    updateChallenges(nextChallenges);
    setChallengeDialogOpen(false);
    setChallengeForm(emptyChallengeForm());
    toast.success("Challenge created for the team.");
  };

  const toggleShiftCell = (staff: StaffMember, date: string) => {
    const existing = staffShifts.find(
      (shift) => shift.staffId === staff.id && shift.date === date,
    );
    if (existing) {
      const nextShifts = staffShifts.filter(
        (shift) => shift.id !== existing.id,
      );
      updateShiftsOnly(nextShifts);
      toast.success(
        `Removed ${staff.name}'s shift on ${format(parseISO(date), "EEE d MMM")}.`,
      );
      return;
    }
    const nextShifts = [
      buildDefaultShift(staff.id, staff.role, date),
      ...staffShifts,
    ];
    updateShiftsOnly(nextShifts);
    toast.success(
      `Added ${staff.name} to ${format(parseISO(date), "EEE d MMM")}.`,
    );
  };

  const handleClockIn = (shift: StaffShift) => {
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const late = nowMinutes > parseTimeToMinutes(shift.startTime) + 15;
    const status: StaffShift["status"] = late ? "late" : "active";
    const nextShifts: StaffShift[] = staffShifts.map((item) =>
      item.id === shift.id
        ? {
            ...item,
            clockInAt: now.toISOString(),
            status,
          }
        : item,
    );
    updateShiftsOnly(nextShifts);
    toast.success(late ? "Clock-in logged as late." : "Clock-in logged.");
  };

  const handleClockOut = (shift: StaffShift) => {
    const nextShifts: StaffShift[] = staffShifts.map((item) =>
      item.id === shift.id
        ? {
            ...item,
            clockOutAt: new Date().toISOString(),
            status: "completed",
          }
        : item,
    );
    updateShiftsOnly(nextShifts);
    toast.success("Clock-out recorded.");
  };

  const addBreakTime = (shift: StaffShift, minutes: number) => {
    const nextShifts = staffShifts.map((item) =>
      item.id === shift.id
        ? { ...item, breakMinutes: item.breakMinutes + minutes }
        : item,
    );
    updateShiftsOnly(nextShifts);
    toast.success(`Added ${minutes} break minutes.`);
  };

  const updateAutoPayoutMode = (mode: AutoPayoutMode) => {
    setAutoPayoutMode(mode);
    writeStorage(autoPayoutStorageKey, mode);
  };

  const updateStaffPreference = (
    staffId: string,
    key: StaffNotification["type"],
    value: boolean,
  ) => {
    const nextPrefs: StaffNotificationPreferences = {
      ...notificationPrefs,
      [staffId]: {
        ...(notificationPrefs[staffId] ?? defaultNotificationPreferences()),
        [key]: value,
      },
    };
    setNotificationPrefs(nextPrefs);
    writeStorage(notificationPrefsStorageKey, nextPrefs);
  };

  const addNotification = (notification: StaffNotification) => {
    const nextNotifications = [notification, ...notifications].sort(
      (left, right) => +new Date(right.createdAt) - +new Date(left.createdAt),
    );
    updateNotifications(nextNotifications);
  };

  const addPayoutNotification = (staffId: string, amount: number) => {
    return {
      id: createId("notification"),
      staffId,
      type: "payout_sent",
      title: "M-Pesa payout sent",
      message: `${formatKes(amount)} was sent to the staff member's M-Pesa wallet successfully.`,
      createdAt: new Date().toISOString(),
    } satisfies StaffNotification;
  };

  const handleBatchPayout = async () => {
    const payoutTargets = staffMembers.filter(
      (staff) => staff.pendingPayout > 0 && staff.mpesaPayoutEnabled,
    );
    if (!payoutTargets.length) {
      toast.info("No pending M-Pesa payouts to send right now.");
      return;
    }
    setSendingBatch(true);
    const startedAt = new Date().toISOString();
    const processingIds = new Set<string>();
    const startedPayouts = [...payouts];
    payoutTargets.forEach((staff) => {
      const existingPending = startedPayouts.find(
        (payout) =>
          payout.staffId === staff.id &&
          payout.status === "pending" &&
          payout.type === "tip",
      );
      if (existingPending) {
        existingPending.status = "processing";
        processingIds.add(existingPending.id);
        return;
      }
      const nextPayout: StaffPayout = {
        id: createId("payout"),
        staffId: staff.id,
        amount: staff.pendingPayout,
        currency: "KES",
        mpesaPhone: staff.phone,
        status: "processing",
        type: "tip",
        createdAt: startedAt,
        period: startedAt.slice(0, 7),
      };
      processingIds.add(nextPayout.id);
      startedPayouts.unshift(nextPayout);
    });
    updatePayouts([...startedPayouts]);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const processedAt = new Date().toISOString();
    const nextPayouts: StaffPayout[] = startedPayouts.map((payout) =>
      processingIds.has(payout.id)
        ? {
            ...payout,
            status: "sent",
            processedAt,
            mpesaReference:
              payout.mpesaReference ??
              `MPS-${payout.staffId.slice(-4)}-${Date.now().toString().slice(-5)}`,
          }
        : payout,
    );
    const payoutNotifications: StaffNotification[] = [];
    const nextStaff = staffMembers.map((staff) => {
      if (!payoutTargets.find((candidate) => candidate.id === staff.id))
        return staff;
      payoutNotifications.push(
        addPayoutNotification(staff.id, staff.pendingPayout),
      );
      return {
        ...staff,
        totalEarnings: staff.totalEarnings + staff.pendingPayout,
        pendingPayout: 0,
        lastPayoutAt: processedAt,
      };
    });
    updatePayouts(nextPayouts);
    updateStaffOnly(nextStaff);
    updateNotifications([...payoutNotifications, ...notifications]);
    setSendingBatch(false);
    toast.success(`Sent ${payoutTargets.length} M-Pesa payouts.`);
  };

  const handleIndividualPayout = async () => {
    toast.error(
      "Simulated payouts are disabled. Create a pending payout in Accounting and wait for verified transfer evidence.",
    );
  };

  const handleWalkoutReport = () => {
    const staff = staffById.get(walkoutForm.staffId);
    const amount = Number(walkoutForm.amount);
    if (!staff || !walkoutForm.tableNumber || amount <= 0) {
      toast.error("Choose staff, table and amount before saving the walkout.");
      return;
    }
    addNotification({
      id: createId("notification"),
      staffId: staff.id,
      type: "walkout",
      title: `Walkout reported at Table ${walkoutForm.tableNumber}`,
      message: `${staff.name} logged a walkout worth ${formatKes(amount)}. ${walkoutForm.note || "Manager follow-up recommended."}`,
      createdAt: new Date().toISOString(),
      metadata: {
        tableNumber: Number(walkoutForm.tableNumber),
        amount,
      },
    });
    setWalkoutForm(emptyWalkoutForm(staff.id));
    toast.success("Walkout report added to the staff feed.");
  };

  const markNotificationRead = (notificationId: string) => {
    const nextNotifications = notifications.map((notification) =>
      notification.id === notificationId && !notification.readAt
        ? { ...notification, readAt: new Date().toISOString() }
        : notification,
    );
    updateNotifications(nextNotifications);
  };

  const dismissInsight = (insightId: string) => {
    const nextInsights = insights.map((insight) =>
      insight.id === insightId ? { ...insight, dismissed: true } : insight,
    );
    setInsights(nextInsights);
    saveMerchantStaffInsights(nextInsights);
  };

  return (
    <div className="space-y-6 pb-8">
      <div className="rounded-3xl border border-slate-200 bg-gradient-to-br from-slate-900 via-slate-800 to-emerald-900 p-6 text-white shadow-xl">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium text-slate-100">
              <Sparkles className="size-4" />
              Sunday-style staff ops, tuned for African hospitality and M-Pesa
              payouts
            </div>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">
                Staff App
              </h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-200">
                Manage your floor team, shifts, performance and payouts from one
                merchant cockpit.
              </p>
            </div>
          </div>
          <div className="grid w-full gap-3 sm:grid-cols-3 lg:w-auto lg:min-w-[440px]">
            <SummaryCard
              title="Active team"
              value={`${teamActiveCount}`}
              subtitle={`${onShiftCount} on shift today`}
              icon={Users}
              tone="bg-white/10 text-white"
            />
            <SummaryCard
              title="Pending payouts"
              value={formatKes(teamPendingPayout)}
              subtitle="Ready for M-Pesa disbursement"
              icon={Wallet}
              tone="bg-emerald-500/20 text-emerald-100"
            />
            <SummaryCard
              title="AI nudges"
              value={`${visibleInsights.length}`}
              subtitle="Live coaching and staffing prompts"
              icon={Bot}
              tone="bg-violet-500/20 text-violet-100"
            />
          </div>
        </div>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as StaffTab)}
        className="space-y-6"
      >
        <TabsList className="grid h-auto w-full grid-cols-2 gap-2 rounded-2xl border border-slate-200 bg-white p-2 lg:grid-cols-6">
          <TabsTrigger value="team" className="rounded-xl">
            Team
          </TabsTrigger>
          <TabsTrigger value="performance" className="rounded-xl">
            Performance
          </TabsTrigger>
          <TabsTrigger value="shifts" className="rounded-xl">
            Shifts &amp; Scheduling
          </TabsTrigger>
          <TabsTrigger value="tips" className="rounded-xl">
            Tips
          </TabsTrigger>
          <TabsTrigger value="payouts" className="rounded-xl">
            Payouts
          </TabsTrigger>
          <TabsTrigger value="notifications" className="rounded-xl">
            Notifications &amp; AI
          </TabsTrigger>
        </TabsList>

        <TabsContent value="team" className="space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <SectionTitle
              title="Team roster"
              description="Every staff member gets a lightweight profile, payout wallet and shift snapshot."
              action={
                <Button onClick={openCreateStaff} className="gap-2 rounded-xl">
                  <Plus className="size-4" />
                  Add staff
                </Button>
              }
            />
          </div>
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {staffMembers.map((staff) => {
              const entry = leaderboardMap.get(staff.id);
              const shift = todayShifts.find(
                (item) => item.staffId === staff.id,
              );
              const zones = staffZones(staff);
              return (
                <div
                  key={staff.id}
                  className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="flex size-12 items-center justify-center rounded-2xl bg-slate-100 text-sm font-semibold text-slate-700">
                        {getInitials(staff.name)}
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold text-slate-900">
                            {staff.name}
                          </h3>
                          <StatusBadge
                            label={formatRole(staff.role)}
                            tone="bg-slate-100 text-slate-700"
                          />
                          <StatusBadge
                            label={staff.isActive ? "Active" : "Inactive"}
                            tone={
                              staff.isActive
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-slate-100 text-slate-500"
                            }
                          />
                        </div>
                        <p className="text-sm text-slate-500">{staff.phone}</p>
                      </div>
                    </div>
                    <StatusBadge
                      label={
                        staff.mpesaPayoutEnabled ? "M-Pesa on" : "M-Pesa off"
                      }
                      tone={
                        staff.mpesaPayoutEnabled
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-red-50 text-red-700"
                      }
                    />
                  </div>

                  <div className="mt-5 grid grid-cols-3 gap-3 rounded-2xl bg-slate-50 p-3 text-sm">
                    <div>
                      <p className="text-xs text-slate-500">Shift</p>
                      <p className="mt-1 font-medium text-slate-900">
                        {shift ? formatLabel(shift.status) : "Off"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Tables today</p>
                      <p className="mt-1 font-medium text-slate-900">
                        {entry?.tablesServed ?? 0}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Tips today</p>
                      <p className="mt-1 font-medium text-emerald-700">
                        {formatKes(entry?.todayTips ?? 0)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 space-y-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Assigned zones
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {zones.length ? (
                        zones.map((zone) => (
                          <span
                            key={zone}
                            className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700"
                          >
                            {zone}
                          </span>
                        ))
                      ) : (
                        <span className="text-sm text-slate-400">
                          No zone assigned yet
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="mt-5 flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      className="gap-2 rounded-xl"
                      onClick={() => openEditStaff(staff)}
                    >
                      <Pencil className="size-4" />
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      className="gap-2 rounded-xl"
                      onClick={() => setProfileStaffId(staff.id)}
                    >
                      <Eye className="size-4" />
                      View profile
                    </Button>
                    <Button
                      variant="outline"
                      className="gap-2 rounded-xl"
                      onClick={() => {
                        setActiveTab("payouts");
                        setPayoutForm(emptyPayoutForm(staff.id));
                      }}
                    >
                      <Send className="size-4" />
                      Send payout
                    </Button>
                    <Button
                      variant="outline"
                      className="gap-2 rounded-xl"
                      onClick={() => handleToggleActive(staff.id)}
                    >
                      <UserRoundX className="size-4" />
                      {staff.isActive ? "Deactivate" : "Reactivate"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="performance" className="space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <SectionTitle
              title="Leaderboard + incentives"
              description="Keep the existing staff leaderboard, then layer on challenges, badges and coaching moments."
              action={
                <div className="flex flex-wrap items-center gap-3">
                  <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1 text-sm">
                    {(["today", "week", "month"] as PerformancePeriod[]).map(
                      (value) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setPeriod(value)}
                          className={cn(
                            "rounded-lg px-3 py-1.5 transition",
                            period === value
                              ? "bg-white text-slate-900 shadow-sm"
                              : "text-slate-500",
                          )}
                        >
                          {value.charAt(0).toUpperCase() + value.slice(1)}
                        </button>
                      ),
                    )}
                  </div>
                  <Button
                    onClick={() => setChallengeDialogOpen(true)}
                    className="gap-2 rounded-xl bg-amber-500 hover:bg-amber-600"
                  >
                    <Target className="size-4" />
                    Create challenge
                  </Button>
                </div>
              }
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-slate-900">Leaderboard</h3>
                <StatusBadge
                  label="Amber = performance mode"
                  tone="bg-amber-50 text-amber-700"
                />
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-left text-slate-500">
                    <tr>
                      <th className="pb-3 pr-4">Staff</th>
                      <th className="pb-3 pr-4">Tables</th>
                      <th className="pb-3 pr-4">Tips</th>
                      <th className="pb-3 pr-4">Rating</th>
                      <th className="pb-3 pr-4">Speed</th>
                      <th className="pb-3">Upsell</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboard.map((entry, index) => (
                      <tr
                        key={entry.staff.id}
                        className="border-t border-slate-100 text-slate-700"
                      >
                        <td className="py-3 pr-4">
                          <div className="flex items-center gap-3">
                            <div className="flex size-9 items-center justify-center rounded-xl bg-slate-100 text-xs font-semibold text-slate-700">
                              {index + 1}
                            </div>
                            <div>
                              <p className="font-medium text-slate-900">
                                {entry.staff.name}
                              </p>
                              <p className="text-xs text-slate-500">
                                {formatRole(entry.staff.role)}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 pr-4">{entry.tablesServed}</td>
                        <td className="py-3 pr-4 font-medium text-emerald-700">
                          {formatKes(entry.totalTips)}
                        </td>
                        <td className="py-3 pr-4">
                          {entry.avgRating ? entry.avgRating.toFixed(1) : "—"}
                        </td>
                        <td className="py-3 pr-4">
                          {entry.avgTurnTime
                            ? `${entry.avgTurnTime.toFixed(0)}m`
                            : "—"}
                        </td>
                        <td className="py-3">{entry.upsellRate.toFixed(0)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="font-semibold text-slate-900">
                Achievement badges
              </h3>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                {achievementCards.map((badge) => (
                  <div
                    key={badge.title}
                    className="rounded-2xl border border-slate-100 bg-slate-50 p-4"
                  >
                    <div className="flex items-start gap-3">
                      <div className={cn("rounded-2xl p-3", badge.tone)}>
                        <badge.icon className="size-5" />
                      </div>
                      <div>
                        <p className="font-medium text-slate-900">
                          {badge.title}
                        </p>
                        <p className="text-sm text-slate-600">
                          {badge.winner ?? "TBD"}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {badge.subtitle}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="font-semibold text-slate-900">
                Tips and tables mix
              </h3>
              <div className="mt-4 h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={performanceChartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="Tips" fill="#f59e0b" radius={[6, 6, 0, 0]} />
                    <Bar
                      dataKey="Tables"
                      fill="#2563eb"
                      radius={[6, 6, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="font-semibold text-slate-900">Team tip trend</h3>
              <div className="mt-4 h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" />
                    <YAxis />
                    <Tooltip />
                    {staffMembers.map((member, index) => (
                      <Line
                        key={member.id}
                        type="monotone"
                        dataKey={member.name}
                        stroke={chartColors[index % chartColors.length]}
                        strokeWidth={2}
                        dot={false}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {challengeCards.map((challenge) => (
              <div
                key={challenge.id}
                className="rounded-2xl border border-amber-100 bg-white p-5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-amber-600">
                      Active challenge
                    </p>
                    <h3 className="mt-1 font-semibold text-slate-900">
                      {challenge.title}
                    </h3>
                    <p className="mt-1 text-sm text-slate-500">
                      {challenge.description}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-amber-50 px-3 py-2 text-right">
                    <p className="text-xs text-amber-700">Reward</p>
                    <p className="font-semibold text-amber-700">
                      {formatKes(challenge.reward)}
                    </p>
                  </div>
                </div>
                <div className="mt-4 rounded-2xl bg-slate-50 p-4">
                  <div className="flex items-center justify-between text-sm text-slate-500">
                    <span>{challengeMetricLabels[challenge.metric]}</span>
                    <span>Target {challenge.target}</span>
                  </div>
                  <div className="mt-3 space-y-4">
                    {challenge.participants.slice(0, 4).map((participant) => {
                      const staff = staffById.get(participant.staffId);
                      if (!staff) return null;
                      return (
                        <div key={participant.staffId}>
                          <div className="mb-2 flex items-center justify-between text-sm">
                            <span className="font-medium text-slate-700">
                              {staff.name}
                            </span>
                            <span className="text-slate-500">
                              {participant.progress.toFixed(
                                challenge.metric === "tables_served" ? 0 : 1,
                              )}{" "}
                              / {challenge.target}
                            </span>
                          </div>
                          <ProgressPill
                            value={participant.progress}
                            max={challenge.target}
                            tone="bg-amber-500"
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="shifts" className="space-y-6">
          <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
            <div className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
              <SectionTitle
                title="Today's roster"
                description="Clock in staff, manage breaks and spot late arrivals before service slips."
              />
              <div className="mt-4 grid gap-3">
                {roster.map(({ shift, staff }) => (
                  <div
                    key={shift.id}
                    className="rounded-2xl border border-slate-100 bg-slate-50 p-4"
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold text-slate-900">
                            {staff.name}
                          </h3>
                          <StatusBadge
                            label={formatLabel(shift.status)}
                            tone={
                              shift.status === "late"
                                ? "bg-amber-50 text-amber-700"
                                : shift.status === "active"
                                  ? "bg-blue-50 text-blue-700"
                                  : shift.status === "completed"
                                    ? "bg-emerald-50 text-emerald-700"
                                    : "bg-slate-100 text-slate-600"
                            }
                          />
                        </div>
                        <p className="mt-1 text-sm text-slate-500">
                          {shift.startTime} – {shift.endTime} • Break{" "}
                          {shift.breakMinutes} min
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {!shift.clockInAt ? (
                          <Button
                            className="gap-2 rounded-xl bg-blue-600 hover:bg-blue-700"
                            onClick={() => handleClockIn(shift)}
                          >
                            <Clock3 className="size-4" />
                            Clock in
                          </Button>
                        ) : null}
                        {shift.clockInAt && !shift.clockOutAt ? (
                          <>
                            <Button
                              variant="outline"
                              className="gap-2 rounded-xl"
                              onClick={() => addBreakTime(shift, 15)}
                            >
                              <Coffee className="size-4" />
                              +15m break
                            </Button>
                            <Button
                              variant="outline"
                              className="gap-2 rounded-xl"
                              onClick={() => handleClockOut(shift)}
                            >
                              <CheckCircle2 className="size-4" />
                              Clock out
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-violet-50 p-3 text-violet-700">
                  <Bot className="size-5" />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900">
                    AI scheduling suggestion
                  </h3>
                  <p className="text-sm text-slate-500">
                    Localized staffing guidance
                  </p>
                </div>
              </div>
              <div className="mt-4 rounded-2xl bg-violet-50 p-4 text-sm text-violet-900">
                <p className="font-medium">
                  {schedulingInsight?.title ?? "Friday evening staffing gap"}
                </p>
                <p className="mt-2">
                  {schedulingInsight?.insight ??
                    "Based on last month's data, you need 3 servers on Friday evening."}
                </p>
                <p className="mt-3 text-violet-700">
                  {schedulingInsight?.recommendation ??
                    "Add one extra waiter and keep a host flexible for terrace seating between 7pm and 9pm."}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <SectionTitle
              title="Weekly schedule grid"
              description="Tap any cell to create a shift. Tap again to clear it. Staff run top-to-bottom, Monday to Sunday left-to-right."
              action={
                <StatusBadge
                  label="Blue = shift planning"
                  tone="bg-blue-50 text-blue-700"
                />
              }
            />
            <div className="mt-4 overflow-x-auto">
              <div className="min-w-[860px]">
                <div className="grid grid-cols-[180px_repeat(7,minmax(90px,1fr))] gap-2 text-sm">
                  <div className="rounded-2xl bg-slate-50 px-4 py-3 font-medium text-slate-500">
                    Staff
                  </div>
                  {weekDays.map((day) => (
                    <div
                      key={day.toISOString()}
                      className="rounded-2xl bg-slate-50 px-3 py-3 text-center font-medium text-slate-500"
                    >
                      <p>{format(day, "EEE")}</p>
                      <p className="text-xs">{format(day, "d MMM")}</p>
                    </div>
                  ))}
                  {staffMembers.map((staff) => (
                    <Fragment key={staff.id}>
                      <div
                        key={`${staff.id}-label`}
                        className="rounded-2xl border border-slate-100 px-4 py-3"
                      >
                        <p className="font-medium text-slate-900">
                          {staff.name}
                        </p>
                        <p className="text-xs text-slate-500">
                          {formatRole(staff.role)}
                        </p>
                      </div>
                      {weekDays.map((day) => {
                        const date = format(day, "yyyy-MM-dd");
                        const shift = staffShifts.find(
                          (item) =>
                            item.staffId === staff.id && item.date === date,
                        );
                        return (
                          <button
                            key={`${staff.id}-${date}`}
                            type="button"
                            onClick={() => toggleShiftCell(staff, date)}
                            className={cn(
                              "min-h-24 rounded-2xl border p-3 text-left transition",
                              shift
                                ? "border-blue-200 bg-blue-50 text-blue-900"
                                : "border-slate-200 bg-white text-slate-500 hover:border-blue-200 hover:bg-blue-50/40",
                            )}
                          >
                            {shift ? (
                              <div className="space-y-2">
                                <p className="font-medium">
                                  {shift.startTime} – {shift.endTime}
                                </p>
                                <StatusBadge
                                  label={formatLabel(shift.status)}
                                  tone={
                                    shift.status === "late"
                                      ? "bg-amber-50 text-amber-700"
                                      : "bg-white text-blue-700"
                                  }
                                />
                                <p className="text-xs">
                                  Break {shift.breakMinutes} min
                                </p>
                              </div>
                            ) : (
                              <div className="flex h-full items-center justify-center text-xs">
                                Tap to add
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </Fragment>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="tips" className="space-y-6">
          <TipsPanel />
        </TabsContent>

        <TabsContent value="payouts" className="space-y-6">
          <div className="grid gap-4 lg:grid-cols-4">
            <SummaryCard
              title="Disbursed"
              value={formatKes(payoutSummary.totalDisbursed)}
              subtitle="Sent this period"
              icon={Wallet}
              tone="bg-emerald-50 text-emerald-700"
            />
            <SummaryCard
              title="Pending"
              value={formatKes(payoutSummary.pending)}
              subtitle="Queued tips and salaries"
              icon={Clock3}
              tone="bg-blue-50 text-blue-700"
            />
            <SummaryCard
              title="Tips"
              value={formatKes(payoutSummary.byType.tip)}
              subtitle="Tip disbursements"
              icon={Sparkles}
              tone="bg-amber-50 text-amber-700"
            />
            <SummaryCard
              title="Bonus + salary"
              value={formatKes(
                payoutSummary.byType.salary +
                  payoutSummary.byType.bonus +
                  payoutSummary.byType.incentive,
              )}
              subtitle="Fixed and incentive payouts"
              icon={Smartphone}
              tone="bg-violet-50 text-violet-700"
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
            <div className="space-y-4">
              <div className="rounded-2xl border border-emerald-100 bg-white p-5 shadow-sm">
                <SectionTitle
                  title="M-Pesa staff wallets"
                  description="Phone numbers double as staff bank accounts for disbursement."
                  action={
                    <Button
                      onClick={handleBatchPayout}
                      disabled={sendingBatch}
                      className="gap-2 rounded-xl"
                      style={{ backgroundColor: mpesaGreen }}
                    >
                      {sendingBatch ? (
                        <LoaderCircle className="size-4 animate-spin" />
                      ) : (
                        <Send className="size-4" />
                      )}
                      Batch payout
                    </Button>
                  }
                />
                <div className="mt-4 space-y-3">
                  {staffMembers.map((staff) => (
                    <div
                      key={staff.id}
                      className="flex flex-col gap-3 rounded-2xl border border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-slate-900">
                            {staff.name}
                          </p>
                          <StatusBadge
                            label={
                              staff.mpesaPayoutEnabled ? "Enabled" : "Disabled"
                            }
                            tone={
                              staff.mpesaPayoutEnabled
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-slate-100 text-slate-500"
                            }
                          />
                        </div>
                        <p className="text-sm text-slate-500">{staff.phone}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right text-sm">
                          <p className="text-slate-500">Pending</p>
                          <p className="font-medium text-emerald-700">
                            {formatKes(staff.pendingPayout)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const nextStaff = staffMembers.map((member) =>
                              member.id === staff.id
                                ? {
                                    ...member,
                                    mpesaPayoutEnabled:
                                      !member.mpesaPayoutEnabled,
                                  }
                                : member,
                            );
                            updateStaffOnly(nextStaff);
                          }}
                          className={cn(
                            "inline-flex rounded-full px-3 py-1.5 text-xs font-medium",
                            staff.mpesaPayoutEnabled
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-slate-100 text-slate-500",
                          )}
                        >
                          {staff.mpesaPayoutEnabled ? "Disable" : "Enable"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="font-semibold text-slate-900">Payout history</h3>
                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="text-left text-slate-500">
                      <tr>
                        <th className="pb-3 pr-4">Staff</th>
                        <th className="pb-3 pr-4">Type</th>
                        <th className="pb-3 pr-4">Amount</th>
                        <th className="pb-3 pr-4">Status</th>
                        <th className="pb-3">Reference</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payouts.map((payout) => (
                        <tr
                          key={payout.id}
                          className="border-t border-slate-100 text-slate-700"
                        >
                          <td className="py-3 pr-4">
                            {staffById.get(payout.staffId)?.name ??
                              "Former staff"}
                          </td>
                          <td className="py-3 pr-4 capitalize">
                            {payout.type}
                          </td>
                          <td className="py-3 pr-4 font-medium text-emerald-700">
                            {formatKes(payout.amount)}
                          </td>
                          <td className="py-3 pr-4">
                            <StatusBadge
                              label={formatLabel(payout.status)}
                              tone={
                                payout.status === "sent"
                                  ? "bg-emerald-50 text-emerald-700"
                                  : payout.status === "failed"
                                    ? "bg-red-50 text-red-700"
                                    : "bg-amber-50 text-amber-700"
                              }
                            />
                          </td>
                          <td className="py-3 text-xs text-slate-500">
                            {payout.mpesaReference ?? "Awaiting STK push"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-emerald-100 bg-white p-5 shadow-sm">
                <h3 className="font-semibold text-slate-900">
                  Auto-payout settings
                </h3>
                <div className="mt-4 grid gap-2">
                  {(["manual", "daily", "weekly"] as AutoPayoutMode[]).map(
                    (mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => updateAutoPayoutMode(mode)}
                        className={cn(
                          "flex items-center justify-between rounded-2xl border px-4 py-3 text-left",
                          autoPayoutMode === mode
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-slate-200 bg-white text-slate-600",
                        )}
                      >
                        <div>
                          <p className="font-medium capitalize">{mode}</p>
                          <p className="text-xs text-slate-500">
                            {mode === "manual"
                              ? "Manager approves every disbursement."
                              : `Send payouts ${mode}.`}
                          </p>
                        </div>
                        {autoPayoutMode === mode ? (
                          <CheckCircle2 className="size-4" />
                        ) : null}
                      </button>
                    ),
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-emerald-100 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-3">
                  <div
                    className="rounded-2xl p-3 text-white"
                    style={{ backgroundColor: mpesaGreen }}
                  >
                    <Smartphone className="size-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900">
                      STK push simulator
                    </h3>
                    <p className="text-sm text-slate-500">
                      Show exactly what an M-Pesa payout would do.
                    </p>
                  </div>
                </div>
                <div className="mt-4 space-y-4">
                  <label className="space-y-2 text-sm text-slate-600">
                    <span>Staff member</span>
                    <select
                      value={payoutForm.staffId}
                      onChange={(event) =>
                        setPayoutForm((current) => ({
                          ...current,
                          staffId: event.target.value,
                        }))
                      }
                      className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                    >
                      <option value="">Select staff member</option>
                      {staffMembers.map((staff) => (
                        <option key={staff.id} value={staff.id}>
                          {staff.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="space-y-2 text-sm text-slate-600">
                      <span>Amount (KES)</span>
                      <Input
                        value={payoutForm.amount}
                        onChange={(event) =>
                          setPayoutForm((current) => ({
                            ...current,
                            amount: event.target.value,
                          }))
                        }
                        placeholder="2500"
                      />
                    </label>
                    <label className="space-y-2 text-sm text-slate-600">
                      <span>Type</span>
                      <select
                        value={payoutForm.type}
                        onChange={(event) =>
                          setPayoutForm((current) => ({
                            ...current,
                            type: event.target.value as StaffPayout["type"],
                          }))
                        }
                        className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                      >
                        <option value="tip">Tip</option>
                        <option value="salary">Salary</option>
                        <option value="bonus">Bonus</option>
                        <option value="incentive">Incentive</option>
                      </select>
                    </label>
                  </div>
                  <Button
                    onClick={handleIndividualPayout}
                    disabled={
                      !payoutForm.staffId ||
                      sendingPayoutTo === payoutForm.staffId
                    }
                    className={cn(
                      "w-full gap-2 rounded-xl text-white",
                      sendingPayoutTo === payoutForm.staffId && "animate-pulse",
                    )}
                    style={{ backgroundColor: mpesaGreen }}
                  >
                    {sendingPayoutTo === payoutForm.staffId ? (
                      <LoaderCircle className="size-4 animate-spin" />
                    ) : (
                      <Send className="size-4" />
                    )}
                    {payoutForm.staffId
                      ? `Send to ${staffById.get(payoutForm.staffId)?.phone ?? "254..."}`
                      : "Choose a staff member first"}
                  </Button>
                  <div className="rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-800">
                    <p className="font-medium">Simulation</p>
                    <p className="mt-1">
                      Merchant app opens an STK push, confirms the staff wallet,
                      then records the payout reference after about 2 seconds.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="notifications" className="space-y-6">
          <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <SectionTitle
                  title="Live notification feed"
                  description="Order-ready alerts, payout events, walkouts and AI prompts land here in real time."
                />
                <div className="mt-4 space-y-3">
                  {notifications.map((notification) => {
                    const staff = staffById.get(notification.staffId);
                    return (
                      <div
                        key={notification.id}
                        className={cn(
                          "rounded-2xl border p-4",
                          notification.readAt
                            ? "border-slate-100 bg-slate-50"
                            : "border-violet-100 bg-violet-50/40",
                        )}
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-medium text-slate-900">
                                {notification.title}
                              </p>
                              <StatusBadge
                                label={notification.type.replaceAll("_", " ")}
                                tone="bg-white text-slate-600"
                              />
                            </div>
                            <p className="text-sm text-slate-600">
                              {notification.message}
                            </p>
                            <p className="text-xs text-slate-500">
                              {staff?.name ?? "System"} •{" "}
                              {format(
                                new Date(notification.createdAt),
                                "EEE d MMM, HH:mm",
                              )}
                            </p>
                          </div>
                          {!notification.readAt ? (
                            <Button
                              variant="outline"
                              className="rounded-xl"
                              onClick={() =>
                                markNotificationRead(notification.id)
                              }
                            >
                              Mark read
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-2xl border border-red-100 bg-white p-5 shadow-sm">
                <h3 className="font-semibold text-slate-900">
                  Walkout reporting
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  Capture guest walkouts instantly so managers can follow up
                  quickly.
                </p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="space-y-2 text-sm text-slate-600">
                    <span>Staff member</span>
                    <select
                      value={walkoutForm.staffId}
                      onChange={(event) =>
                        setWalkoutForm((current) => ({
                          ...current,
                          staffId: event.target.value,
                        }))
                      }
                      className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                    >
                      <option value="">Select staff member</option>
                      {staffMembers.map((staff) => (
                        <option key={staff.id} value={staff.id}>
                          {staff.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-2 text-sm text-slate-600">
                    <span>Table number</span>
                    <Input
                      value={walkoutForm.tableNumber}
                      onChange={(event) =>
                        setWalkoutForm((current) => ({
                          ...current,
                          tableNumber: event.target.value,
                        }))
                      }
                      placeholder="12"
                    />
                  </label>
                  <label className="space-y-2 text-sm text-slate-600">
                    <span>Estimated amount</span>
                    <Input
                      value={walkoutForm.amount}
                      onChange={(event) =>
                        setWalkoutForm((current) => ({
                          ...current,
                          amount: event.target.value,
                        }))
                      }
                      placeholder="4300"
                    />
                  </label>
                  <label className="space-y-2 text-sm text-slate-600 sm:col-span-2">
                    <span>Notes</span>
                    <textarea
                      value={walkoutForm.note}
                      onChange={(event) =>
                        setWalkoutForm((current) => ({
                          ...current,
                          note: event.target.value,
                        }))
                      }
                      rows={4}
                      className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                      placeholder="Guest left before payment after requesting manager support..."
                    />
                  </label>
                </div>
                <Button
                  onClick={handleWalkoutReport}
                  className="mt-4 gap-2 rounded-xl bg-red-600 hover:bg-red-700"
                >
                  <BellRing className="size-4" />
                  Report walkout
                </Button>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="rounded-2xl bg-violet-50 p-3 text-violet-700">
                    <Bot className="size-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900">
                      AI insights
                    </h3>
                    <p className="text-sm text-slate-500">
                      Operational nudges for staffing, coaching and payouts.
                    </p>
                  </div>
                </div>
                <div className="mt-4 space-y-3">
                  {visibleInsights.map((insight) => (
                    <div
                      key={insight.id}
                      className="rounded-2xl border border-violet-100 bg-violet-50/40 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-slate-900">
                            {insight.title}
                          </p>
                          <p className="mt-1 text-sm text-slate-600">
                            {insight.insight}
                          </p>
                          <p className="mt-3 text-sm text-violet-700">
                            {insight.recommendation}
                          </p>
                          <p className="mt-2 text-xs text-slate-500">
                            Confidence {Math.round(insight.confidence * 100)}%
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => dismissInsight(insight.id)}
                          className="text-xs text-slate-500 underline"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="font-semibold text-slate-900">
                  Notification preferences
                </h3>
                <div className="mt-4 space-y-4">
                  {staffMembers.map((staff) => (
                    <div
                      key={staff.id}
                      className="rounded-2xl border border-slate-100 p-4"
                    >
                      <div className="mb-3 flex items-center justify-between">
                        <div>
                          <p className="font-medium text-slate-900">
                            {staff.name}
                          </p>
                          <p className="text-xs text-slate-500">
                            {staff.phone}
                          </p>
                        </div>
                        <StatusBadge
                          label={formatRole(staff.role)}
                          tone="bg-slate-100 text-slate-600"
                        />
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {(
                          Object.keys(
                            defaultNotificationPreferences(),
                          ) as Array<StaffNotification["type"]>
                        ).map((key) => (
                          <label
                            key={`${staff.id}-${key}`}
                            className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600"
                          >
                            <span>{key.replaceAll("_", " ")}</span>
                            <input
                              type="checkbox"
                              checked={
                                notificationPrefs[staff.id]?.[key] ?? true
                              }
                              onChange={(event) =>
                                updateStaffPreference(
                                  staff.id,
                                  key,
                                  event.target.checked,
                                )
                              }
                              className="size-4 rounded border-slate-300"
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={staffDialogOpen} onOpenChange={setStaffDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {staffForm.id ? "Edit staff member" : "Add staff member"}
            </DialogTitle>
            <DialogDescription>
              Capture the M-Pesa number, role, access PIN and assigned zones for
              this teammate.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <label className="space-y-2 text-sm text-slate-600">
              <span>Full name</span>
              <Input
                value={staffForm.name}
                onChange={(event) =>
                  setStaffForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                placeholder="Amina N."
              />
            </label>
            <label className="space-y-2 text-sm text-slate-600">
              <span>M-Pesa number</span>
              <Input
                value={staffForm.phone}
                onChange={(event) =>
                  setStaffForm((current) => ({
                    ...current,
                    phone: event.target.value,
                  }))
                }
                placeholder="2547XXXXXXXX"
              />
            </label>
            <label className="space-y-2 text-sm text-slate-600">
              <span>Role</span>
              <select
                value={staffForm.role}
                onChange={(event) =>
                  setStaffForm((current) => ({
                    ...current,
                    role: event.target.value as StaffRole,
                  }))
                }
                className="w-full rounded-2xl border border-slate-200 px-4 py-3"
              >
                <option value="waiter">Waiter</option>
                <option value="bartender">Bartender</option>
                <option value="kitchen">Kitchen</option>
                <option value="host">Host</option>
                <option value="manager">Manager</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            <div className="space-y-2 sm:col-span-2">
              <span className="text-sm text-slate-600">Zone assignment</span>
              <div className="grid gap-2 sm:grid-cols-3">
                {snapshot.zones.map((zone) => {
                  const checked = staffForm.assignedZones.includes(zone.id);
                  return (
                    <label
                      key={zone.id}
                      className={cn(
                        "flex items-center justify-between rounded-2xl border px-4 py-3 text-sm",
                        checked
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-slate-200 bg-white text-slate-600",
                      )}
                    >
                      <span>{zone.name}</span>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) =>
                          setStaffForm((current) => ({
                            ...current,
                            assignedZones: event.target.checked
                              ? [...current.assignedZones, zone.id]
                              : current.assignedZones.filter(
                                  (zoneId) => zoneId !== zone.id,
                                ),
                          }))
                        }
                        className="size-4 rounded border-slate-300"
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              className="rounded-xl"
              onClick={() => setStaffDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button className="rounded-xl" onClick={handleSaveStaff}>
              Save staff member
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={challengeDialogOpen} onOpenChange={setChallengeDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create performance challenge</DialogTitle>
            <DialogDescription>
              Build a Sunday-style incentive sprint for tables, ratings, tips or
              upsells.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <label className="space-y-2 text-sm text-slate-600 sm:col-span-2">
              <span>Challenge title</span>
              <Input
                value={challengeForm.title}
                onChange={(event) =>
                  setChallengeForm((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
                placeholder="Weekend Upsell Sprint"
              />
            </label>
            <label className="space-y-2 text-sm text-slate-600 sm:col-span-2">
              <span>Description</span>
              <textarea
                value={challengeForm.description}
                onChange={(event) =>
                  setChallengeForm((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                rows={4}
                className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                placeholder="Reward the top staff members who keep ratings above 4.7 while driving premium pairings."
              />
            </label>
            <label className="space-y-2 text-sm text-slate-600">
              <span>Metric</span>
              <select
                value={challengeForm.metric}
                onChange={(event) =>
                  setChallengeForm((current) => ({
                    ...current,
                    metric: event.target
                      .value as StaffPerformanceChallenge["metric"],
                  }))
                }
                className="w-full rounded-2xl border border-slate-200 px-4 py-3"
              >
                {Object.entries(challengeMetricLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-400">
                {challengeMetricHints[challengeForm.metric]}
              </p>
            </label>
            <label className="space-y-2 text-sm text-slate-600">
              <span>Target</span>
              <Input
                value={challengeForm.target}
                onChange={(event) =>
                  setChallengeForm((current) => ({
                    ...current,
                    target: event.target.value,
                  }))
                }
                placeholder="18"
              />
            </label>
            <label className="space-y-2 text-sm text-slate-600">
              <span>Reward (KES)</span>
              <Input
                value={challengeForm.reward}
                onChange={(event) =>
                  setChallengeForm((current) => ({
                    ...current,
                    reward: event.target.value,
                  }))
                }
                placeholder="2500"
              />
            </label>
            <label className="space-y-2 text-sm text-slate-600">
              <span>Start date</span>
              <Input
                type="date"
                value={challengeForm.startDate}
                onChange={(event) =>
                  setChallengeForm((current) => ({
                    ...current,
                    startDate: event.target.value,
                  }))
                }
              />
            </label>
            <label className="space-y-2 text-sm text-slate-600">
              <span>End date</span>
              <Input
                type="date"
                value={challengeForm.endDate}
                onChange={(event) =>
                  setChallengeForm((current) => ({
                    ...current,
                    endDate: event.target.value,
                  }))
                }
              />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              className="rounded-xl"
              onClick={() => setChallengeDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              className="rounded-xl bg-amber-500 hover:bg-amber-600"
              onClick={handleCreateChallenge}
            >
              Launch challenge
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(profileStaff)}
        onOpenChange={(open) => !open && setProfileStaffId(null)}
      >
        <DialogContent className="sm:max-w-2xl">
          {profileStaff ? (
            <>
              <DialogHeader>
                <DialogTitle>{profileStaff.name}</DialogTitle>
                <DialogDescription>
                  {formatRole(profileStaff.role)} • Joined{" "}
                  {format(new Date(profileStaff.hiredAt), "d MMM yyyy")}
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-500">
                    Contact
                  </p>
                  <p className="mt-2 font-medium text-slate-900">
                    {profileStaff.phone}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    PINs are managed securely in venue staff settings.
                  </p>
                </div>
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-500">
                    Payout wallet
                  </p>
                  <p className="mt-2 font-medium text-emerald-700">
                    {formatKes(profileStaff.pendingPayout)} pending
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    Total earnings {formatKes(profileStaff.totalEarnings)}
                  </p>
                </div>
                <div className="rounded-2xl bg-slate-50 p-4 sm:col-span-2">
                  <p className="text-xs uppercase tracking-wide text-slate-500">
                    Assigned zones
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {staffZones(profileStaff).map((zone) => (
                      <span
                        key={zone}
                        className="rounded-full bg-white px-3 py-1 text-xs text-slate-700"
                      >
                        {zone}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="rounded-2xl bg-slate-50 p-4 sm:col-span-2">
                  <p className="text-xs uppercase tracking-wide text-slate-500">
                    Recent staff feed
                  </p>
                  <div className="mt-3 space-y-2">
                    {notifications
                      .filter(
                        (notification) =>
                          notification.staffId === profileStaff.id,
                      )
                      .slice(0, 3)
                      .map((notification) => (
                        <div
                          key={notification.id}
                          className="rounded-xl bg-white p-3 text-sm text-slate-600"
                        >
                          <p className="font-medium text-slate-900">
                            {notification.title}
                          </p>
                          <p className="mt-1">{notification.message}</p>
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
