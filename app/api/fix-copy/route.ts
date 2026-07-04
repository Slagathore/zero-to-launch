import { NextResponse } from "next/server";
import { fixAdCopy, coerceAdCopyList } from "@/agents/copy";
import { coerceAngles } from "@/agents/angles";
import { coerceOfferBrief } from "@/agents/research";
import { evaluateCopy } from "@/agents/compliance";
import { AgentJsonError } from "@/lib/agentJson";

/**
 * POST /api/fix-copy — { brief, angle, ad, violations?, model?, strictness? }
 *   -> { ok, ad, verdict }
 *
 * Rewrites one ad to resolve its compliance violations and re-scores it, so the
 * UI can swap the fixed ad in and show the (hopefully clean) new verdict.
 */
export async function POST(req: Request) {
  let body: { brief?: unknown; angle?: unknown; ad?: unknown; violations?: unknown; model?: string; strictness?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body must be JSON with { brief, angle, ad }." }, { status: 400 });
  }
  if (!body.brief || typeof body.brief !== "object") {
    return NextResponse.json({ ok: false, error: "Missing offer brief." }, { status: 400 });
  }
  const angle = coerceAngles({ angles: [body.angle] })[0];
  const ad = coerceAdCopyList([body.ad])[0];
  if (!angle || !ad) {
    return NextResponse.json({ ok: false, error: "Missing angle or ad." }, { status: 400 });
  }
  const violations = Array.isArray(body.violations)
    ? (body.violations as { offendingText?: unknown; fix?: unknown }[]).map((v) => ({
        offendingText: typeof v.offendingText === "string" ? v.offendingText : "",
        fix: typeof v.fix === "string" ? v.fix : "",
      }))
    : [];
  const strictness = ["lenient", "standard", "strict"].includes(body.strictness as string)
    ? (body.strictness as "lenient" | "standard" | "strict")
    : "standard";

  try {
    const brief = coerceOfferBrief(body.brief, (body.brief as { url?: string }).url ?? "");
    const fixed = await fixAdCopy(brief, angle, ad, violations, typeof body.model === "string" ? body.model : undefined);
    return NextResponse.json({ ok: true, ad: fixed, verdict: evaluateCopy(fixed, strictness) });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const status = e instanceof AgentJsonError ? 502 : 422;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
