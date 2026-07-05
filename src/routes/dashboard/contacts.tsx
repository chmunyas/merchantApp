import { createFileRoute } from "@tanstack/react-router";
import { Cloud, CloudOff, History, MessageSquare, Send, Sparkles, Users, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

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
import { getCurrentVenueId } from "@/lib/merchant-dashboard";
import { authFetch } from "@/lib/auth";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/contacts")({
  component: DashboardContactsPage,
});

type Contact = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  tier: string;
  points: number;
  total_spent: string | number;
  visits: number;
  tags: string[];
};

type Health = { ok: boolean; database?: string; venues?: number };

const money = new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
  maximumFractionDigits: 0,
});

const TIER_STYLES: Record<string, string> = {
  Platinum: "bg-violet-100 text-violet-700",
  Gold: "bg-amber-100 text-amber-700",
  Silver: "bg-slate-200 text-slate-700",
  Bronze: "bg-orange-100 text-orange-700",
};

type TimelineMsg = {
  direction: "inbound" | "outbound";
  body: string;
  channel: string;
  ai?: boolean;
  created_at: string;
};

const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  web: "Web chat",
  telegram: "Telegram",
  instagram: "Instagram",
  sms: "SMS",
};

function DashboardContactsPage() {
  const venue = useMemo(() => getCurrentVenueId(), []);
  const [health, setHealth] = useState<Health | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  const [prompt, setPrompt] = useState("covers today");
  const [aiReply, setAiReply] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  const [timelineFor, setTimelineFor] = useState<Contact | null>(null);
  const [timeline, setTimeline] = useState<TimelineMsg[]>([]);
  const [timelineChannels, setTimelineChannels] = useState<string[]>([]);
  const [timelineBusy, setTimelineBusy] = useState(false);

  async function loadContacts() {
    try {
      const res = await authFetch(`/api/contacts?venue=${venue}`);
      const data = (await res.json()) as { contacts?: Contact[] };
      setContacts(data.contacts ?? []);
    } catch {
      setContacts([]);
    }
  }

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/health");
        const data = (await res.json()) as Health;
        if (active) setHealth(data);
      } catch {
        if (active) setHealth({ ok: false });
      }
      await loadContacts();
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venue]);

  async function addContact() {
    if (!name.trim()) {
      toast.error("Enter a name.");
      return;
    }
    try {
      const res = await authFetch(`/api/contacts?venue=${venue}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, phone, email }),
      });
      if (!res.ok) throw new Error("failed");
      toast.success("Contact added to Postgres.");
      setName("");
      setPhone("");
      setEmail("");
      await loadContacts();
    } catch {
      toast.error("Could not add contact (cloud backend offline).");
    }
  }

  async function askAi() {
    setAiBusy(true);
    setAiReply(null);
    try {
      const res = await authFetch(`/api/ai/command?venue=${venue}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: prompt }),
      });
      const data = (await res.json()) as { reply?: string };
      setAiReply(data.reply ?? "No response.");
    } catch {
      setAiReply("Cloud backend offline.");
    } finally {
      setAiBusy(false);
    }
  }

  async function openTimeline(contact: Contact) {
    if (!contact.phone) {
      toast.error("This contact has no phone to match conversations.");
      return;
    }
    setTimelineFor(contact);
    setTimelineBusy(true);
    setTimeline([]);
    setTimelineChannels([]);
    try {
      const res = await authFetch(
        `/api/timeline?venue=${venue}&phone=${encodeURIComponent(contact.phone)}`,
      );
      const data = (await res.json()) as {
        messages?: TimelineMsg[];
        channels?: string[];
      };
      setTimeline(data.messages ?? []);
      setTimelineChannels(data.channels ?? []);
    } catch {
      setTimeline([]);
    } finally {
      setTimelineBusy(false);
    }
  }

  const online = health?.ok === true;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Contacts</h2>
          <p className="text-sm text-muted-foreground">
            Server-backed CRM — stored in PostgreSQL, read at the edge.
          </p>
        </div>
        {online ? (
          <Badge className="gap-1 bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
            <Cloud className="h-3.5 w-3.5" /> Postgres online · {health?.venues}{" "}
            venues
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="gap-1 border-amber-200 text-amber-700"
          >
            <CloudOff className="h-3.5 w-3.5" /> Cloud backend offline
          </Badge>
        )}
      </div>

      <Card className="border-slate-200 bg-white/90 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-violet-500" /> Ask the AI agent
          </CardTitle>
          <CardDescription>
            Natural-language queries run real SQL against Postgres (Workers AI in
            production). Try "covers today", "top spenders", "new enquiries".
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Input
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Ask about bookings, covers, contacts..."
              onKeyDown={(event) => {
                if (event.key === "Enter") askAi();
              }}
            />
            <Button type="button" onClick={askAi} disabled={aiBusy}>
              <Send className="mr-1 h-3.5 w-3.5" />
              {aiBusy ? "Thinking…" : "Ask"}
            </Button>
          </div>
          {aiReply ? (
            <div className="mt-3 rounded-2xl bg-slate-900 px-4 py-3 text-sm text-white">
              {aiReply}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
        <Card className="border-slate-200 bg-white/90 shadow-sm">
          <CardHeader>
            <CardTitle>Add contact</CardTitle>
            <CardDescription>Writes a row to the contacts table.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <Field label="Name">
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Jane Doe"
                />
              </Field>
              <Field label="Phone">
                <Input
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="+2547..."
                />
              </Field>
              <Field label="Email">
                <Input
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="jane@example.com"
                />
              </Field>
              <div className="flex justify-end">
                <Button type="button" onClick={addContact} disabled={!online}>
                  Add contact
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Users className="h-4 w-4 text-slate-400" />
            {contacts.length} contacts
          </div>
          {loading ? (
            <Card className="border-slate-200 bg-white/60">
              <CardContent className="p-6 text-center text-sm text-slate-500">
                Loading from Postgres…
              </CardContent>
            </Card>
          ) : contacts.length === 0 ? (
            <Card className="border-dashed border-slate-300 bg-white/60">
              <CardContent className="p-6 text-center text-sm text-slate-500">
                {online
                  ? "No contacts yet for this venue."
                  : "Cloud backend offline — start the Postgres service to load contacts."}
              </CardContent>
            </Card>
          ) : (
            contacts.map((contact) => (
              <Card
                key={contact.id}
                className="border-slate-200 bg-white/90 shadow-sm"
              >
                <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div>
                    <p className="font-medium text-slate-950">{contact.name}</p>
                    <p className="text-xs text-slate-500">
                      {contact.phone ?? "no phone"} · {contact.visits} visits ·{" "}
                      {money.format(Number(contact.total_spent))}
                    </p>
                    {contact.tags.length > 0 ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {contact.tags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      className={cn(
                        "hover:opacity-100",
                        TIER_STYLES[contact.tier] ?? "bg-slate-100 text-slate-600",
                      )}
                    >
                      {contact.tier}
                    </Badge>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1"
                      onClick={() => openTimeline(contact)}
                    >
                      <History className="h-3.5 w-3.5" /> History
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>

      {timelineFor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setTimelineFor(null)}
        >
          <div
            className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  {timelineFor.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  Cross-channel history
                  {timelineChannels.length > 0
                    ? ` · ${timelineChannels.map((c) => CHANNEL_LABEL[c] ?? c).join(", ")}`
                    : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTimelineFor(null)}
                className="rounded-full p-1 hover:bg-slate-100"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto bg-slate-50 p-4">
              {timelineBusy ? (
                <p className="py-6 text-center text-sm text-slate-400">
                  Loading…
                </p>
              ) : timeline.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-400">
                  No conversations yet for this contact.
                </p>
              ) : (
                timeline
                  .slice()
                  .reverse()
                  .map((message, index) => (
                    <div
                      key={index}
                      className={
                        message.direction === "inbound"
                          ? "flex justify-start"
                          : "flex justify-end"
                      }
                    >
                      <div
                        className={cn(
                          "max-w-[80%] rounded-2xl px-3 py-2 text-sm",
                          message.direction === "inbound"
                            ? "bg-white text-slate-800 shadow-sm"
                            : "bg-emerald-600 text-white",
                        )}
                      >
                        <div className="mb-0.5 flex items-center gap-1 text-[10px] opacity-70">
                          <MessageSquare className="h-2.5 w-2.5" />
                          {CHANNEL_LABEL[message.channel] ?? message.channel}
                        </div>
                        {message.body}
                      </div>
                    </div>
                  ))
              )}
            </div>
          </div>
        </div>
      )}
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
    <label className="space-y-2">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}
