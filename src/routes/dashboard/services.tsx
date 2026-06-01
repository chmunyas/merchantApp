import { createFileRoute, Link } from "@tanstack/react-router";
import {
  addDays,
  format,
  isSameDay,
  isToday,
  parseISO,
  startOfWeek,
} from "date-fns";
import {
  BarChart3,
  BriefcaseBusiness,
  CalendarClock,
  CalendarDays,
  CarFront,
  ChartColumnBig,
  CheckCircle2,
  Copy,
  Eye,
  Package2,
  Phone,
  Plus,
  ScanSearch,
  Send,
  Sparkles,
  UserPlus,
  Users,
  Wallet,
  Wrench,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  Booking,
  JobCard,
  ServiceClient,
  ServiceOffering,
  ServicePackage,
} from "@/components/merchant/features/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  ensureServicesDemoData,
  getServiceAnalytics,
  getServicesBusinessSlug,
  getStaffUtilization,
  saveServicesSnapshot,
  type ServicesSnapshot,
} from "@/lib/merchant-dashboard";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/dashboard/services")({
  component: ServicesDashboardPage,
});

type ServicesTab = "bookings" | "catalogue" | "clients" | "jobs" | "reports";

type BookingFormState = {
  id?: string;
  existingClientId: string;
  clientName: string;
  clientPhone: string;
  serviceId: string;
  staffId: string;
  date: string;
  startTime: string;
  duration: string;
  status: Booking["status"];
  paymentStatus: Booking["paymentStatus"];
  paymentMethod: Booking["paymentMethod"] | "";
  notes: string;
  isWalkIn: boolean;
};

type ServiceFormState = {
  id?: string;
  name: string;
  description: string;
  category: string;
  price: string;
  priceType: ServiceOffering["priceType"];
  duration: string;
  materials: string;
  staffIds: string[];
  isActive: boolean;
};

type PackageFormState = {
  id?: string;
  name: string;
  description: string;
  services: string[];
  price: string;
  savings: string;
  isActive: boolean;
};

type ClientFormState = {
  id?: string;
  name: string;
  phone: string;
  email: string;
  tag: ServiceClient["tag"];
  notes: string;
};

type JobCardFormState = {
  id?: string;
  clientId: string;
  title: string;
  description: string;
  estimatedCost: string;
  assignedStaff: string;
  laborHours: string;
  laborRate: string;
  materials: string;
};

const currency = new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
  maximumFractionDigits: 0,
});

const bookingStatusStyles: Record<Booking["status"], string> = {
  scheduled: "bg-blue-50 text-blue-700 border-blue-200",
  confirmed: "bg-indigo-50 text-indigo-700 border-indigo-200",
  in_progress: "bg-amber-50 text-amber-700 border-amber-200",
  completed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  cancelled: "bg-slate-100 text-slate-600 border-slate-200",
  no_show: "bg-rose-50 text-rose-700 border-rose-200",
};

const jobStages: JobCard["status"][] = [
  "received",
  "diagnosed",
  "quoted",
  "approved",
  "in_progress",
  "done",
  "invoiced",
  "paid",
];

const defaultTab: ServicesTab = "bookings";

function ServicesDashboardPage() {
  const [tab, setTab] = useState<ServicesTab>(defaultTab);
  const [snapshot, setSnapshot] = useState<ServicesSnapshot>(() =>
    ensureServicesDemoData(),
  );
  const [weekOffset, setWeekOffset] = useState(0);
  const [bookingFilterStaff, setBookingFilterStaff] = useState("all");
  const [bookingFilterService, setBookingFilterService] = useState("all");
  const [bookingFilterStatus, setBookingFilterStatus] = useState("all");
  const [selectedClientId, setSelectedClientId] = useState(
    snapshot.clients[0]?.id ?? "",
  );
  const [bookingDialogOpen, setBookingDialogOpen] = useState(false);
  const [serviceDialogOpen, setServiceDialogOpen] = useState(false);
  const [clientDialogOpen, setClientDialogOpen] = useState(false);
  const [jobDialogOpen, setJobDialogOpen] = useState(false);
  const [bookingForm, setBookingForm] = useState<BookingFormState>(() =>
    createBookingForm(snapshot),
  );
  const [serviceForm, setServiceForm] = useState<ServiceFormState>(() =>
    createServiceForm(),
  );
  const [packageForm, setPackageForm] = useState<PackageFormState>(() =>
    createPackageForm(),
  );
  const [clientForm, setClientForm] = useState<ClientFormState>(() =>
    createClientForm(),
  );
  const [jobForm, setJobForm] = useState<JobCardFormState>(() =>
    createJobCardForm(snapshot),
  );

  function persist(next: ServicesSnapshot) {
    setSnapshot(next);
    saveServicesSnapshot(next);
  }

  const businessLink = `/book/${getServicesBusinessSlug(snapshot.business)}`;
  const analytics = useMemo(
    () => getServiceAnalytics(snapshot.bookings, snapshot.services),
    [snapshot.bookings, snapshot.services],
  );
  const staffUtilization = useMemo(
    () => getStaffUtilization(snapshot.bookings, snapshot.staff),
    [snapshot.bookings, snapshot.staff],
  );

  const todayBookings = useMemo(
    () =>
      snapshot.bookings.filter((booking) =>
        isToday(parseISO(`${booking.date}T${booking.startTime}:00`)),
      ),
    [snapshot.bookings],
  );

  const weekStart = useMemo(() => {
    const start = startOfWeek(addDays(new Date(), weekOffset * 7), {
      weekStartsOn: 1,
    });
    start.setHours(0, 0, 0, 0);
    return start;
  }, [weekOffset]);

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)),
    [weekStart],
  );

  const filteredWeekBookings = useMemo(() => {
    return snapshot.bookings.filter((booking) => {
      const bookingDate = parseISO(`${booking.date}T${booking.startTime}:00`);
      const inWeek = weekDays.some((day) => isSameDay(day, bookingDate));
      if (!inWeek) return false;
      if (
        bookingFilterStaff !== "all" &&
        booking.staffId !== bookingFilterStaff
      )
        return false;
      if (
        bookingFilterService !== "all" &&
        booking.serviceId !== bookingFilterService
      )
        return false;
      if (
        bookingFilterStatus !== "all" &&
        booking.status !== bookingFilterStatus
      )
        return false;
      return true;
    });
  }, [
    bookingFilterService,
    bookingFilterStaff,
    bookingFilterStatus,
    snapshot.bookings,
    weekDays,
  ]);

  const selectedClient =
    snapshot.clients.find((client) => client.id === selectedClientId) ??
    snapshot.clients[0];
  const selectedClientBookings = useMemo(
    () =>
      snapshot.bookings.filter(
        (booking) => booking.clientId === selectedClient?.id,
      ),
    [selectedClient?.id, snapshot.bookings],
  );
  const selectedClientUpcoming = selectedClientBookings
    .filter(
      (booking) =>
        new Date(`${booking.date}T${booking.startTime}:00`) >= new Date(),
    )
    .sort((left, right) =>
      `${left.date}${left.startTime}`.localeCompare(
        `${right.date}${right.startTime}`,
      ),
    );
  const selectedClientPayments = selectedClientBookings.filter(
    (booking) => booking.paymentStatus !== "unpaid",
  );
  const selectedClientPreferredServices = [
    ...new Set(selectedClientBookings.map((booking) => booking.serviceName)),
  ];

  const averageJobCardValue = snapshot.jobCards.length
    ? Math.round(
        snapshot.jobCards.reduce(
          (sum, jobCard) => sum + (jobCard.actualCost ?? jobCard.estimatedCost),
          0,
        ) / snapshot.jobCards.length,
      )
    : 0;

  function openBookingDialog(walkIn = false) {
    setBookingForm(createBookingForm(snapshot, walkIn));
    setBookingDialogOpen(true);
  }

  function submitBooking() {
    const service = snapshot.services.find(
      (entry) => entry.id === bookingForm.serviceId,
    );
    if (!service) {
      toast.error("Choose a service first.");
      return;
    }

    const duration = Number(bookingForm.duration) || service.duration;
    const date = bookingForm.date || format(new Date(), "yyyy-MM-dd");
    const client = snapshot.clients.find(
      (entry) => entry.id === bookingForm.existingClientId,
    );
    const clientName = client?.name || bookingForm.clientName.trim();
    const clientPhone = client?.phone || bookingForm.clientPhone.trim();

    if (!clientName || !clientPhone) {
      toast.error("Client name and phone are required.");
      return;
    }

    const staff = snapshot.staff.find(
      (entry) => entry.id === bookingForm.staffId,
    );
    const startTime = bookingForm.startTime || "09:00";
    const endTime = addMinutesToTime(startTime, duration);
    const selectedClientRecord =
      client ??
      ({
        id: `client-${Date.now()}`,
        name: clientName,
        phone: clientPhone,
        tag: bookingForm.isWalkIn ? "new" : "regular",
        totalVisits: 0,
        totalSpent: 0,
        loyaltyPoints: 0,
        notes: bookingForm.notes || "Created from bookings tab",
        createdAt: new Date().toISOString(),
      } satisfies ServiceClient);

    const booking: Booking = {
      id: bookingForm.id ?? `booking-${Date.now()}`,
      clientId: selectedClientRecord.id,
      clientName: selectedClientRecord.name,
      clientPhone: selectedClientRecord.phone,
      serviceId: service.id,
      serviceName: service.name,
      staffId: staff?.id,
      staffName: staff?.name,
      date,
      startTime,
      endTime,
      duration,
      price: service.price,
      status: bookingForm.status,
      paymentStatus: bookingForm.paymentStatus,
      paymentMethod: bookingForm.paymentMethod || undefined,
      notes: bookingForm.notes,
      isWalkIn: bookingForm.isWalkIn,
      createdAt: new Date().toISOString(),
    };

    const nextClients = client
      ? snapshot.clients
      : [selectedClientRecord, ...snapshot.clients];
    const existingIndex = snapshot.bookings.findIndex(
      (entry) => entry.id === booking.id,
    );
    const nextBookings = [...snapshot.bookings];
    if (existingIndex >= 0) nextBookings[existingIndex] = booking;
    else nextBookings.unshift(booking);

    persist({
      ...snapshot,
      clients: nextClients,
      bookings: nextBookings,
    });
    setSelectedClientId(selectedClientRecord.id);
    setBookingDialogOpen(false);
    toast.success(booking.isWalkIn ? "Walk-in added" : "Booking saved");
  }

  function submitService() {
    if (!serviceForm.name.trim() || !serviceForm.category.trim()) {
      toast.error("Service name and category are required.");
      return;
    }
    const service: ServiceOffering = {
      id: serviceForm.id ?? `service-${Date.now()}`,
      name: serviceForm.name.trim(),
      description: serviceForm.description.trim(),
      category: serviceForm.category.trim(),
      price: Number(serviceForm.price) || 0,
      priceType: serviceForm.priceType,
      duration: Number(serviceForm.duration) || 30,
      staffIds: serviceForm.staffIds,
      materials: splitCommaValues(serviceForm.materials),
      isActive: serviceForm.isActive,
      image: undefined,
    };

    const existingIndex = snapshot.services.findIndex(
      (entry) => entry.id === service.id,
    );
    const nextServices = [...snapshot.services];
    if (existingIndex >= 0) nextServices[existingIndex] = service;
    else nextServices.unshift(service);
    persist({ ...snapshot, services: nextServices });
    setServiceDialogOpen(false);
    setServiceForm(createServiceForm());
    toast.success(existingIndex >= 0 ? "Service updated" : "Service added");
  }

  function submitPackage() {
    if (!packageForm.name.trim() || packageForm.services.length === 0) {
      toast.error("Package name and included services are required.");
      return;
    }
    const nextPackage: ServicePackage = {
      id: packageForm.id ?? `package-${Date.now()}`,
      name: packageForm.name.trim(),
      description: packageForm.description.trim(),
      services: packageForm.services,
      price: Number(packageForm.price) || 0,
      savings: Number(packageForm.savings) || 0,
      isActive: packageForm.isActive,
    };
    const index = snapshot.packages.findIndex(
      (entry) => entry.id === nextPackage.id,
    );
    const nextPackages = [...snapshot.packages];
    if (index >= 0) nextPackages[index] = nextPackage;
    else nextPackages.unshift(nextPackage);
    persist({ ...snapshot, packages: nextPackages });
    setPackageForm(createPackageForm());
    toast.success(index >= 0 ? "Package updated" : "Package saved");
  }

  function submitClient() {
    if (!clientForm.name.trim() || !clientForm.phone.trim()) {
      toast.error("Client name and phone are required.");
      return;
    }
    const nextClient: ServiceClient = {
      id: clientForm.id ?? `client-${Date.now()}`,
      name: clientForm.name.trim(),
      phone: clientForm.phone.trim(),
      email: clientForm.email.trim() || undefined,
      tag: clientForm.tag,
      totalVisits: snapshot.bookings.filter(
        (booking) => booking.clientId === clientForm.id,
      ).length,
      totalSpent: snapshot.bookings
        .filter(
          (booking) =>
            booking.clientId === clientForm.id &&
            booking.status === "completed",
        )
        .reduce((sum, booking) => sum + booking.price, 0),
      lastVisit: snapshot.bookings
        .filter((booking) => booking.clientId === clientForm.id)
        .sort((left, right) =>
          `${right.date}${right.startTime}`.localeCompare(
            `${left.date}${left.startTime}`,
          ),
        )[0]?.createdAt,
      notes: clientForm.notes.trim() || undefined,
      loyaltyPoints:
        snapshot.bookings.filter(
          (booking) => booking.clientId === clientForm.id,
        ).length * 10,
      createdAt: new Date().toISOString(),
    };
    const index = snapshot.clients.findIndex(
      (entry) => entry.id === nextClient.id,
    );
    const nextClients = [...snapshot.clients];
    if (index >= 0)
      nextClients[index] = { ...nextClients[index], ...nextClient };
    else nextClients.unshift(nextClient);
    persist({ ...snapshot, clients: nextClients });
    setSelectedClientId(nextClient.id);
    setClientDialogOpen(false);
    setClientForm(createClientForm());
    toast.success(index >= 0 ? "Client updated" : "Client added");
  }

  function submitJobCard() {
    if (!jobForm.clientId || !jobForm.title.trim()) {
      toast.error("Pick a client and add a job title.");
      return;
    }
    const client = snapshot.clients.find(
      (entry) => entry.id === jobForm.clientId,
    );
    if (!client) {
      toast.error("Selected client could not be found.");
      return;
    }
    const nextJobCard: JobCard = {
      id: jobForm.id ?? `job-${Date.now()}`,
      clientId: client.id,
      clientName: client.name,
      clientPhone: client.phone,
      title: jobForm.title.trim(),
      description: jobForm.description.trim(),
      status: "received",
      estimatedCost: Number(jobForm.estimatedCost) || 0,
      actualCost: undefined,
      materials: splitCommaValues(jobForm.materials).map((name) => ({
        name,
        qty: 1,
        unitCost: 0,
      })),
      laborHours: Number(jobForm.laborHours) || 0,
      laborRate: Number(jobForm.laborRate) || 0,
      photos: [],
      assignedStaff: jobForm.assignedStaff,
      createdAt: new Date().toISOString(),
    };
    const index = snapshot.jobCards.findIndex(
      (entry) => entry.id === nextJobCard.id,
    );
    const nextJobCards = [...snapshot.jobCards];
    if (index >= 0)
      nextJobCards[index] = { ...nextJobCards[index], ...nextJobCard };
    else nextJobCards.unshift(nextJobCard);
    persist({ ...snapshot, jobCards: nextJobCards });
    setJobDialogOpen(false);
    setJobForm(createJobCardForm(snapshot));
    toast.success(index >= 0 ? "Job card updated" : "Job card created");
  }

  function editService(service: ServiceOffering) {
    setServiceForm({
      id: service.id,
      name: service.name,
      description: service.description ?? "",
      category: service.category,
      price: String(service.price),
      priceType: service.priceType,
      duration: String(service.duration),
      materials: (service.materials ?? []).join(", "),
      staffIds: service.staffIds,
      isActive: service.isActive,
    });
    setServiceDialogOpen(true);
  }

  function editClient(client: ServiceClient) {
    setClientForm({
      id: client.id,
      name: client.name,
      phone: client.phone,
      email: client.email ?? "",
      tag: client.tag,
      notes: client.notes ?? "",
    });
    setClientDialogOpen(true);
  }

  function sendReminder(channel: "sms" | "whatsapp") {
    const upcoming = selectedClientUpcoming[0];
    if (!selectedClient || !upcoming) {
      toast.error("Choose a client with an upcoming booking.");
      return;
    }
    const message = `Hi ${selectedClient.name.split(" ")[0]}, your appointment is on ${format(parseISO(`${upcoming.date}T${upcoming.startTime}:00`), "EEE d MMM 'at' h:mm a")}. Reply to confirm or reschedule.`;
    void navigator.clipboard?.writeText(message).catch(() => undefined);
    toast.success(`${channel === "sms" ? "SMS" : "WhatsApp"} reminder copied`);
  }

  function advanceJobCard(jobCard: JobCard) {
    const currentIndex = jobStages.indexOf(jobCard.status);
    if (currentIndex === -1 || currentIndex === jobStages.length - 1) return;
    const nextStatus = jobStages[currentIndex + 1];
    const nextJobCards = snapshot.jobCards.map((entry) =>
      entry.id === jobCard.id
        ? {
            ...entry,
            status: nextStatus,
            startedAt:
              nextStatus === "in_progress"
                ? new Date().toISOString()
                : entry.startedAt,
            completedAt:
              nextStatus === "done"
                ? new Date().toISOString()
                : entry.completedAt,
            invoiceId:
              nextStatus === "invoiced" && !entry.invoiceId
                ? `INV-${entry.id.slice(-4).toUpperCase()}`
                : entry.invoiceId,
          }
        : entry,
    );
    persist({ ...snapshot, jobCards: nextJobCards });
    toast.success(`Job moved to ${nextStatus.replaceAll("_", " ")}`);
  }

  function linkInvoice(jobCard: JobCard) {
    const nextJobCards = snapshot.jobCards.map((entry) =>
      entry.id === jobCard.id
        ? {
            ...entry,
            invoiceId:
              entry.invoiceId ?? `INV-${entry.id.slice(-4).toUpperCase()}`,
            status: entry.status === "done" ? "invoiced" : entry.status,
          }
        : entry,
    );
    persist({ ...snapshot, jobCards: nextJobCards });
    toast.success("Invoice linked to job card");
  }

  function shareJobCard(jobCard: JobCard) {
    const message = [
      `*${jobCard.title}*`,
      `Client: ${jobCard.clientName} (${jobCard.clientPhone})`,
      `Status: ${jobCard.status.replaceAll("_", " ")}`,
      `Estimate: ${currency.format(jobCard.estimatedCost)}`,
      `Assigned: ${jobCard.assignedStaff}`,
      `Notes: ${jobCard.description}`,
      jobCard.invoiceId ? `Invoice: ${jobCard.invoiceId}` : null,
    ]
      .filter(Boolean)
      .join("\n");
    void navigator.clipboard?.writeText(message).catch(() => undefined);
    toast.success("WhatsApp-ready job card copied");
  }

  function toggleServiceActive(service: ServiceOffering) {
    persist({
      ...snapshot,
      services: snapshot.services.map((entry) =>
        entry.id === service.id
          ? { ...entry, isActive: !entry.isActive }
          : entry,
      ),
    });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-3xl bg-[linear-gradient(135deg,#111827_0%,#1e3a8a_55%,#312e81_100%)] p-6 text-white shadow-xl">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-3xl space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm text-blue-100">
              <BriefcaseBusiness className="h-4 w-4" /> General Services Module
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">
              {snapshot.business.name}
            </h1>
            <p className="max-w-2xl text-sm text-blue-100 sm:text-base">
              {snapshot.business.description}
            </p>
            <div className="flex flex-wrap items-center gap-3 text-sm text-blue-100">
              <span>{snapshot.business.location}</span>
              <span>•</span>
              <span>{snapshot.business.phone}</span>
              <span>•</span>
              <span>Till {snapshot.business.tillNumber}</span>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 lg:w-[420px]">
            <StatCard
              title="Today booked"
              value={String(todayBookings.length)}
              hint="appointments"
              tone="bg-white/10 text-white"
            />
            <StatCard
              title="Avg job card"
              value={currency.format(averageJobCardValue)}
              hint="all open + closed"
              tone="bg-white/10 text-white"
            />
            <StatCard
              title="Retention"
              value={`${analytics.clientRetentionRate}%`}
              hint="repeat customers"
              tone="bg-white/10 text-white"
            />
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <Button
            className="rounded-full bg-white text-slate-900 hover:bg-white/90"
            onClick={() => openBookingDialog(false)}
          >
            <Plus className="h-4 w-4" /> New booking
          </Button>
          <Button
            variant="outline"
            className="rounded-full border-white/20 bg-white/5 text-white hover:bg-white/10"
            onClick={() => openBookingDialog(true)}
          >
            <UserPlus className="h-4 w-4" /> Walk-in
          </Button>
          <Button
            variant="outline"
            className="rounded-full border-white/20 bg-white/5 text-white hover:bg-white/10"
            asChild
          >
            <Link to={businessLink} target="_blank" rel="noreferrer">
              <Eye className="h-4 w-4" /> Public booking page
            </Link>
          </Button>
          <Button
            variant="outline"
            className="rounded-full border-white/20 bg-white/5 text-white hover:bg-white/10"
            onClick={() => {
              void navigator.clipboard
                ?.writeText(`${window.location.origin}${businessLink}`)
                .catch(() => undefined);
              toast.success("Booking link copied");
            }}
          >
            <Copy className="h-4 w-4" /> Copy booking link
          </Button>
        </div>
      </div>

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as ServicesTab)}
        className="space-y-4"
      >
        <TabsList className="h-auto w-full flex-wrap justify-start gap-2 rounded-2xl bg-slate-100 p-2">
          <TabsTrigger value="bookings" className="rounded-xl px-4 py-2">
            Bookings
          </TabsTrigger>
          <TabsTrigger value="catalogue" className="rounded-xl px-4 py-2">
            Services Catalogue
          </TabsTrigger>
          <TabsTrigger value="clients" className="rounded-xl px-4 py-2">
            Clients
          </TabsTrigger>
          <TabsTrigger value="jobs" className="rounded-xl px-4 py-2">
            Job Cards
          </TabsTrigger>
          <TabsTrigger value="reports" className="rounded-xl px-4 py-2">
            Reports & Insights
          </TabsTrigger>
        </TabsList>

        <TabsContent value="bookings" className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-[1.1fr_1.9fr]">
            <Card className="rounded-3xl border-0 shadow-lg shadow-slate-200/50">
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-xl">
                      Today&apos;s appointments
                    </CardTitle>
                    <CardDescription>
                      Quick glance for the front desk and bay leads.
                    </CardDescription>
                  </div>
                  <Badge className="rounded-full bg-indigo-50 px-3 py-1 text-indigo-700 hover:bg-indigo-50">
                    {todayBookings.length} today
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {todayBookings.length === 0 ? (
                  <EmptyState
                    icon={CalendarClock}
                    title="No appointments today"
                    description="Use the quick-add button to create your first service booking."
                  />
                ) : (
                  todayBookings
                    .sort((left, right) =>
                      left.startTime.localeCompare(right.startTime),
                    )
                    .map((booking) => (
                      <div
                        key={booking.id}
                        className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-2">
                            <div className="flex items-center gap-2">
                              <h3 className="font-semibold text-slate-900">
                                {booking.clientName}
                              </h3>
                              {booking.isWalkIn ? (
                                <Badge className="rounded-full bg-amber-50 text-amber-700 hover:bg-amber-50">
                                  Walk-in
                                </Badge>
                              ) : null}
                            </div>
                            <p className="text-sm text-slate-600">
                              {booking.serviceName}
                            </p>
                            <div className="flex flex-wrap gap-3 text-xs text-slate-500">
                              <span>
                                {booking.startTime}–{booking.endTime}
                              </span>
                              <span>{booking.duration} min</span>
                              <span>{booking.staffName ?? "Unassigned"}</span>
                            </div>
                          </div>
                          <StatusBadge booking={booking} />
                        </div>
                        {booking.notes ? (
                          <p className="mt-3 text-sm text-slate-600">
                            {booking.notes}
                          </p>
                        ) : null}
                      </div>
                    ))
                )}
              </CardContent>
            </Card>

            <Card className="rounded-3xl border-0 shadow-lg shadow-slate-200/50">
              <CardHeader className="space-y-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <CardTitle className="text-xl">Weekly schedule</CardTitle>
                    <CardDescription>
                      Bookings arranged by day with time slots on the Y-axis.
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      className="rounded-full"
                      onClick={() => setWeekOffset((current) => current - 1)}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      className="rounded-full"
                      onClick={() => setWeekOffset(0)}
                    >
                      This week
                    </Button>
                    <Button
                      variant="outline"
                      className="rounded-full"
                      onClick={() => setWeekOffset((current) => current + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-4">
                  <FilterSelect
                    label="Staff member"
                    value={bookingFilterStaff}
                    onChange={setBookingFilterStaff}
                    options={[
                      { value: "all", label: "All staff" },
                      ...snapshot.staff.map((member) => ({
                        value: member.id,
                        label: member.name,
                      })),
                    ]}
                  />
                  <FilterSelect
                    label="Service type"
                    value={bookingFilterService}
                    onChange={setBookingFilterService}
                    options={[
                      { value: "all", label: "All services" },
                      ...snapshot.services.map((service) => ({
                        value: service.id,
                        label: service.name,
                      })),
                    ]}
                  />
                  <FilterSelect
                    label="Status"
                    value={bookingFilterStatus}
                    onChange={setBookingFilterStatus}
                    options={[
                      { value: "all", label: "All statuses" },
                      ...(
                        [
                          "scheduled",
                          "confirmed",
                          "in_progress",
                          "completed",
                          "cancelled",
                          "no_show",
                        ] as Booking["status"][]
                      ).map((status) => ({
                        value: status,
                        label: status.replaceAll("_", " "),
                      })),
                    ]}
                  />
                </div>
              </CardHeader>
              <CardContent>
                <WeekCalendar days={weekDays} bookings={filteredWeekBookings} />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="catalogue" className="space-y-6">
          <div className="grid gap-4 md:grid-cols-4">
            <SummaryTile
              icon={Wrench}
              title="Active services"
              value={String(
                snapshot.services.filter((service) => service.isActive).length,
              )}
              hint="ready to book"
              tone="from-indigo-500 to-blue-500"
            />
            <SummaryTile
              icon={Package2}
              title="Bundles"
              value={String(snapshot.packages.length)}
              hint="discount packages"
              tone="from-emerald-500 to-teal-500"
            />
            <SummaryTile
              icon={Users}
              title="Assigned staff"
              value={String(snapshot.staff.length)}
              hint="specialists"
              tone="from-amber-500 to-orange-500"
            />
            <SummaryTile
              icon={Wallet}
              title="Avg service"
              value={currency.format(
                Math.round(
                  snapshot.services.reduce(
                    (sum, service) => sum + service.price,
                    0,
                  ) / snapshot.services.length,
                ),
              )}
              hint="list price"
              tone="from-fuchsia-500 to-violet-500"
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.65fr_1fr]">
            <Card className="rounded-3xl border-0 shadow-lg shadow-slate-200/50">
              <CardHeader className="flex flex-row items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-xl">Service catalogue</CardTitle>
                  <CardDescription>
                    Set pricing, duration, materials, and staff assignment.
                  </CardDescription>
                </div>
                <Button
                  className="rounded-full"
                  onClick={() => {
                    setServiceForm(createServiceForm());
                    setServiceDialogOpen(true);
                  }}
                >
                  <Plus className="h-4 w-4" /> Add service
                </Button>
              </CardHeader>
              <CardContent>
                <div className="hidden lg:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Service</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Price</TableHead>
                        <TableHead>Duration</TableHead>
                        <TableHead>Staff</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {snapshot.services.map((service) => (
                        <TableRow key={service.id}>
                          <TableCell>
                            <div>
                              <div className="font-medium text-slate-900">
                                {service.name}
                              </div>
                              <div className="mt-1 max-w-md text-xs text-slate-500">
                                {service.description}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>{service.category}</TableCell>
                          <TableCell>
                            {currency.format(service.price)}
                          </TableCell>
                          <TableCell>{service.duration} min</TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {service.staffIds.map((staffId) => {
                                const member = snapshot.staff.find(
                                  (entry) => entry.id === staffId,
                                );
                                return (
                                  <Badge
                                    key={staffId}
                                    variant="outline"
                                    className="rounded-full px-2 py-0.5 text-xs"
                                  >
                                    {member?.name ?? staffId}
                                  </Badge>
                                );
                              })}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge
                              className={cn(
                                "rounded-full border px-3 py-1 capitalize",
                                service.isActive
                                  ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-50"
                                  : "bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-100",
                              )}
                            >
                              {service.isActive ? "active" : "inactive"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                className="rounded-full"
                                onClick={() => editService(service)}
                              >
                                Edit
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="rounded-full"
                                onClick={() => toggleServiceActive(service)}
                              >
                                {service.isActive ? "Pause" : "Activate"}
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="grid gap-4 lg:hidden">
                  {snapshot.services.map((service) => (
                    <div
                      key={service.id}
                      className="rounded-2xl border border-slate-200 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="font-semibold text-slate-900">
                            {service.name}
                          </h3>
                          <p className="mt-1 text-sm text-slate-500">
                            {service.description}
                          </p>
                        </div>
                        <Badge
                          className={cn(
                            "rounded-full border px-3 py-1 capitalize",
                            service.isActive
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-50"
                              : "bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-100",
                          )}
                        >
                          {service.isActive ? "active" : "inactive"}
                        </Badge>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-3 text-sm text-slate-600">
                        <span>{service.category}</span>
                        <span>{currency.format(service.price)}</span>
                        <span>{service.duration} min</span>
                      </div>
                      <div className="mt-4 flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="rounded-full"
                          onClick={() => editService(service)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="rounded-full"
                          onClick={() => toggleServiceActive(service)}
                        >
                          {service.isActive ? "Pause" : "Activate"}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-3xl border-0 shadow-lg shadow-slate-200/50">
              <CardHeader className="pb-4">
                <CardTitle className="text-xl">Package deals</CardTitle>
                <CardDescription>
                  Bundle popular services for higher basket size.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {snapshot.packages.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-semibold text-slate-900">
                          {entry.name}
                        </h3>
                        <p className="mt-1 text-sm text-slate-500">
                          {entry.description}
                        </p>
                      </div>
                      <Badge className="rounded-full bg-emerald-50 text-emerald-700 hover:bg-emerald-50">
                        Save {currency.format(entry.savings)}
                      </Badge>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {entry.services.map((serviceId) => {
                        const service = snapshot.services.find(
                          (candidate) => candidate.id === serviceId,
                        );
                        return (
                          <Badge
                            key={serviceId}
                            variant="outline"
                            className="rounded-full px-3 py-1 text-xs"
                          >
                            {service?.name ?? serviceId}
                          </Badge>
                        );
                      })}
                    </div>
                    <div className="mt-4 flex items-center justify-between text-sm">
                      <span className="text-slate-500">Bundle price</span>
                      <span className="font-semibold text-slate-900">
                        {currency.format(entry.price)}
                      </span>
                    </div>
                  </div>
                ))}
                <div className="rounded-2xl border border-dashed border-slate-300 p-4">
                  <h3 className="font-semibold text-slate-900">
                    Create or refresh a bundle
                  </h3>
                  <div className="mt-4 grid gap-3">
                    <Field label="Package name">
                      <Input
                        value={packageForm.name}
                        onChange={(event) =>
                          setPackageForm((current) => ({
                            ...current,
                            name: event.target.value,
                          }))
                        }
                        placeholder="Full Service Bundle"
                      />
                    </Field>
                    <Field label="Description">
                      <Textarea
                        value={packageForm.description}
                        onChange={(event) =>
                          setPackageForm((current) => ({
                            ...current,
                            description: event.target.value,
                          }))
                        }
                        placeholder="Oil + brakes + alignment for commuters"
                      />
                    </Field>
                    <Field label="Included services">
                      <select
                        multiple
                        value={packageForm.services}
                        onChange={(event) =>
                          setPackageForm((current) => ({
                            ...current,
                            services: Array.from(
                              event.target.selectedOptions,
                            ).map((option) => option.value),
                          }))
                        }
                        className="min-h-32 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      >
                        {snapshot.services.map((service) => (
                          <option key={service.id} value={service.id}>
                            {service.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <div className="grid gap-3 md:grid-cols-2">
                      <Field label="Bundle price">
                        <Input
                          type="number"
                          value={packageForm.price}
                          onChange={(event) =>
                            setPackageForm((current) => ({
                              ...current,
                              price: event.target.value,
                            }))
                          }
                        />
                      </Field>
                      <Field label="Customer savings">
                        <Input
                          type="number"
                          value={packageForm.savings}
                          onChange={(event) =>
                            setPackageForm((current) => ({
                              ...current,
                              savings: event.target.value,
                            }))
                          }
                        />
                      </Field>
                    </div>
                    <label className="flex items-center gap-3 text-sm text-slate-600">
                      <input
                        type="checkbox"
                        checked={packageForm.isActive}
                        onChange={(event) =>
                          setPackageForm((current) => ({
                            ...current,
                            isActive: event.target.checked,
                          }))
                        }
                        className="h-4 w-4 rounded border-slate-300"
                      />
                      Active package
                    </label>
                    <Button className="rounded-full" onClick={submitPackage}>
                      Save package
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="clients" className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
            <Card className="rounded-3xl border-0 shadow-lg shadow-slate-200/50">
              <CardHeader className="flex flex-row items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-xl">Client directory</CardTitle>
                  <CardDescription>
                    Visit history, spend, notes, and loyalty status.
                  </CardDescription>
                </div>
                <Button
                  className="rounded-full"
                  onClick={() => {
                    setClientForm(createClientForm());
                    setClientDialogOpen(true);
                  }}
                >
                  <Plus className="h-4 w-4" /> Add client
                </Button>
              </CardHeader>
              <CardContent className="space-y-3">
                {snapshot.clients.map((client) => (
                  <button
                    key={client.id}
                    type="button"
                    onClick={() => setSelectedClientId(client.id)}
                    className={cn(
                      "w-full rounded-2xl border p-4 text-left transition hover:border-indigo-300 hover:bg-indigo-50/40",
                      selectedClientId === client.id
                        ? "border-indigo-300 bg-indigo-50/60"
                        : "border-slate-200 bg-white",
                    )}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-slate-900">
                            {client.name}
                          </h3>
                          <Badge
                            className={cn(
                              "rounded-full px-3 py-1 capitalize",
                              client.tag === "vip"
                                ? "bg-amber-50 text-amber-700 hover:bg-amber-50"
                                : client.tag === "corporate"
                                  ? "bg-blue-50 text-blue-700 hover:bg-blue-50"
                                  : client.tag === "regular"
                                    ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-50"
                                    : "bg-slate-100 text-slate-600 hover:bg-slate-100",
                            )}
                          >
                            {client.tag}
                          </Badge>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-3 text-sm text-slate-500">
                          <span>{client.phone}</span>
                          {client.email ? <span>{client.email}</span> : null}
                        </div>
                      </div>
                      <div className="grid gap-1 text-right text-sm text-slate-600">
                        <span>{client.totalVisits} visits</span>
                        <span>{currency.format(client.totalSpent)}</span>
                        <span>
                          {client.lastVisit
                            ? format(parseISO(client.lastVisit), "d MMM yyyy")
                            : "No visits yet"}
                        </span>
                      </div>
                    </div>
                    {client.notes ? (
                      <p className="mt-3 text-sm text-slate-600">
                        {client.notes}
                      </p>
                    ) : null}
                  </button>
                ))}
              </CardContent>
            </Card>

            <Card className="rounded-3xl border-0 shadow-lg shadow-slate-200/50">
              <CardHeader>
                <CardTitle className="text-xl">Client profile</CardTitle>
                <CardDescription>
                  Preferred services, reminders, and payment history.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {selectedClient ? (
                  <>
                    <div className="rounded-2xl bg-slate-50 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-lg font-semibold text-slate-900">
                            {selectedClient.name}
                          </h3>
                          <p className="mt-1 text-sm text-slate-500">
                            {selectedClient.phone}
                          </p>
                          {selectedClient.notes ? (
                            <p className="mt-3 text-sm text-slate-600">
                              {selectedClient.notes}
                            </p>
                          ) : null}
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="rounded-full"
                          onClick={() => editClient(selectedClient)}
                        >
                          Edit
                        </Button>
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <StatCard
                        title="Visits"
                        value={String(selectedClient.totalVisits)}
                        hint="lifetime"
                      />
                      <StatCard
                        title="Loyalty"
                        value={`${selectedClient.loyaltyPoints} pts`}
                        hint={`${10 - (selectedClient.totalVisits % 10 || 10)} visits to next reward`}
                      />
                    </div>

                    <div className="space-y-2">
                      <SectionLabel>Preferred services</SectionLabel>
                      <div className="flex flex-wrap gap-2">
                        {selectedClientPreferredServices.length > 0 ? (
                          selectedClientPreferredServices.map((serviceName) => (
                            <Badge
                              key={serviceName}
                              variant="outline"
                              className="rounded-full px-3 py-1"
                            >
                              {serviceName}
                            </Badge>
                          ))
                        ) : (
                          <p className="text-sm text-slate-500">
                            No completed history yet.
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <SectionLabel>Reminder actions</SectionLabel>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          className="rounded-full"
                          onClick={() => sendReminder("sms")}
                        >
                          <Send className="h-4 w-4" /> SMS reminder
                        </Button>
                        <Button
                          variant="outline"
                          className="rounded-full"
                          onClick={() => sendReminder("whatsapp")}
                        >
                          <Phone className="h-4 w-4" /> WhatsApp reminder
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <SectionLabel>Upcoming bookings</SectionLabel>
                      {selectedClientUpcoming.length > 0 ? (
                        selectedClientUpcoming.slice(0, 3).map((booking) => (
                          <div
                            key={booking.id}
                            className="rounded-2xl border border-slate-200 p-3 text-sm"
                          >
                            <div className="font-medium text-slate-900">
                              {booking.serviceName}
                            </div>
                            <div className="mt-1 text-slate-500">
                              {format(
                                parseISO(
                                  `${booking.date}T${booking.startTime}:00`,
                                ),
                                "EEE d MMM · h:mm a",
                              )}
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-slate-500">
                          No upcoming bookings.
                        </p>
                      )}
                    </div>

                    <div className="space-y-3">
                      <SectionLabel>Payment history</SectionLabel>
                      {selectedClientPayments.length > 0 ? (
                        selectedClientPayments.slice(0, 4).map((booking) => (
                          <div
                            key={booking.id}
                            className="flex items-center justify-between rounded-2xl border border-slate-200 p-3 text-sm"
                          >
                            <div>
                              <div className="font-medium text-slate-900">
                                {booking.serviceName}
                              </div>
                              <div className="text-slate-500">
                                {booking.paymentMethod ?? "manual"} ·{" "}
                                {booking.paymentStatus}
                              </div>
                            </div>
                            <div className="font-semibold text-slate-900">
                              {currency.format(booking.price)}
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-slate-500">
                          No payment history yet.
                        </p>
                      )}
                    </div>
                  </>
                ) : (
                  <EmptyState
                    icon={Users}
                    title="Pick a client"
                    description="Select a customer from the directory to view their profile."
                  />
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="jobs" className="space-y-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-slate-900">
                Job cards
              </h2>
              <p className="text-sm text-slate-500">
                Track diagnostics, approvals, materials, labour, and invoice
                linkage.
              </p>
            </div>
            <Button
              className="rounded-full"
              onClick={() => {
                setJobForm(createJobCardForm(snapshot));
                setJobDialogOpen(true);
              }}
            >
              <Plus className="h-4 w-4" /> Create job card
            </Button>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            {snapshot.jobCards.map((jobCard) => (
              <Card
                key={jobCard.id}
                className="rounded-3xl border-0 shadow-lg shadow-slate-200/50"
              >
                <CardHeader className="pb-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-lg">{jobCard.title}</CardTitle>
                      <CardDescription>
                        {jobCard.clientName} · {jobCard.clientPhone}
                      </CardDescription>
                    </div>
                    <Badge
                      className={cn(
                        "rounded-full border px-3 py-1 capitalize",
                        jobCard.status === "paid"
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-50"
                          : jobCard.status === "in_progress"
                            ? "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-50"
                            : "bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-100",
                      )}
                    >
                      {jobCard.status.replaceAll("_", " ")}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    {jobStages.map((stage, index) => {
                      const activeIndex = jobStages.indexOf(jobCard.status);
                      return (
                        <div
                          key={stage}
                          className={cn(
                            "inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs capitalize",
                            index <= activeIndex
                              ? "bg-indigo-600 text-white"
                              : "bg-slate-100 text-slate-500",
                          )}
                        >
                          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/20 text-[10px]">
                            {index + 1}
                          </span>
                          {stage.replaceAll("_", " ")}
                        </div>
                      );
                    })}
                  </div>

                  <p className="text-sm leading-6 text-slate-600">
                    {jobCard.description}
                  </p>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <StatCard
                      title="Estimate"
                      value={currency.format(jobCard.estimatedCost)}
                      hint={`Labour ${jobCard.laborHours}h @ ${currency.format(jobCard.laborRate)}`}
                    />
                    <StatCard
                      title="Invoice"
                      value={jobCard.invoiceId ?? "Pending"}
                      hint={jobCard.assignedStaff}
                    />
                  </div>

                  <div className="space-y-2">
                    <SectionLabel>Materials used</SectionLabel>
                    <div className="space-y-2">
                      {jobCard.materials.map((material) => (
                        <div
                          key={`${jobCard.id}-${material.name}`}
                          className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3 text-sm"
                        >
                          <span className="text-slate-700">
                            {material.name} × {material.qty}
                          </span>
                          <span className="font-medium text-slate-900">
                            {currency.format(material.unitCost * material.qty)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <SectionLabel>Before / after photos</SectionLabel>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {jobCard.photos.map((photo) => (
                        <div
                          key={`${jobCard.id}-${photo.label}`}
                          className="overflow-hidden rounded-2xl border border-slate-200"
                        >
                          <img
                            src={photo.url}
                            alt={photo.label}
                            className="h-32 w-full object-cover"
                          />
                          <div className="space-y-1 p-3 text-sm">
                            <div className="font-medium text-slate-900">
                              {photo.label}
                            </div>
                            <div className="capitalize text-slate-500">
                              {photo.stage}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      className="rounded-full"
                      onClick={() => advanceJobCard(jobCard)}
                    >
                      <CheckCircle2 className="h-4 w-4" /> Advance stage
                    </Button>
                    <Button
                      variant="outline"
                      className="rounded-full"
                      onClick={() => linkInvoice(jobCard)}
                    >
                      <Wallet className="h-4 w-4" /> Link invoice
                    </Button>
                    <Button
                      variant="outline"
                      className="rounded-full"
                      onClick={() => shareJobCard(jobCard)}
                    >
                      <Copy className="h-4 w-4" /> WhatsApp format
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="reports" className="space-y-6">
          <div className="grid gap-4 md:grid-cols-4">
            <SummaryTile
              icon={ChartColumnBig}
              title="This month"
              value={currency.format(analytics.monthlyComparison.current)}
              hint={`${analytics.monthlyComparison.delta >= 0 ? "+" : ""}${analytics.monthlyComparison.delta}% vs last month`}
              tone="from-indigo-500 to-violet-500"
            />
            <SummaryTile
              icon={CalendarDays}
              title="Retention"
              value={`${analytics.clientRetentionRate}%`}
              hint="repeat customers"
              tone="from-emerald-500 to-teal-500"
            />
            <SummaryTile
              icon={Wallet}
              title="Average job value"
              value={currency.format(analytics.averageJobValue)}
              hint="completed + in progress"
              tone="from-amber-500 to-orange-500"
            />
            <SummaryTile
              icon={ScanSearch}
              title="Avg job card"
              value={currency.format(averageJobCardValue)}
              hint="garage work orders"
              tone="from-sky-500 to-cyan-500"
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
            <Card className="rounded-3xl border-0 shadow-lg shadow-slate-200/50">
              <CardHeader>
                <CardTitle className="text-xl">
                  Revenue by service type
                </CardTitle>
                <CardDescription>
                  Compare your top earners across service lines.
                </CardDescription>
              </CardHeader>
              <CardContent className="h-[360px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={analytics.revenueByServiceType}
                    margin={{ left: 12, right: 12 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="name"
                      tickLine={false}
                      axisLine={false}
                      interval={0}
                      angle={-20}
                      textAnchor="end"
                      height={80}
                    />
                    <YAxis
                      tickFormatter={(value) => `${Math.round(value / 1000)}k`}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      formatter={(value: number) => currency.format(value)}
                    />
                    <Bar
                      dataKey="value"
                      fill="#4f46e5"
                      radius={[12, 12, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="rounded-3xl border-0 shadow-lg shadow-slate-200/50">
              <CardHeader>
                <CardTitle className="text-xl">AI insights</CardTitle>
                <CardDescription>
                  Actionable prompts generated from live activity.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {analytics.aiInsights.map((insight) => (
                  <div
                    key={insight}
                    className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4 text-sm text-indigo-900"
                  >
                    <div className="flex items-start gap-3">
                      <Sparkles className="mt-0.5 h-4 w-4 text-indigo-600" />
                      <span>{insight}</span>
                    </div>
                  </div>
                ))}
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
                    <span>
                      Completed jobs and paid appointments are the best
                      candidates for loyalty follow-up offers.
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.25fr_1fr_1fr]">
            <Card className="rounded-3xl border-0 shadow-lg shadow-slate-200/50">
              <CardHeader>
                <CardTitle className="text-xl">Busiest days & hours</CardTitle>
                <CardDescription>
                  Heatmap of service demand by weekday and hour.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 overflow-x-auto">
                  <div className="grid min-w-[560px] grid-cols-[120px_repeat(10,minmax(0,1fr))] gap-2 text-xs font-medium text-slate-500">
                    <div />
                    {Array.from(
                      new Set(
                        analytics.busiestMatrix.map((entry) => entry.hour),
                      ),
                    ).map((hour) => (
                      <div key={hour} className="text-center">
                        {hour}
                      </div>
                    ))}
                    {Array.from(
                      new Set(
                        analytics.busiestMatrix.map((entry) => entry.day),
                      ),
                    ).map((day) => (
                      <>
                        <div
                          key={`${day}-label`}
                          className="flex items-center font-medium text-slate-700"
                        >
                          {day}
                        </div>
                        {analytics.busiestMatrix
                          .filter((entry) => entry.day === day)
                          .map((entry) => (
                            <div
                              key={`${entry.day}-${entry.hour}`}
                              className={cn(
                                "flex h-12 items-center justify-center rounded-2xl text-xs font-semibold",
                                entry.count >= 3
                                  ? "bg-indigo-600 text-white"
                                  : entry.count === 2
                                    ? "bg-indigo-300 text-indigo-950"
                                    : entry.count === 1
                                      ? "bg-indigo-100 text-indigo-700"
                                      : "bg-slate-100 text-slate-400",
                              )}
                            >
                              {entry.count}
                            </div>
                          ))}
                      </>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-3xl border-0 shadow-lg shadow-slate-200/50">
              <CardHeader>
                <CardTitle className="text-xl">Staff utilization</CardTitle>
                <CardDescription>
                  Booked hours versus available hours this week.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {staffUtilization.map((member) => (
                  <div key={member.staffId} className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <div>
                        <div className="font-medium text-slate-900">
                          {member.staffName}
                        </div>
                        <div className="text-slate-500">{member.role}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold text-slate-900">
                          {member.utilization}%
                        </div>
                        <div className="text-slate-500">
                          {member.bookedHours.toFixed(1)}h /{" "}
                          {member.availableHours.toFixed(0)}h
                        </div>
                      </div>
                    </div>
                    <div className="h-3 rounded-full bg-slate-100">
                      <div
                        className="h-3 rounded-full"
                        style={{
                          width: `${Math.min(member.utilization, 100)}%`,
                          backgroundColor: member.color,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="rounded-3xl border-0 shadow-lg shadow-slate-200/50">
              <CardHeader>
                <CardTitle className="text-xl">Monthly comparison</CardTitle>
                <CardDescription>
                  Track momentum against the previous month.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-2xl bg-slate-50 p-4">
                  <div className="text-sm text-slate-500">Current month</div>
                  <div className="mt-1 text-2xl font-semibold text-slate-900">
                    {currency.format(analytics.monthlyComparison.current)}
                  </div>
                </div>
                <div className="rounded-2xl bg-slate-50 p-4">
                  <div className="text-sm text-slate-500">Last month</div>
                  <div className="mt-1 text-2xl font-semibold text-slate-900">
                    {currency.format(analytics.monthlyComparison.previous)}
                  </div>
                </div>
                <div
                  className={cn(
                    "rounded-2xl p-4 text-sm",
                    analytics.monthlyComparison.delta >= 0
                      ? "bg-emerald-50 text-emerald-900"
                      : "bg-rose-50 text-rose-900",
                  )}
                >
                  {analytics.monthlyComparison.delta >= 0
                    ? "Growth"
                    : "Decline"}
                  : {analytics.monthlyComparison.delta}%
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={bookingDialogOpen} onOpenChange={setBookingDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-3xl sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {bookingForm.isWalkIn
                ? "Add walk-in booking"
                : bookingForm.id
                  ? "Edit booking"
                  : "Quick-add booking"}
            </DialogTitle>
            <DialogDescription>
              Capture client, service, staff assignment, and payment status in
              one step.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Existing client">
              <select
                value={bookingForm.existingClientId}
                onChange={(event) => {
                  const nextId = event.target.value;
                  const nextClient = snapshot.clients.find(
                    (entry) => entry.id === nextId,
                  );
                  setBookingForm((current) => ({
                    ...current,
                    existingClientId: nextId,
                    clientName: nextClient?.name ?? current.clientName,
                    clientPhone: nextClient?.phone ?? current.clientPhone,
                  }));
                }}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Select or create new</option>
                {snapshot.clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Service">
              <select
                value={bookingForm.serviceId}
                onChange={(event) => {
                  const service = snapshot.services.find(
                    (entry) => entry.id === event.target.value,
                  );
                  setBookingForm((current) => ({
                    ...current,
                    serviceId: event.target.value,
                    duration: String(service?.duration ?? current.duration),
                  }));
                }}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {snapshot.services.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Client name">
              <Input
                value={bookingForm.clientName}
                onChange={(event) =>
                  setBookingForm((current) => ({
                    ...current,
                    clientName: event.target.value,
                  }))
                }
              />
            </Field>
            <Field label="Client phone">
              <Input
                value={bookingForm.clientPhone}
                onChange={(event) =>
                  setBookingForm((current) => ({
                    ...current,
                    clientPhone: event.target.value,
                  }))
                }
              />
            </Field>
            <Field label="Assigned staff">
              <select
                value={bookingForm.staffId}
                onChange={(event) =>
                  setBookingForm((current) => ({
                    ...current,
                    staffId: event.target.value,
                  }))
                }
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Unassigned</option>
                {snapshot.staff.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Status">
              <select
                value={bookingForm.status}
                onChange={(event) =>
                  setBookingForm((current) => ({
                    ...current,
                    status: event.target.value as Booking["status"],
                  }))
                }
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {(
                  [
                    "scheduled",
                    "confirmed",
                    "in_progress",
                    "completed",
                    "cancelled",
                    "no_show",
                  ] as Booking["status"][]
                ).map((status) => (
                  <option key={status} value={status}>
                    {status.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Date">
              <Input
                type="date"
                value={bookingForm.date}
                onChange={(event) =>
                  setBookingForm((current) => ({
                    ...current,
                    date: event.target.value,
                  }))
                }
              />
            </Field>
            <Field label="Start time">
              <Input
                type="time"
                value={bookingForm.startTime}
                onChange={(event) =>
                  setBookingForm((current) => ({
                    ...current,
                    startTime: event.target.value,
                  }))
                }
              />
            </Field>
            <Field label="Duration (minutes)">
              <Input
                type="number"
                value={bookingForm.duration}
                onChange={(event) =>
                  setBookingForm((current) => ({
                    ...current,
                    duration: event.target.value,
                  }))
                }
              />
            </Field>
            <Field label="Payment status">
              <select
                value={bookingForm.paymentStatus}
                onChange={(event) =>
                  setBookingForm((current) => ({
                    ...current,
                    paymentStatus: event.target
                      .value as Booking["paymentStatus"],
                  }))
                }
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {(
                  ["unpaid", "deposit", "paid"] as Booking["paymentStatus"][]
                ).map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Payment method" className="sm:col-span-2">
              <select
                value={bookingForm.paymentMethod}
                onChange={(event) =>
                  setBookingForm((current) => ({
                    ...current,
                    paymentMethod: event.target
                      .value as BookingFormState["paymentMethod"],
                  }))
                }
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Select method later</option>
                <option value="mpesa">M-Pesa</option>
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="bnpl">Co-op BNPL</option>
              </select>
            </Field>
            <Field label="Notes" className="sm:col-span-2">
              <Textarea
                value={bookingForm.notes}
                onChange={(event) =>
                  setBookingForm((current) => ({
                    ...current,
                    notes: event.target.value,
                  }))
                }
                placeholder="E.g. noisy brakes, waiting customer, or special request"
              />
            </Field>
            <label className="sm:col-span-2 flex items-center gap-3 rounded-2xl border border-slate-200 p-3 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={bookingForm.isWalkIn}
                onChange={(event) =>
                  setBookingForm((current) => ({
                    ...current,
                    isWalkIn: event.target.checked,
                  }))
                }
                className="h-4 w-4 rounded border-slate-300"
              />
              Mark as walk-in arrival
            </label>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="rounded-full"
              onClick={() => setBookingDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button className="rounded-full" onClick={submitBooking}>
              Save booking
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={serviceDialogOpen} onOpenChange={setServiceDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-3xl sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {serviceForm.id ? "Edit service" : "Add service"}
            </DialogTitle>
            <DialogDescription>
              Define duration, pricing model, materials, and staff who can
              deliver it.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Service name">
              <Input
                value={serviceForm.name}
                onChange={(event) =>
                  setServiceForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
              />
            </Field>
            <Field label="Category">
              <Input
                value={serviceForm.category}
                onChange={(event) =>
                  setServiceForm((current) => ({
                    ...current,
                    category: event.target.value,
                  }))
                }
                placeholder="Service, Repair, Diagnostics"
              />
            </Field>
            <Field label="Price">
              <Input
                type="number"
                value={serviceForm.price}
                onChange={(event) =>
                  setServiceForm((current) => ({
                    ...current,
                    price: event.target.value,
                  }))
                }
              />
            </Field>
            <Field label="Price type">
              <select
                value={serviceForm.priceType}
                onChange={(event) =>
                  setServiceForm((current) => ({
                    ...current,
                    priceType: event.target
                      .value as ServiceOffering["priceType"],
                  }))
                }
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="fixed">Fixed</option>
                <option value="per_hour">Per hour</option>
                <option value="from">From</option>
              </select>
            </Field>
            <Field label="Duration (minutes)">
              <Input
                type="number"
                value={serviceForm.duration}
                onChange={(event) =>
                  setServiceForm((current) => ({
                    ...current,
                    duration: event.target.value,
                  }))
                }
              />
            </Field>
            <Field label="Assigned staff" className="sm:col-span-2">
              <select
                multiple
                value={serviceForm.staffIds}
                onChange={(event) =>
                  setServiceForm((current) => ({
                    ...current,
                    staffIds: Array.from(event.target.selectedOptions).map(
                      (option) => option.value,
                    ),
                  }))
                }
                className="min-h-32 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {snapshot.staff.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name} · {member.specialty}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Required materials" className="sm:col-span-2">
              <Input
                value={serviceForm.materials}
                onChange={(event) =>
                  setServiceForm((current) => ({
                    ...current,
                    materials: event.target.value,
                  }))
                }
                placeholder="Comma-separated e.g. brake fluid, oil filter"
              />
            </Field>
            <Field label="Description" className="sm:col-span-2">
              <Textarea
                value={serviceForm.description}
                onChange={(event) =>
                  setServiceForm((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
              />
            </Field>
            <label className="sm:col-span-2 flex items-center gap-3 rounded-2xl border border-slate-200 p-3 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={serviceForm.isActive}
                onChange={(event) =>
                  setServiceForm((current) => ({
                    ...current,
                    isActive: event.target.checked,
                  }))
                }
                className="h-4 w-4 rounded border-slate-300"
              />
              Service is active and can be booked online
            </label>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="rounded-full"
              onClick={() => setServiceDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button className="rounded-full" onClick={submitService}>
              Save service
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={clientDialogOpen} onOpenChange={setClientDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-3xl sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {clientForm.id ? "Edit client" : "Add client"}
            </DialogTitle>
            <DialogDescription>
              Save contact details, notes, tags, and loyalty-ready metadata.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <Field label="Name">
              <Input
                value={clientForm.name}
                onChange={(event) =>
                  setClientForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
              />
            </Field>
            <Field label="Phone">
              <Input
                value={clientForm.phone}
                onChange={(event) =>
                  setClientForm((current) => ({
                    ...current,
                    phone: event.target.value,
                  }))
                }
              />
            </Field>
            <Field label="Email">
              <Input
                value={clientForm.email}
                onChange={(event) =>
                  setClientForm((current) => ({
                    ...current,
                    email: event.target.value,
                  }))
                }
              />
            </Field>
            <Field label="Tag">
              <select
                value={clientForm.tag}
                onChange={(event) =>
                  setClientForm((current) => ({
                    ...current,
                    tag: event.target.value as ServiceClient["tag"],
                  }))
                }
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="new">New</option>
                <option value="regular">Regular</option>
                <option value="vip">VIP</option>
                <option value="corporate">Corporate</option>
              </select>
            </Field>
            <Field label="Notes">
              <Textarea
                value={clientForm.notes}
                onChange={(event) =>
                  setClientForm((current) => ({
                    ...current,
                    notes: event.target.value,
                  }))
                }
              />
            </Field>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="rounded-full"
              onClick={() => setClientDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button className="rounded-full" onClick={submitClient}>
              Save client
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={jobDialogOpen} onOpenChange={setJobDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-3xl sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {jobForm.id ? "Edit job card" : "Create job card"}
            </DialogTitle>
            <DialogDescription>
              Track the problem description, estimated cost, materials, labour,
              and assigned staff.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Client">
              <select
                value={jobForm.clientId}
                onChange={(event) =>
                  setJobForm((current) => ({
                    ...current,
                    clientId: event.target.value,
                  }))
                }
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {snapshot.clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Assigned staff">
              <Input
                value={jobForm.assignedStaff}
                onChange={(event) =>
                  setJobForm((current) => ({
                    ...current,
                    assignedStaff: event.target.value,
                  }))
                }
                placeholder="John Kariuki"
              />
            </Field>
            <Field label="Job title" className="sm:col-span-2">
              <Input
                value={jobForm.title}
                onChange={(event) =>
                  setJobForm((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
                placeholder="Toyota Fielder KCJ 123A - Overheating"
              />
            </Field>
            <Field label="Estimated cost">
              <Input
                type="number"
                value={jobForm.estimatedCost}
                onChange={(event) =>
                  setJobForm((current) => ({
                    ...current,
                    estimatedCost: event.target.value,
                  }))
                }
              />
            </Field>
            <Field label="Labour hours">
              <Input
                type="number"
                value={jobForm.laborHours}
                onChange={(event) =>
                  setJobForm((current) => ({
                    ...current,
                    laborHours: event.target.value,
                  }))
                }
              />
            </Field>
            <Field label="Labour rate">
              <Input
                type="number"
                value={jobForm.laborRate}
                onChange={(event) =>
                  setJobForm((current) => ({
                    ...current,
                    laborRate: event.target.value,
                  }))
                }
              />
            </Field>
            <Field label="Materials" className="sm:col-span-2">
              <Input
                value={jobForm.materials}
                onChange={(event) =>
                  setJobForm((current) => ({
                    ...current,
                    materials: event.target.value,
                  }))
                }
                placeholder="Comma-separated e.g. coolant hose, fan relay"
              />
            </Field>
            <Field label="Problem description" className="sm:col-span-2">
              <Textarea
                value={jobForm.description}
                onChange={(event) =>
                  setJobForm((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
              />
            </Field>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="rounded-full"
              onClick={() => setJobDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button className="rounded-full" onClick={submitJobCard}>
              Save job card
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function WeekCalendar({
  days,
  bookings,
}: {
  days: Date[];
  bookings: Booking[];
}) {
  const startMinutes = 8 * 60;
  const endMinutes = 18 * 60;
  const cellHeight = 56;
  const totalRows = (endMinutes - startMinutes) / 30;
  const totalHeight = totalRows * cellHeight;
  const hours = Array.from(
    { length: totalRows },
    (_, index) => startMinutes + index * 30,
  );

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[1080px] rounded-3xl border border-slate-200 bg-white">
        <div className="grid grid-cols-[72px_repeat(7,minmax(0,1fr))] border-b border-slate-200 bg-slate-50">
          <div className="px-3 py-4 text-xs font-medium uppercase tracking-wide text-slate-500">
            Time
          </div>
          {days.map((day) => (
            <div
              key={day.toISOString()}
              className="border-l border-slate-200 px-3 py-4 text-center"
            >
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                {format(day, "EEE")}
              </div>
              <div className="mt-1 text-sm font-semibold text-slate-900">
                {format(day, "d MMM")}
              </div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-[72px_repeat(7,minmax(0,1fr))]">
          <div className="relative border-r border-slate-200 bg-slate-50">
            {hours.map((minutes) => (
              <div
                key={minutes}
                className="border-b border-slate-200 px-3 py-2 text-xs text-slate-500"
                style={{ height: `${cellHeight}px` }}
              >
                {minutes % 60 === 0 ? formatMinutes(minutes) : ""}
              </div>
            ))}
          </div>
          {days.map((day) => {
            const dayBookings = bookings.filter((booking) =>
              isSameDay(
                day,
                parseISO(`${booking.date}T${booking.startTime}:00`),
              ),
            );
            return (
              <div
                key={day.toISOString()}
                className="relative border-r border-slate-200 last:border-r-0"
                style={{ height: `${totalHeight}px` }}
              >
                {hours.map((minutes) => (
                  <div
                    key={`${day.toISOString()}-${minutes}`}
                    className="border-b border-slate-200/80"
                    style={{ height: `${cellHeight}px` }}
                  />
                ))}
                {dayBookings.map((booking) => {
                  const top =
                    ((timeToMinutes(booking.startTime) - startMinutes) / 30) *
                    cellHeight;
                  const height = Math.max(
                    (booking.duration / 30) * cellHeight - 6,
                    40,
                  );
                  return (
                    <div
                      key={booking.id}
                      className={cn(
                        "absolute left-1 right-1 rounded-2xl border p-3 text-xs shadow-sm",
                        bookingStatusStyles[booking.status],
                      )}
                      style={{ top: `${top + 3}px`, height: `${height}px` }}
                    >
                      <div className="font-semibold">{booking.clientName}</div>
                      <div className="mt-1 line-clamp-2">
                        {booking.serviceName}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px] opacity-80">
                        <span>{booking.startTime}</span>
                        <span>{booking.staffName ?? "Unassigned"}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <Field label={label}>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

function StatusBadge({ booking }: { booking: Booking }) {
  return (
    <Badge
      className={cn(
        "rounded-full border px-3 py-1 capitalize",
        bookingStatusStyles[booking.status],
      )}
    >
      {booking.status.replaceAll("_", " ")}
    </Badge>
  );
}

function SummaryTile({
  icon: Icon,
  title,
  value,
  hint,
  tone,
}: {
  icon: typeof BarChart3;
  title: string;
  value: string;
  hint: string;
  tone: string;
}) {
  return (
    <Card className="overflow-hidden rounded-3xl border-0 shadow-lg shadow-slate-200/50">
      <div className={cn("h-1.5 w-full bg-gradient-to-r", tone)} />
      <CardContent className="flex items-start justify-between gap-3 p-6">
        <div>
          <p className="text-sm text-slate-500">{title}</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
          <p className="mt-1 text-sm text-slate-500">{hint}</p>
        </div>
        <div
          className={cn("rounded-2xl bg-gradient-to-br p-3 text-white", tone)}
        >
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}

function StatCard({
  title,
  value,
  hint,
  tone,
}: {
  title: string;
  value: string;
  hint: string;
  tone?: string;
}) {
  return (
    <div
      className={cn("rounded-2xl border border-slate-200 bg-white p-4", tone)}
    >
      <div className="text-sm text-current/70">{title}</div>
      <div className="mt-2 text-xl font-semibold">{value}</div>
      <div className="mt-1 text-sm text-current/70">{hint}</div>
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof CarFront;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center rounded-3xl border border-dashed border-slate-300 px-6 py-12 text-center">
      <div className="rounded-2xl bg-slate-100 p-3 text-slate-600">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="mt-4 text-lg font-semibold text-slate-900">{title}</h3>
      <p className="mt-2 max-w-md text-sm text-slate-500">{description}</p>
    </div>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label
      className={cn("grid gap-2 text-sm font-medium text-slate-700", className)}
    >
      <span>{label}</span>
      {children}
    </label>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
      {children}
    </h4>
  );
}

function splitCommaValues(value: string) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function createBookingForm(
  snapshot: ServicesSnapshot,
  walkIn = false,
): BookingFormState {
  const firstService = snapshot.services[0];
  const firstStaff = firstService?.staffIds[0] ?? snapshot.staff[0]?.id ?? "";
  return {
    existingClientId: walkIn ? "" : (snapshot.clients[0]?.id ?? ""),
    clientName: walkIn ? "" : (snapshot.clients[0]?.name ?? ""),
    clientPhone: walkIn ? "" : (snapshot.clients[0]?.phone ?? ""),
    serviceId: firstService?.id ?? "",
    staffId: firstStaff,
    date: format(new Date(), "yyyy-MM-dd"),
    startTime: walkIn ? format(new Date(), "HH:mm") : "09:00",
    duration: String(firstService?.duration ?? 60),
    status: walkIn ? "confirmed" : "scheduled",
    paymentStatus: "unpaid",
    paymentMethod: "",
    notes: "",
    isWalkIn: walkIn,
  };
}

function createServiceForm(): ServiceFormState {
  return {
    name: "",
    description: "",
    category: "Service",
    price: "",
    priceType: "fixed",
    duration: "60",
    materials: "",
    staffIds: [],
    isActive: true,
  };
}

function createPackageForm(): PackageFormState {
  return {
    name: "",
    description: "",
    services: [],
    price: "",
    savings: "",
    isActive: true,
  };
}

function createClientForm(): ClientFormState {
  return {
    name: "",
    phone: "",
    email: "",
    tag: "new",
    notes: "",
  };
}

function createJobCardForm(snapshot: ServicesSnapshot): JobCardFormState {
  return {
    clientId: snapshot.clients[0]?.id ?? "",
    title: "",
    description: "",
    estimatedCost: "",
    assignedStaff: snapshot.staff[0]?.name ?? "",
    laborHours: "2",
    laborRate: "1800",
    materials: "",
  };
}

function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function addMinutesToTime(time: string, duration: number) {
  const total = timeToMinutes(time) + duration;
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function formatMinutes(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const normalized = hours % 12 || 12;
  const suffix = hours >= 12 ? "PM" : "AM";
  return `${normalized}${suffix}`;
}
