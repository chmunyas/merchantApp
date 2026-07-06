import { createFileRoute } from "@tanstack/react-router";
import { addMinutes, format, parseISO } from "date-fns";
import {
  CalendarDays,
  CarFront,
  CheckCircle2,
  Clock3,
  CreditCard,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Send,
  ShieldCheck,
  UserRound,
  Wallet,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { BNPLTransaction } from "@/lib/coop-bnpl";
import { BNPLCheckout } from "@/components/merchant/features/BNPLCheckout";
import type { Booking } from "@/components/merchant/features/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  buildPaymentMetadata,
  executePayment,
  type PaymentStatus,
} from "@/lib/pesaswap-payments";
import {
  ensureServicesDemoData,
  getAvailableSlots,
  saveServicesSnapshot,
} from "@/lib/merchant-dashboard";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/book/$businessId")({
  component: PublicBookingPage,
});

type PaymentOption = "pay_now" | "deposit" | "pay_on_arrival" | "bnpl";

type ConfirmationState = {
  bookingId: string;
  serviceName: string;
  customerName: string;
  phone: string;
  date: string;
  time: string;
  paymentLabel: string;
  paymentStatus: Booking["paymentStatus"];
  notes?: string;
};

const money = new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
  maximumFractionDigits: 0,
});

function PublicBookingPage() {
  const { businessId } = Route.useParams();
  const [snapshot, setSnapshot] = useState(() => ensureServicesDemoData());
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedServiceId, setSelectedServiceId] = useState(
    snapshot.services[0]?.id ?? "",
  );
  const [selectedDate, setSelectedDate] = useState(
    format(new Date(), "yyyy-MM-dd"),
  );
  const [selectedStaffId, setSelectedStaffId] = useState("any");
  const [selectedSlot, setSelectedSlot] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [paymentOption, setPaymentOption] =
    useState<PaymentOption>("pay_on_arrival");
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus | null>(
    null,
  );
  const [showBNPL, setShowBNPL] = useState(false);
  const [confirmation, setConfirmation] = useState<ConfirmationState | null>(
    null,
  );
  const [rescheduleBookingId, setRescheduleBookingId] = useState<string | null>(
    null,
  );
  const [submitting, setSubmitting] = useState(false);

  const business = snapshot.business;
  const [customerEmail, setCustomerEmail] = useState("");
  const [branding, setBranding] = useState<{
    businessName?: string;
    logoUrl?: string | null;
  } | null>(null);
  const [contactMessage, setContactMessage] = useState("");
  const [contactSending, setContactSending] = useState(false);

  // Pull the merchant's real branding (logo the owner set in Settings) for this
  // venue; fall back to the demo branding if none is configured.
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(
          `/api/branding?venue=${encodeURIComponent(businessId)}`,
        );
        if (res.ok) {
          const data = (await res.json()) as {
            branding?: { businessName?: string; logoUrl?: string | null };
          };
          if (data.branding) setBranding(data.branding);
        }
      } catch {
        /* fall back to the demo branding */
      }
    })();
  }, [businessId]);

  const logoUrl = branding?.logoUrl || business.logoUrl;
  const businessName = branding?.businessName || business.name;
  const whatsappDigits = business.whatsapp.replace(/[^\d]/g, "");

  // Omnichannel natural-language message → the merchant's enquiry inbox.
  async function sendContactMessage() {
    if (!contactMessage.trim()) {
      toast.error("Type a message first.");
      return;
    }
    setContactSending(true);
    try {
      const res = await fetch(
        `/api/enquiries?venue=${encodeURIComponent(businessId)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            customerName: customerName.trim() || "Website visitor",
            phone: customerPhone.trim() || undefined,
            notes: `${contactMessage.trim()}${
              customerEmail.trim() ? ` · email: ${customerEmail.trim()}` : ""
            }`,
          }),
        },
      );
      if (!res.ok) throw new Error("failed");
      toast.success("Message sent — the team will be in touch.");
      setContactMessage("");
    } catch {
      toast.error("Couldn't send. Try WhatsApp or call us directly.");
    } finally {
      setContactSending(false);
    }
  }
  const service =
    snapshot.services.find((entry) => entry.id === selectedServiceId) ??
    snapshot.services[0];
  const filteredServices =
    selectedCategory === "all"
      ? snapshot.services.filter((entry) => entry.isActive)
      : snapshot.services.filter(
          (entry) => entry.category === selectedCategory && entry.isActive,
        );
  const availableSlots = useMemo(() => {
    if (!service) return [];
    const baseSlots = getAvailableSlots(
      snapshot.bookings,
      selectedDate,
      selectedStaffId === "any" ? undefined : selectedStaffId,
    );
    return baseSlots.filter((slot) =>
      slotFitsDuration(slot, service.duration, baseSlots),
    );
  }, [selectedDate, selectedStaffId, service, snapshot.bookings]);

  if (snapshot.business.id !== businessId) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <Card className="rounded-3xl border-0 shadow-lg shadow-slate-200/60">
          <CardContent className="flex flex-col items-center gap-4 p-10 text-center">
            <CarFront className="h-10 w-10 text-slate-400" />
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">
                Booking page not found
              </h1>
              <p className="mt-2 text-sm text-slate-500">
                Try the active demo business:{" "}
                <span className="font-medium text-slate-900">
                  {snapshot.business.id}
                </span>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  async function finalizeBooking(options: {
    paymentStatus: Booking["paymentStatus"];
    paymentMethod?: Booking["paymentMethod"];
    label: string;
  }) {
    if (
      !service ||
      !selectedSlot ||
      !customerName.trim() ||
      !customerPhone.trim()
    ) {
      toast.error("Complete service, slot, and contact details first.");
      return;
    }
    const staff =
      selectedStaffId === "any"
        ? snapshot.staff.find((member) => service.staffIds.includes(member.id))
        : snapshot.staff.find((member) => member.id === selectedStaffId);
    const clientId = `client-${Date.now()}`;
    const bookingId = rescheduleBookingId ?? `booking-${Date.now()}`;
    const booking: Booking = {
      id: bookingId,
      clientId,
      clientName: customerName.trim(),
      clientPhone: customerPhone.trim(),
      serviceId: service.id,
      serviceName: service.name,
      staffId: staff?.id,
      staffName: staff?.name,
      date: selectedDate,
      startTime: selectedSlot,
      endTime: timeToLabel(
        addMinutes(
          parseISO(`${selectedDate}T${selectedSlot}:00`),
          service.duration,
        ),
      ),
      duration: service.duration,
      price: service.price,
      status: "confirmed",
      paymentStatus: options.paymentStatus,
      paymentMethod: options.paymentMethod,
      notes: notes.trim() || undefined,
      createdAt: new Date().toISOString(),
    };

    const client = {
      id: clientId,
      name: booking.clientName,
      phone: booking.clientPhone,
      email: undefined,
      tag: "new" as const,
      totalVisits: 1,
      totalSpent: options.paymentStatus === "unpaid" ? 0 : booking.price,
      lastVisit: new Date(
        `${booking.date}T${booking.startTime}:00`,
      ).toISOString(),
      notes: booking.notes,
      loyaltyPoints: 10,
      createdAt: new Date().toISOString(),
    };

    const nextBookings = rescheduleBookingId
      ? snapshot.bookings.map((entry) =>
          entry.id === bookingId ? booking : entry,
        )
      : [booking, ...snapshot.bookings];
    const nextClients = rescheduleBookingId
      ? snapshot.clients
      : [client, ...snapshot.clients];
    const nextSnapshot = {
      ...snapshot,
      bookings: nextBookings,
      clients: nextClients,
    };
    setSnapshot(nextSnapshot);
    saveServicesSnapshot(nextSnapshot);
    setConfirmation({
      bookingId,
      serviceName: booking.serviceName,
      customerName: booking.clientName,
      phone: booking.clientPhone,
      date: booking.date,
      time: booking.startTime,
      paymentLabel: options.label,
      paymentStatus: options.paymentStatus,
      notes: booking.notes,
    });
    setRescheduleBookingId(null);
    setShowBNPL(false);
    toast.success("Booking confirmed");
  }

  async function handleConfirm() {
    if (!service) {
      toast.error("Select a service first.");
      return;
    }
    if (paymentOption === "bnpl") {
      setShowBNPL(true);
      return;
    }
    setSubmitting(true);
    try {
      if (paymentOption === "pay_now" || paymentOption === "deposit") {
        const amount =
          paymentOption === "deposit"
            ? Math.round(service.price * 0.5)
            : service.price;
        try {
          const result = await executePayment({
            amount,
            phone: customerPhone,
            metadata: buildPaymentMetadata({
              merchant: {
                name: business.name,
                till: business.tillNumber,
                id: business.id,
              },
              flow: "quick_charge",
              customer: { phone: customerPhone, name: customerName },
              items: [
                {
                  name: service.name,
                  qty: 1,
                  price: amount,
                  category: service.category,
                },
              ],
            }),
            preferredFlow: "mpesa_stk_push",
            onStatusChange: setPaymentStatus,
          });
          if (!result.success) {
            toast.error(
              result.error ??
                "Payment request failed. Booking will be saved as pending.",
            );
            await finalizeBooking({
              paymentStatus: "unpaid",
              paymentMethod: "mpesa",
              label: `${paymentOption === "deposit" ? "Deposit" : "Pay now"} pending`,
            });
            return;
          }
          await finalizeBooking({
            paymentStatus: paymentOption === "deposit" ? "deposit" : "paid",
            paymentMethod: "mpesa",
            label:
              paymentOption === "deposit"
                ? "50% deposit via M-Pesa"
                : "Paid in full via M-Pesa",
          });
          return;
        } catch (error) {
          toast.error(
            error instanceof Error
              ? error.message
              : "Payment unavailable. Saved as unpaid.",
          );
          await finalizeBooking({
            paymentStatus: "unpaid",
            paymentMethod: "mpesa",
            label: "Payment pending",
          });
          return;
        }
      }

      await finalizeBooking({
        paymentStatus: "unpaid",
        paymentMethod: undefined,
        label: "Pay on arrival",
      });
    } finally {
      setSubmitting(false);
    }
  }

  function cancelConfirmedBooking() {
    if (!confirmation) return;
    const nextSnapshot = {
      ...snapshot,
      bookings: snapshot.bookings.map((entry) =>
        entry.id === confirmation.bookingId
          ? { ...entry, status: "cancelled" as const }
          : entry,
      ),
    };
    setSnapshot(nextSnapshot);
    saveServicesSnapshot(nextSnapshot);
    setConfirmation(null);
    toast.success("Booking cancelled");
  }

  function startReschedule() {
    if (!confirmation) return;
    const booking = snapshot.bookings.find(
      (entry) => entry.id === confirmation.bookingId,
    );
    if (!booking) return;
    setSelectedServiceId(booking.serviceId);
    setSelectedDate(booking.date);
    setSelectedSlot(booking.startTime);
    setSelectedStaffId(booking.staffId ?? "any");
    setCustomerName(booking.clientName);
    setCustomerPhone(booking.clientPhone);
    setNotes(booking.notes ?? "");
    setConfirmation(null);
    setRescheduleBookingId(booking.id);
    toast.success("Adjust the slot, then confirm to reschedule.");
  }

  const calendarLink = confirmation
    ? buildCalendarUrl({
        title: `${confirmation.serviceName} at ${business.name}`,
        details:
          confirmation.notes ??
          `${confirmation.paymentLabel} · ${business.location}`,
        location: business.location,
        start: `${confirmation.date}T${confirmation.time}:00`,
        end: addMinutes(
          parseISO(`${confirmation.date}T${confirmation.time}:00`),
          service?.duration ?? 60,
        ).toISOString(),
      })
    : "#";

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 md:px-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="overflow-hidden rounded-[32px] bg-[linear-gradient(135deg,#0f172a_0%,#1d4ed8_52%,#1e293b_100%)] text-white shadow-xl">
          <div className="grid gap-8 p-6 lg:grid-cols-[1.2fr_0.8fr] lg:p-8">
            <div className="space-y-4">
              <Badge className="rounded-full bg-white/10 px-4 py-1.5 text-white hover:bg-white/10">
                Book online
              </Badge>
              <div className="space-y-2">
                <h1 className="text-3xl font-semibold tracking-tight lg:text-4xl">
                  {businessName}
                </h1>
                <p className="max-w-2xl text-sm text-blue-100 sm:text-base">
                  {business.description}
                </p>
              </div>
              <div className="flex flex-wrap gap-3 text-sm text-blue-100">
                <span className="inline-flex items-center gap-2">
                  <MapPin className="h-4 w-4" /> {business.location}
                </span>
                <span className="inline-flex items-center gap-2">
                  <Phone className="h-4 w-4" /> {business.phone}
                </span>
                <span className="inline-flex items-center gap-2">
                  <Mail className="h-4 w-4" /> {business.email}
                </span>
                <span className="inline-flex items-center gap-2">
                  <Clock3 className="h-4 w-4" />{" "}
                  {
                    business.operatingHours.find(
                      (entry) => entry.day === new Date().getDay(),
                    )?.start
                  }{" "}
                  -{" "}
                  {
                    business.operatingHours.find(
                      (entry) => entry.day === new Date().getDay(),
                    )?.end
                  }
                </span>
              </div>
            </div>
            <div className="rounded-3xl bg-white/10 p-4 backdrop-blur-sm">
              <img
                src={logoUrl}
                alt={businessName}
                className="h-52 w-full rounded-3xl object-cover"
              />
            </div>
          </div>
        </div>

        <Card className="rounded-3xl border-0 shadow-lg shadow-slate-200/60">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="text-xl">Talk to us</CardTitle>
                <CardDescription>
                  Ask a question in your own words — we&apos;ll reply on your
                  preferred channel.
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <a
                  href={`https://wa.me/${whatsappDigits}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white"
                >
                  <MessageCircle className="h-4 w-4" /> WhatsApp
                </a>
                <a
                  href={`tel:${business.phone}`}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700"
                >
                  <Phone className="h-4 w-4" /> Call
                </a>
                <a
                  href={`mailto:${business.email}`}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700"
                >
                  <Mail className="h-4 w-4" /> Email
                </a>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={contactMessage}
              onChange={(event) => setContactMessage(event.target.value)}
              placeholder="e.g. Do you service Prado brakes today? What time can I bring it in?"
              rows={3}
            />
            <Button
              onClick={() => void sendContactMessage()}
              disabled={contactSending}
              className="gap-2"
            >
              <Send className="h-4 w-4" />
              {contactSending ? "Sending…" : "Send message"}
            </Button>
          </CardContent>
        </Card>

        {confirmation ? (
          <Card className="rounded-3xl border-0 shadow-lg shadow-slate-200/60">
            <CardContent className="space-y-6 p-8 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                <CheckCircle2 className="h-8 w-8" />
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-semibold">Booking confirmed</h2>
                <p className="text-slate-500">
                  {confirmation.customerName}, your appointment for{" "}
                  {confirmation.serviceName} is booked.
                </p>
              </div>
              <div className="mx-auto grid max-w-3xl gap-4 rounded-3xl bg-slate-50 p-6 text-left md:grid-cols-2">
                <Detail label="Booking" value={confirmation.bookingId} />
                <Detail
                  label="Payment"
                  value={`${confirmation.paymentLabel} (${confirmation.paymentStatus})`}
                />
                <Detail
                  label="Date"
                  value={format(
                    parseISO(`${confirmation.date}T${confirmation.time}:00`),
                    "EEE d MMM yyyy",
                  )}
                />
                <Detail
                  label="Time"
                  value={format(
                    parseISO(`${confirmation.date}T${confirmation.time}:00`),
                    "h:mm a",
                  )}
                />
                <Detail label="Phone" value={confirmation.phone} />
                <Detail label="Location" value={business.location} />
              </div>
              <div className="flex flex-wrap justify-center gap-3">
                <Button className="rounded-full" asChild>
                  <a href={calendarLink} target="_blank" rel="noreferrer">
                    <CalendarDays className="h-4 w-4" /> Add to calendar
                  </a>
                </Button>
                <Button
                  variant="outline"
                  className="rounded-full"
                  onClick={startReschedule}
                >
                  Reschedule
                </Button>
                <Button
                  variant="outline"
                  className="rounded-full"
                  onClick={cancelConfirmedBooking}
                >
                  Cancel booking
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-6">
              <Card className="rounded-3xl border-0 shadow-lg shadow-slate-200/60">
                <CardHeader>
                  <CardTitle className="text-xl">1. Browse services</CardTitle>
                  <CardDescription>
                    Choose a category, compare prices, and select the service
                    you need.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    <CategoryChip
                      active={selectedCategory === "all"}
                      label="All"
                      onClick={() => setSelectedCategory("all")}
                    />
                    {Array.from(
                      new Set(snapshot.services.map((entry) => entry.category)),
                    ).map((category) => (
                      <CategoryChip
                        key={category}
                        active={selectedCategory === category}
                        label={category}
                        onClick={() => setSelectedCategory(category)}
                      />
                    ))}
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    {filteredServices.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => {
                          setSelectedServiceId(entry.id);
                          setSelectedSlot("");
                        }}
                        className={cn(
                          "rounded-3xl border p-4 text-left transition",
                          selectedServiceId === entry.id
                            ? "border-indigo-300 bg-indigo-50/70"
                            : "border-slate-200 bg-white hover:border-slate-300",
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h3 className="font-semibold text-slate-900">
                              {entry.name}
                            </h3>
                            <p className="mt-2 text-sm text-slate-500">
                              {entry.description}
                            </p>
                          </div>
                          <Badge className="rounded-full bg-slate-100 text-slate-700 hover:bg-slate-100">
                            {entry.category}
                          </Badge>
                        </div>
                        <div className="mt-4 flex flex-wrap gap-3 text-sm text-slate-600">
                          <span>{money.format(entry.price)}</span>
                          <span>{entry.duration} min</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-3xl border-0 shadow-lg shadow-slate-200/60">
                <CardHeader>
                  <CardTitle className="text-xl">
                    2. Pick date, staff, and time
                  </CardTitle>
                  <CardDescription>
                    Choose any available staff member or book with a specialist.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Date">
                      <Input
                        type="date"
                        value={selectedDate}
                        onChange={(event) => {
                          setSelectedDate(event.target.value);
                          setSelectedSlot("");
                        }}
                      />
                    </Field>
                    <Field label="Preferred staff">
                      <select
                        value={selectedStaffId}
                        onChange={(event) => {
                          setSelectedStaffId(event.target.value);
                          setSelectedSlot("");
                        }}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      >
                        <option value="any">Any available</option>
                        {snapshot.staff
                          .filter((member) =>
                            service?.staffIds.includes(member.id),
                          )
                          .map((member) => (
                            <option key={member.id} value={member.id}>
                              {member.name} · {member.specialty}
                            </option>
                          ))}
                      </select>
                    </Field>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {availableSlots.length > 0 ? (
                      availableSlots.map((slot) => (
                        <button
                          key={slot}
                          type="button"
                          onClick={() => setSelectedSlot(slot)}
                          className={cn(
                            "rounded-2xl border px-4 py-3 text-sm font-medium transition",
                            selectedSlot === slot
                              ? "border-indigo-500 bg-indigo-600 text-white"
                              : "border-slate-200 bg-white text-slate-700 hover:border-indigo-300",
                          )}
                        >
                          {format(
                            parseISO(`${selectedDate}T${slot}:00`),
                            "h:mm a",
                          )}
                        </button>
                      ))
                    ) : (
                      <p className="col-span-full text-sm text-slate-500">
                        No matching slots. Try another day or leave staff as any
                        available.
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-3xl border-0 shadow-lg shadow-slate-200/60">
                <CardHeader>
                  <CardTitle className="text-xl">3. Confirm details</CardTitle>
                  <CardDescription>
                    Tell the business who&apos;s coming and how you want to pay.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Your name">
                      <Input
                        value={customerName}
                        onChange={(event) =>
                          setCustomerName(event.target.value)
                        }
                        placeholder="Enter full name"
                      />
                    </Field>
                    <Field label="Phone number">
                      <Input
                        value={customerPhone}
                        onChange={(event) =>
                          setCustomerPhone(event.target.value)
                        }
                        placeholder="07xx xxx xxx"
                      />
                    </Field>
                    <Field label="Email (optional)">
                      <Input
                        type="email"
                        value={customerEmail}
                        onChange={(event) =>
                          setCustomerEmail(event.target.value)
                        }
                        placeholder="you@email.com"
                      />
                    </Field>
                    <Field label="Notes" className="md:col-span-2">
                      <Textarea
                        value={notes}
                        onChange={(event) => setNotes(event.target.value)}
                        placeholder="Vehicle issue, preferred wait time, or any special instruction"
                      />
                    </Field>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <PaymentCard
                      active={paymentOption === "pay_now"}
                      title="Pay now"
                      description="Full amount by M-Pesa"
                      icon={Wallet}
                      amount={money.format(service?.price ?? 0)}
                      onClick={() => setPaymentOption("pay_now")}
                    />
                    <PaymentCard
                      active={paymentOption === "deposit"}
                      title="Pay deposit"
                      description="Secure with 50%"
                      icon={CreditCard}
                      amount={money.format(
                        Math.round((service?.price ?? 0) * 0.5),
                      )}
                      onClick={() => setPaymentOption("deposit")}
                    />
                    <PaymentCard
                      active={paymentOption === "pay_on_arrival"}
                      title="Pay on arrival"
                      description="Cash, card, or M-Pesa at the shop"
                      icon={ShieldCheck}
                      amount="Book now"
                      onClick={() => setPaymentOption("pay_on_arrival")}
                    />
                    <PaymentCard
                      active={paymentOption === "bnpl"}
                      title="Co-op BNPL"
                      description="Split payments with approval"
                      icon={CalendarDays}
                      amount="Flexible terms"
                      onClick={() => setPaymentOption("bnpl")}
                    />
                  </div>
                  {showBNPL ? (
                    <div className="rounded-3xl border border-blue-200 bg-blue-50 p-4">
                      <BNPLCheckout
                        amount={service?.price ?? 0}
                        orderId={`svc-${Date.now()}`}
                        merchantId={business.id}
                        description={`${service?.name} at ${business.name}`}
                        onSuccess={async (_transaction: BNPLTransaction) => {
                          await finalizeBooking({
                            paymentStatus: "paid",
                            paymentMethod: "bnpl",
                            label: "Approved on Co-op BNPL",
                          });
                        }}
                        onCancel={() => {
                          setShowBNPL(false);
                          toast.message("BNPL checkout cancelled");
                        }}
                      />
                    </div>
                  ) : null}
                  <Button
                    className="w-full rounded-full py-6 text-base"
                    onClick={() => void handleConfirm()}
                    disabled={submitting || !selectedSlot || !service}
                  >
                    {submitting
                      ? "Confirming booking..."
                      : rescheduleBookingId
                        ? "Save rescheduled booking"
                        : "Confirm booking"}
                  </Button>
                  {paymentStatus ? (
                    <p className="text-center text-sm text-slate-500">
                      Payment status: {paymentStatus.replaceAll("_", " ")}
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            </div>

            <div className="space-y-6">
              <Card className="rounded-3xl border-0 shadow-lg shadow-slate-200/60">
                <CardHeader>
                  <CardTitle className="text-xl">Booking summary</CardTitle>
                  <CardDescription>
                    Review your selected service before checkout.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {service ? (
                    <>
                      <div className="rounded-3xl bg-slate-50 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h3 className="font-semibold text-slate-900">
                              {service.name}
                            </h3>
                            <p className="mt-1 text-sm text-slate-500">
                              {service.description}
                            </p>
                          </div>
                          <Badge className="rounded-full bg-indigo-50 text-indigo-700 hover:bg-indigo-50">
                            {service.category}
                          </Badge>
                        </div>
                        <div className="mt-4 grid gap-3 text-sm text-slate-600">
                          <span className="inline-flex items-center gap-2">
                            <Wallet className="h-4 w-4" />{" "}
                            {money.format(service.price)}
                          </span>
                          <span className="inline-flex items-center gap-2">
                            <Clock3 className="h-4 w-4" /> {service.duration}{" "}
                            minutes
                          </span>
                          <span className="inline-flex items-center gap-2">
                            <UserRound className="h-4 w-4" />{" "}
                            {selectedStaffId === "any"
                              ? "Any available technician"
                              : snapshot.staff.find(
                                  (member) => member.id === selectedStaffId,
                                )?.name}
                          </span>
                          <span className="inline-flex items-center gap-2">
                            <CalendarDays className="h-4 w-4" />{" "}
                            {selectedSlot
                              ? format(
                                  parseISO(
                                    `${selectedDate}T${selectedSlot}:00`,
                                  ),
                                  "EEE d MMM · h:mm a",
                                )
                              : "Choose a slot"}
                          </span>
                        </div>
                      </div>
                      <div className="rounded-3xl border border-slate-200 p-4">
                        <h4 className="font-semibold text-slate-900">
                          Operating hours
                        </h4>
                        <div className="mt-3 space-y-2 text-sm text-slate-600">
                          {business.operatingHours.map((entry) => (
                            <div
                              key={entry.day}
                              className="flex items-center justify-between"
                            >
                              <span>{entry.label}</span>
                              <span>
                                {entry.start} - {entry.end}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  ) : null}
                </CardContent>
              </Card>

              <Card className="rounded-3xl border-0 shadow-lg shadow-slate-200/60">
                <CardHeader>
                  <CardTitle className="text-xl">Need flexibility?</CardTitle>
                  <CardDescription>
                    Use deposits, BNPL, or pay on arrival depending on your
                    plan.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-slate-600">
                  <div className="rounded-2xl bg-emerald-50 p-4 text-emerald-900">
                    Pay now for the fastest check-in and instant confirmation.
                  </div>
                  <div className="rounded-2xl bg-amber-50 p-4 text-amber-900">
                    Use a 50% deposit to reserve a long service like AC repair
                    or full service.
                  </div>
                  <div className="rounded-2xl bg-blue-50 p-4 text-blue-900">
                    BNPL is ideal for higher-value repairs that need approval
                    and flexible repayment.
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CategoryChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-4 py-2 text-sm font-medium transition",
        active
          ? "border-indigo-500 bg-indigo-600 text-white"
          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
      )}
    >
      {label}
    </button>
  );
}

function PaymentCard({
  active,
  title,
  description,
  icon: Icon,
  amount,
  onClick,
}: {
  active: boolean;
  title: string;
  description: string;
  icon: typeof Wallet;
  amount: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-3xl border p-4 text-left transition",
        active
          ? "border-indigo-500 bg-indigo-50 shadow-sm"
          : "border-slate-200 bg-white hover:border-slate-300",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div
          className={cn(
            "rounded-2xl p-3",
            active ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600",
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="text-sm font-semibold text-slate-900">{amount}</div>
      </div>
      <div className="mt-4">
        <h4 className="font-semibold text-slate-900">{title}</h4>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      </div>
    </button>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-1 font-semibold text-slate-900">{value}</div>
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

function slotFitsDuration(
  slot: string,
  duration: number,
  availableSlots: string[],
) {
  const available = new Set(availableSlots);
  for (let offset = 0; offset < duration; offset += 30) {
    if (!available.has(addMinutesLabel(slot, offset))) return false;
  }
  return true;
}

function addMinutesLabel(time: string, duration: number) {
  const [hours, minutes] = time.split(":").map(Number);
  const total = hours * 60 + minutes + duration;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function timeToLabel(date: Date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function buildCalendarUrl({
  title,
  details,
  location,
  start,
  end,
}: {
  title: string;
  details: string;
  location: string;
  start: string;
  end: string;
}) {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    details,
    location,
    dates: `${calendarDate(start)}/${calendarDate(end)}`,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function calendarDate(value: string) {
  return value
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z")
    .replace("T", "T");
}
