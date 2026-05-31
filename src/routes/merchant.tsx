import { createFileRoute } from "@tanstack/react-router";
import { TopHeader } from "@/components/TopHeader";
import { PhoneFrame } from "@/components/merchant/PhoneFrame";
import { MerchantApp } from "@/components/merchant/MerchantApp";
import {
  QRInvoicingFlow,
  InvoiceLedgerFlow,
  SmartSettlementFlow,
  PWAFlow,
} from "@/components/merchant/MerchantFlows";
import { Smartphone, QrCode, FileText, Zap } from "lucide-react";
import type { ReactNode } from "react";

export const Route = createFileRoute("/merchant")({
  head: () => ({
    meta: [
      { title: "Merchant App â FX Engine" },
      {
        name: "description",
        content:
          "Mobile merchant app with QR code invoicing, scan-to-pay, smart settlement and offline PWA support.",
      },
    ],
  }),
  component: MerchantPage,
});

function MerchantPage() {
  return (
    <>
      <TopHeader crumb="Merchant App" />
      <div className="px-6 lg:px-8 py-10 max-w-6xl mx-auto animate-slide-up space-y-24">
        {/* HERO â full interactive app */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
          <div className="lg:col-span-5 space-y-8 lg:sticky lg:top-8">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
                FX Engine Â· Mobile
              </p>
              <h1 className="text-4xl font-bold tracking-tight leading-tight">
                A multi-currency terminal in every pocket.
              </h1>
              <p className="text-sm text-muted-foreground mt-4 leading-relaxed">
                Four focused capabilities, one merchant app. Each flow is
                purpose-built â Revolut-clean, Wise-precise.
              </p>
            </div>

            <div className="space-y-2">
              {[
                { i: QrCode, t: "QR invoicing", d: "Generate payable QR codes in seconds." },
                { i: FileText, t: "Invoice ledger", d: "Track paid, pending and overdue receivables." },
                { i: Zap, t: "Smart settlement", d: "Auto-route to the best FX provider." },
                { i: Smartphone, t: "PWA & mobile", d: "Installable, offline-first, biometric secure." },
              ].map(({ i: Icon, t, d }) => (
                <a
                  key={t}
                  href={`#${t.split(" ")[0].toLowerCase()}`}
                  className="flex gap-3 p-3 rounded-xl border border-border bg-card hover:bg-muted transition-colors"
                >
                  <div className="size-8 rounded-md bg-muted flex items-center justify-center shrink-0">
                    <Icon className="size-3.5" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold">{t}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{d}</p>
                  </div>
                </a>
              ))}
            </div>

            <div className="flex gap-2">
              <button className="flex-1 bg-foreground text-background py-2.5 rounded-md text-xs font-semibold">
                Download iOS
              </button>
              <button className="flex-1 border border-border py-2.5 rounded-md text-xs font-semibold">
                Download Android
              </button>
            </div>
          </div>

          <div className="lg:col-span-7">
            <PhoneFrame>
              <MerchantApp />
            </PhoneFrame>
          </div>
        </section>

        {/* CAPABILITY FLOWS */}
        <FlowSection
          id="qr"
          eyebrow="Capability Â· 01"
          title="QR invoicing"
          headline="Request a payment in three taps."
          body="Type the amount, pick a currency, and a QR appears â payable from any wallet, banking app or FX Engine scanner. Share it as a link, AirDrop or print it. EMVCo, UPI, PIX and FX Engine native payloads supported."
          bullets={[
            "Dynamic QR with embedded invoice ID & FX routing hint",
            "Share-sheet, copy-link and printable PDF options",
            "Real-time payment confirmation push",
          ]}
          phone={<QRInvoicingFlow />}
        />

        <FlowSection
          id="invoice"
          eyebrow="Capability Â· 02"
          title="Invoice ledger"
          headline="Every receivable, in one calm view."
          body="The ledger filters by paid, pending and overdue with Wise-style clarity. Each row carries the customer, currency, settlement provider and timestamp â exportable to your accounting stack with one tap."
          bullets={[
            "Segmented filters: Paid Â· Pending Â· Overdue",
            "Multi-currency totals with weekly settlement view",
            "CSV / Xero / QuickBooks export",
          ]}
          phone={<InvoiceLedgerFlow />}
          reverse
        />

        <FlowSection
          id="smart"
          eyebrow="Capability Â· 03"
          title="Smart settlement"
          headline="Always the best route. Always transparent."
          body="When a payment lands in EUR but you settle in USD, FX Engine compares Wise, Currencycloud, LMAX and Verto live. It shows you mid-market, the spread, the fee and the ETA â then routes through the winner automatically."
          bullets={[
            "Live mid-market vs provider rates",
            "Fee, spread and ETA shown per provider",
            "Auto-route with manual override",
          ]}
          phone={<SmartSettlementFlow />}
        />

        <FlowSection
          id="pwa"
          eyebrow="Capability Â· 04"
          title="PWA & mobile"
          headline="Installable. Offline. Biometric-secure."
          body="FX Engine works as a native iOS / Android app and an installable PWA. Drafts are queued offline, synced when the merchant comes back online. Camera-grade QR scanner, push receipts and Face ID-protected ledger."
          bullets={[
            "Add to home screen on iOS, Android & desktop",
            "Offline draft invoicing with background sync",
            "Push alerts, Face ID / Touch ID protection",
          ]}
          phone={<PWAFlow />}
          reverse
        />
      </div>
    </>
  );
}

function FlowSection({
  id,
  eyebrow,
  title,
  headline,
  body,
  bullets,
  phone,
  reverse,
}: {
  id: string;
  eyebrow: string;
  title: string;
  headline: string;
  body: string;
  bullets: string[];
  phone: ReactNode;
  reverse?: boolean;
}) {
  return (
    <section
      id={id}
      className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center scroll-mt-20"
    >
      <div className={`lg:col-span-5 space-y-5 ${reverse ? "lg:order-2" : ""}`}>
        <div>
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            {eyebrow}
          </p>
          <p className="text-xs font-mono mt-1 mb-3">{title}</p>
          <h2 className="text-3xl font-bold tracking-tight leading-tight">{headline}</h2>
          <p className="text-sm text-muted-foreground mt-3 leading-relaxed">{body}</p>
        </div>
        <ul className="space-y-2 pt-2 border-t border-border">
          {bullets.map((b) => (
            <li key={b} className="flex gap-2.5 text-xs">
              <span className="mt-1.5 size-1 rounded-full bg-foreground shrink-0" />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className={`lg:col-span-7 ${reverse ? "lg:order-1" : ""}`}>
        <PhoneFrame>{phone}</PhoneFrame>
      </div>
    </section>
  );
}

