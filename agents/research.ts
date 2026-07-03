import type { OfferBrief } from "@/agents/types";
import { fenceUntrusted, FENCE_GUIDANCE } from "@/lib/fence";
import { generateJson, asString, asStringArray, asRecord, asEnum } from "@/lib/agentJson";
import type { ExtractedOffer } from "@/lib/fetchOffer";
import type { GenerateResult } from "@/lib/llm";

/**
 * Research Agent (ZERO_TO_LAUNCH_BUILD_PLAN.md §2, L0). Turns a scraped/pasted
 * affiliate offer into a structured OfferBrief: vertical, product, audience
 * (who / pains / desires), USPs, the raw claims found on the page, and a
 * compliance-risk rating. This is the pipeline's context stage — every later
 * agent (angles, copy, advertorial, judge) reads its output.
 *
 * The offer text is UNTRUSTED web content, so it enters the prompt only via
 * lib/fence.ts (fenceUntrusted) — an injected "ignore your instructions" in the
 * page can't hijack the analysis; it just gets reported as a detected claim.
 *
 * Claim detection + the compliance-risk rating here are what make the
 * downstream Compliance Gate (S4) meaningful: we flag the risky claims at the
 * source so the gate and the advertorial's FTC disclosure can address them.
 */

const SYSTEM_PROMPT = `You are the Research Agent in an affiliate-marketing campaign pipeline.
You analyze a single product offer and produce a rigorous, honest brief for a media-buying team.

${FENCE_GUIDANCE}

Return ONLY a JSON object (no prose, no markdown fence) with EXACTLY this shape:
{
  "vertical": string,            // market category, e.g. "weight-loss supplement", "solar financing"
  "product": string,             // the specific product/offer name
  "audience": {
    "who": string,               // one tight sentence describing the core buyer
    "painPoints": string[],      // 3-6 concrete pains this buyer feels
    "desires": string[]          // 3-6 concrete outcomes this buyer wants
  },
  "usps": string[],              // 3-6 unique selling points actually supported by the offer
  "claimsDetected": string[],    // verbatim-ish risky/marketing claims found in the offer text
  "complianceRisk": "low" | "med" | "high",  // overall ad-policy/FTC risk of THIS offer's claims
  "notes": string                // 1-3 sentences: anything a buyer should know before launching
}

Rules:
- Ground every field in the offer text; do not invent a product that isn't there.
- claimsDetected must capture health/income/"guaranteed"/"cure"/"#1" style claims as written — these drive the compliance stage.
- Rate complianceRisk "high" if the offer makes disease-cure, guaranteed-income, or miracle claims; "med" for strong but hedged claims; "low" for mild lifestyle claims.
- If the offer text is thin, do your best and say so in notes rather than fabricating.`;

/** Build the user message: task + the fenced untrusted offer content. */
function buildUserMessage(offer: ExtractedOffer): string {
  const meta = [
    offer.url ? `Offer URL: ${offer.url}` : "Offer source: pasted text",
    offer.title ? `Page title: ${offer.title}` : "",
    offer.truncated ? "(NOTE: offer text was truncated for length.)" : "",
  ]
    .filter(Boolean)
    .join("\n");

  return `Analyze this offer and produce the OfferBrief JSON.

${meta}

${fenceUntrusted("offer", offer.content)}`;
}

/** Coerce arbitrary parsed JSON into a valid, trusted OfferBrief. */
export function coerceOfferBrief(raw: unknown, url: string): OfferBrief {
  const o = asRecord(raw);
  const audience = asRecord(o.audience);
  return {
    url,
    vertical: asString(o.vertical, "unknown"),
    product: asString(o.product, "unknown"),
    audience: {
      who: asString(audience.who),
      painPoints: asStringArray(audience.painPoints),
      desires: asStringArray(audience.desires),
    },
    usps: asStringArray(o.usps),
    claimsDetected: asStringArray(o.claimsDetected),
    complianceRisk: asEnum(o.complianceRisk, ["low", "med", "high"] as const, "med"),
    notes: asString(o.notes),
  };
}

export interface ResearchOutput {
  brief: OfferBrief;
  meta: GenerateResult;
}

/** Run the Research Agent over an extracted offer. */
export async function research(offer: ExtractedOffer): Promise<ResearchOutput> {
  const { value, meta } = await generateJson<OfferBrief>(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserMessage(offer) },
    ],
    (raw) => coerceOfferBrief(raw, offer.url),
    { temperature: 0.3 },
  );
  return { brief: value, meta };
}
