import { Plus } from "lucide-react";

export function TopHeader({ crumb }: { crumb: string }) {
  return (
    <header className="h-16 border-b border-border flex items-center justify-between pl-16 pr-4 lg:px-8 bg-background/80 backdrop-blur-md sticky top-0 z-10">
      <div className="flex items-center gap-4 min-w-0">
        <h1 className="hidden sm:block text-sm font-semibold text-muted-foreground">Treasury Overview</h1>
        <span className="hidden sm:inline text-border">/</span>
        <span className="text-sm font-medium truncate">{crumb}</span>
      </div>
      <div className="flex items-center gap-3 sm:gap-4 shrink-0">
        <button className="px-3 py-1.5 bg-foreground text-background text-xs font-medium rounded-full inline-flex items-center gap-1.5 hover:opacity-90 transition-opacity">
          <Plus className="size-3.5" /> <span className="hidden sm:inline">Add Funds</span>
        </button>
        <div className="size-8 rounded-full bg-muted ring-1 ring-border" />
      </div>
    </header>
  );
}

