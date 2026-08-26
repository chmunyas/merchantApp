import { createFileRoute } from "@tanstack/react-router";
import {
  Megaphone,
  MessageSquare,
  Play,
  Send,
  Workflow as WorkflowIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import type {
  Campaign,
  CampaignSegment,
  LoyaltyCustomer,
  MessageChannel,
  MessageLogEntry,
  Reservation,
  Workflow,
  WorkflowTrigger,
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
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  ensureMerchantDemoData,
  getCampaignRecipients,
  matchReservationsForTrigger,
  renderTemplate,
  saveMerchantCampaigns,
  saveMerchantMessageLog,
  saveMerchantWorkflows,
} from "@/lib/merchant-dashboard";
import { authFetch } from "@/lib/auth";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/automations")({
  component: DashboardAutomationsPage,
});

type TabKey = "workflows" | "campaigns" | "activity";

const TAB_OPTIONS: Array<{ key: TabKey; label: string }> = [
  { key: "workflows", label: "Workflows" },
  { key: "campaigns", label: "Campaigns" },
  { key: "activity", label: "Activity" },
];

const TRIGGERS: Array<{ value: WorkflowTrigger; label: string }> = [
  { value: "booking_created", label: "When a booking is created" },
  { value: "reminder", label: "Reminder (same day)" },
  { value: "post_visit", label: "After the visit" },
  { value: "no_show", label: "On a no-show" },
];

const SEGMENTS: Array<{ value: CampaignSegment; label: string }> = [
  { value: "all", label: "All contacts" },
  { value: "gold_plus", label: "Gold & Platinum" },
  { value: "lapsed", label: "Lapsed (30+ days)" },
];

const CHANNELS: MessageChannel[] = ["sms", "whatsapp", "email"];

const CHANNEL_STYLES: Record<MessageChannel, string> = {
  sms: "bg-blue-100 text-blue-700",
  whatsapp: "bg-emerald-100 text-emerald-700",
  email: "bg-violet-100 text-violet-700",
};

function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function createEmptyWorkflow(): Workflow {
  return {
    id: createId("wf"),
    name: "",
    trigger: "booking_created",
    channel: "sms",
    message: "",
    active: true,
  };
}

function createEmptyCampaign(): Campaign {
  return {
    id: createId("camp"),
    name: "",
    segment: "all",
    channel: "sms",
    message: "",
    status: "draft",
  };
}

const selectClass =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300";

function DashboardAutomationsPage() {
  const [hydrated, setHydrated] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("workflows");
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [messageLog, setMessageLog] = useState<MessageLogEntry[]>([]);
  const [customers, setCustomers] = useState<LoyaltyCustomer[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [venue, setVenue] = useState("our venue");
  const [workflowDraft, setWorkflowDraft] = useState<Workflow | null>(null);
  const [campaignDraft, setCampaignDraft] = useState<Campaign | null>(null);

  useEffect(() => {
    const snapshot = ensureMerchantDemoData();
    setWorkflows(snapshot.workflows);
    setCampaigns(snapshot.campaigns);
    setMessageLog(snapshot.messageLog);
    setCustomers(snapshot.loyaltyCustomers);
    setReservations(snapshot.reservations);
    setVenue(snapshot.settings.businessProfile?.name ?? "our venue");
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveMerchantWorkflows(workflows);
  }, [hydrated, workflows]);

  useEffect(() => {
    if (!hydrated) return;
    saveMerchantCampaigns(campaigns);
  }, [campaigns, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    saveMerchantMessageLog(messageLog);
  }, [hydrated, messageLog]);

  const sampleVars = useMemo(
    () => ({
      name: "Wanjiru",
      date: todayISO(),
      time: "19:30",
      covers: 6,
      venue,
    }),
    [venue],
  );

  function handleSaveWorkflow() {
    if (!workflowDraft) return;
    if (!workflowDraft.name.trim() || !workflowDraft.message.trim()) {
      toast.error("Give the workflow a name and a message.");
      return;
    }
    setWorkflows((current) => {
      const exists = current.some((w) => w.id === workflowDraft.id);
      return exists
        ? current.map((w) => (w.id === workflowDraft.id ? workflowDraft : w))
        : [...current, workflowDraft];
    });
    toast.success("Workflow saved.");
    setWorkflowDraft(null);
  }

  function handleRunWorkflows() {
    const today = todayISO();
    const entries: MessageLogEntry[] = [];
    for (const workflow of workflows.filter((w) => w.active)) {
      const matched = matchReservationsForTrigger(
        workflow.trigger,
        reservations,
        today,
      );
      for (const reservation of matched) {
        entries.push({
          id: createId("msg"),
          channel: workflow.channel,
          to:
            reservation.customerName +
            (reservation.phone ? ` (${reservation.phone})` : ""),
          body: renderTemplate(workflow.message, {
            name: reservation.customerName,
            date: reservation.date,
            time: reservation.time,
            covers: reservation.covers,
            venue,
          }),
          source: workflow.name,
          createdAt: new Date().toISOString(),
        });
      }
    }
    if (entries.length === 0) {
      toast.error("No matching bookings today for the active workflows.");
      return;
    }
    setMessageLog((current) => [...entries, ...current]);
    toast.success(`Queued ${entries.length} message(s).`);
    setActiveTab("activity");
  }

  function handleSaveCampaign() {
    if (!campaignDraft) return;
    if (!campaignDraft.name.trim() || !campaignDraft.message.trim()) {
      toast.error("Give the campaign a name and a message.");
      return;
    }
    setCampaigns((current) => {
      const exists = current.some((c) => c.id === campaignDraft.id);
      return exists
        ? current.map((c) => (c.id === campaignDraft.id ? campaignDraft : c))
        : [...current, campaignDraft];
    });
    toast.success("Campaign saved.");
    setCampaignDraft(null);
  }

  async function handleSendCampaign(campaign: Campaign) {
    const recipients = getCampaignRecipients(campaign.segment, customers);
    if (recipients.length === 0) {
      toast.error("No contacts in this segment.");
      return;
    }
    try {
      const res = await authFetch(`/api/broadcast?venue=${venue}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `campaign:${campaign.id}:${crypto.randomUUID()}`,
        },
        body: JSON.stringify({
          venue,
          segment: campaign.segment,
          channel: campaign.channel,
          message: campaign.message,
        }),
      });
      if (res.ok) {
        const stats = (await res.json()) as {
          total?: number;
          queued?: number;
        };
        setCampaigns((current) =>
          current.map((entry) =>
            entry.id === campaign.id
              ? { ...entry, status: "draft", recipients: stats.total ?? recipients.length }
              : entry,
          ),
        );
        toast.success(`Queued ${stats.queued ?? 0} of ${stats.total ?? recipients.length} recipient(s).`);
        setActiveTab("activity");
      } else {
        toast.error("Campaign was not queued.");
      }
    } catch {
      toast.error("Campaign was not queued.");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {TAB_OPTIONS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "rounded-full px-4 py-2 text-sm font-medium transition",
                activeTab === tab.key
                  ? "bg-slate-900 text-white"
                  : "bg-white text-slate-600 hover:bg-slate-100",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <Badge
          variant="outline"
          className="border-amber-200 text-amber-700"
        >
          Simulated — connect an SMS/WhatsApp/email provider to send for real
        </Badge>
      </div>

      {activeTab === "workflows" ? (
        <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <Card className="border-slate-200 bg-white/90 shadow-sm">
            <CardHeader>
              <CardTitle>
                {workflowDraft && workflows.some((w) => w.id === workflowDraft.id)
                  ? "Edit workflow"
                  : "Create workflow"}
              </CardTitle>
              <CardDescription>
                Automatically message guests on booking events.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <Field label="Name">
                  <Input
                    value={workflowDraft?.name ?? ""}
                    onChange={(event) =>
                      setWorkflowDraft((current) => ({
                        ...(current ?? createEmptyWorkflow()),
                        name: event.target.value,
                      }))
                    }
                    placeholder="Booking confirmation"
                  />
                </Field>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Trigger">
                    <select
                      className={selectClass}
                      value={workflowDraft?.trigger ?? "booking_created"}
                      onChange={(event) =>
                        setWorkflowDraft((current) => ({
                          ...(current ?? createEmptyWorkflow()),
                          trigger: event.target.value as WorkflowTrigger,
                        }))
                      }
                    >
                      {TRIGGERS.map((trigger) => (
                        <option key={trigger.value} value={trigger.value}>
                          {trigger.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Channel">
                    <select
                      className={selectClass}
                      value={workflowDraft?.channel ?? "sms"}
                      onChange={(event) =>
                        setWorkflowDraft((current) => ({
                          ...(current ?? createEmptyWorkflow()),
                          channel: event.target.value as MessageChannel,
                        }))
                      }
                    >
                      {CHANNELS.map((channel) => (
                        <option key={channel} value={channel}>
                          {channel}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field label="Message">
                  <Textarea
                    value={workflowDraft?.message ?? ""}
                    onChange={(event) =>
                      setWorkflowDraft((current) => ({
                        ...(current ?? createEmptyWorkflow()),
                        message: event.target.value,
                      }))
                    }
                    placeholder="Hi {{name}}, your table on {{date}} {{time}} is confirmed."
                  />
                </Field>
                <p className="text-xs text-slate-500">
                  Variables: {"{{name}} {{date}} {{time}} {{covers}} {{venue}}"}
                </p>
                {workflowDraft?.message ? (
                  <div className="rounded-2xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
                    <span className="text-xs font-semibold text-slate-400">
                      Preview
                    </span>
                    <p className="mt-1">
                      {renderTemplate(workflowDraft.message, sampleVars)}
                    </p>
                  </div>
                ) : null}
                <div className="flex justify-end gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setWorkflowDraft(createEmptyWorkflow())}
                  >
                    Reset
                  </Button>
                  <Button type="button" onClick={handleSaveWorkflow}>
                    Save workflow
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-800">
                Workflows ({workflows.filter((w) => w.active).length} active)
              </h3>
              <Button type="button" variant="outline" onClick={handleRunWorkflows}>
                <Play className="mr-1 h-3.5 w-3.5" /> Run for today
              </Button>
            </div>
            {workflows.map((workflow) => (
              <Card
                key={workflow.id}
                className="border-slate-200 bg-white/90 shadow-sm"
              >
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="flex items-center gap-2 font-semibold text-slate-950">
                        <WorkflowIcon className="h-4 w-4 text-slate-400" />
                        {workflow.name}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {TRIGGERS.find((t) => t.value === workflow.trigger)
                          ?.label ?? workflow.trigger}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        className={cn(
                          "hover:opacity-100",
                          CHANNEL_STYLES[workflow.channel],
                        )}
                      >
                        {workflow.channel}
                      </Badge>
                      <Switch
                        checked={workflow.active}
                        onCheckedChange={(checked) =>
                          setWorkflows((current) =>
                            current.map((entry) =>
                              entry.id === workflow.id
                                ? { ...entry, active: checked }
                                : entry,
                            ),
                          )
                        }
                      />
                    </div>
                  </div>
                  <p className="rounded-2xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
                    {workflow.message}
                  </p>
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setWorkflowDraft(workflow)}
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="border-rose-200 text-rose-600 hover:bg-rose-50"
                      onClick={() =>
                        setWorkflows((current) =>
                          current.filter((entry) => entry.id !== workflow.id),
                        )
                      }
                    >
                      Delete
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ) : null}

      {activeTab === "campaigns" ? (
        <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <Card className="border-slate-200 bg-white/90 shadow-sm">
            <CardHeader>
              <CardTitle>
                {campaignDraft && campaigns.some((c) => c.id === campaignDraft.id)
                  ? "Edit campaign"
                  : "Create campaign"}
              </CardTitle>
              <CardDescription>
                Send a one-off promotion to a customer segment.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <Field label="Name">
                  <Input
                    value={campaignDraft?.name ?? ""}
                    onChange={(event) =>
                      setCampaignDraft((current) => ({
                        ...(current ?? createEmptyCampaign()),
                        name: event.target.value,
                      }))
                    }
                    placeholder="Weekend brunch offer"
                  />
                </Field>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Segment">
                    <select
                      className={selectClass}
                      value={campaignDraft?.segment ?? "all"}
                      onChange={(event) =>
                        setCampaignDraft((current) => ({
                          ...(current ?? createEmptyCampaign()),
                          segment: event.target.value as CampaignSegment,
                        }))
                      }
                    >
                      {SEGMENTS.map((segment) => (
                        <option key={segment.value} value={segment.value}>
                          {segment.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Channel">
                    <select
                      className={selectClass}
                      value={campaignDraft?.channel ?? "sms"}
                      onChange={(event) =>
                        setCampaignDraft((current) => ({
                          ...(current ?? createEmptyCampaign()),
                          channel: event.target.value as MessageChannel,
                        }))
                      }
                    >
                      {CHANNELS.map((channel) => (
                        <option key={channel} value={channel}>
                          {channel}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field label="Message">
                  <Textarea
                    value={campaignDraft?.message ?? ""}
                    onChange={(event) =>
                      setCampaignDraft((current) => ({
                        ...(current ?? createEmptyCampaign()),
                        message: event.target.value,
                      }))
                    }
                    placeholder="This weekend at {{venue}}: 2-for-1 cocktails!"
                  />
                </Field>
                <p className="text-xs text-slate-500">
                  Reaches{" "}
                  <span className="font-semibold text-slate-700">
                    {
                      getCampaignRecipients(
                        campaignDraft?.segment ?? "all",
                        customers,
                      ).length
                    }
                  </span>{" "}
                  contacts. Variables: {"{{name}} {{venue}}"}
                </p>
                <div className="flex justify-end gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setCampaignDraft(createEmptyCampaign())}
                  >
                    Reset
                  </Button>
                  <Button type="button" onClick={handleSaveCampaign}>
                    Save campaign
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-800">
              Campaigns ({campaigns.length})
            </h3>
            {campaigns.map((campaign) => (
              <Card
                key={campaign.id}
                className="border-slate-200 bg-white/90 shadow-sm"
              >
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="flex items-center gap-2 font-semibold text-slate-950">
                        <Megaphone className="h-4 w-4 text-slate-400" />
                        {campaign.name}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {SEGMENTS.find((s) => s.value === campaign.segment)
                          ?.label ?? campaign.segment}{" "}
                        ·{" "}
                        {getCampaignRecipients(campaign.segment, customers)
                          .length}{" "}
                        contacts
                      </p>
                    </div>
                    <Badge
                      className={cn(
                        "hover:opacity-100",
                        campaign.status === "sent"
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-slate-100 text-slate-600",
                      )}
                    >
                      {campaign.status === "sent"
                        ? `Sent · ${campaign.recipients ?? 0}`
                        : "Draft"}
                    </Badge>
                  </div>
                  <p className="rounded-2xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
                    {campaign.message}
                  </p>
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setCampaignDraft(campaign)}
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => handleSendCampaign(campaign)}
                    >
                      <Send className="mr-1 h-3.5 w-3.5" /> Send now
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ) : null}

      {activeTab === "activity" ? (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-800">
            Message activity ({messageLog.length})
          </h3>
          {messageLog.length === 0 ? (
            <Card className="border-dashed border-slate-300 bg-white/60">
              <CardContent className="p-6 text-center text-sm text-slate-500">
                No messages yet. Run a workflow or send a campaign to see the
                simulated log here.
              </CardContent>
            </Card>
          ) : (
            messageLog.map((entry) => (
              <Card
                key={entry.id}
                className="border-slate-200 bg-white/90 shadow-sm"
              >
                <CardContent className="space-y-2 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="flex items-center gap-2 text-sm font-medium text-slate-900">
                      <MessageSquare className="h-4 w-4 text-slate-400" />
                      {entry.to}
                    </p>
                    <Badge
                      className={cn("hover:opacity-100", CHANNEL_STYLES[entry.channel])}
                    >
                      {entry.channel}
                    </Badge>
                  </div>
                  <p className="text-sm text-slate-600">{entry.body}</p>
                  <p className="text-xs text-slate-400">
                    via {entry.source} ·{" "}
                    {new Date(entry.createdAt).toLocaleTimeString()}
                  </p>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      ) : null}
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
