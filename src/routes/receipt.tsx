import { createFileRoute } from "@tanstack/react-router";
import { Loader2, MailCheck, ReceiptText, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/receipt")({
  component: ReceiptLookupPage,
});

/**
 * A5.2 / A5.3 — "I forgot to download my receipt" (Sunday help centre article
 * 7669632), and the login that Sunday's article 9013955 lands the guest on.
 *
 * Sunday's manual process asks for the restaurant, the date, the total, the last
 * 4 of the card and an email address, and a human sends the receipt. This page
 * automates that WITHOUT automating the disclosure: the guest proves control of
 * the contact on the payment with a one-time code, and the reward is the same
 * /me/:token portal they would have had if they had logged in at checkout.
 *
 * The page never says whether a contact is known to a venue. Step 2 is reached
 * for every well-formed entry.
 */
function ReceiptLookupPage() {
  const [venueId, setVenueId] = useState("");
  const [venueName, setVenueName] = useState<string | null>(null);
  const [venueCode, setVenueCode] = useState("");
  const [venueError, setVenueError] = useState<string | null>(null);
  const [venueBusy, setVenueBusy] = useState(false);

  const [channel, setChannel] = useState<"sms" | "whatsapp" | "email">("sms");
  const [contact, setContact] = useState("");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [masked, setMasked] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [outcome, setOutcome] = useState<string | null>(null);

  // A deep link from the original receipt message carries the venue already.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const v = params.get("v");
    if (v) setVenueId(v);
  }, []);

  async function findVenue(event: React.FormEvent) {
    event.preventDefault();
    setVenueBusy(true);
    setVenueError(null);
    setStatus("Looking up that venue code…");
    try {
      const res = await fetch(
        `/api/guest/venue?code=${encodeURIComponent(venueCode.trim())}`,
      );
      const data = (await res.json().catch(() => ({}))) as {
        venue?: { id: string; name: string };
        error?: string;
      };
      if (!res.ok || !data.venue) {
        setVenueError("We couldn't find a venue with that code.");
        setStatus("No venue matched that code.");
        return;
      }
      setVenueId(data.venue.id);
      setVenueName(data.venue.name);
      setStatus(`Venue found: ${data.venue.name}.`);
    } catch {
      setVenueError("We couldn't reach the venue directory. Try again.");
      setStatus("Venue lookup failed.");
    } finally {
      setVenueBusy(false);
    }
  }

  async function requestCode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setStatus("Sending your code…");
    try {
      const res = await fetch("/api/guest/receipt-lookup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ venue: venueId, channel, contact }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        challengeId?: string;
        maskedDestination?: string;
        error?: string;
      };
      if (!res.ok || !data.challengeId) {
        setError(data.error ?? "We couldn't start that lookup. Try again.");
        setStatus("Could not send a code.");
        return;
      }
      setChallengeId(data.challengeId);
      setMasked(data.maskedDestination ?? null);
      setStatus(
        `If those details match a payment at this venue, we've sent a code to ${
          data.maskedDestination ?? "your contact"
        }.`,
      );
    } catch {
      setError("We couldn't start that lookup. Try again.");
      setStatus("Could not send a code.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setStatus("Checking your code…");
    try {
      const res = await fetch("/api/guest/receipt-lookup/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ challengeId, venue: venueId, channel, contact, code }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        url?: string | null;
        message?: string;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "That code wasn't right.");
        setStatus("Code rejected.");
        return;
      }
      if (data.url) {
        setStatus("Verified. Opening your receipts…");
        window.location.assign(data.url);
        return;
      }
      setOutcome(
        data.message ??
          "We couldn't find a payment at this venue for those details.",
      );
      setStatus("Verified, but no receipts were found.");
    } catch {
      setError("We couldn't check that code. Try again.");
      setStatus("Code check failed.");
    } finally {
      setBusy(false);
    }
  }

  const contactLabel =
    channel === "email" ? "Email address" : "Mobile number";
  const contactHint =
    channel === "email"
      ? "The email address the venue has for you."
      : "The number you paid from, e.g. 0712 345 678.";

  return (
    <main className="mx-auto w-full max-w-md px-4 py-10">
      <header className="text-center">
        <ReceiptText
          className="mx-auto size-10 text-emerald-600"
          aria-hidden="true"
        />
        <h1 className="mt-3 text-2xl font-bold">Find my receipt</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Left without saving your receipt? Confirm the contact details you paid
          with and we'll reopen your receipts.
        </p>
      </header>

      {/* Async status for assistive technology. Always present so updates are
          announced rather than the region being inserted mid-flow. */}
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>

      {!venueId ? (
        <form onSubmit={findVenue} className="mt-8 space-y-3" noValidate>
          <label htmlFor="venue-code" className="block text-sm font-medium">
            Venue code
          </label>
          <p id="venue-code-hint" className="text-xs text-muted-foreground">
            The short code printed on the QR sticker or on your bill.
          </p>
          <input
            id="venue-code"
            name="venue-code"
            value={venueCode}
            onChange={(e) => setVenueCode(e.target.value)}
            required
            autoComplete="off"
            aria-describedby={
              venueError ? "venue-code-hint venue-code-error" : "venue-code-hint"
            }
            aria-invalid={venueError ? true : undefined}
            className="min-h-[44px] w-full rounded-xl border border-border bg-background px-4 py-3 text-base"
          />
          {venueError ? (
            <p id="venue-code-error" className="text-sm text-red-600">
              {venueError}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={venueBusy || !venueCode.trim()}
            className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-base font-semibold text-white disabled:opacity-50"
          >
            {venueBusy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : null}
            Continue
          </button>
        </form>
      ) : !challengeId ? (
        <form onSubmit={requestCode} className="mt-8 space-y-4" noValidate>
          {venueName ? (
            <p className="text-sm text-muted-foreground">
              Venue: <span className="font-medium">{venueName}</span>
            </p>
          ) : null}

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">
              Where should we send your code?
            </legend>
            {(
              [
                { id: "sms", label: "Text message (SMS)" },
                { id: "whatsapp", label: "WhatsApp" },
                { id: "email", label: "Email" },
              ] as const
            ).map((option) => (
              <label
                key={option.id}
                htmlFor={`channel-${option.id}`}
                className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-xl border border-border px-4 py-2 text-sm"
              >
                <input
                  id={`channel-${option.id}`}
                  type="radio"
                  name="channel"
                  value={option.id}
                  checked={channel === option.id}
                  onChange={() => setChannel(option.id)}
                  className="size-4"
                />
                {option.label}
              </label>
            ))}
          </fieldset>

          <div className="space-y-2">
            <label htmlFor="contact" className="block text-sm font-medium">
              {contactLabel}
            </label>
            <p id="contact-hint" className="text-xs text-muted-foreground">
              {contactHint}
            </p>
            <input
              id="contact"
              name="contact"
              type={channel === "email" ? "email" : "tel"}
              inputMode={channel === "email" ? "email" : "tel"}
              autoComplete={channel === "email" ? "email" : "tel"}
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              required
              aria-describedby={
                error ? "contact-hint lookup-error" : "contact-hint"
              }
              aria-invalid={error ? true : undefined}
              className="min-h-[44px] w-full rounded-xl border border-border bg-background px-4 py-3 text-base"
            />
          </div>

          {error ? (
            <p id="lookup-error" className="text-sm text-red-600">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={busy || !contact.trim()}
            className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-base font-semibold text-white disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : null}
            Send me a code
          </button>

          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            For your protection we never confirm whether a phone number or email
            is on file. If those details match a payment here, a code will
            arrive.
          </p>
        </form>
      ) : outcome ? (
        <div className="mt-8 rounded-2xl border border-border p-5">
          <MailCheck
            className="size-6 text-emerald-600"
            aria-hidden="true"
          />
          <p className="mt-3 text-sm">{outcome}</p>
        </div>
      ) : (
        <form onSubmit={verifyCode} className="mt-8 space-y-4" noValidate>
          <div className="space-y-2">
            <label htmlFor="code" className="block text-sm font-medium">
              6-digit code
            </label>
            <p id="code-hint" className="text-xs text-muted-foreground">
              Sent to {masked ?? "your contact"}. It expires in 10 minutes.
            </p>
            <input
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              required
              aria-describedby={error ? "code-hint code-error" : "code-hint"}
              aria-invalid={error ? true : undefined}
              className="min-h-[44px] w-full rounded-xl border border-border bg-background px-4 py-3 text-center font-mono text-2xl tracking-widest"
            />
          </div>

          {error ? (
            <p id="code-error" className="text-sm text-red-600">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={busy || code.length !== 6}
            className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-base font-semibold text-white disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : null}
            Open my receipts
          </button>
        </form>
      )}
    </main>
  );
}
