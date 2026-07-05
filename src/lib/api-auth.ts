import { envVar } from "@/lib/env";

// Optional API-key guard. OFF by default: when no OMNI_API_KEY is configured it
// allows everything, so the same-origin PWA/app is completely unaffected. When a
// key IS configured, the request must present a matching `x-api-key` header.
//
// Apply ONLY to machine-to-machine / admin endpoints — never to routes the
// browser app calls directly (those rely on the app's own auth/session).
export function requireApiKey(request: Request, env: unknown): Response | null {
  const configured = envVar(env, "OMNI_API_KEY");
  if (!configured) return null; // disabled — non-breaking default
  const provided = request.headers.get("x-api-key");
  if (provided && provided === configured) return null;
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}
