import { NextResponse } from "next/server";
import { angles } from "@/agents/angles";
import { coerceOfferBrief } from "@/agents/research";
import { AgentJsonError } from "@/lib/agentJson";

/**
 * POST /api/angles  — { brief: OfferBrief } -> { ok, angles, meta }
 *
 * Stage 2 of the pipeline: the Angle Swarm turns an OfferBrief into 4-6
 * divergent marketing angles. The incoming brief is re-coerced through the
 * Research agent's coercer so a hand-edited or replayed brief can't inject a
 * malformed shape into the swarm prompt.
 */
export async function POST(req: Request) {
  let body: { brief?: unknown; model?: string; angleCount?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body must be JSON with { brief }." }, { status: 400 });
  }

  if (!body.brief || typeof body.brief !== "object") {
    return NextResponse.json({ ok: false, error: "Missing offer brief. Run research first." }, { status: 400 });
  }

  try {
    const brief = coerceOfferBrief(body.brief, (body.brief as { url?: string }).url ?? "");
    const count = Number.isFinite(body.angleCount) ? Math.min(8, Math.max(4, Number(body.angleCount))) : 6;
    const { angles: result, meta } = await angles(brief, typeof body.model === "string" ? body.model : undefined, count);
    if (result.length === 0) {
      return NextResponse.json({ ok: false, error: "The swarm returned no usable angles. Try again." }, { status: 502 });
    }
    return NextResponse.json({
      ok: true,
      angles: result,
      meta: { provider: meta.provider, model: meta.model, usedFallback: meta.usedFallback },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const status = e instanceof AgentJsonError ? 502 : 422;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
