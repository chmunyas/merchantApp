import { createFileRoute } from "@tanstack/react-router";
import { Gift, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

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
import { getCurrentVenueId } from "@/lib/tenant-store";

export const Route = createFileRoute("/dashboard/rewards")({
  component: RewardsPage,
});

type Reward = {
  id: string;
  name: string;
  description: string | null;
  pointsCost: number;
  active: boolean;
};

function RewardsPage() {
  const venue = useMemo(() => getCurrentVenueId(), []);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pointsCost, setPointsCost] = useState("100");

  async function load() {
    try {
      const res = await authFetch(`/api/rewards?venue=${venue}`);
      const data = (await res.json()) as { rewards?: Reward[] };
      setRewards(data.rewards ?? []);
    } catch {
      setRewards([]);
      toast.error("Could not load rewards.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venue]);

  async function addReward() {
    const cost = Number(pointsCost);
    if (!name.trim() || !Number.isInteger(cost) || cost <= 0) {
      toast.error("Add a reward name and a positive points cost.");
      return;
    }
    setBusy(true);
    try {
      const res = await authFetch(`/api/rewards?venue=${venue}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          points_cost: cost,
        }),
      });
      if (!res.ok) throw new Error("failed");
      toast.success("Reward added.");
      setName("");
      setDescription("");
      setPointsCost("100");
      await load();
    } catch {
      toast.error("Could not add reward.");
    } finally {
      setBusy(false);
    }
  }

  async function updateReward(reward: Reward) {
    setBusy(true);
    try {
      const res = await authFetch(`/api/rewards/${reward.id}?venue=${venue}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: reward.name,
          description: reward.description,
          points_cost: reward.pointsCost,
          active: reward.active,
        }),
      });
      if (!res.ok) throw new Error("failed");
      toast.success("Reward saved.");
      await load();
    } catch {
      toast.error("Could not save reward.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteReward(id: string) {
    setBusy(true);
    try {
      const res = await authFetch(`/api/rewards/${id}?venue=${venue}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("failed");
      toast.success("Reward deleted.");
      await load();
    } catch {
      toast.error("Could not delete reward.");
    } finally {
      setBusy(false);
    }
  }

  function patchLocal(id: string, patch: Partial<Reward>) {
    setRewards((current) =>
      current.map((reward) =>
        reward.id === id ? { ...reward, ...patch } : reward,
      ),
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">
            Rewards catalogue
          </h2>
          <p className="text-sm text-muted-foreground">
            Create points-based offers customers can redeem from their portal.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      <Card className="border-slate-200 bg-white/90 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Plus className="h-4 w-4 text-emerald-500" /> Add reward
          </CardTitle>
          <CardDescription>
            Points are plain integers and are deducted at redemption.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-[1fr_1fr_140px_auto]">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Reward name"
          />
          <Input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Description"
          />
          <Input
            value={pointsCost}
            onChange={(event) => setPointsCost(event.target.value.replace(/\D/g, ""))}
            inputMode="numeric"
            placeholder="Points"
          />
          <Button type="button" onClick={addReward} disabled={busy}>
            <Gift className="h-3.5 w-3.5" /> Add
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-3">
        {loading ? (
          <Card className="border-slate-200 bg-white/60">
            <CardContent className="p-6 text-center text-sm text-slate-500">
              Loading rewards…
            </CardContent>
          </Card>
        ) : rewards.length === 0 ? (
          <Card className="border-slate-200 bg-white/60">
            <CardContent className="p-6 text-center text-sm text-slate-500">
              No rewards yet.
            </CardContent>
          </Card>
        ) : (
          rewards.map((reward) => (
            <Card key={reward.id} className="border-slate-200 bg-white/90 shadow-sm">
              <CardContent className="grid gap-3 p-4 lg:grid-cols-[1fr_1fr_130px_auto_auto]">
                <Input
                  value={reward.name}
                  onChange={(event) => patchLocal(reward.id, { name: event.target.value })}
                  placeholder="Reward name"
                />
                <Input
                  value={reward.description ?? ""}
                  onChange={(event) =>
                    patchLocal(reward.id, { description: event.target.value })
                  }
                  placeholder="Description"
                />
                <Input
                  value={String(reward.pointsCost)}
                  onChange={(event) =>
                    patchLocal(reward.id, {
                      pointsCost: Number(event.target.value.replace(/\D/g, "") || 0),
                    })
                  }
                  inputMode="numeric"
                />
                <Button
                  type="button"
                  variant={reward.active ? "outline" : "secondary"}
                  onClick={() => patchLocal(reward.id, { active: !reward.active })}
                >
                  {reward.active ? "Active" : "Inactive"}
                </Button>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => updateReward(reward)}
                    disabled={busy}
                  >
                    <Save className="h-3.5 w-3.5" /> Save
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-red-600 hover:text-red-700"
                    onClick={() => deleteReward(reward.id)}
                    disabled={busy}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
