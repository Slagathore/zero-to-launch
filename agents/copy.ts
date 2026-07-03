import type { AdCopy, Angle, OfferBrief, Platform } from "@/agents/types";
import { generateJson, asString, asRecord, asEnum } from "@/lib/agentJson";
import type { GenerateResult } from "@/lib/llm";

/**
 * Copy Agent (ZERO_TO_LAUNCH_BUILD_PLAN.md §2, L1). Turns the offer brief +
 * angles into per-platform ad copy. Prioritizes Meta + Taboola (build plan
 * §10) — the developer's named stack, and a deliberate paid-social vs. native
 * asymmetry: the same angle has to be written very differently for a Facebook
 * feed than for a Taboola content-recommendation widget, which is the point of
 * doing this per platform.
 *
 * Structure: ONE call per platform, each generating copy for every angle in
 * that platform's voice (fewer, larger calls beats N×P tiny calls on a
 * thinking model — cost + latency mindful). Each call uses generateJson (the
 * house generate→repair→coerce primitive), so a truncated/garbled JSON reply
 * is repaired rather than crashing the stage.
 *
 * Compliance is NOT enforced here — that's the S4 gate. Copy is written to be
 * persuasive-but-defensible; the gate then scores it and suggests fixes.
 */

/** Platforms L1 targets. Google/TikTok are wired into the type but out of scope until later. */
export const COPY_PLATFORMS: Platform[] = ["meta", "taboola"];

/** Per-platform voice + field guidance baked into each system prompt. */
const PLATFORM_GUIDANCE: Record<Platform, string> = {
  meta: `Platform: META (Facebook / Instagram feed ads).
Voice: conversational, scroll-stopping, feels native to a social feed. Lead with a pattern-interrupt hook.
Field guidance:
- primaryText: the body above the creative. Open with a 1-line hook, then 1-2 short lines of benefit. ~125 chars is the sweet spot; keep it tight.
- headline: bold benefit under the image, ~40 chars max.
- description: one short supporting line, ~30 chars.
- cta: use a real Meta CTA button label — one of "Learn More", "Shop Now", "Sign Up", "Get Offer", "Subscribe".`,
  taboola: `Platform: TABOOLA (native content-recommendation widget).
Voice: editorial curiosity — it must read like a recommended article, NOT an ad. Third-person, intrigue, open loop.
Field guidance:
- headline: the clickable native title. Curiosity + benefit, ~50-70 chars. This is the most important field.
- primaryText: a short teaser that continues the open loop, ~90 chars.
- description: one secondary supporting line.
- cta: a soft native CTA — one of "Read More", "Learn More", "Find Out", "See Why".`,
  google: `Platform: GOOGLE (responsive search ads).
Voice: high-intent, benefit-forward, keyword-relevant. The reader is actively searching — be direct, not clever.
Field guidance:
- headline: a punchy ~30-char headline (Google caps headlines at 30 chars).
- primaryText: the description line, ~90 chars, benefit + proof.
- description: a second ~90-char description line with a differentiator.
- cta: a plain action phrase — "Learn More".`,
  tiktok: `Platform: TIKTOK (in-feed video ad caption/hook).
Voice: native, casual, creator-style. Sounds like a person, not a brand. Front-load the hook.
Field guidance:
- headline: a scroll-stopping spoken hook for the first 2 seconds, ~40 chars.
- primaryText: the caption body, casual and punchy, ~100 chars.
- description: one short supporting line.
- cta: "Shop Now".`,
};

const CTA_WHITELISTS: Record<Platform, string[]> = {
  meta: ["Learn More", "Shop Now", "Sign Up", "Get Offer", "Subscribe"],
  taboola: ["Read More", "Learn More", "Find Out", "See Why"],
  google: ["Learn More"],
  tiktok: ["Shop Now"],
};

function systemPrompt(platform: Platform): string {
  return `You are a senior direct-response copywriter writing high-CTR paid-acquisition copy.

${PLATFORM_GUIDANCE[platform]}

You will receive an offer brief and a list of angles (each with an id, hook type, promise, and headline seed).
Write ONE ad for EACH angle, in this platform's voice, expanding that angle's specific hook.

Return ONLY a JSON object (no prose, no markdown fence) with EXACTLY this shape:
{
  "copy": [
    {
      "angleId": string,      // echo the angle's id EXACTLY so we can match it back
      "primaryText": string,
      "headline": string,
      "description": string,
      "cta": string
    }
  ]
}

Rules:
- Produce exactly one copy object per angle you were given, in the same order, echoing each angleId.
- Stay true to each angle's hook type and promise — do not collapse them into one generic ad.
- Ground the copy in the brief's product, USPs, and audience; do not invent features.
- Keep claims to what the offer supports; a later compliance pass will police specifics.`;
}

function buildUserMessage(brief: OfferBrief, angles: Angle[]): string {
  const compactAngles = angles.map((a) => ({
    id: a.id,
    hookType: a.hookType,
    promise: a.promise,
    headlineSeed: a.headlineSeed,
  }));
  return `OFFER BRIEF:
${JSON.stringify({ product: brief.product, vertical: brief.vertical, audience: brief.audience, usps: brief.usps }, null, 2)}

ANGLES (write one ad per angle):
${JSON.stringify(compactAngles, null, 2)}`;
}

/** Coerce one raw copy object into a typed AdCopy, stamping the platform. */
function coerceAdCopy(raw: unknown, platform: Platform, fallbackAngleId: string): AdCopy {
  const c = asRecord(raw);
  return {
    angleId: asString(c.angleId) || fallbackAngleId,
    platform,
    primaryText: asString(c.primaryText),
    headline: asString(c.headline),
    description: asString(c.description),
    cta: asString(c.cta) || CTA_WHITELISTS[platform][0],
  };
}

/**
 * Coerce a platform response into AdCopy[]. Matches each returned item back to
 * a known angle by echoed angleId, falling back to positional order (the
 * prompt asks for same-order output) so a model that drops/garbles an id
 * still lands on the right angle.
 */
export function coerceCopyForPlatform(raw: unknown, platform: Platform, angles: Angle[]): AdCopy[] {
  const o = asRecord(raw);
  const list = Array.isArray(o.copy) ? o.copy : Array.isArray(raw) ? raw : [];
  const knownIds = new Set(angles.map((a) => a.id));
  return list.map((item, i) => {
    const fallbackId = angles[i]?.id ?? `angle-${i + 1}`;
    const ac = coerceAdCopy(item, platform, fallbackId);
    // If the echoed id isn't one we recognize, trust positional order instead.
    if (!knownIds.has(ac.angleId)) ac.angleId = fallbackId;
    return ac;
  });
}

/** Normalize a platform label that may have arrived from the network. */
export function toPlatform(raw: unknown): Platform {
  return asEnum(raw, ["meta", "taboola", "google", "tiktok"] as const, "meta");
}

/** Coerce an arbitrary (e.g. replayed / network) list into typed AdCopy[].
 *  Used by the compliance route so it can score copy without trusting shape. */
export function coerceAdCopyList(raw: unknown): AdCopy[] {
  const list = Array.isArray(raw) ? raw : [];
  return list.map((item, i) => {
    const c = asRecord(item);
    return {
      angleId: asString(c.angleId) || `angle-${i + 1}`,
      platform: toPlatform(c.platform),
      primaryText: asString(c.primaryText),
      headline: asString(c.headline),
      description: asString(c.description),
      cta: asString(c.cta),
    };
  });
}

async function copyForPlatform(platform: Platform, brief: OfferBrief, angles: Angle[]) {
  return generateJson<AdCopy[]>(
    [
      { role: "system", content: systemPrompt(platform) },
      { role: "user", content: buildUserMessage(brief, angles) },
    ],
    (raw) => coerceCopyForPlatform(raw, platform, angles),
    // Generous budget: one ad per angle across several fields, on a thinking
    // model whose reasoning phase eats tokens before the JSON is emitted.
    { temperature: 0.75, maxTokens: 8000 },
  );
}

/**
 * One platform, with a single retry. kimi-k2.6:cloud is a thinking model and
 * occasionally emits unparseable/truncated JSON on a harder (multi-angle)
 * request; a fresh attempt almost always succeeds. Resolves to an empty
 * result (never throws) so one flaky platform can't sink the whole stage.
 */
async function copyForPlatformResilient(
  platform: Platform, brief: OfferBrief, angles: Angle[],
): Promise<{ copy: AdCopy[]; meta: GenerateResult | null; error?: string }> {
  let lastError = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { value, meta } = await copyForPlatform(platform, brief, angles);
      if (value.length > 0) return { copy: value, meta };
      lastError = "empty copy";
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  return { copy: [], meta: null, error: `${platform}: ${lastError}` };
}

/** Cap on how many angles we write copy for in one run — bounds output size
 *  (and mirrors real practice: you write copy for your best few angles). */
export const MAX_ANGLES_FOR_COPY = 6;

export interface CopyOutput {
  copy: AdCopy[];
  meta: GenerateResult[];
  /** Platforms that failed both attempts (empty when everything succeeded). */
  failedPlatforms: string[];
}

/**
 * Generate per-platform ad copy for a set of angles. Platforms run
 * sequentially (a single local Ollama proxying to the cloud serializes work
 * anyway, and it keeps token bursts bounded) and resiliently (a failing
 * platform degrades to partial results). Throws only if EVERY platform failed.
 */
export async function copy(
  brief: OfferBrief,
  angles: Angle[],
  platforms: Platform[] = COPY_PLATFORMS,
): Promise<CopyOutput> {
  const forCopy = angles.slice(0, MAX_ANGLES_FOR_COPY);
  const all: AdCopy[] = [];
  const meta: GenerateResult[] = [];
  const failedPlatforms: string[] = [];

  for (const platform of platforms) {
    const { copy: c, meta: m, error } = await copyForPlatformResilient(platform, brief, forCopy);
    if (c.length > 0) {
      all.push(...c);
      if (m) meta.push(m);
    } else {
      failedPlatforms.push(error ?? platform);
    }
  }

  if (all.length === 0) {
    throw new Error(`Copy generation failed for all platforms: ${failedPlatforms.join(" | ")}`);
  }
  return { copy: all, meta, failedPlatforms };
}
