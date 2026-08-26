import { requireAuth } from "@/api/auth";
import { runIngressWorker } from "@/lib/channel-ingress";
import { envVar } from "@/lib/env";
import { runOutboundWorker } from "@/lib/outbound-jobs";
import { roleAtLeast } from "@/lib/rbac";
import { verifyToken } from "@/lib/webhook-verify";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function handleChannelRecoveryRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/channels/run" || request.method !== "POST") return null;
  const secret = envVar(env, "CRON_SECRET");
  if (secret) {
    if (!verifyToken(request.headers.get("x-cron-secret"), secret)) {
      return json({ error: "unauthorized" }, 401);
    }
  } else {
    const principal = await requireAuth(request, env);
    if (!principal || !roleAtLeast(principal, "manager")) {
      return json({ error: "unauthorized" }, 401);
    }
  }
  const ingress = await runIngressWorker(env, 100);
  const outbound = await runOutboundWorker(env, 200);
  return json({ ingress, outbound });
}
