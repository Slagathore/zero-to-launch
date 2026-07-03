import { NextResponse } from "next/server";
import { askLLM } from "@/lib/llm";

/**
 * Sprint 0 infra proof: confirms lib/llm.ts reaches a real model end to end
 * (self-hosted Ollama running a cloud Kimi). Not part of the product
 * pipeline — superseded by agents/*.ts + their own routes starting Sprint 1.
 */
export async function GET() {
  try {
    // kimi-k2.6:cloud is a thinking model — it spends tokens reasoning before
    // it emits `content`, so a tiny max_tokens would truncate inside the
    // thinking phase (returning empty content). 512 leaves ample room to finish.
    const result = await askLLM([
      { role: "user", content: "Reply with exactly one word: pong" },
    ], { maxTokens: 512 });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
