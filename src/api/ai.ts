import { activeProvider, aiTranscribe } from "@/lib/ai-providers";
import { requireAuth, requireHumanAuth } from "@/api/auth";
import { roleAtLeast } from "@/lib/rbac";
import { tokenHasScope } from "@/lib/api-tokens";

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

export async function handleAiRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;

  // Report the active AI provider (for the Settings UI).
  if (path === "/api/ai/provider" && request.method === "GET") {
    const payload = await requireHumanAuth(request, env);
    if (!payload || !roleAtLeast(payload, "merchant")) {
      return json({ error: "forbidden" }, 403);
    }
    return json({ provider: activeProvider(env) });
  }

  // Transcribe an uploaded audio clip (voice notes).
  if (path === "/api/ai/transcribe" && request.method === "POST") {
    const payload = await requireAuth(request, env);
    if (!payload) return json({ error: "unauthorized" }, 401);
    if (!roleAtLeast(payload, "staff") || !tokenHasScope(payload, "agent:invoke")) {
      return json({ error: "forbidden" }, 403);
    }
    try {
      const audio = await request.arrayBuffer();
      if (audio.byteLength === 0) return json({ error: "no audio" }, 400);
      if (audio.byteLength > MAX_AUDIO_BYTES) return json({ error: "audio too large" }, 413);
      const text = await aiTranscribe(audio, env);
      if (text === null) {
        return json({ error: "no transcription provider configured" }, 503);
      }
      return json({ text });
    } catch {
      return json({ error: "transcription failed" }, 500);
    }
  }

  return null;
}
