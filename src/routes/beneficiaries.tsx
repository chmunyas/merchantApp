import { createFileRoute } from "@tanstack/react-router";
import { TopHeader } from "@/components/TopHeader";

const beneficiaries = [
  { name: "Acme Manufacturing Ltd", account: "GB29 NWBK 6016 1331 9268 19", bank: "NatWest â¢ London", currency: "GBP" },
  { name: "Helios Logistics GmbH", account: "DE89 3704 0044 0532 0130 00", bank: "Commerzbank â¢ Frankfurt", currency: "EUR" },
  { name: "Kenya Coffee Co-op", account: "0123 4567 8901 2345", bank: "KCB â¢ Nairobi", currency: "KES" },
  { name: "Lagos Trade Partners", account: "0049 1234 5678", bank: "GTBank â¢ Lagos", currency: "NGN" },
];

export const Route = createFileRoute("/beneficiaries")({
  head: () => ({
    meta: [
      { title: "Beneficiaries — PesaSwap" },
      { name: "description", content: "Manage payment beneficiaries across currencies and banks." },
    ],
  }),
  component: BeneficiariesPage,
});

function BeneficiariesPage() {
  return (
    <>
      <TopHeader crumb="Beneficiaries" />
      <div className="p-8 max-w-6xl mx-auto space-y-4 animate-slide-up">
        <div className="flex justify-between items-end">
          <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
            Saved Beneficiaries
          </h2>
          <button className="px-3 py-1.5 bg-foreground text-background text-xs font-medium rounded-full">
            + Add Beneficiary
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {beneficiaries.map((b) => (
            <div key={b.name} className="p-5 bg-card border border-border rounded-xl ring-1 ring-border">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <p className="font-bold text-sm">{b.name}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{b.bank}</p>
                </div>
                <span className="font-mono text-[10px] px-2 py-0.5 bg-muted rounded border border-border">
                  {b.currency}
                </span>
              </div>
              <p className="font-mono text-xs text-muted-foreground tracking-wide">{b.account}</p>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

