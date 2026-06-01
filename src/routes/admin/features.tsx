import { createFileRoute } from "@tanstack/react-router";
import { Check, Layers3, Lock, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ensureAdminDemoData,
  getFeatureFlags,
  getGlobalFeatureState,
  getMerchants,
  getTierDefaults,
  logActivity,
  saveMerchant,
  setGlobalFeatureState,
  setMerchantFeature,
  type FeatureFlag,
  type MerchantAccount,
} from "@/lib/admin";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/features")({
  component: AdminFeaturesPage,
});

const tierOrder = ["free", "starter", "growth", "enterprise"] as const;

function AdminFeaturesPage() {
  const [merchants, setMerchants] = useState<MerchantAccount[]>([]);
  const [globalState, setGlobalState] = useState<Record<string, boolean>>({});
  const [activeCategory, setActiveCategory] = useState("Payments");

  const featureFlags = useMemo(() => getFeatureFlags(), []);

  useEffect(() => {
    refresh();
  }, []);

  function refresh() {
    ensureAdminDemoData();
    setMerchants(getMerchants());
    setGlobalState(getGlobalFeatureState());
  }

  const categories = useMemo(
    () => Array.from(new Set(featureFlags.map((feature) => feature.category))),
    [featureFlags],
  );

  const visibleFeatures = useMemo(
    () => featureFlags.filter((feature) => feature.category === activeCategory),
    [activeCategory, featureFlags],
  );

  const usage = useMemo(
    () =>
      featureFlags.map((feature) => ({
        feature,
        merchantCount: merchants.filter(
          (merchant) => merchant.features[feature.key],
        ).length,
        effectiveCount: merchants.filter(
          (merchant) =>
            merchant.features[feature.key] && globalState[feature.key],
        ).length,
      })),
    [featureFlags, globalState, merchants],
  );

  const globalEnabledCount = featureFlags.filter(
    (feature) => globalState[feature.key],
  ).length;
  const growthBnplCount = merchants.filter(
    (merchant) =>
      (merchant.tier === "growth" || merchant.tier === "enterprise") &&
      merchant.features["payments.bnpl"],
  ).length;

  function handleGlobalToggle(feature: FeatureFlag, enabled: boolean) {
    setGlobalFeatureState(feature.key, enabled);
    logActivity(
      enabled ? "feature_enabled" : "feature_disabled",
      `${feature.name} ${enabled ? "enabled" : "disabled"} platform-wide.`,
    );
    refresh();
  }

  function handleMerchantToggle(
    merchant: MerchantAccount,
    feature: FeatureFlag,
    enabled: boolean,
  ) {
    setMerchantFeature(merchant.id, feature.key, enabled);
    logActivity(
      enabled ? "feature_enabled" : "feature_disabled",
      `${feature.name} ${enabled ? "enabled" : "disabled"} for ${merchant.businessName}.`,
      merchant.id,
    );
    refresh();
  }

  function enableBnplForGrowthPlus() {
    setGlobalFeatureState("payments.bnpl", true);
    merchants.forEach((merchant) => {
      if (merchant.tier === "growth" || merchant.tier === "enterprise") {
        setMerchantFeature(merchant.id, "payments.bnpl", true);
      }
    });
    logActivity(
      "feature_enabled",
      "BNPL enabled for all Growth+ merchants and switched on globally.",
    );
    refresh();
    toast.success("BNPL enabled for Growth+ merchants");
  }

  function resetTierDefaults(merchant: MerchantAccount) {
    saveMerchant({
      ...merchant,
      features: getTierDefaults(merchant.tier),
    });
    logActivity(
      "settings_changed",
      `Feature set reset to ${merchant.tier} defaults for ${merchant.businessName}.`,
      merchant.id,
    );
    refresh();
    toast.success("Tier defaults restored");
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-4">
        <SummaryCard
          label="Global flags on"
          value={`${globalEnabledCount}/${featureFlags.length}`}
        />
        <SummaryCard
          label="Flags globally off"
          value={`${featureFlags.length - globalEnabledCount}`}
        />
        <SummaryCard
          label="Growth+ BNPL merchants"
          value={growthBnplCount.toString()}
        />
        <SummaryCard
          label="Managed merchants"
          value={merchants.length.toString()}
        />
      </div>

      <section className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-2xl font-semibold text-white">
              Global feature flags
            </h3>
            <p className="mt-2 text-sm text-slate-400">
              Platform-wide switches gate every merchant, regardless of their
              tier entitlements.
            </p>
          </div>
          <Button
            className="rounded-xl bg-violet-500 text-white hover:bg-violet-400"
            onClick={enableBnplForGrowthPlus}
          >
            <Sparkles className="h-4 w-4" /> Enable BNPL for all Growth+
            merchants
          </Button>
        </div>
        <div className="mt-6 grid gap-4 xl:grid-cols-2">
          {categories.map((category) => (
            <div
              key={category}
              className="rounded-3xl border border-slate-800 bg-slate-950/70 p-5"
            >
              <div className="flex items-center gap-3">
                <Layers3 className="h-4 w-4 text-violet-300" />
                <h4 className="text-lg font-semibold text-white">{category}</h4>
              </div>
              <div className="mt-4 space-y-3">
                {featureFlags
                  .filter((feature) => feature.category === category)
                  .map((feature) => (
                    <div
                      key={feature.key}
                      className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3 md:flex-row md:items-center md:justify-between"
                    >
                      <div>
                        <div className="font-medium text-slate-100">
                          {feature.name}
                        </div>
                        <div className="text-sm text-slate-400">
                          {feature.description}
                        </div>
                        <div className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-500">
                          Default {feature.defaultEnabled ? "on" : "off"} · Min
                          tier {feature.tierMinimum}
                        </div>
                      </div>
                      <Switch
                        checked={Boolean(globalState[feature.key])}
                        onCheckedChange={(checked) =>
                          handleGlobalToggle(feature, checked)
                        }
                      />
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-2xl font-semibold text-white">
              Per-merchant overrides
            </h3>
            <p className="mt-2 text-sm text-slate-400">
              Each switch below adjusts merchant access. Global off means the
              feature stays unavailable.
            </p>
          </div>
          <Tabs value={activeCategory} onValueChange={setActiveCategory}>
            <TabsList className="flex-wrap bg-slate-950 text-slate-500">
              {categories.map((category) => (
                <TabsTrigger
                  key={category}
                  value={category}
                  className="data-[state=active]:bg-slate-800 data-[state=active]:text-white"
                >
                  {category}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        <ScrollArea className="mt-6 w-full rounded-3xl border border-slate-800 bg-slate-950/70">
          <div className="min-w-[950px]">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-800 hover:bg-transparent">
                  <TableHead className="px-4 text-slate-400">
                    Merchant
                  </TableHead>
                  <TableHead className="text-slate-400">Tier</TableHead>
                  <TableHead className="text-slate-400">Status</TableHead>
                  {visibleFeatures.map((feature) => (
                    <TableHead key={feature.key} className="text-slate-400">
                      <div className="min-w-36">
                        <div>{feature.name}</div>
                        <div className="mt-1 text-xs font-normal text-slate-600">
                          {feature.key}
                        </div>
                      </div>
                    </TableHead>
                  ))}
                  <TableHead className="pr-4 text-right text-slate-400">
                    Reset
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {merchants.map((merchant, index) => (
                  <TableRow
                    key={merchant.id}
                    className={cn(
                      "border-slate-800 hover:bg-slate-800/30",
                      index % 2 === 0 ? "bg-slate-900" : "bg-slate-950/40",
                    )}
                  >
                    <TableCell className="px-4">
                      <div>
                        <div className="font-medium text-slate-100">
                          {merchant.businessName}
                        </div>
                        <div className="text-xs text-slate-500">
                          {merchant.vertical}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="capitalize text-slate-300">
                      {merchant.tier}
                    </TableCell>
                    <TableCell>
                      <Badge className="rounded-full border border-slate-700 bg-slate-800 px-3 py-1 text-slate-200">
                        {merchant.status}
                      </Badge>
                    </TableCell>
                    {visibleFeatures.map((feature) => {
                      const globallyEnabled = Boolean(globalState[feature.key]);
                      const checked = Boolean(merchant.features[feature.key]);
                      return (
                        <TableCell key={feature.key}>
                          <div className="flex items-center gap-3">
                            <Switch
                              checked={checked}
                              disabled={!globallyEnabled}
                              onCheckedChange={(next) =>
                                handleMerchantToggle(merchant, feature, next)
                              }
                            />
                            {!globallyEnabled ? (
                              <Lock className="h-3.5 w-3.5 text-slate-500" />
                            ) : checked ? (
                              <Check className="h-3.5 w-3.5 text-emerald-300" />
                            ) : null}
                          </div>
                        </TableCell>
                      );
                    })}
                    <TableCell className="pr-4 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-xl border-slate-700 bg-slate-950 text-slate-100 hover:bg-slate-800"
                        onClick={() => resetTierDefaults(merchant)}
                      >
                        Restore tier
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </ScrollArea>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
          <h3 className="text-xl font-semibold text-white">
            Feature usage stats
          </h3>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {usage.map(({ feature, merchantCount, effectiveCount }) => (
              <div
                key={feature.key}
                className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4"
              >
                <div className="font-medium text-slate-100">{feature.name}</div>
                <div className="mt-1 text-sm text-slate-400">
                  {feature.description}
                </div>
                <div className="mt-4 flex items-center gap-3 text-sm">
                  <span className="rounded-full bg-slate-800 px-3 py-1 text-slate-200">
                    {merchantCount} merchants configured
                  </span>
                  <span className="rounded-full bg-violet-500/15 px-3 py-1 text-violet-200">
                    {effectiveCount} live
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
          <h3 className="text-xl font-semibold text-white">
            Tier-based defaults
          </h3>
          <div className="mt-5 space-y-4">
            {tierOrder.map((tier) => {
              const defaults = getTierDefaults(tier);
              const enabled = featureFlags.filter(
                (feature) => defaults[feature.key],
              );
              return (
                <div
                  key={tier}
                  className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-lg font-semibold capitalize text-white">
                      {tier}
                    </div>
                    <Badge className="rounded-full border border-violet-500/30 bg-violet-500/15 px-3 py-1 text-violet-100">
                      {enabled.length} included
                    </Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {enabled.map((feature) => (
                      <span
                        key={feature.key}
                        className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs text-slate-300"
                      >
                        {feature.key}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
      <div className="text-sm text-slate-400">{label}</div>
      <div className="mt-3 text-3xl font-semibold text-white">{value}</div>
    </div>
  );
}
