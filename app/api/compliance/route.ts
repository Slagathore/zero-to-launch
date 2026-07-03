import { NextResponse } from "next/server";
import { compliance, summarize, activeRuleCount } from "@/agents/compliance";
import { coerceAdCopyList } from "@/agents/copy";

/**
 * POST /api/compliance — { copy: AdCopy[] } -> { ok, verdicts, summary, ruleCount }
 *
 * The QA gate (L3). Deterministic + synchronous — no model call — so it
 * returns instantly. The pipeline calls this inline right after copy; the UI
 * attaches each verdict to its ad card. Copy is coerced defensively so a
 * replayed/hand-edited payload can't break the scorer.
 */
export async function POST(req: Request) {
  let body: { copy?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body must be JSON with { copy }." }, { status: 400 });
  }

  const copies = coerceAdCopyList(body.copy);
  if (copies.length === 0) {
    return NextResponse.json({ ok: false, error: "No copy to score. Generate copy first." }, { status: 400 });
  }

  const verdicts = compliance(copies);
  return NextResponse.json({
    ok: true,
    verdicts,
    summary: summarize(verdicts),
    ruleCount: activeRuleCount(),
  });
}
