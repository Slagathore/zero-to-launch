import { NextResponse } from "next/server";
import { askClaude } from "@/lib/claude";

/**
 * Sprint 0 infra proof: confirms lib/claude.ts reaches a real model end to
 * end. Not part of the product pipeline — superseded by agents/*.ts + their
 * own routes starting Sprint 1.
 */
export async function GET() {
  try {
    const result = await askClaude([
      { role: "user", content: "Reply with exactly one word: pong" },
    ], { maxTokens: 16 });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
