import { createFileRoute } from "@tanstack/react-router";
import { Bot, Send, Sparkles, User } from "lucide-react";
import { useMemo, useState } from "react";

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
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/copilot")({
  component: DashboardCopilotPage,
});

type ChatMessage = {
  role: "user" | "assistant";
  body: string;
};

function DashboardCopilotPage() {
  const venue = useMemo(() => getCurrentVenueId(), []);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      body: "Hi, I'm your merchant copilot. Ask about today's sales, open orders, bookings, contacts, or ask me to create an invoice.",
    },
  ]);
  const [prompt, setPrompt] = useState("How are we doing today?");
  const [busy, setBusy] = useState(false);

  async function askCopilot() {
    const message = prompt.trim();
    if (!message || busy) return;
    setPrompt("");
    setBusy(true);
    setMessages((current) => [...current, { role: "user", body: message }]);
    try {
      const res = await authFetch(`/api/copilot?venue=${venue}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const data = (await res.json()) as { reply?: string };
      setMessages((current) => [
        ...current,
        { role: "assistant", body: data.reply ?? "I couldn't get a response." },
      ]);
    } catch {
      setMessages((current) => [
        ...current,
        { role: "assistant", body: "Cloud backend offline. Try again shortly." },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-950">
          <Sparkles className="h-5 w-5 text-violet-500" />
          Merchant copilot
        </h2>
        <p className="text-sm text-muted-foreground">
          An AI employee for daily ops — grounded in your venue data and able to
          execute staff actions.
        </p>
      </div>

      <Card className="min-h-[70vh] border-slate-200 bg-white/90 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bot className="h-4 w-4 text-emerald-600" />
            Operations chat
          </CardTitle>
          <CardDescription>
            Try "covers today", "new enquiries", "top spenders", or "create an
            invoice for 2500 to +254712345678".
          </CardDescription>
        </CardHeader>
        <CardContent className="flex min-h-[58vh] flex-col gap-4">
          <div className="flex-1 space-y-3 overflow-y-auto rounded-3xl bg-slate-50 p-3 sm:p-4">
            {messages.map((message, index) => (
              <div
                key={index}
                className={cn(
                  "flex",
                  message.role === "user" ? "justify-end" : "justify-start",
                )}
              >
                <div
                  className={cn(
                    "flex max-w-[88%] gap-2 rounded-3xl px-4 py-3 text-sm shadow-sm sm:max-w-[78%]",
                    message.role === "user"
                      ? "bg-emerald-600 text-white"
                      : "bg-white text-slate-800",
                  )}
                >
                  {message.role === "assistant" ? (
                    <Bot className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                  ) : (
                    <User className="mt-0.5 h-4 w-4 shrink-0" />
                  )}
                  <span className="whitespace-pre-wrap">{message.body}</span>
                </div>
              </div>
            ))}
            {busy ? (
              <div className="text-sm text-slate-400">Copilot is thinking…</div>
            ) : null}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Input
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Ask your AI employee..."
              onKeyDown={(event) => {
                if (event.key === "Enter") askCopilot();
              }}
            />
            <Button type="button" onClick={askCopilot} disabled={busy}>
              <Send className="mr-1 h-3.5 w-3.5" />
              {busy ? "Sending…" : "Send"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
