import { NextResponse } from "next/server";
import { generateAdvertorial } from "@/agents/advertorial";
import { coerceAngles } from "@/agents/angles";
import { coerceOfferBrief } from "@/agents/research";
import { saveAdvertorial } from "@/lib/advertorialStore";
import { AgentJsonError } from "@/lib/agentJson";

/**
 * POST /api/advertorial — { brief, angle } -> { ok, advertorial, url, meta }
 *
 * Stage 4 of the pipeline (L2): develop ONE angle into a full advertorial
 * pre-lander, persist it, and hand back the live /p/[slug] URL — the page the
 * judge clicks. Inputs are re-coerced through their agents' coercers (house
 * pattern) so replayed/hand-edited payloads can't inject malformed shapes.
 */
export async function POST(req: Request) {
  let body: { brief?: unknown; angle?: unknown; model?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body must be JSON with { brief, angle }." }, { status: 400 });
  }

  if (!body.brief || typeof body.brief !== "object") {
    return NextResponse.json({ ok: false, error: "Missing offer brief. Run research first." }, { status: 400 });
  }
  const angle = coerceAngles({ angles: [body.angle] })[0];
  if (!angle) {
    return NextResponse.json({ ok: false, error: "Missing or empty angle. Generate angles first." }, { status: 400 });
  }

  try {
    const brief = coerceOfferBrief(body.brief, (body.brief as { url?: string }).url ?? "");
    const { advertorial, content, meta } = await generateAdvertorial(brief, angle, typeof body.model === "string" ? body.model : undefined);
    await saveAdvertorial({
      advertorial,
      content,
      offer: { product: brief.product, vertical: brief.vertical, url: brief.url },
      createdAt: new Date().toISOString(),
    });
    return NextResponse.json({
      ok: true,
      advertorial: { angleId: advertorial.angleId, slug: advertorial.slug, ftcDisclosure: advertorial.ftcDisclosure },
      url: `/p/${advertorial.slug}`,
      meta: { provider: meta.provider, model: meta.model, usedFallback: meta.usedFallback },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const status = e instanceof AgentJsonError ? 502 : 502; // generation failures are upstream either way
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
