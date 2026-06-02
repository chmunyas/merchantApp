import { useNavigate } from "@tanstack/react-router";
import { LogOut, Settings, Shield, User } from "lucide-react";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type AuthUser, isDemoMode, useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

function getInitials(name?: string) {
  return (name ?? "U")
    .split(" ")
    .filter(Boolean)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function roleBadge(role: AuthUser["role"]) {
  const map: Record<string, { label: string; className: string }> = {
    admin: {
      label: "Admin",
      className:
        "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300",
    },
    merchant: {
      label: "Merchant",
      className:
        "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
    },
    staff: {
      label: "Staff",
      className:
        "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300",
    },
    customer: {
      label: "Customer",
      className:
        "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
    },
  };
  return map[role] ?? map.customer;
}

type UserProfileMenuProps = {
  variant?: "light" | "dark";
};

export function UserProfileMenu({ variant = "light" }: UserProfileMenuProps) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  if (!user) return null;

  const badge = roleBadge(user.role);
  const isDark = variant === "dark";

  function handleLogout() {
    signOut();
    toast.success("Signed out successfully");
    void navigate({ to: "/sign-in" });
  }

  function handleSettings() {
    if (user?.role === "admin") {
      void navigate({ to: "/admin" });
    } else {
      void navigate({ to: "/dashboard/settings" });
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "flex items-center gap-2.5 rounded-2xl border px-3 py-2 text-left transition focus:outline-none focus:ring-2 focus:ring-violet-500/40",
            isDark
              ? "border-slate-700 bg-slate-900 hover:bg-slate-800"
              : "border-border bg-background hover:bg-muted/60",
          )}
        >
          {user.avatar ? (
            <img
              src={user.avatar}
              alt=""
              className="h-9 w-9 rounded-full object-cover"
            />
          ) : (
            <div
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold",
                isDark
                  ? "bg-violet-500/20 text-violet-200"
                  : "bg-emerald-100 text-emerald-700",
              )}
            >
              {getInitials(user.name)}
            </div>
          )}
          <div className="hidden sm:block">
            <div
              className={cn(
                "text-sm font-medium leading-tight",
                isDark ? "text-slate-100" : "text-foreground",
              )}
            >
              {user.name}
            </div>
            <div
              className={cn(
                "text-xs",
                isDark ? "text-slate-400" : "text-muted-foreground",
              )}
            >
              {user.email ?? user.phone ?? user.role}
            </div>
          </div>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        className={cn(
          "w-64",
          isDark && "border-slate-700 bg-slate-900 text-slate-100",
        )}
      >
        <DropdownMenuLabel className="font-normal">
          <div className="flex items-center gap-3 py-1">
            {user.avatar ? (
              <img
                src={user.avatar}
                alt=""
                className="h-10 w-10 rounded-full object-cover"
              />
            ) : (
              <div
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold",
                  isDark
                    ? "bg-violet-500/20 text-violet-200"
                    : "bg-emerald-100 text-emerald-700",
                )}
              >
                {getInitials(user.name)}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  "truncate text-sm font-semibold",
                  isDark ? "text-white" : "text-foreground",
                )}
              >
                {user.name}
              </p>
              {user.email && (
                <p
                  className={cn(
                    "truncate text-xs",
                    isDark ? "text-slate-400" : "text-muted-foreground",
                  )}
                >
                  {user.email}
                </p>
              )}
              <span
                className={cn(
                  "mt-1 inline-block rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                  badge.className,
                )}
              >
                {badge.label}
              </span>
            </div>
          </div>
        </DropdownMenuLabel>

        {isDemoMode() && (
          <>
            <DropdownMenuSeparator
              className={isDark ? "bg-slate-800" : undefined}
            />
            <div className="px-2 py-1.5">
              <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700">
                Demo Mode
              </span>
            </div>
          </>
        )}

        <DropdownMenuSeparator
          className={isDark ? "bg-slate-800" : undefined}
        />

        <DropdownMenuGroup>
          <DropdownMenuItem
            onClick={handleSettings}
            className={cn(
              "cursor-pointer",
              isDark && "focus:bg-slate-800 focus:text-white",
            )}
          >
            <Settings className="h-4 w-4" />
            <span>Settings</span>
          </DropdownMenuItem>
          {user.role === "admin" && (
            <DropdownMenuItem
              onClick={() => void navigate({ to: "/admin/features" })}
              className={cn(
                "cursor-pointer",
                isDark && "focus:bg-slate-800 focus:text-white",
              )}
            >
              <Shield className="h-4 w-4" />
              <span>Feature Flags</span>
            </DropdownMenuItem>
          )}
          {user.role === "merchant" && (
            <DropdownMenuItem
              onClick={() => void navigate({ to: "/dashboard/staff" })}
              className={cn(
                "cursor-pointer",
                isDark && "focus:bg-slate-800 focus:text-white",
              )}
            >
              <User className="h-4 w-4" />
              <span>My Team</span>
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>

        <DropdownMenuSeparator
          className={isDark ? "bg-slate-800" : undefined}
        />

        <DropdownMenuItem
          onClick={handleLogout}
          className={cn(
            "cursor-pointer text-red-600 focus:text-red-600",
            isDark && "focus:bg-slate-800",
          )}
        >
          <LogOut className="h-4 w-4" />
          <span>Sign out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
