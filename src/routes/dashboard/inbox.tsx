import { createFileRoute } from "@tanstack/react-router";
import {
  Bell,
  Bot,
  Cloud,
  CloudOff,
  Globe,
  MessageSquare,
  Phone,
  RefreshCw,
  Send,
  Sparkles,
  UserRound,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { authFetch } from "@/lib/auth";
import { getCurrentVenueId } from "@/lib/merchant-dashboard";
import { enablePush } from "@/lib/push-client";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/inbox")({
  component: DashboardInboxPage,
});

type Conversation = {
  id: string;
  wa_id: string;
  name: string | null;
  role: string;
  status: string;
  channel: string;
  last_message_at: string;
  last_message: string | null;
};

type Message = {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  ai: boolean;
  tool: string | null;
  created_at: string;
};

type Health = { ok: boolean; database?: string };

const ROLE_STYLES: Record<string, string> = {
  admin: "bg-violet-100 text-violet-700",
  staff: "bg-blue-100 text-blue-700",
  customer: "bg-slate-200 text-slate-700",
};

const CHANNEL_META: Record<
  string,
  { label: string; icon: typeof Phone; className: string }
> = {
  whatsapp: { label: "WhatsApp", icon: Phone, className: "bg-emerald-100 text-emerald-700" },
  web: { label: "Web chat", icon: Globe, className: "bg-sky-100 text-sky-700" },
  telegram: { label: "Telegram", icon: Send, className: "bg-blue-100 text-blue-700" },
  sms: { label: "SMS", icon: MessageSquare, className: "bg-amber-100 text-amber-700" },
  instagram: { label: "Instagram", icon: MessageSquare, className: "bg-pink-100 text-pink-700" },
};

function channelMeta(channel: string) {
  return (
    CHANNEL_META[channel] ?? {
      label: channel || "Other",
      icon: MessageSquare,
      className: "bg-slate-100 text-slate-600",
    }
  );
}

function timeLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function DashboardInboxPage() {
  const venue = useMemo(() => getCurrentVenueId(), []);
  const [health, setHealth] = useState<Health | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);

  const [simChannel, setSimChannel] = useState("whatsapp");
  const [simFrom, setSimFrom] = useState("+254712345678");
  const [simName, setSimName] = useState("Walk-in Guest");
  const [simText, setSimText] = useState("book 4 tonight at 8");
  const [simBusy, setSimBusy] = useState(false);

  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [pushBusy, setPushBusy] = useState(false);

  const threadRef = useRef<HTMLDivElement>(null);

  const selected = conversations.find((c) => c.id === selectedId) ?? null;

  const channelsPresent = Array.from(
    new Set(conversations.map((c) => c.channel).filter(Boolean)),
  );
  const visibleConversations =
    channelFilter === "all"
      ? conversations
      : conversations.filter((c) => c.channel === channelFilter);

  async function enableAlerts() {
    setPushBusy(true);
    try {
      const status = await enablePush(venue);
      if (status === "enabled") {
        toast.success("Notifications enabled on this device.");
      } else if (status === "denied") {
        toast.error("Notifications are blocked in your browser settings.");
      } else if (status === "unsupported") {
        toast.error("This browser doesn't support push notifications.");
      } else {
        toast.error("Couldn't enable notifications.");
      }
    } finally {
      setPushBusy(false);
    }
  }

  async function loadConversations(selectFirst = false) {
    try {
      const res = await authFetch(`/api/whatsapp/conversations?venue=${venue}`);
      const data = (await res.json()) as { conversations?: Conversation[] };
      const list = data.conversations ?? [];
      setConversations(list);
      if (selectFirst && !selectedId && list.length > 0) {
        setSelectedId(list[0].id);
      }
    } catch {
      setConversations([]);
    }
  }

  async function loadMessages(conversationId: string) {
    try {
      const res = await fetch(
        `/api/whatsapp/messages?conversation=${conversationId}`,
      );
      const data = (await res.json()) as { messages?: Message[] };
      setMessages(data.messages ?? []);
    } catch {
      setMessages([]);
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
      await loadConversations(true);
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venue]);

  useEffect(() => {
    if (selectedId) loadMessages(selectedId);
  }, [selectedId]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [messages]);

  async function sendReply() {
    if (!selected || !reply.trim()) return;
    setSending(true);
    try {
      const res = await authFetch("/api/whatsapp/reply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversation: selected.id,
          to: selected.wa_id,
          text: reply,
        }),
      });
      if (!res.ok) throw new Error("failed");
      setReply("");
      await loadMessages(selected.id);
      await loadConversations();
    } catch {
      toast.error("Could not send reply (cloud backend offline).");
    } finally {
      setSending(false);
    }
  }

  async function simulate() {
    if (!simText.trim()) {
      toast.error("Enter a message to simulate.");
      return;
    }
    setSimBusy(true);
    try {
      const res = await authFetch("/api/channels/simulate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          channel: simChannel,
          venue,
          from: simFrom,
          name: simName,
          text: simText,
        }),
      });
      const data = (await res.json()) as {
        conversationId?: string;
        reply?: string;
        tool?: string;
      };
      if (!res.ok || !data.conversationId) throw new Error("failed");
      toast.success(
        data.tool ? `Agent ran: ${data.tool}` : "Agent replied.",
      );
      setSimText("");
      await loadConversations();
      setSelectedId(data.conversationId);
      await loadMessages(data.conversationId);
    } catch {
      toast.error("Simulator failed (cloud backend offline).");
    } finally {
      setSimBusy(false);
    }
  }

  const online = health?.ok === true;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Inbox</h2>
          <p className="text-sm text-muted-foreground">
            Omnichannel AI agent — WhatsApp &amp; in-app web chat, 24/7 on the
            edge, replies persisted in PostgreSQL. Staff numbers unlock full CRM
            control.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={enableAlerts}
            disabled={pushBusy}
          >
            <Bell className="h-3.5 w-3.5" />
            {pushBusy ? "Enabling..." : "Enable alerts"}
          </Button>
          {online ? (
            <Badge className="gap-1 bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
              <Cloud className="h-3.5 w-3.5" /> Agent online
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
      </div>

      <Card className="border-slate-200 bg-white/90 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-violet-500" /> Simulate an inbound
            message
          </CardTitle>
          <CardDescription>
            Drives the exact same agent pipeline as a real inbound message on any
            channel — no provider account needed. Try "book 4 tonight at 8", or
            use a staff WhatsApp number for "covers today", "top spenders".
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-[130px_150px_150px_1fr_auto]">
            <select
              value={simChannel}
              onChange={(event) => {
                const next = event.target.value;
                setSimChannel(next);
                const defaults: Record<string, string> = {
                  whatsapp: "+254712345678",
                  sms: "254720123456",
                  web: "sim-web",
                  telegram: "555777",
                  instagram: "17900042",
                };
                setSimFrom(defaults[next] ?? "");
              }}
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm"
            >
              <option value="whatsapp">WhatsApp</option>
              <option value="web">Web chat</option>
              <option value="telegram">Telegram</option>
              <option value="instagram">Instagram</option>
              <option value="sms">SMS</option>
            </select>
            <Input
              value={simFrom}
              onChange={(event) => setSimFrom(event.target.value)}
              placeholder="from id"
            />
            <Input
              value={simName}
              onChange={(event) => setSimName(event.target.value)}
              placeholder="Name"
            />
            <Input
              value={simText}
              onChange={(event) => setSimText(event.target.value)}
              placeholder="Message text..."
              onKeyDown={(event) => {
                if (event.key === "Enter") simulate();
              }}
            />
            <Button type="button" onClick={simulate} disabled={simBusy}>
              <Send className="mr-1 h-3.5 w-3.5" />
              {simBusy ? "Sending..." : "Send"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <Card className="border-slate-200 bg-white/90 shadow-sm">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-semibold">
              Conversations
            </CardTitle>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => loadConversations()}
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-1 px-2">
            {channelsPresent.length > 1 && (
              <div className="flex flex-wrap gap-1 px-1 pb-1">
                {["all", ...channelsPresent].map((ch) => (
                  <button
                    key={ch}
                    type="button"
                    onClick={() => setChannelFilter(ch)}
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[11px] capitalize transition",
                      channelFilter === ch
                        ? "bg-slate-900 text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                    )}
                  >
                    {ch === "all" ? "All" : channelMeta(ch).label}
                  </button>
                ))}
              </div>
            )}
            {visibleConversations.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                No conversations yet. Simulate one above.
              </p>
            ) : (
              visibleConversations.map((conversation) => {
                const meta = channelMeta(conversation.channel);
                const ChannelIcon = meta.icon;
                return (
                  <button
                    key={conversation.id}
                    type="button"
                    onClick={() => setSelectedId(conversation.id)}
                    className={cn(
                      "w-full rounded-lg px-3 py-2 text-left transition",
                      selectedId === conversation.id
                        ? "bg-slate-100"
                        : "hover:bg-slate-50",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-slate-900">
                        {conversation.name ?? conversation.wa_id}
                      </span>
                      <div className="flex shrink-0 items-center gap-1">
                        <span
                          className={cn(
                            "flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px]",
                            meta.className,
                          )}
                        >
                          <ChannelIcon className="h-2.5 w-2.5" />
                          {meta.label}
                        </span>
                        <Badge
                          className={cn(
                            "text-[10px] capitalize",
                            ROLE_STYLES[conversation.role] ??
                              ROLE_STYLES.customer,
                          )}
                        >
                          {conversation.role}
                        </Badge>
                      </div>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-muted-foreground">
                        {conversation.last_message ?? "—"}
                      </span>
                      {conversation.status === "escalated" && (
                        <span className="shrink-0 text-[10px] font-semibold text-amber-600">
                          ESCALATED
                        </span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card className="flex min-h-[420px] flex-col border-slate-200 bg-white/90 shadow-sm">
          {selected ? (
            <>
              <CardHeader className="border-b border-slate-100 py-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <UserRound className="h-4 w-4 text-slate-500" />
                  {selected.name ?? selected.wa_id}
                  <span className="text-xs font-normal text-muted-foreground">
                    {selected.wa_id}
                  </span>
                  {selected.status === "escalated" && (
                    <Badge className="ml-auto bg-amber-100 text-amber-700 hover:bg-amber-100">
                      Escalated
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <div
                ref={threadRef}
                className="flex-1 space-y-3 overflow-y-auto p-4"
              >
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={cn(
                      "flex flex-col",
                      message.direction === "inbound"
                        ? "items-start"
                        : "items-end",
                    )}
                  >
                    <div
                      className={cn(
                        "max-w-[80%] rounded-2xl px-3 py-2 text-sm",
                        message.direction === "inbound"
                          ? "rounded-tl-sm bg-slate-100 text-slate-900"
                          : "rounded-tr-sm bg-emerald-600 text-white",
                      )}
                    >
                      {message.body}
                    </div>
                    <div className="mt-1 flex items-center gap-1 px-1 text-[10px] text-muted-foreground">
                      {message.direction === "outbound" &&
                        (message.ai ? (
                          <span className="flex items-center gap-0.5">
                            <Bot className="h-3 w-3" /> AI
                            {message.tool ? ` · ${message.tool}` : ""}
                          </span>
                        ) : (
                          <span>Staff</span>
                        ))}
                      <span>{timeLabel(message.created_at)}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="border-t border-slate-100 p-3">
                <div className="flex gap-2">
                  <Input
                    value={reply}
                    onChange={(event) => setReply(event.target.value)}
                    placeholder="Reply as staff (takes over from the AI)..."
                    onKeyDown={(event) => {
                      if (event.key === "Enter") sendReply();
                    }}
                  />
                  <Button
                    type="button"
                    onClick={sendReply}
                    disabled={sending || !reply.trim()}
                  >
                    <Send className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-10 text-center text-muted-foreground">
              <MessageSquare className="h-8 w-8 opacity-40" />
              <p className="text-sm">Select a conversation to view the thread.</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
