import { getOffer } from "@/lib/fetchOffer";
import { research } from "@/agents/research";
import { angles as generateAngles } from "@/agents/angles";
import { copy as generateCopy } from "@/agents/copy";
import { compliance } from "@/agents/compliance";
import { generateAdvertorial } from "@/agents/advertorial";
import { saveAdvertorial } from "@/lib/advertorialStore";
import { rankAngles, judge } from "@/agents/judge";
import { type ProgressFn, type RunInput, type RunResult, type Stage } from "@/agents/orchestrator-core";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/settings";

// Re-export the jsdom-free core so existing importers keep one entry point.
// (Routes that only need the light helpers should import orchestrator-core
// directly — see that file's header for why.)
export { STAGES, stageDataFromResult } from "@/agents/orchestrator-core";
export type { Stage, ProgressEvent, ProgressFn, RunInput, RunResult } from "@/agents/orchestrator-core";

/**
 * Orchestrator (ZERO_TO_LAUNCH_BUILD_PLAN.md §2, L4) — chains the six agents
 * into one run and emits a progress event as each stage starts/finishes, so
 * /api/run can stream the pipeline stage-by-stage (build plan §8 demo).
 *
 * Order: research → angles → copy → compliance (sync gate) → advertorial (for
 * the top-ranked angle) → judge (rank, select, assemble the LaunchPackage).
 * The advertorial targets the deterministic top-ranked angle so the page the
 * judge sees is the one the pipeline actually recommends.
 *
 * The generation agents already retry internally; a hard failure here
 * propagates to the caller, which decides whether to fall back to the seeded
 * run (the un-killable-demo path).
 *
 * NOTE: this module transitively imports jsdom (via lib/fetchOffer) and must
 * only be imported where that's safe — lazy-import it on the live branch of a
 * route, never at a route's top level (see agents/orchestrator-core.ts).
 */

const noop: ProgressFn = () => {};

/** Run the full pipeline, emitting progress. `settings` routes each stage's
 *  model + controls angle count / platforms / compliance strictness. Throws on
 *  a stage that can't recover (the route turns that into a seeded-run fallback). */
export async function runPipeline(
  input: RunInput,
  onProgress: ProgressFn = noop,
  settings: Settings = DEFAULT_SETTINGS,
): Promise<RunResult> {
  const m = settings.models;
  async function stage<T>(name: Stage, fn: () => Promise<T> | T): Promise<T> {
    await onProgress({ stage: name, status: "start" });
    try {
      const data = await fn();
      await onProgress({ stage: name, status: "done", data });
      return data;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      await onProgress({ stage: name, status: "error", error });
      throw e;
    }
  }

  const brief = await stage("research", async () => {
    const offer = await getOffer({ url: input.url, text: input.text });
    return (await research(offer, m.research)).brief;
  });

  const angles = await stage("angles", async () => (await generateAngles(brief, m.angles, settings.generation.angleCount)).angles);

  const copy = await stage("copy", async () => (await generateCopy(brief, angles, settings.generation.defaultPlatforms, m.copy)).copy);

  const verdicts = await stage("compliance", () => compliance(copy, settings.compliance.strictness));

  const { slug, url, angleId } = await stage("advertorial", async () => {
    const ranking = rankAngles(angles, copy, verdicts);
    const topAngle = angles.find((a) => a.id === ranking[0]?.angleId) ?? angles[0];
    const { advertorial, content } = await generateAdvertorial(brief, topAngle, m.advertorial);
    await saveAdvertorial({
      advertorial,
      content,
      offer: { product: brief.product, vertical: brief.vertical, url: brief.url },
      createdAt: new Date().toISOString(),
    });
    return { slug: advertorial.slug, url: `/p/${advertorial.slug}`, angleId: topAngle.id };
  });

  const judgeResult = await stage("judge", async () => {
    const { result } = await judge({ brief, angles, copy, verdicts, advertorialUrl: url, model: m.judge });
    return result;
  });

  return { brief, angles, copy, verdicts, advertorialSlug: slug, advertorialUrl: url, advertorialAngleId: angleId, judge: judgeResult };
}
