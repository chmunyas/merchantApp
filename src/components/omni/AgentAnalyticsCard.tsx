import { Bot, MessageSquare, TrendingUp, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { getCurrentVenueId } from "@/lib/merchant-dashboard";

type AgentStats = {
  byChannel: Array<{ channel: string; conversations: number }>;
  messages: {
    total: number;
    inbound: number;
    ai_replies: number;
    human_replies: number;
  };
  tools: Array<{ tool: string; count: number }>;
  conversations: { total: number; escalated: number };
  broadcasts: number;
  escalationRate: number;
  automationRate: number;
};

// Agent & channel performance from the omnichannel event store. Self-contained
// so it can drop into the analytics page without touching existing charts.
export function AgentAnalyticsCard() {
  const venue = useMemo(() => getCurrentVenueId(), []);
  const [stats, setStats] = useState<AgentStats | null>(null);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/analytics/agent?venue=${venue}`);
        if (!res.ok) throw new Error("offline");
        const data = (await res.json()) as AgentStats;
        if (active) setStats(data);
      } catch {
        if (active) setOnline(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [venue]);

  if (!online) return null;
  if (!stats) return null;

  const metrics = [
    {
      label: "Conversations",
      value: stats.conversations.total,
      icon: MessageSquare,
      hint: `${stats.byChannel.length} channels`,
    },
    {
      label: "AI automation",
      value: `${stats.automationRate}%`,
      icon: Bot,
      hint: `${stats.messages.ai_replies} AI · ${stats.messages.human_replies} human`,
    },
    {
      label: "Escalation rate",
      value: `${stats.escalationRate}%`,
      icon: TrendingUp,
      hint: `${stats.conversations.escalated} to a human`,
    },
    {
      label: "Broadcasts sent",
      value: stats.broadcasts,
      icon: Users,
      hint: `${stats.messages.total} messages total`,
    },
  ];

  return (
    <div className="rounded-2xl border border-slate-200 bg-white/90 p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <Bot className="h-4 w-4 text-violet-500" />
        <h3 className="text-base font-semibold text-slate-950">
          AI agent &amp; channels
        </h3>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <div
              key={metric.label}
              className="rounded-xl border border-slate-100 bg-slate-50 p-3"
            >
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Icon className="h-3.5 w-3.5" />
                {metric.label}
              </div>
              <p className="mt-1 text-2xl font-bold text-slate-900">
                {metric.value}
              </p>
              <p className="text-[11px] text-muted-foreground">{metric.hint}</p>
            </div>
          );
        })}
      </div>

      {(stats.byChannel.length > 0 || stats.tools.length > 0) && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-2 text-xs font-semibold text-slate-500">
              By channel
            </p>
            <div className="space-y-1">
              {stats.byChannel.map((row) => (
                <div
                  key={row.channel}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="capitalize text-slate-700">
                    {row.channel}
                  </span>
                  <span className="font-medium text-slate-900">
                    {row.conversations}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold text-slate-500">
              Top agent tools
            </p>
            <div className="space-y-1">
              {stats.tools.slice(0, 5).map((row) => (
                <div
                  key={row.tool}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="text-slate-700">{row.tool}</span>
                  <span className="font-medium text-slate-900">
                    {row.count}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
