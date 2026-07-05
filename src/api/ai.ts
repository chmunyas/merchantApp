import { activeProvider, aiTranscribe } from "@/lib/ai-providers";

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
    return json({ provider: activeProvider(env) });
  }

  // Transcribe an uploaded audio clip (voice notes).
  if (path === "/api/ai/transcribe" && request.method === "POST") {
    try {
      const audio = await request.arrayBuffer();
      if (audio.byteLength === 0) return json({ error: "no audio" }, 400);
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
