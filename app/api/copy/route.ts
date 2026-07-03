import { NextResponse } from "next/server";
import { copy, COPY_PLATFORMS, toPlatform } from "@/agents/copy";
import { coerceAngles } from "@/agents/angles";
import { coerceOfferBrief } from "@/agents/research";
import { AgentJsonError } from "@/lib/agentJson";

/**
 * POST /api/copy — { brief, angles, platforms? } -> { ok, copy, meta }
 *
 * Stage 3 of the pipeline: per-platform ad copy for the given angles. Brief and
 * angles are re-coerced through their agents' coercers so a replayed or
 * hand-edited payload can't inject a malformed shape into the copy prompts.
 */
export async function POST(req: Request) {
  let body: { brief?: unknown; angles?: unknown; platforms?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body must be JSON with { brief, angles }." }, { status: 400 });
  }

  if (!body.brief || typeof body.brief !== "object") {
    return NextResponse.json({ ok: false, error: "Missing offer brief. Run research first." }, { status: 400 });
  }

  const angles = coerceAngles({ angles: body.angles });
  if (angles.length === 0) {
    return NextResponse.json({ ok: false, error: "No angles provided. Generate angles first." }, { status: 400 });
  }

  const platforms = Array.isArray(body.platforms) && body.platforms.length > 0
    ? Array.from(new Set(body.platforms.map(toPlatform)))
    : COPY_PLATFORMS;

  try {
    const brief = coerceOfferBrief(body.brief, (body.brief as { url?: string }).url ?? "");
    const { copy: result, meta, failedPlatforms } = await copy(brief, angles, platforms);
    return NextResponse.json({
      ok: true,
      copy: result,
      // Non-empty only if some (but not all) platforms failed — a partial result.
      failedPlatforms,
      meta: meta.map((m) => ({ provider: m.provider, model: m.model, usedFallback: m.usedFallback })),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const status = e instanceof AgentJsonError ? 502 : 422;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
