import { createFileRoute } from "@tanstack/react-router";
import { Download, FileDown, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createTableQrValue,
  ensureMerchantDemoData,
  loadMerchantSnapshot,
  saveMerchantSettings,
  type MerchantSnapshot,
  type MerchantUser,
} from "@/lib/merchant-dashboard";

export const Route = createFileRoute("/dashboard/settings")({
  component: DashboardSettingsPage,
});

function generateDemoData() {
  return ensureMerchantDemoData();
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

  useEffect(() => {
    generateDemoData();
    setSnapshot(loadMerchantSnapshot());
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

  function addUser() {
    if (!snapshot || !newUser.name.trim()) return;
    updateSettings((settings) => ({
      ...settings,
      users: [...settings.users, { ...newUser, id: `user-${Date.now()}` }],
    }));
    setNewUser({ id: "", name: "", role: "Server", phone: "", active: true });
    toast.success("User added");
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
          <div className="mt-4 rounded-2xl border border-dashed border-border bg-slate-50 p-5 text-sm text-muted-foreground">
            Logo upload placeholder
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
            <div className="rounded-2xl border border-dashed border-border p-5 text-sm text-muted-foreground">
              Logo upload placeholder
            </div>
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
                value={createTableQrValue(table.tableNumber, snapshot.settings)}
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
            {snapshot.settings.users.map((user) => (
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
                    onClick={() =>
                      updateSettings((settings) => ({
                        ...settings,
                        users: settings.users.filter(
                          (entry) => entry.id !== user.id,
                        ),
                      }))
                    }
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
