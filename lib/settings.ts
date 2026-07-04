import type { Platform } from "@/agents/types";

/**
 * User-tunable pipeline settings — persisted in localStorage (client) and sent
 * with each pipeline request. The headline is MODEL-PER-STAGE routing: this
 * app runs on a self-hosted Ollama serving many cloud models, so the operator
 * can point each stage at a different one (e.g. a fast model for copy, a
 * reasoning model for the judge). The model NAME is not a secret; any API keys
 * stay server-side in .env and are never sent to or stored in the browser.
 *
 * Compliance is intentionally NOT model-routable — it's a deterministic regex
 * gate (agents/compliance.ts), so there's no model to choose.
 */

/** Stages that actually call a model (compliance is deterministic). */
export const MODEL_STAGES = ["research", "angles", "copy", "advertorial", "judge"] as const;
export type ModelStage = (typeof MODEL_STAGES)[number];

export interface Settings {
  /** Per-stage model override (a model name the Ollama endpoint serves). */
  models: Record<ModelStage, string>;
  generation: {
    angleCount: number; // how many angles the swarm targets (4-8)
    defaultPlatforms: Platform[]; // platforms the copy stage writes for
  };
  compliance: {
    strictness: "lenient" | "standard" | "strict";
  };
}

/** The project default model — see lib/llm.ts DEFAULT_MODEL. */
export const DEFAULT_STAGE_MODEL = "kimi-k2.6:cloud";

export const DEFAULT_SETTINGS: Settings = {
  models: {
    research: DEFAULT_STAGE_MODEL,
    angles: DEFAULT_STAGE_MODEL,
    copy: DEFAULT_STAGE_MODEL,
    advertorial: DEFAULT_STAGE_MODEL,
    judge: DEFAULT_STAGE_MODEL,
  },
  generation: { angleCount: 6, defaultPlatforms: ["meta", "taboola"] },
  compliance: { strictness: "standard" },
};

const ALL_PLATFORMS: Platform[] = ["meta", "taboola", "google", "tiktok"];

/**
 * Merge an untrusted (client / replayed) settings object over the defaults so
 * a partial or malformed payload can't break the pipeline. Server-side safe.
 */
export function coerceSettings(raw: unknown): Settings {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const models = (typeof r.models === "object" && r.models !== null ? r.models : {}) as Record<string, unknown>;
  const generation = (typeof r.generation === "object" && r.generation !== null ? r.generation : {}) as Record<string, unknown>;
  const compliance = (typeof r.compliance === "object" && r.compliance !== null ? r.compliance : {}) as Record<string, unknown>;

  const modelFor = (stage: ModelStage): string =>
    typeof models[stage] === "string" && (models[stage] as string).trim()
      ? (models[stage] as string)
      : DEFAULT_SETTINGS.models[stage];

  const angleCountRaw = Number(generation.angleCount);
  const angleCount = Number.isFinite(angleCountRaw) ? Math.min(8, Math.max(4, Math.round(angleCountRaw))) : DEFAULT_SETTINGS.generation.angleCount;

  const platforms = Array.isArray(generation.defaultPlatforms)
    ? (generation.defaultPlatforms.filter((p): p is Platform => ALL_PLATFORMS.includes(p as Platform)))
    : DEFAULT_SETTINGS.generation.defaultPlatforms;

  const strictness = ["lenient", "standard", "strict"].includes(compliance.strictness as string)
    ? (compliance.strictness as Settings["compliance"]["strictness"])
    : DEFAULT_SETTINGS.compliance.strictness;

  return {
    models: {
      research: modelFor("research"),
      angles: modelFor("angles"),
      copy: modelFor("copy"),
      advertorial: modelFor("advertorial"),
      judge: modelFor("judge"),
    },
    generation: {
      angleCount,
      defaultPlatforms: platforms.length > 0 ? platforms : DEFAULT_SETTINGS.generation.defaultPlatforms,
    },
    compliance: { strictness },
  };
}
