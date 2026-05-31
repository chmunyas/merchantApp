import { Link, useRouterState } from "@tanstack/react-router";
import { Wallet, ArrowLeftRight, Send, Users, BarChart3, Smartphone } from "lucide-react";

const items = [
  { title: "Wallets", url: "/", icon: Wallet },
  { title: "Converter", url: "/converter", icon: ArrowLeftRight },
  { title: "Payments", url: "/payments", icon: Send },
  { title: "Beneficiaries", url: "/beneficiaries", icon: Users },
  { title: "Reports", url: "/reports", icon: BarChart3 },
  { title: "Merchant App", url: "/merchant", icon: Smartphone },
];

export function AppSidebar() {
  const currentPath = useRouterState({ select: (s) => s.location.pathname });

  return (
    <aside className="fixed left-0 top-0 h-full w-64 border-r border-border bg-sidebar p-6 flex flex-col gap-8 z-20">
      <div className="flex items-center gap-2 px-2">
        <div className="size-8 bg-foreground rounded-sm flex items-center justify-center">
          <div className="size-3.5 border-2 border-background rotate-45" />
        </div>
        <span className="font-bold tracking-tight text-xl">FX Engine</span>
      </div>

      <nav className="flex flex-col gap-1">
        {items.map((item) => {
          const active = currentPath === item.url;
          return (
            <Link
              key={item.url}
              to={item.url}
              className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                active
                  ? "bg-foreground/5 text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-foreground/5"
              }`}
            >
              <item.icon className="size-4" />
              {item.title}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto px-2">
        <div className="p-4 bg-muted rounded-lg border border-border">
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">
            Market Status
          </p>
          <p className="text-xs font-medium flex items-center gap-2">
            <span className="size-1.5 bg-accent rounded-full animate-pulse" />
            London Open
          </p>
        </div>
      </div>
    </aside>
  );
}

