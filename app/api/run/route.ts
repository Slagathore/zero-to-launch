import { STAGES, stageDataFromResult, type RunResult } from "@/agents/orchestrator-core";
import { loadSeededRun } from "@/lib/seededRun";

// The live pipeline (agents/orchestrator) transitively imports jsdom, which
// crashes at module load in Vercel's serverless runtime. Import it lazily so
// the seeded/no-offer paths — the only ones that run on the public deploy —
// never load jsdom. See agents/orchestrator-core.ts.

/**
 * POST /api/run — { url?, text?, seeded? } -> Server-Sent Events stream.
 *
 * The one-click orchestrated flow (build plan L4 — "the flex"). Streams a
 * progress event per stage, then a final `complete` event with the RunResult.
 *
 * Un-killable demo (build plan §8): if the live pipeline can't run (no model
 * reachable — e.g. the public URL without the tunnel — or a hard stage
 * failure), it silently falls back to replaying the committed seeded run, so
 * the demo NEVER cold-fails. Seeded output is tagged `seeded: true` (honest at
 * the API layer; the UI shows a small "cached" indicator). `seeded: true` in
 * the body forces the cached run on purpose.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { url?: string; text?: string; seeded?: boolean; settings?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body is fine — treated as a seeded demo request below */
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (obj: unknown) => {
        if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };

      // SSE heartbeat: a comment line every 15s so the connection never goes
      // idle. The generation stages (copy, advertorial) run the thinking model
      // for 60-120s with no events in between; without this, a proxy in front
      // of the app (Cloudflare's ~100s idle timeout) cuts the stream mid-run.
      // Comment lines (": ...") are ignored by the client's data-only parser.
      const heartbeat = setInterval(() => {
        if (!closed) {
          try {
            controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
          } catch {
            /* controller already closed */
          }
        }
      }, 15_000);

      async function replaySeeded(reason: string) {
        const seed = await loadSeededRun();
        if (!seed) {
          send({ type: "fatal", error: `No live pipeline and no seeded run available (${reason}).` });
          return;
        }
        send({ type: "info", seeded: true, message: reason });
        for (const stage of STAGES) {
          send({ type: "progress", seeded: true, event: { stage, status: "done", data: stageDataFromResult(seed, stage) } });
        }
        send({ type: "complete", seeded: true, result: seed });
      }

      try {
        if (body.seeded) {
          await replaySeeded("Showing a cached demo run.");
        } else if (!body.url && !body.text) {
          await replaySeeded("No offer provided — showing a cached demo run.");
        } else {
          const [{ runPipeline }, { coerceSettings }] = await Promise.all([
            import("@/agents/orchestrator"),
            import("@/lib/settings"),
          ]);
          const result: RunResult = await runPipeline(
            { url: body.url, text: body.text },
            (event) => send({ type: "progress", event }),
            coerceSettings(body.settings),
          );
          send({ type: "complete", result });
        }
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        // Live run failed mid-flight — fall back to the cached run so the demo holds.
        await replaySeeded(`Live run unavailable (${reason.slice(0, 140)}) — showing a cached demo run.`);
      } finally {
        clearInterval(heartbeat);
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
