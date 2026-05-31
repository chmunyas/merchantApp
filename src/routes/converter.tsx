import { createFileRoute } from "@tanstack/react-router";
import { TopHeader } from "@/components/TopHeader";
import { QuickExchange } from "@/components/QuickExchange";
import { ProviderComparison } from "@/components/ProviderComparison";

export const Route = createFileRoute("/converter")({
  head: () => ({
    meta: [
      { title: "Converter â FX Engine" },
      { name: "description", content: "Compare live FX rates across top providers and execute at the best rate." },
    ],
  }),
  component: ConverterPage,
});

function ConverterPage() {
  return (
    <>
      <TopHeader crumb="Converter" />
      <div className="p-8 max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 animate-slide-up">
        <div className="lg:col-span-5">
          <QuickExchange />
        </div>
        <div className="lg:col-span-7">
          <ProviderComparison />
        </div>
      </div>
    </>
  );
}

