import { type ReactNode } from "react";
import { Navigate } from "@tanstack/react-router";

import { type UserRole, useAuth } from "@/lib/auth";

type Props = {
  roles: UserRole[];
  children: ReactNode;
};

export function ProtectedRoute({ roles, children }: Props) {
  const { user, isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-violet-500 border-t-transparent" />
          <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
        </div>
      </div>
    );
  }

  if (!isSignedIn || !user) {
    return <Navigate to="/sign-in" />;
  }

  if (!roles.includes(user.role)) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-600">Access Denied</h1>
          <p className="mt-2 text-muted-foreground">
            Your role ({user.role}) does not have access to this page.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
