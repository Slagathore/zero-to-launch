import type { AdCopy, Angle, ComplianceVerdict, OfferBrief } from "@/agents/types";
import type { JudgeResult } from "@/agents/judge";

/**
 * jsdom-free core of the orchestrator: types + the pure stage helpers.
 *
 * Why this file exists (a real serverless bug, fixed here): the live pipeline
 * (agents/orchestrator.ts) imports lib/fetchOffer, which imports jsdom. jsdom
 * uses dynamic requires that fail to initialize in Vercel's bundled serverless
 * runtime — so ANY route that statically imports the orchestrator 500s at
 * module load, even on a code path that never touches jsdom (like /api/run's
 * seeded replay). /api/run imports these light helpers statically and
 * lazy-imports the heavy runPipeline only on the live branch.
 */

export type Stage = "research" | "angles" | "copy" | "compliance" | "advertorial" | "judge";

export const STAGES: Stage[] = ["research", "angles", "copy", "compliance", "advertorial", "judge"];

export interface ProgressEvent {
  stage: Stage;
  status: "start" | "done" | "error";
  /** Stage output on `done` (shape depends on stage). */
  data?: unknown;
  error?: string;
}

export type ProgressFn = (e: ProgressEvent) => void | Promise<void>;

export interface RunInput {
  url?: string;
  text?: string;
}

export interface RunResult {
  brief: OfferBrief;
  angles: Angle[];
  copy: AdCopy[];
  verdicts: ComplianceVerdict[];
  advertorialSlug: string;
  advertorialUrl: string;
  judge: JudgeResult;
}

/** Derive a stage's `done` payload from a completed RunResult — lets the
 *  seeded-run fallback replay a cached run through the same event shape the
 *  live pipeline emits (keeps /api/run's two paths identical for the UI). */
export function stageDataFromResult(r: RunResult, stage: Stage): unknown {
  switch (stage) {
    case "research": return r.brief;
    case "angles": return r.angles;
    case "copy": return r.copy;
    case "compliance": return r.verdicts;
    case "advertorial": return { slug: r.advertorialSlug, url: r.advertorialUrl };
    case "judge": return r.judge;
  }
}
