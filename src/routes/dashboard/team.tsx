import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  listMembers,
  removeMember,
  saveMember,
  type TeamMember,
} from "@/lib/auth";
import { getCurrentVenueId } from "@/lib/tenant-store";
import { MANAGEABLE_ROLES, canGrantRole, canRemoveMember } from "@/lib/tenancy";

export const Route = createFileRoute("/dashboard/team")({
  component: DashboardTeamPage,
});

const roleLabel: Record<string, string> = {
  merchant: "Owner",
  manager: "Manager",
  supervisor: "Supervisor",
  staff: "Staff",
};

function DashboardTeamPage() {
  const [venue, setVenue] = useState("");
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [callerRole, setCallerRole] = useState("");
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("staff");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (v: string) => {
    setLoading(true);
    const data = await listMembers(v);
    if (!data) {
      setForbidden(true);
      setMembers([]);
    } else {
      setForbidden(false);
      setMembers(data.members);
      setCallerRole(data.callerRole);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const v = getCurrentVenueId();
    setVenue(v);
    void load(v);
  }, [load]);

  // Keep the visible choices identical to the server's authority policy.
  const grantableRoles = useMemo(() => {
    return MANAGEABLE_ROLES.filter((candidate) =>
      canGrantRole(callerRole, candidate),
    );
  }, [callerRole]);

  useEffect(() => {
    if (grantableRoles.length && !grantableRoles.includes(role as never)) {
      setRole(grantableRoles[0]);
    }
  }, [grantableRoles, role]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || saving) return;
    setSaving(true);
    try {
      const res = await saveMember(venue, email.trim(), role, name.trim());
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(
        res.invited
          ? `Invited ${email.trim()} as ${roleLabel[role] ?? role}`
          : `Updated ${email.trim()} to ${roleLabel[role] ?? role}`,
      );
      setEmail("");
      setName("");
      await load(venue);
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(m: TeamMember) {
    if (!confirm(`Remove ${m.email} from this store?`)) return;
    const res = await removeMember(venue, m.email);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    toast.success(`Removed ${m.email}`);
    await load(venue);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Team</h1>
        <p className="text-sm text-muted-foreground">
          Manage who can access this store and what they can do. Roles are
          per-store — the same person can be an owner here and a manager
          elsewhere.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading team…
        </div>
      ) : forbidden ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            You need to be a manager or owner of this store to manage its team.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Add a team member</CardTitle>
              <CardDescription>
                They gain access on their next sign-in (Google or a password
                reset on this email).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={handleAdd}
                className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto]"
              >
                <Input
                  type="email"
                  required
                  placeholder="name@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <Input
                  placeholder="Name (optional)"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                >
                  {grantableRoles.map((r) => (
                    <option key={r} value={r}>
                      {roleLabel[r] ?? r}
                    </option>
                  ))}
                </select>
                <Button type="submit" disabled={saving}>
                  {saving ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <UserPlus className="size-4" />
                  )}
                  Add
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Members ({members.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="divide-y">
              {members.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No members yet.
                </p>
              ) : (
                members.map((m) => {
                  const canRemove =
                    !m.you && canRemoveMember(callerRole, m.role);
                  return (
                    <div
                      key={m.email}
                      className="flex items-center justify-between gap-3 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {m.name || m.email}
                          {m.you ? (
                            <span className="ml-2 text-xs text-muted-foreground">
                              (you)
                            </span>
                          ) : null}
                        </p>
                        {m.name ? (
                          <p className="truncate text-xs text-muted-foreground">
                            {m.email}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">
                          {roleLabel[m.role] ?? m.role}
                        </Badge>
                        {canRemove ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleRemove(m)}
                            aria-label={`Remove ${m.email}`}
                          >
                            <Trash2 className="size-4 text-destructive" />
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
