import { MessageCircle, Send, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type ChatMessage = {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  ai?: boolean;
  created_at?: string;
};

const SESSION_KEY = "pesaswap.chat.session";

function getSessionId(): string {
  if (typeof window === "undefined") return "";
  let id = window.localStorage.getItem(SESSION_KEY);
  if (!id) {
    id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `s-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

// Floating in-app chat that runs the same AI agent pipeline as WhatsApp
// (channel = web). Anonymous session persists in localStorage; replies are
// pulled from the server. Fully self-contained and non-blocking.
export function ChatWidget({ venue = "main" }: { venue?: string }) {
  const [open, setOpen] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSessionId(getSessionId());
  }, []);

  async function loadMessages(id: string) {
    try {
      const res = await fetch(
        `/api/chat/messages?venue=${encodeURIComponent(venue)}&session=${encodeURIComponent(id)}`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as { messages?: ChatMessage[] };
      setMessages(data.messages ?? []);
    } catch {
      /* offline — keep current thread */
    }
  }

  useEffect(() => {
    if (!open || !sessionId) return;
    loadMessages(sessionId);
    const timer = setInterval(() => loadMessages(sessionId), 4000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sessionId, venue]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [messages, open]);

  async function send() {
    const body = text.trim();
    if (!body || !sessionId) return;
    setSending(true);
    setText("");
    setMessages((prev) => [
      ...prev,
      { id: `local-${Date.now()}`, direction: "inbound", body },
    ]);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ venue, sessionId, text: body }),
      });
      const data = (await res.json()) as { reply?: string };
      if (data.reply) {
        setMessages((prev) => [
          ...prev,
          {
            id: `reply-${Date.now()}`,
            direction: "outbound",
            body: data.reply as string,
            ai: true,
          },
        ]);
      }
      await loadMessages(sessionId);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          direction: "outbound",
          body: "We're briefly offline — please try again in a moment.",
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Chat with us"
        className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg transition hover:bg-emerald-700"
      >
        <MessageCircle className="h-6 w-6" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-50 flex h-[30rem] w-[22rem] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
      <div className="flex items-center justify-between bg-emerald-600 px-4 py-3 text-white">
        <div>
          <p className="text-sm font-semibold">Chat with us</p>
          <p className="text-[11px] opacity-90">Typically replies instantly</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close chat"
          className="rounded-full p-1 transition hover:bg-white/20"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div ref={threadRef} className="flex-1 space-y-2 overflow-y-auto bg-slate-50 p-3">
        {messages.length === 0 ? (
          <p className="mt-6 text-center text-xs text-slate-400">
            Ask us anything — book a table, check opening hours, or leave a
            message.
          </p>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={
                message.direction === "inbound"
                  ? "flex justify-end"
                  : "flex justify-start"
              }
            >
              <div
                className={
                  message.direction === "inbound"
                    ? "max-w-[80%] rounded-2xl rounded-br-sm bg-emerald-600 px-3 py-2 text-sm text-white"
                    : "max-w-[80%] rounded-2xl rounded-bl-sm bg-white px-3 py-2 text-sm text-slate-800 shadow-sm"
                }
              >
                {message.body}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-slate-100 p-2">
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") send();
          }}
          placeholder="Type a message..."
          className="flex-1 rounded-full border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-500"
        />
        <button
          type="button"
          onClick={send}
          disabled={sending || !text.trim()}
          aria-label="Send"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-600 text-white transition hover:bg-emerald-700 disabled:opacity-50"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
