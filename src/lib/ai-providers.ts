import { getAi } from "@/lib/db";
import { envVar } from "@/lib/env";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

// Which provider to try first. Explicit AI_PROVIDER wins; otherwise inferred
// from whatever credentials/endpoints are configured. "workers" is the default
// (Cloudflare Workers AI) and also the universal fallback.
export function activeProvider(env: unknown): string {
  const explicit = envVar(env, "AI_PROVIDER");
  if (explicit) return explicit;
  if (envVar(env, "OPENAI_API_KEY") || envVar(env, "OPENAI_BASE_URL")) {
    return "openai";
  }
  if (envVar(env, "ANTHROPIC_API_KEY")) return "anthropic";
  if (envVar(env, "OLLAMA_BASE_URL")) return "ollama";
  return "workers";
}

// OpenAI-compatible: OpenAI, Groq, Together, vLLM, LM Studio, Ollama's /v1, etc.
async function chatOpenAICompatible(
  messages: ChatMessage[],
  env: unknown,
): Promise<string | null> {
  const base = envVar(env, "OPENAI_BASE_URL") ?? "https://api.openai.com/v1";
  const key = envVar(env, "OPENAI_API_KEY");
  const model = envVar(env, "OPENAI_MODEL") ?? "gpt-4o-mini";
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (key) headers.authorization = `Bearer ${key}`;
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model, messages, max_tokens: 300, temperature: 0.3 }),
  });
  if (!res.ok) throw new Error(`openai ${res.status}`);
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? null;
}

async function chatAnthropic(
  messages: ChatMessage[],
  env: unknown,
): Promise<string | null> {
  const key = envVar(env, "ANTHROPIC_API_KEY");
  if (!key) throw new Error("no anthropic key");
  const model = envVar(env, "ANTHROPIC_MODEL") ?? "claude-3-5-haiku-latest";
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n");
  const rest = messages.filter((m) => m.role !== "system");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({ model, max_tokens: 300, system, messages: rest }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}`);
  const data = (await res.json()) as {
    content?: Array<{ text?: string }>;
  };
  return data.content?.[0]?.text ?? null;
}

// Native Ollama (local open-source models — llama3, mistral, qwen, phi, etc.).
async function chatOllama(
  messages: ChatMessage[],
  env: unknown,
): Promise<string | null> {
  const base = envVar(env, "OLLAMA_BASE_URL");
  if (!base) throw new Error("no ollama endpoint");
  const model = envVar(env, "OLLAMA_MODEL") ?? "llama3.1";
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, messages, stream: false }),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}`);
  const data = (await res.json()) as { message?: { content?: string } };
  return data.message?.content ?? null;
}

async function chatWorkers(
  messages: ChatMessage[],
  env: unknown,
): Promise<string | null> {
  const ai = getAi(env);
  if (!ai) throw new Error("no workers ai");
  const result = (await ai.run("@cf/meta/llama-3.1-8b-instruct", {
    messages,
  })) as { response?: string };
  return result?.response ?? null;
}

// Chat completion with automatic fallback to Workers AI. Returns null when no
// provider is available (callers keep their rule-based behavior).
export async function aiChat(
  messages: ChatMessage[],
  env: unknown,
): Promise<string | null> {
  const order = [activeProvider(env), "workers"];
  const tried = new Set<string>();
  for (const provider of order) {
    if (tried.has(provider)) continue;
    tried.add(provider);
    try {
      let out: string | null = null;
      if (provider === "openai") out = await chatOpenAICompatible(messages, env);
      else if (provider === "anthropic") out = await chatAnthropic(messages, env);
      else if (provider === "ollama") out = await chatOllama(messages, env);
      else out = await chatWorkers(messages, env);
      if (out && out.trim()) return out.trim();
    } catch {
      /* try the next provider */
    }
  }
  return null;
}

// 768-dim embeddings (kept consistent with the vector(768) columns): Workers AI
// bge-base or Ollama nomic-embed-text. Null -> callers use keyword/FTS search.
export async function aiEmbed(
  text: string,
  env: unknown,
): Promise<number[] | null> {
  if (!text.trim()) return null;
  const ai = getAi(env);
  if (ai) {
    try {
      const result = (await ai.run("@cf/baai/bge-base-en-v1.5", {
        text: [text],
      })) as { data?: number[][] };
      const vector = result?.data?.[0];
      if (vector) return vector;
    } catch {
      /* fall through */
    }
  }
  const base = envVar(env, "OLLAMA_BASE_URL");
  if (base) {
    try {
      const res = await fetch(`${base}/api/embeddings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: envVar(env, "OLLAMA_EMBED_MODEL") ?? "nomic-embed-text",
          prompt: text,
        }),
      });
      const data = (await res.json()) as { embedding?: number[] };
      if (Array.isArray(data.embedding) && data.embedding.length === 768) {
        return data.embedding;
      }
    } catch {
      /* fall through */
    }
  }
  return null;
}

// Transcribe audio (voice notes) via Workers AI Whisper or an OpenAI/Groq
// compatible Whisper endpoint. Null when no transcription provider is available.
export async function aiTranscribe(
  audio: ArrayBuffer,
  env: unknown,
): Promise<string | null> {
  const ai = getAi(env);
  if (ai) {
    try {
      const result = (await ai.run("@cf/openai/whisper", {
        audio: [...new Uint8Array(audio)],
      })) as { text?: string };
      if (result?.text) return result.text;
    } catch {
      /* fall through */
    }
  }
  const key = envVar(env, "OPENAI_API_KEY");
  if (key) {
    try {
      const base = envVar(env, "OPENAI_BASE_URL") ?? "https://api.openai.com/v1";
      const form = new FormData();
      form.append("file", new Blob([audio]), "audio.ogg");
      form.append("model", envVar(env, "OPENAI_TRANSCRIBE_MODEL") ?? "whisper-1");
      const res = await fetch(`${base}/audio/transcriptions`, {
        method: "POST",
        headers: { authorization: `Bearer ${key}` },
        body: form,
      });
      const data = (await res.json()) as { text?: string };
      if (data?.text) return data.text;
    } catch {
      /* fall through */
    }
  }
  return null;
}
