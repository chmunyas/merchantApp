import { createFileRoute } from "@tanstack/react-router";
import { TopHeader } from "@/components/TopHeader";
import { WalletsGrid } from "@/components/WalletsGrid";
import { QuickExchange } from "@/components/QuickExchange";
import { ProviderComparison } from "@/components/ProviderComparison";
import { TransactionsTable } from "@/components/TransactionsTable";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Wallets — PesaSwap" },
      {
        name: "description",
        content: "Multi-currency wallet balances and best-rate FX routing in one view.",
      },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  return (
    <>
      <TopHeader crumb="Main Dashboard" />
      <div className="p-8 max-w-6xl mx-auto space-y-8">
        <WalletsGrid />
        <section className="animate-slide-up [animation-delay:100ms] grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-4">
            <QuickExchange />
          </div>
          <div className="lg:col-span-8">
            <ProviderComparison />
          </div>
        </section>
        <TransactionsTable />
      </div>
    </>
  );
}

