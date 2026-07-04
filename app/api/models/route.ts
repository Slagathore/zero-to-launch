import { NextResponse } from "next/server";
import { getSettingsFromEnv } from "@/lib/llm";

/**
 * GET /api/models — the list of models the operator's Ollama serves (for the
 * Settings panel's per-stage dropdowns) + provider status BOOLEANS. Never
 * returns keys — only which providers are configured. On a host that can't
 * reach the Ollama endpoint (e.g. the Vercel shell), it returns an empty list
 * and ollama:false rather than erroring.
 */
export const dynamic = "force-dynamic";

interface OpenAIModelsResponse {
  data?: { id?: string }[];
}

export async function GET() {
  const s = getSettingsFromEnv();
  const base = s.openaiCompatUrl.replace(/\/$/, ""); // .../v1
  let models: string[] = [];
  let ollama = false;
  if (base) {
    try {
      const res = await fetch(`${base}/models`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        ollama = true;
        const j: OpenAIModelsResponse = await res.json();
        models = (j?.data ?? []).map((m) => m?.id).filter((id): id is string => !!id);
        // Cloud-tagged models first (the strong ones), then the rest, alpha within each.
        models.sort((a, b) => {
          const ca = a.includes(":cloud") || a.includes("-cloud");
          const cb = b.includes(":cloud") || b.includes("-cloud");
          if (ca !== cb) return ca ? -1 : 1;
          return a.localeCompare(b);
        });
      }
    } catch {
      /* endpoint unreachable — leave ollama:false, empty list */
    }
  }
  return NextResponse.json({
    ollama,
    anthropic: !!(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.trim()),
    models,
    defaultModel: s.primaryModel,
  });
}
