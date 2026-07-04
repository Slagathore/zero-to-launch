import { NextResponse } from "next/server";
import { research } from "@/agents/research";
import { AgentJsonError } from "@/lib/agentJson";

/**
 * POST /api/research  — { url?: string, text?: string } -> { ok, brief, extraction, meta }
 *
 * Stage 1 of the pipeline: extract the offer (URL fetch or pasted-text
 * fallback), then run the Research Agent to produce an OfferBrief. Errors are
 * returned as { ok:false, error } with a helpful message (e.g. "paste the
 * offer text instead") rather than a 500, so the UI can guide the user.
 *
 * lib/fetchOffer is lazy-imported inside the handler: it pulls in jsdom, whose
 * dynamic requires crash at MODULE LOAD in Vercel's serverless runtime — a
 * top-level import would 500 the route uncatchably. (Same fix as /api/run.)
 */
export async function POST(req: Request) {
  let body: { url?: string; text?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body must be JSON with { url } or { text }." }, { status: 400 });
  }

  try {
    const { getOffer } = await import("@/lib/fetchOffer");
    const extraction = await getOffer({ url: body.url, text: body.text });
    const { brief, meta } = await research(extraction);
    return NextResponse.json({
      ok: true,
      brief,
      extraction: { source: extraction.source, title: extraction.title, truncated: extraction.truncated },
      meta: { provider: meta.provider, model: meta.model, usedFallback: meta.usedFallback },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // A JSON-parse failure from the model is a 502 (upstream), a bad
    // offer/input is a 422 the user can fix.
    const status = e instanceof AgentJsonError ? 502 : 422;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
