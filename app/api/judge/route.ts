import { NextResponse } from "next/server";
import { judge } from "@/agents/judge";
import { coerceOfferBrief } from "@/agents/research";
import { coerceAngles } from "@/agents/angles";
import { coerceAdCopyList } from "@/agents/copy";
import { compliance } from "@/agents/compliance";
import type { ComplianceVerdict } from "@/agents/types";

/**
 * POST /api/judge — { brief, angles, copy, verdicts?, advertorialUrl? }
 *   -> { ok, ...JudgeResult }
 *
 * Stage 6: rank angles, pick the launch set, assemble the LaunchPackage,
 * explain. All inputs are re-coerced (house pattern). If verdicts aren't
 * supplied, we recompute them from the copy so the judge is never scoring
 * blind.
 */
export async function POST(req: Request) {
  let body: { brief?: unknown; angles?: unknown; copy?: unknown; verdicts?: unknown; advertorialUrl?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body must be JSON with { brief, angles, copy }." }, { status: 400 });
  }
  if (!body.brief || typeof body.brief !== "object") {
    return NextResponse.json({ ok: false, error: "Missing offer brief." }, { status: 400 });
  }

  const brief = coerceOfferBrief(body.brief, (body.brief as { url?: string }).url ?? "");
  const angles = coerceAngles({ angles: body.angles });
  const copy = coerceAdCopyList(body.copy);
  if (angles.length === 0) {
    return NextResponse.json({ ok: false, error: "No angles to judge." }, { status: 400 });
  }
  // Prefer supplied verdicts; otherwise score the copy ourselves so the judge
  // always factors compliance.
  const verdicts: ComplianceVerdict[] = Array.isArray(body.verdicts) && body.verdicts.length > 0
    ? (body.verdicts as ComplianceVerdict[])
    : compliance(copy);
  const advertorialUrl = typeof body.advertorialUrl === "string" ? body.advertorialUrl : "";

  const { result } = await judge({ brief, angles, copy, verdicts, advertorialUrl });
  return NextResponse.json({ ok: true, ...result });
}
