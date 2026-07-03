import type { Angle, OfferBrief } from "@/agents/types";
import { generateJson, asString, asRecord } from "@/lib/agentJson";
import type { GenerateResult } from "@/lib/llm";

/**
 * Angle Swarm (ZERO_TO_LAUNCH_BUILD_PLAN.md §2 — the "divergence" stage, L0).
 * Maps to the Fusion Council pattern: this is the panelist swarm generating a
 * spread of DISTINCT marketing angles, each a different psychological hook, so
 * the later Judge stage (S5) has real diversity to rank rather than six
 * rewordings of one idea.
 *
 * Divergence is enforced by requiring a different `hookType` per angle drawn
 * from a fixed palette. For L0 this runs as ONE call that emits 4-6 divergent
 * angles (cheaper + faster on a thinking model, and enough to demo real
 * divergence); the code is shaped so S5/ultracode can later fan this out into
 * genuine parallel panelists (one call per hookType) modeled on
 * claw-deck/electron/council/agents.ts and dedupe the union.
 */

/** The hook palette the swarm must diverge across (one distinct hook per angle). */
export const HOOK_TYPES = [
  "curiosity",
  "fear",
  "social-proof",
  "before-after",
  "news-jack",
  "authority",
  "scarcity",
  "identity",
] as const;

const SYSTEM_PROMPT = `You are the Angle Swarm in an affiliate-marketing campaign pipeline.
Given a structured offer brief, you generate a DIVERSE set of distinct marketing angles — the
psychological entry points a media buyer would test against cold traffic.

Return ONLY a JSON object (no prose, no markdown fence) with EXACTLY this shape:
{
  "angles": [
    {
      "hookType": string,        // one of: ${HOOK_TYPES.join(", ")}
      "promise": string,         // the core promise this angle makes to the reader
      "emotionalDriver": string, // the single emotion it pulls (e.g. "fear of decline", "hope", "belonging")
      "headlineSeed": string,    // a punchy seed headline the copy stage can expand
      "rationale": string        // WHY this angle fits THIS audience's pains/desires — be specific
    }
  ]
}

Rules:
- Produce 4 to 6 angles. Each MUST use a DIFFERENT hookType from the list above — this is the point.
- Each angle must be genuinely distinct in approach, not a reworded twin of another.
- Ground the rationale in the brief's audience pains/desires and the product's real USPs.
- Keep claims within what the offer supports; the compliance stage will police specifics later.`;

function buildUserMessage(brief: OfferBrief): string {
  return `Generate the divergent angle set for this offer brief:

${JSON.stringify(brief, null, 2)}`;
}

/** Coerce one raw angle object into a typed Angle with a stable id. */
function coerceAngle(raw: unknown, index: number): Angle {
  const a = asRecord(raw);
  return {
    id: asString(a.id) || `angle-${index + 1}`,
    hookType: asString(a.hookType, "curiosity"),
    promise: asString(a.promise),
    emotionalDriver: asString(a.emotionalDriver),
    headlineSeed: asString(a.headlineSeed),
    rationale: asString(a.rationale),
  };
}

/** Coerce the swarm response into a validated Angle[] (drops empty entries). */
export function coerceAngles(raw: unknown): Angle[] {
  const o = asRecord(raw);
  const list = Array.isArray(o.angles) ? o.angles : Array.isArray(raw) ? raw : [];
  return list
    .map((a, i) => coerceAngle(a, i))
    // An angle with neither a promise nor a headline is useless — drop it.
    .filter((a) => a.promise.trim() || a.headlineSeed.trim());
}

export interface AnglesOutput {
  angles: Angle[];
  meta: GenerateResult;
}

/** Run the Angle Swarm over an OfferBrief. */
export async function angles(brief: OfferBrief): Promise<AnglesOutput> {
  const { value, meta } = await generateJson<Angle[]>(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserMessage(brief) },
    ],
    coerceAngles,
    // Higher temperature than research: we WANT creative spread here.
    { temperature: 0.8, maxTokens: 5000 },
  );
  return { angles: value, meta };
}
