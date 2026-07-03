import { createFileRoute } from "@tanstack/react-router";
import { TopHeader } from "@/components/TopHeader";
import { TransactionsTable } from "@/components/TransactionsTable";

export const Route = createFileRoute("/payments")({
  head: () => ({
    meta: [
      { title: "Payments — PesaSwap" },
      { name: "description", content: "Send, receive and track cross-border payments." },
    ],
  }),
  component: PaymentsPage,
});

function PaymentsPage() {
  return (
    <>
      <TopHeader crumb="Payments" />
      <div className="p-8 max-w-6xl mx-auto space-y-8 animate-slide-up">
        <TransactionsTable />
      </div>
    </>
  );
}

