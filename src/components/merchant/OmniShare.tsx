import { Check, Loader2, MessageCircle, Send, Smartphone, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { authFetch } from "@/lib/auth";

type Channel = "whatsapp" | "telegram" | "sms";

// A reusable omnichannel share sheet. Sends a payment link / invoice / QR /
// booking / enquiry to a customer over the venue's configured WhatsApp, Telegram
// or SMS via POST /api/share, with a deep-link ("open in my own app") fallback.
export function OmniShare({
  open,
  onClose,
  title = "Share",
  message,
  link,
  defaultPhone = "",
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  message: string;
  link: string;
  defaultPhone?: string;
}) {
  const [channel, setChannel] = useState<Channel>("whatsapp");
  const [to, setTo] = useState(defaultPhone);
  const [sending, setSending] = useState(false);

  if (!open) return null;

  const digits = to.replace(/[^\d]/g, "");
  const deepLink =
    channel === "whatsapp"
      ? `https://wa.me/${digits}?text=${encodeURIComponent(`${message}\n\n${link}`)}`
      : channel === "telegram"
        ? `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(message)}`
        : `sms:${to}?body=${encodeURIComponent(`${message} ${link}`)}`;

  async function send() {
    if (!to.trim()) {
      toast.error("Enter a recipient.");
      return;
    }
    setSending(true);
    try {
      const res = await authFetch("/api/share", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channel, to, text: message, link, kind: "share" }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        delivery?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "failed");
      if (data.delivery === "sent") {
        toast.success(`Sent on ${channel}.`);
        onClose();
        return;
      }
      if (data.delivery === "suppressed") {
        toast.error("This customer has opted out.");
        return;
      }
      toast.info("Channel not fully configured here — opening your own app.");
      window.open(deepLink, "_blank");
    } catch {
      toast.info("Opening your own app to send.");
      window.open(deepLink, "_blank");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="absolute inset-0 z-[60] flex items-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full space-y-4 rounded-t-3xl bg-background p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <p className="font-bold">{title}</p>
          <button type="button" onClick={onClose} aria-label="Close">
            <X className="size-5 text-muted-foreground" />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {(
            [
              ["whatsapp", "WhatsApp", MessageCircle],
              ["telegram", "Telegram", Send],
              ["sms", "SMS", Smartphone],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setChannel(id)}
              className={`flex flex-col items-center gap-1 rounded-xl border py-2.5 text-[11px] font-medium transition-colors ${
                channel === id
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground"
              }`}
            >
              <Icon className="size-4" /> {label}
            </button>
          ))}
        </div>

        <input
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder={
            channel === "telegram"
              ? "Telegram chat id / @username"
              : "Phone e.g. +254712345678"
          }
          className="w-full rounded-xl border border-border bg-transparent px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
        />

        <div className="rounded-xl bg-muted p-3 text-xs text-muted-foreground">
          <p className="whitespace-pre-wrap">{message}</p>
          <p className="mt-1 break-all text-emerald-700">{link}</p>
        </div>

        <button
          type="button"
          onClick={send}
          disabled={sending}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-foreground py-3.5 text-sm font-bold text-background disabled:opacity-50"
        >
          {sending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Check className="size-4" />
          )}
          Send now
        </button>
        <a
          href={deepLink}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-center text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          or open in my own {channel === "sms" ? "messages" : channel} app
        </a>
      </div>
    </div>
  );
}
