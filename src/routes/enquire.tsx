import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ensureMerchantDemoData,
  getCurrentVenueId,
} from "@/lib/merchant-dashboard";

export const Route = createFileRoute("/enquire")({
  component: EnquirePage,
});

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function EnquirePage() {
  const snapshot = useMemo(() => ensureMerchantDemoData(), []);
  const businessName = snapshot.settings.businessProfile?.name ?? "our venue";

  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [date, setDate] = useState(todayISO());
  const [time, setTime] = useState("19:00");
  const [covers, setCovers] = useState(2);
  const [notes, setNotes] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!customerName.trim()) {
      toast.error("Please enter your name.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/enquiries?venue=${encodeURIComponent(getCurrentVenueId())}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            customerName: customerName.trim(),
            phone: phone.trim(),
            covers,
            date,
            time,
            notes: notes.trim() || undefined,
          }),
        },
      );
      if (!res.ok) throw new Error("failed");
      setSubmitted(true);
      toast.success("Request sent!");
    } catch {
      toast.error(
        "Couldn't send your request. Check your connection and try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center px-4 text-center">
        <CheckCircle2 className="h-12 w-12 text-emerald-500" />
        <h1 className="mt-4 text-2xl font-semibold text-slate-950">
          Request sent
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Thanks {customerName.split(" ")[0]}! {businessName} will confirm your
          table for {covers} on {date} at {time} shortly.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 py-8">
      <div className="rounded-3xl bg-gradient-to-br from-slate-950 to-emerald-950 p-6 text-white shadow-xl">
        <p className="text-sm text-emerald-200">Book a table</p>
        <h1 className="mt-1 text-2xl font-semibold">{businessName}</h1>
        <p className="mt-2 text-sm text-slate-300">
          Tell us when you'd like to come and we'll confirm availability.
        </p>
      </div>

      <div className="mt-6 space-y-4">
        <Field label="Your name">
          <Input
            value={customerName}
            onChange={(event) => setCustomerName(event.target.value)}
            placeholder="Jane Doe"
          />
        </Field>
        <Field label="Phone (optional)">
          <Input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="+2547..."
          />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Date">
            <Input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </Field>
          <Field label="Time">
            <Input
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
            />
          </Field>
          <Field label="Guests">
            <Input
              type="number"
              min="1"
              value={covers}
              onChange={(event) => setCovers(Number(event.target.value) || 1)}
            />
          </Field>
        </div>
        <Field label="Anything we should know? (optional)">
          <Textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Occasion, seating preference..."
          />
        </Field>
        <Button
          type="button"
          className="w-full"
          onClick={handleSubmit}
          disabled={submitting}
        >
          {submitting ? "Sending…" : "Request booking"}
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}
