import { promises as fs } from "node:fs";
import path from "node:path";
import type { RunResult } from "@/agents/orchestrator";

/**
 * Loads the cached full pipeline run (examples/seeded-run.json) that backs the
 * un-killable demo (build plan §8). It's a real RunResult captured from a live
 * run and committed, so /api/run can replay it when the live pipeline can't
 * reach the model (e.g. the public Vercel URL with no cloudflared tunnel up).
 * Ships in the serverless bundle via next.config outputFileTracingIncludes.
 */
export async function loadSeededRun(): Promise<RunResult | null> {
  const p = process.env.SEEDED_RUN_PATH || path.join(process.cwd(), "examples", "seeded-run.json");
  try {
    return JSON.parse(await fs.readFile(p, "utf8")) as RunResult;
  } catch {
    return null;
  }
}
