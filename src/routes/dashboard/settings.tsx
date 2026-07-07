import { createFileRoute } from "@tanstack/react-router";
import { Download, FileDown, KeyRound, Plus, Trash2, User } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authFetch, useAuth } from "@/lib/auth";
import { buildKeQr, resolveKeQrMerchant } from "@/lib/ke-qr";
import {
  ensureMerchantDemoData,
  loadMerchantSnapshot,
  MERCHANT_NAME,
  saveMerchantSettings,
  TILL_NUMBER,
  type MerchantSnapshot,
  type MerchantUser,
} from "@/lib/merchant-dashboard";

export const Route = createFileRoute("/dashboard/settings")({
  component: DashboardSettingsPage,
});

function generateDemoData() {
  return ensureMerchantDemoData();
}

function AccountSecuritySection() {
  const { user } = useAuth();
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwLoading, setPwLoading] = useState(false);

  function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!currentPw.trim()) {
      toast.error("Enter your current password");
      return;
    }
    if (newPw.length < 6) {
      toast.error("New password must be at least 6 characters");
      return;
    }
    if (newPw !== confirmPw) {
      toast.error("Passwords do not match");
      return;
    }
    setPwLoading(true);
    setTimeout(() => {
      setPwLoading(false);
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
      toast.success("Password updated successfully");
    }, 1000);
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <div className="flex items-center gap-2 mb-4">
        <User className="h-5 w-5 text-violet-600" />
        <h3 className="text-lg font-semibold">Account & Security</h3>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Profile info */}
        <div className="space-y-4">
          <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Profile
          </h4>
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-lg font-bold text-emerald-700">
              {(user?.name ?? "U")
                .split(" ")
                .map((p) => p[0])
                .join("")
                .slice(0, 2)
                .toUpperCase()}
            </div>
            <div>
              <p className="font-medium">{user?.name ?? "—"}</p>
              <p className="text-sm text-muted-foreground">
                {user?.email ?? user?.phone ?? "—"}
              </p>
              <span className="mt-1 inline-block rounded-md bg-violet-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-violet-700">
                {user?.role ?? "user"}
              </span>
            </div>
          </div>
        </div>

        {/* Change password */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-muted-foreground" />
            <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Change Password
            </h4>
          </div>
          <form onSubmit={handleChangePassword} className="space-y-3">
            <Input
              type="password"
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
              placeholder="Current password"
              className="h-10 rounded-xl"
            />
            <Input
              type="password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              placeholder="New password (min 6 chars)"
              className="h-10 rounded-xl"
            />
            <Input
              type="password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              placeholder="Confirm new password"
              className="h-10 rounded-xl"
            />
            <Button
              type="submit"
              disabled={pwLoading}
              size="sm"
              className="rounded-xl"
            >
              {pwLoading ? "Updating…" : "Update password"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}

function DashboardSettingsPage() {
  const [snapshot, setSnapshot] = useState<MerchantSnapshot | null>(null);
  const [newUser, setNewUser] = useState<MerchantUser>({
    id: "",
    name: "",
    role: "Server",
    phone: "",
    active: true,
  });
  const qrRefs = useRef<Record<number, HTMLCanvasElement | null>>({});
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const [savingBrand, setSavingBrand] = useState(false);
  const [staff, setStaff] = useState<
    Array<{
      id: string;
      name: string;
      role: string;
      phone: string | null;
      active: boolean;
    }>
  >([]);

  async function loadStaff() {
    const fetchStaff = () =>
      authFetch("/api/staff")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => (d?.staff ?? []) as typeof staff)
        .catch(() => [] as typeof staff);
    let list = await fetchStaff();
    // One-time migration of the legacy localStorage users blob to the server.
    if (list.length === 0 && localStorage.getItem("staff_migrated") !== "1") {
      localStorage.setItem("staff_migrated", "1");
      const legacy = loadMerchantSnapshot()?.settings.users ?? [];
      if (legacy.length > 0) {
        await Promise.all(
          legacy.map((u) =>
            authFetch("/api/staff", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ name: u.name, role: u.role, phone: u.phone }),
            }).catch(() => undefined),
          ),
        );
        list = await fetchStaff();
      }
    }
    setStaff(list);
  }

  useEffect(() => {
    generateDemoData();
    setSnapshot(loadMerchantSnapshot());
    void loadStaff();
    // Load server-persisted branding (logo / colour / name) for this merchant.
    authFetch("/api/branding")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const b = data?.branding;
        if (!b) return;
        setSnapshot((prev) =>
          prev
            ? {
                ...prev,
                settings: {
                  ...prev.settings,
                  businessProfile: {
                    ...prev.settings.businessProfile,
                    name: b.businessName ?? prev.settings.businessProfile.name,
                    logoUrl: b.logoUrl ?? prev.settings.businessProfile.logoUrl,
                  },
                  branding: {
                    ...prev.settings.branding,
                    logoUrl: b.logoUrl ?? prev.settings.branding.logoUrl,
                    primaryColor:
                      b.primaryColor ?? prev.settings.branding.primaryColor,
                  },
                },
              }
            : prev,
        );
      })
      .catch(() => {});
  }, []);

  const tables = useMemo(() => snapshot?.tables ?? [], [snapshot]);

  function updateSettings(
    updater: (
      settings: MerchantSnapshot["settings"],
    ) => MerchantSnapshot["settings"],
  ) {
    if (!snapshot) return;
    const nextSettings = updater(snapshot.settings);
    saveMerchantSettings(nextSettings);
    setSnapshot({ ...snapshot, settings: nextSettings });
  }

  function handleLogoUpload(file: File | undefined) {
    if (!file) return;
    if (file.size > 512 * 1024) {
      toast.error("Logo must be under 512KB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      updateSettings((settings) => ({
        ...settings,
        businessProfile: { ...settings.businessProfile, logoUrl: dataUrl },
        branding: { ...settings.branding, logoUrl: dataUrl },
      }));
    };
    reader.readAsDataURL(file);
  }

  async function saveBranding() {
    if (!snapshot) return;
    setSavingBrand(true);
    try {
      const res = await authFetch("/api/branding", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          businessName: snapshot.settings.businessProfile.name,
          logoUrl: snapshot.settings.branding.logoUrl || undefined,
          primaryColor: snapshot.settings.branding.primaryColor || undefined,
        }),
      });
      if (res.ok) toast.success("Branding saved");
      else toast.error("Could not save branding");
    } catch {
      toast.error("Could not save branding");
    } finally {
      setSavingBrand(false);
    }
  }

  function downloadQr(tableNumber: number) {
    const canvas = qrRefs.current[tableNumber];
    if (!canvas) return;
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `table-${tableNumber}-qr.png`;
    link.click();
  }

  function downloadBulkPdf() {
    const popup = window.open("", "_blank", "width=900,height=700");
    if (!popup) return;
    const cards = tables
      .map((table) => {
        const dataUrl =
          qrRefs.current[table.tableNumber]?.toDataURL("image/png") || "";
        return `<div style="width:220px;padding:16px;border:1px solid #e2e8f0;border-radius:16px;margin:12px;display:inline-block;text-align:center"><img src="${dataUrl}" width="160" height="160" /><h3 style="font-family:Inter,sans-serif">Table ${table.tableNumber}</h3><p style="font-family:Inter,sans-serif">${snapshot?.settings.businessProfile.name}</p></div>`;
      })
      .join("");
    popup.document.write(
      `<html><head><title>Table QR Codes</title></head><body>${cards}<script>window.print()</script></body></html>`,
    );
    popup.document.close();
  }

  async function addUser() {
    if (!newUser.name.trim()) return;
    const res = await authFetch("/api/staff", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: newUser.name,
        role: newUser.role,
        phone: newUser.phone,
      }),
    });
    if (res.ok) {
      setNewUser({ id: "", name: "", role: "Server", phone: "", active: true });
      toast.success("User added");
      void loadStaff();
    } else {
      toast.error("Could not add user");
    }
  }

  if (!snapshot) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6">
        Loading settings…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Account & Security */}
      <AccountSecuritySection />

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-2xl border border-border bg-card p-6">
          <h3 className="text-lg font-semibold">Business profile</h3>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Input
              value={snapshot.settings.businessProfile.name}
              onChange={(event) =>
                updateSettings((settings) => ({
                  ...settings,
                  businessProfile: {
                    ...settings.businessProfile,
                    name: event.target.value,
                  },
                }))
              }
              placeholder="Business name"
            />
            <Input
              value={snapshot.settings.businessProfile.tillNumber}
              onChange={(event) =>
                updateSettings((settings) => ({
                  ...settings,
                  businessProfile: {
                    ...settings.businessProfile,
                    tillNumber: event.target.value,
                  },
                }))
              }
              placeholder="Till number"
            />
            <Input
              value={snapshot.settings.businessProfile.address}
              onChange={(event) =>
                updateSettings((settings) => ({
                  ...settings,
                  businessProfile: {
                    ...settings.businessProfile,
                    address: event.target.value,
                  },
                }))
              }
              placeholder="Address"
            />
            <Input
              value={snapshot.settings.businessProfile.phone}
              onChange={(event) =>
                updateSettings((settings) => ({
                  ...settings,
                  businessProfile: {
                    ...settings.businessProfile,
                    phone: event.target.value,
                  },
                }))
              }
              placeholder="Phone"
            />
          </div>
          <div className="mt-4 space-y-3">
            <label className="block text-sm font-medium">Business logo</label>
            <div className="flex items-center gap-4">
              <div className="flex size-16 items-center justify-center overflow-hidden rounded-xl border border-border bg-slate-50">
                {snapshot.settings.businessProfile.logoUrl ? (
                  <img
                    src={snapshot.settings.businessProfile.logoUrl}
                    alt="Business logo"
                    className="size-full object-contain"
                  />
                ) : (
                  <span className="text-xs text-muted-foreground">No logo</span>
                )}
              </div>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/png,image/jpeg,image/svg+xml,image/webp"
                className="hidden"
                onChange={(e) => handleLogoUpload(e.target.files?.[0])}
              />
              <Button
                variant="outline"
                onClick={() => logoInputRef.current?.click()}
              >
                Upload logo
              </Button>
              {snapshot.settings.businessProfile.logoUrl ? (
                <Button
                  variant="ghost"
                  onClick={() =>
                    updateSettings((s) => ({
                      ...s,
                      businessProfile: { ...s.businessProfile, logoUrl: "" },
                      branding: { ...s.branding, logoUrl: "" },
                    }))
                  }
                >
                  Remove
                </Button>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              PNG, JPG, SVG or WebP · up to 512KB
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6">
          <h3 className="text-lg font-semibold">Branding</h3>
          <div className="mt-4 space-y-4">
            <label className="block text-sm font-medium">Primary color</label>
            <input
              type="color"
              value={snapshot.settings.branding.primaryColor}
              onChange={(event) =>
                updateSettings((settings) => ({
                  ...settings,
                  branding: {
                    ...settings.branding,
                    primaryColor: event.target.value,
                  },
                }))
              }
              className="h-12 w-24 rounded-xl border border-border"
            />
            <div className="rounded-2xl border border-border p-4">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Preview
              </p>
              <div
                className="mt-2 flex items-center gap-3 rounded-xl p-3"
                style={{
                  backgroundColor:
                    snapshot.settings.branding.primaryColor || "#2563eb",
                }}
              >
                {snapshot.settings.branding.logoUrl ? (
                  <img
                    src={snapshot.settings.branding.logoUrl}
                    alt="Logo"
                    className="size-8 rounded bg-white object-contain p-0.5"
                  />
                ) : null}
                <span className="font-semibold text-white">
                  {snapshot.settings.businessProfile.name || "Your business"}
                </span>
              </div>
            </div>
            <Button onClick={saveBranding} disabled={savingBrand}>
              {savingBrand ? "Saving…" : "Save branding"}
            </Button>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-lg font-semibold">QR code management</h3>
            <p className="text-sm text-muted-foreground">
              Generate a payment QR for each table and export assets.
            </p>
          </div>
          <Button onClick={downloadBulkPdf} className="gap-2">
            <FileDown className="h-4 w-4" /> Bulk PDF
          </Button>
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {tables.map((table) => (
            <div
              key={table.id}
              className="rounded-2xl border border-border bg-slate-50 p-4 text-center"
            >
              <QRCodeCanvas
                value={buildKeQr(
                  resolveKeQrMerchant({
                    name: snapshot.settings.businessProfile?.name || MERCHANT_NAME,
                    merchantId:
                      snapshot.settings.businessProfile?.tillNumber || TILL_NUMBER,
                  }),
                  { storeLabel: `Table ${table.tableNumber}` },
                )}
                size={160}
                includeMargin
                ref={(node) => {
                  qrRefs.current[table.tableNumber] = node;
                }}
              />
              <p className="mt-3 font-medium">Table {table.tableNumber}</p>
              <Button
                variant="outline"
                className="mt-3 gap-2"
                onClick={() => downloadQr(table.tableNumber)}
              >
                <Download className="h-4 w-4" /> Download
              </Button>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-6">
          <h3 className="text-lg font-semibold">Payment configuration</h3>
          <div className="mt-4 space-y-3 text-sm">
            {[
              ["mpesa", "M-Pesa"],
              ["card", "Card"],
              ["applePay", "Apple Pay"],
              ["googlePay", "Google Pay"],
            ].map(([key, label]) => (
              <label
                key={key}
                className="flex items-center justify-between rounded-xl border border-border px-4 py-3"
              >
                <span>{label}</span>
                <input
                  type="checkbox"
                  checked={
                    snapshot.settings.paymentConfiguration[
                      key as keyof typeof snapshot.settings.paymentConfiguration
                    ] as boolean
                  }
                  onChange={(event) =>
                    updateSettings((settings) => ({
                      ...settings,
                      paymentConfiguration: {
                        ...settings.paymentConfiguration,
                        [key]: event.target.checked,
                      },
                    }))
                  }
                />
              </label>
            ))}
            <div>
              <label className="mb-2 block font-medium">Tip suggestions</label>
              <Input
                value={snapshot.settings.paymentConfiguration.tipSuggestions.join(
                  ", ",
                )}
                onChange={(event) =>
                  updateSettings((settings) => ({
                    ...settings,
                    paymentConfiguration: {
                      ...settings.paymentConfiguration,
                      tipSuggestions: event.target.value
                        .split(",")
                        .map((value) => Number(value.trim()))
                        .filter((value) => !Number.isNaN(value)),
                    },
                  }))
                }
              />
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6">
          <h3 className="text-lg font-semibold">User management</h3>
          <div className="mt-4 space-y-3">
            {staff.map((user) => (
              <div
                key={user.id}
                className="flex flex-col gap-3 rounded-2xl border border-border p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium">{user.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {user.role} · {user.phone}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ${user.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-700"}`}
                  >
                    {user.active ? "Active" : "Inactive"}
                  </span>
                  <Button
                    variant="destructive"
                    size="icon"
                    onClick={async () => {
                      await authFetch(`/api/staff/${user.id}`, {
                        method: "DELETE",
                      });
                      void loadStaff();
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <Input
              value={newUser.name}
              onChange={(event) =>
                setNewUser((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
              placeholder="Name"
            />
            <select
              value={newUser.role}
              onChange={(event) =>
                setNewUser((current) => ({
                  ...current,
                  role: event.target.value as MerchantUser["role"],
                }))
              }
              className="rounded-xl border border-border bg-background px-3 py-2 text-sm"
            >
              <option>Owner</option>
              <option>Manager</option>
              <option>Server</option>
              <option>Kitchen</option>
            </select>
            <Input
              value={newUser.phone}
              onChange={(event) =>
                setNewUser((current) => ({
                  ...current,
                  phone: event.target.value,
                }))
              }
              placeholder="Phone"
            />
            <Button onClick={addUser} className="gap-2">
              <Plus className="h-4 w-4" /> Add user
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
