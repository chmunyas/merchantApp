import { Link, useRouterState } from "@tanstack/react-router";
import {
  Wallet,
  ArrowLeftRight,
  Send,
  Users,
  BarChart3,
  Smartphone,
  X,
} from "lucide-react";

const items = [
  { title: "Wallets", url: "/", icon: Wallet },
  { title: "Converter", url: "/converter", icon: ArrowLeftRight },
  { title: "Payments", url: "/payments", icon: Send },
  { title: "Beneficiaries", url: "/beneficiaries", icon: Users },
  { title: "Reports", url: "/reports", icon: BarChart3 },
  { title: "Merchant App", url: "/merchant", icon: Smartphone },
];

export function AppSidebar({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const currentPath = useRouterState({ select: (s) => s.location.pathname });

  // On mobile the sidebar overlays content, so close it after navigating.
  const handleNav = () => {
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 1023px)").matches
    ) {
      onClose();
    }
  };

  return (
    <>
      {/* Scrim (mobile only) — tap to dismiss the drawer. */}
      <div
        className={`fixed inset-0 z-30 bg-black/40 backdrop-blur-sm transition-opacity duration-200 lg:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={`fixed left-0 top-0 z-40 flex h-full w-64 max-w-[82vw] flex-col gap-8 border-r border-border bg-sidebar p-6 transition-transform duration-200 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-hidden={!open}
      >
        <div className="flex items-center justify-between px-2">
          <div className="flex items-center gap-2">
            <div className="size-8 bg-foreground rounded-sm flex items-center justify-center">
              <div className="size-3.5 border-2 border-background rotate-45" />
            </div>
            <span className="font-bold tracking-tight text-xl">PesaSwap</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            <X className="size-5" />
          </button>
        </div>

        <nav className="flex flex-col gap-1">
          {items.map((item) => {
            const active = currentPath === item.url;
            return (
              <Link
                key={item.url}
                to={item.url}
                onClick={handleNav}
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
    </>
  );
}

