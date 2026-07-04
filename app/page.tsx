"use client";

import { useState, useEffect } from "react";
import type { OfferBrief, Angle, AdCopy, Platform, ComplianceVerdict } from "@/agents/types";
import type { JudgeResult } from "@/agents/judge";
import { EXAMPLE_OFFERS } from "@/lib/examples";

/**
 * Stepper UI (ZERO_TO_LAUNCH_BUILD_PLAN.md §2): paste/URL offer → Research
 * (OfferBrief) → Angle Swarm → per-platform Copy, each ad scored inline by the
 * Compliance Gate → a live Advertorial. Each stage reveals its artifact in
 * turn, matching the demo script (build plan §8). Judge + one-click run: S5.
 */

interface RunMeta {
  provider: string;
  model: string;
  usedFallback: boolean;
}

interface ComplianceSummary {
  total: number;
  pass: number;
  flag: number;
  block: number;
}

const VERDICT_STYLES: Record<ComplianceVerdict["status"], string> = {
  pass: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 ring-emerald-500/30",
  flag: "bg-amber-500/15 text-amber-600 dark:text-amber-400 ring-amber-500/30",
  block: "bg-rose-500/15 text-rose-600 dark:text-rose-400 ring-rose-500/30",
};

const RISK_STYLES: Record<OfferBrief["complianceRisk"], string> = {
  low: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 ring-emerald-500/30",
  med: "bg-amber-500/15 text-amber-600 dark:text-amber-400 ring-amber-500/30",
  high: "bg-rose-500/15 text-rose-600 dark:text-rose-400 ring-rose-500/30",
};

/** The RunResult shape /api/run streams (subset the client reads). */
interface RunResultLike {
  brief: OfferBrief;
  angles: Angle[];
  copy: AdCopy[];
  verdicts: ComplianceVerdict[];
  advertorialUrl: string;
  advertorialSlug: string;
  judge: JudgeResult;
}

type RunEvent =
  | { type: "info"; seeded?: boolean; message: string }
  | { type: "fatal"; error: string }
  | { type: "progress"; seeded?: boolean; event: { stage: string; status: "start" | "done" | "error"; data?: unknown; error?: string } }
  | { type: "complete"; seeded?: boolean; result: RunResultLike };

const RUN_STAGES = ["research", "angles", "copy", "compliance", "advertorial", "judge"] as const;
type RunStage = (typeof RUN_STAGES)[number];

/** Per-stage display copy + a rough duration estimate (seconds) for the ETA.
 *  Estimates are from real runs against the thinking model; compliance + judge
 *  are near-instant deterministic stages. */
const STAGE_META: Record<RunStage, { label: string; detail: string; est: number }> = {
  research: { label: "Reading the offer", detail: "Extracting product, audience, claims & risk", est: 35 },
  angles: { label: "Generating angles", detail: "Diverging across distinct psychological hooks", est: 55 },
  copy: { label: "Writing ad copy", detail: "Per-platform variants for each angle", est: 90 },
  compliance: { label: "Compliance gate", detail: "Scoring every ad vs. platform + FTC policy", est: 3 },
  advertorial: { label: "Building advertorial", detail: "A full FTC-labeled landing page", est: 90 },
  judge: { label: "Ranking launch set", detail: "Picking the best angles & explaining why", est: 18 },
};
const TOTAL_EST = RUN_STAGES.reduce((s, k) => s + STAGE_META[k].est, 0);

function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}

function summarizeVerdicts(verdicts: ComplianceVerdict[]): ComplianceSummary {
  const s: ComplianceSummary = { total: verdicts.length, pass: 0, flag: 0, block: 0 };
  for (const v of verdicts) s[v.status] += 1;
  return s;
}

export default function Home() {
  const [mode, setMode] = useState<"text" | "url">("text");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");

  const [brief, setBrief] = useState<OfferBrief | null>(null);
  const [angles, setAngles] = useState<Angle[] | null>(null);
  const [copy, setCopy] = useState<AdCopy[] | null>(null);
  const [verdicts, setVerdicts] = useState<ComplianceVerdict[] | null>(null);
  const [complianceSummary, setComplianceSummary] = useState<ComplianceSummary | null>(null);
  const [ruleCount, setRuleCount] = useState<number | null>(null);
  const [researchMeta, setResearchMeta] = useState<RunMeta | null>(null);
  const [anglesMeta, setAnglesMeta] = useState<RunMeta | null>(null);
  const [copyMeta, setCopyMeta] = useState<RunMeta | null>(null);
  const [advertorialUrl, setAdvertorialUrl] = useState<string | null>(null);
  const [advertorialMeta, setAdvertorialMeta] = useState<RunMeta | null>(null);
  const [advertorialAngleId, setAdvertorialAngleId] = useState<string>("");
  const [judgeResult, setJudgeResult] = useState<JudgeResult | null>(null);

  const [researchLoading, setResearchLoading] = useState(false);
  const [anglesLoading, setAnglesLoading] = useState(false);
  const [copyLoading, setCopyLoading] = useState(false);
  const [advertorialLoading, setAdvertorialLoading] = useState(false);
  const [running, setRunning] = useState(false); // the one-click orchestrated run
  const [runStage, setRunStage] = useState<string | null>(null);
  const [doneStages, setDoneStages] = useState<string[]>([]);
  const [runStartMs, setRunStartMs] = useState<number | null>(null);
  const [stageStartMs, setStageStartMs] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState<number>(0);
  const [seeded, setSeeded] = useState(false); // whether the shown run is the cached demo
  const [error, setError] = useState<string | null>(null);

  // Tick a 1s clock only while a run is in flight, to drive the elapsed/ETA
  // display. Initial `nowMs` is seeded in runAll(); the effect only owns the interval.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  function clearCopyAndDownstream() {
    setCopy(null);
    setCopyMeta(null);
    setVerdicts(null);
    setComplianceSummary(null);
    setRuleCount(null);
  }

  function reset() {
    setBrief(null);
    setAngles(null);
    clearCopyAndDownstream();
    setResearchMeta(null);
    setAnglesMeta(null);
    setAdvertorialUrl(null);
    setAdvertorialMeta(null);
    setAdvertorialAngleId("");
    setJudgeResult(null);
    setSeeded(false);
    setDoneStages([]);
    setRunStartMs(null);
    setStageStartMs(null);
    setError(null);
  }

  /** One-click orchestrated run: stream /api/run (SSE) and fill each stage as
   *  it lands. Falls back to the cached demo run automatically (server-side)
   *  when the live pipeline can't reach the model. */
  async function runAll(payload: { url?: string; text?: string; seeded?: boolean }) {
    reset();
    setRunning(true);
    setRunStage("research");
    setDoneStages([]);
    const t0 = Date.now();
    setRunStartMs(t0);
    setStageStartMs(t0);
    setNowMs(t0);
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.body) throw new Error("No response stream.");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const dataLine = part.split("\n").find((l) => l.startsWith("data:"));
          if (!dataLine) continue;
          handleRunEvent(JSON.parse(dataLine.slice(5).trim()));
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
      setRunStage(null);
    }
  }

  function handleRunEvent(ev: RunEvent) {
    if (ev.type === "info") {
      if (ev.seeded) setSeeded(true);
      return;
    }
    if (ev.type === "fatal") {
      setError(ev.error);
      return;
    }
    if (ev.type === "progress" && ev.event.status === "start") {
      // A stage began — light it up and reset the in-stage clock for the ETA.
      setRunStage(ev.event.stage);
      setStageStartMs(Date.now());
    }
    if (ev.type === "progress" && ev.event.status === "done") {
      if (ev.seeded) setSeeded(true);
      applyStage(ev.event.stage, ev.event.data);
      setDoneStages((prev) => (prev.includes(ev.event.stage) ? prev : [...prev, ev.event.stage]));
    }
    if (ev.type === "complete") {
      if (ev.seeded) setSeeded(true);
      // The complete payload carries the whole RunResult — trust it as the
      // final source of truth (covers any event we might have missed).
      const r = ev.result;
      setBrief(r.brief);
      setAngles(r.angles);
      setCopy(r.copy);
      setVerdicts(r.verdicts);
      setComplianceSummary(summarizeVerdicts(r.verdicts));
      setAdvertorialUrl(r.advertorialUrl);
      setJudgeResult(r.judge);
      if (r.angles[0]?.id) setAdvertorialAngleId(r.angles[0].id);
      setDoneStages([...RUN_STAGES]);
      setRunStage(null);
    }
  }

  function applyStage(stage: string, data: unknown) {
    switch (stage) {
      case "research": setBrief(data as OfferBrief); break;
      case "angles": {
        const a = data as Angle[];
        setAngles(a);
        if (a[0]?.id) setAdvertorialAngleId(a[0].id);
        break;
      }
      case "copy": setCopy(data as AdCopy[]); break;
      case "compliance": {
        const v = data as ComplianceVerdict[];
        setVerdicts(v);
        setComplianceSummary(summarizeVerdicts(v));
        break;
      }
      case "advertorial": setAdvertorialUrl((data as { url: string }).url); break;
      case "judge": setJudgeResult(data as JudgeResult); break;
    }
  }

  async function runResearch() {
    reset();
    setResearchLoading(true);
    try {
      const payload = mode === "url" ? { url } : { text };
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Research failed.");
      setBrief(data.brief);
      setResearchMeta(data.meta);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setResearchLoading(false);
    }
  }

  async function runAngles() {
    if (!brief) return;
    setAnglesLoading(true);
    setError(null);
    setSeeded(false); // a manual regeneration is always a live model call
    // Regenerating angles invalidates any copy/advertorial made for the old set.
    clearCopyAndDownstream();
    setAdvertorialUrl(null);
    setAdvertorialMeta(null);
    setAdvertorialAngleId("");
    try {
      const res = await fetch("/api/angles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Angle generation failed.");
      setAngles(data.angles);
      setAnglesMeta(data.meta);
      // Default the advertorial to the first (top) angle.
      if (data.angles?.[0]?.id) setAdvertorialAngleId(data.angles[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAnglesLoading(false);
    }
  }

  async function runAdvertorial() {
    if (!brief || !angles) return;
    const angle = angles.find((a) => a.id === advertorialAngleId) ?? angles[0];
    if (!angle) return;
    setAdvertorialLoading(true);
    setError(null);
    setSeeded(false); // a manual regeneration is always a live model call
    try {
      const res = await fetch("/api/advertorial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief, angle }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Advertorial generation failed.");
      setAdvertorialUrl(data.url);
      setAdvertorialMeta(data.meta);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAdvertorialLoading(false);
    }
  }

  async function runCopy() {
    if (!brief || !angles) return;
    setCopyLoading(true);
    setError(null);
    setSeeded(false); // a manual regeneration is always a live model call
    try {
      const res = await fetch("/api/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief, angles }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Copy generation failed.");
      setCopy(data.copy);
      // The copy stage returns one meta per platform; surface the first for the tag.
      setCopyMeta(Array.isArray(data.meta) ? data.meta[0] : data.meta);
      // Inline QA gate: score the fresh copy immediately (deterministic + instant).
      await runCompliance(data.copy);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCopyLoading(false);
    }
  }

  async function runCompliance(copyToScore: AdCopy[]) {
    try {
      const res = await fetch("/api/compliance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ copy: copyToScore }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Compliance scoring failed.");
      setVerdicts(data.verdicts);
      setComplianceSummary(data.summary);
      setRuleCount(data.ruleCount);
    } catch (e) {
      // The gate is non-blocking for the pipeline: if it fails, copy still shows.
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const canRun = mode === "url" ? url.trim().length > 0 : text.trim().length > 0;

  // Match each ad to its compliance verdict BY POSITION: compliance() returns
  // verdicts in the same order as the copy array, so verdicts[i] belongs to
  // copy[i]. Keying by (angleId, platform) instead would be wrong whenever a
  // platform has two ads for the same angle (they'd share the first's verdict).
  const verdictByCopy = new Map<AdCopy, ComplianceVerdict>();
  if (copy && verdicts) copy.forEach((c, i) => { if (verdicts[i]) verdictByCopy.set(c, verdicts[i]); });

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-10 sm:py-14">
      <header className="mb-8">
        <p className="text-xs font-mono uppercase tracking-widest text-neutral-500">Zero-to-Launch</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Campaign Launch Agent</h1>
        <p className="mt-2 max-w-2xl text-sm text-neutral-500">
          Drop in an affiliate offer. Watch the pipeline turn it into a brief, then a spread of
          divergent marketing angles. (Copy, compliance, a live advertorial, and a ranked launch set
          come next.)
        </p>
      </header>

      {/* Step 1 — offer input */}
      <Card step={1} title="The offer">
        <div className="mb-3 inline-flex rounded-lg bg-neutral-500/10 p-0.5 text-sm">
          <ModeButton active={mode === "text"} onClick={() => setMode("text")}>Paste text</ModeButton>
          <ModeButton active={mode === "url"} onClick={() => setMode("url")}>From URL</ModeButton>
        </div>

        {mode === "url" ? (
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://the-offer-page.com/…"
            className="w-full rounded-lg border border-neutral-500/20 bg-transparent px-3 py-2 text-sm outline-none focus:border-neutral-500/50"
          />
        ) : (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste the offer page copy here…"
            rows={6}
            className="w-full resize-y rounded-lg border border-neutral-500/20 bg-transparent px-3 py-2 text-sm outline-none focus:border-neutral-500/50"
          />
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-neutral-500">Try an example:</span>
          {EXAMPLE_OFFERS.map((ex) => (
            <button
              key={ex.label}
              onClick={() => { setMode("text"); setText(ex.text); }}
              className="rounded-full border border-neutral-500/25 px-3 py-1 text-xs text-neutral-600 transition hover:border-neutral-500/50 dark:text-neutral-300"
            >
              {ex.label}
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            onClick={() => runAll(mode === "url" ? { url } : { text })}
            disabled={!canRun || running}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            {running ? `Running… ${runStage ?? ""}` : "▶ Run full pipeline"}
          </button>
          <button
            onClick={runResearch}
            disabled={!canRun || researchLoading || running}
            className="rounded-lg border border-neutral-500/30 px-4 py-2 text-sm font-medium transition hover:border-neutral-500/60 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {researchLoading ? "Analyzing…" : "Step through manually"}
          </button>
          <button
            onClick={() => runAll({ seeded: true })}
            disabled={running}
            className="text-xs text-neutral-500 underline underline-offset-2 transition hover:text-neutral-800 disabled:opacity-40 dark:hover:text-neutral-200"
          >
            watch a cached demo run
          </button>
          {researchMeta && <MetaTag meta={researchMeta} />}
        </div>
      </Card>

      {seeded && (
        <div className="mt-4 rounded-lg border border-sky-500/30 bg-sky-500/10 px-4 py-2.5 text-xs text-sky-700 dark:text-sky-300">
          Showing a <strong>cached demo run</strong> — the live model wasn’t reachable from here (it runs on the operator’s
          machine). Every stage below is a real, previously-generated pipeline output.
        </div>
      )}

      {running && (
        <PipelineProgress
          current={runStage}
          done={doneStages}
          seeded={seeded}
          elapsedSec={runStartMs ? (nowMs - runStartMs) / 1000 : 0}
          stageElapsedSec={stageStartMs ? (nowMs - stageStartMs) / 1000 : 0}
        />
      )}

      {error && (
        <div className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-600 dark:text-rose-400">
          {error}
        </div>
      )}

      {/* Step 2 — the brief */}
      {brief && (
        <Card step={2} title="Offer brief">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{brief.vertical}</Badge>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${RISK_STYLES[brief.complianceRisk]}`}
            >
              compliance risk: {brief.complianceRisk}
            </span>
          </div>
          <h3 className="mt-3 text-lg font-semibold">{brief.product}</h3>

          <Field label="Who it's for">{brief.audience.who}</Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <ListField label="Pain points" items={brief.audience.painPoints} />
            <ListField label="Desires" items={brief.audience.desires} />
          </div>
          <ListField label="USPs" items={brief.usps} />
          {brief.claimsDetected.length > 0 && (
            <ListField label="Claims detected (compliance-relevant)" items={brief.claimsDetected} />
          )}
          {brief.notes && <Field label="Notes">{brief.notes}</Field>}

          <div className="mt-5 flex items-center gap-3">
            <button
              onClick={runAngles}
              disabled={anglesLoading || running}
              className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              {anglesLoading ? "Generating angles…" : "Generate angles"}
            </button>
            {anglesMeta && <MetaTag meta={anglesMeta} />}
          </div>
        </Card>
      )}

      {/* Step 3 — the angles */}
      {angles && angles.length > 0 && (
        <Card step={3} title={`Angles (${angles.length})`}>
          <div className="grid gap-3">
            {angles.map((a) => (
              <div key={a.id} className="rounded-xl border border-neutral-500/15 bg-neutral-500/5 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="rounded-full bg-neutral-500/15 px-2.5 py-0.5 text-xs font-medium">{a.hookType}</span>
                  <span className="text-xs text-neutral-500">{a.emotionalDriver}</span>
                </div>
                <p className="mt-2 text-base font-semibold leading-snug">{a.headlineSeed}</p>
                <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">{a.promise}</p>
                <p className="mt-2 border-t border-neutral-500/15 pt-2 text-xs text-neutral-500">
                  <span className="font-medium text-neutral-600 dark:text-neutral-400">Why: </span>
                  {a.rationale}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-5 flex items-center gap-3">
            <button
              onClick={runCopy}
              disabled={copyLoading || running}
              className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              {copyLoading ? "Writing copy…" : "Generate ad copy"}
            </button>
            {copyMeta && <MetaTag meta={copyMeta} />}
          </div>
        </Card>
      )}

      {/* Step 4 — the per-platform copy, each ad scored by the inline compliance gate */}
      {copy && copy.length > 0 && angles && (
        <Card step={4} title={`Ad copy (${copy.length})`}>
          {complianceSummary && (
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-neutral-500/15 bg-neutral-500/5 px-3 py-2 text-xs">
              <span className="font-semibold uppercase tracking-wide text-neutral-500">Compliance gate</span>
              <VerdictPill status="pass" count={complianceSummary.pass} />
              <VerdictPill status="flag" count={complianceSummary.flag} />
              <VerdictPill status="block" count={complianceSummary.block} />
              {ruleCount != null && (
                <span className="ml-auto text-neutral-400">{ruleCount} rules · Meta/Taboola/Google/TikTok + FTC</span>
              )}
            </div>
          )}
          {groupByPlatform(copy).map(([platform, items]) => (
            <div key={platform} className="mt-2 first:mt-0">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                {PLATFORM_LABELS[platform] ?? platform}
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {items.map((c, i) => {
                  const verdict = verdictByCopy.get(c);
                  return (
                    <div key={`${c.angleId}-${i}`} className="flex flex-col rounded-xl border border-neutral-500/15 bg-neutral-500/5 p-4">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="rounded-full bg-neutral-500/15 px-2 py-0.5 text-[11px] font-medium text-neutral-500">
                          {hookFor(angles, c.angleId)}
                        </span>
                        {verdict && (
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase ring-1 ring-inset ${VERDICT_STYLES[verdict.status]}`}>
                            {verdict.status}
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-semibold leading-snug">{c.headline}</p>
                      <p className="mt-1 flex-1 text-sm text-neutral-600 dark:text-neutral-300">{c.primaryText}</p>
                      {c.description && <p className="mt-1 text-xs text-neutral-500">{c.description}</p>}
                      <span className="mt-3 self-start rounded-md bg-neutral-900 px-2.5 py-1 text-xs font-medium text-white dark:bg-white dark:text-neutral-900">
                        {c.cta}
                      </span>
                      {verdict && verdict.violations.length > 0 && (
                        <ul className="mt-3 space-y-1.5 border-t border-neutral-500/15 pt-2.5">
                          {verdict.violations.map((v, vi) => (
                            <li key={vi} className="text-[11px] leading-snug">
                              <span className={`font-semibold ${v.severity === "block" ? "text-rose-600 dark:text-rose-400" : "text-amber-600 dark:text-amber-400"}`}>
                                {v.severity}
                              </span>
                              <span className="text-neutral-500"> · “{v.offendingText}” — {v.fix}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </Card>
      )}

      {/* Step 5 — the live advertorial pre-lander */}
      {angles && angles.length > 0 && (
        <Card step={5} title="Advertorial pre-lander">
          <p className="mb-3 text-sm text-neutral-500">
            Develop one angle into a full, FTC-labeled advertorial — served live on this site.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={advertorialAngleId}
              onChange={(e) => setAdvertorialAngleId(e.target.value)}
              className="rounded-lg border border-neutral-500/20 bg-transparent px-3 py-2 text-sm outline-none focus:border-neutral-500/50"
            >
              {angles.map((a) => (
                <option key={a.id} value={a.id}>
                  [{a.hookType}] {a.headlineSeed}
                </option>
              ))}
            </select>
            <button
              onClick={runAdvertorial}
              disabled={advertorialLoading || running}
              className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              {advertorialLoading ? "Writing advertorial…" : "Generate advertorial"}
            </button>
            {advertorialMeta && <MetaTag meta={advertorialMeta} />}
          </div>

          {advertorialUrl && (
            <a
              href={advertorialUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 transition hover:bg-emerald-500/15"
            >
              <span className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                Live advertorial ready — click to open the real page
              </span>
              <span className="shrink-0 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white">
                Open ↗
              </span>
            </a>
          )}
        </Card>
      )}

      {/* Step 6 — the Judge's ranked recommendation + launch package */}
      {judgeResult && (
        <Card step={6} title="Recommended launch set">
          <div className="rounded-xl border border-neutral-500/15 bg-neutral-500/5 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
              Why these angles {judgeResult.rationaleSource === "heuristic" && <span className="text-neutral-400">(heuristic)</span>}
            </p>
            <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-200">{judgeResult.rationale}</p>
          </div>

          <div className="mt-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">Ranking</p>
            <ol className="space-y-1.5">
              {judgeResult.ranking.map((r, i) => {
                const picked = judgeResult.launchPackage.recommendedAngles.some((a) => a.id === r.angleId);
                return (
                  <li key={r.angleId} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${picked ? "bg-emerald-500/10 ring-1 ring-inset ring-emerald-500/25" : "bg-neutral-500/5"}`}>
                    <span className="w-5 shrink-0 text-xs font-semibold text-neutral-400">{i + 1}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase ring-1 ring-inset ${VERDICT_STYLES[r.worstStatus]}`}>{r.worstStatus}</span>
                    <span className="flex-1 truncate">{r.headlineSeed}</span>
                    <span className="shrink-0 text-[11px] text-neutral-500">{r.hookType} · {r.score}</span>
                    {picked && <span className="shrink-0 rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">LAUNCH</span>}
                  </li>
                );
              })}
            </ol>
          </div>

          <ListField label="Launch checklist" items={judgeResult.launchPackage.checklist} />

          {judgeResult.launchPackage.advertorialUrl && (
            <a
              href={judgeResult.launchPackage.advertorialUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              Open the recommended advertorial ↗
            </a>
          )}
        </Card>
      )}
    </main>
  );
}

const PLATFORM_LABELS: Partial<Record<Platform, string>> = {
  meta: "Meta (Facebook / Instagram)",
  taboola: "Taboola (native)",
  google: "Google",
  tiktok: "TikTok",
};

/** Group copy by platform, preserving first-seen platform order. */
function groupByPlatform(copy: AdCopy[]): [Platform, AdCopy[]][] {
  const groups = new Map<Platform, AdCopy[]>();
  for (const c of copy) {
    const list = groups.get(c.platform) ?? [];
    list.push(c);
    groups.set(c.platform, list);
  }
  return [...groups.entries()];
}

/** Look up the hook type of the angle a piece of copy was written for. */
function hookFor(angles: Angle[], angleId: string): string {
  return angles.find((a) => a.id === angleId)?.hookType ?? "angle";
}

function VerdictPill({ status, count }: { status: ComplianceVerdict["status"]; count: number }) {
  return (
    <span className={`rounded-full px-2 py-0.5 font-semibold ring-1 ring-inset ${VERDICT_STYLES[status]}`}>
      {count} {status}
    </span>
  );
}

/** The loading artifact shown during a one-click run: a live stage tracker with
 *  elapsed time and a best-effort ETA (skipped for the near-instant cached run). */
function PipelineProgress({
  current, done, seeded, elapsedSec, stageElapsedSec,
}: {
  current: string | null;
  done: string[];
  seeded: boolean;
  elapsedSec: number;
  stageElapsedSec: number;
}) {
  const notDone = RUN_STAGES.filter((s) => !done.includes(s));
  const estRemaining = notDone.reduce((sum, s) => sum + STAGE_META[s].est, 0);
  const remainingSec = Math.max(2, estRemaining - stageElapsedSec);
  const doneEst = RUN_STAGES.filter((s) => done.includes(s)).reduce((sum, s) => sum + STAGE_META[s].est, 0);
  const pct = Math.min(100, Math.round((doneEst / TOTAL_EST) * 100));

  return (
    <section className="mt-4 rounded-2xl border border-neutral-500/15 bg-neutral-500/3 p-5 shadow-sm">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">
          {done.length === RUN_STAGES.length ? "Finishing up…" : "Running the pipeline"}
        </h2>
        <span className="text-xs tabular-nums text-neutral-500">
          {fmtDuration(elapsedSec)} elapsed
          {!seeded && done.length < RUN_STAGES.length && <> · ~{fmtDuration(remainingSec)} left</>}
        </span>
      </div>

      {/* progress bar */}
      <div className="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-neutral-500/15">
        <div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>

      <ol className="space-y-1.5">
        {RUN_STAGES.map((stage) => {
          const isDone = done.includes(stage);
          const isCurrent = !isDone && stage === current;
          const meta = STAGE_META[stage];
          return (
            <li key={stage} className={`flex items-center gap-3 rounded-lg px-2 py-1.5 ${isCurrent ? "bg-neutral-500/10" : ""}`}>
              <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                {isDone ? (
                  <span className="text-emerald-500">✓</span>
                ) : isCurrent ? (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-neutral-400 border-t-transparent" />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-neutral-500/40" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className={`text-sm ${isCurrent ? "font-semibold" : isDone ? "text-neutral-500" : "text-neutral-400"}`}>
                  {meta.label}
                </p>
                {isCurrent && <p className="truncate text-xs text-neutral-500">{meta.detail}</p>}
              </div>
              {isCurrent && !seeded && (
                <span className="shrink-0 text-xs tabular-nums text-neutral-400">{fmtDuration(stageElapsedSec)}</span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/* --- small presentational components --- */

function Card({ step, title, children }: { step: number; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-4 rounded-2xl border border-neutral-500/15 bg-neutral-500/3 p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-neutral-900 text-xs font-semibold text-white dark:bg-white dark:text-neutral-900">
          {step}
        </span>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function ModeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-3 py-1 font-medium transition ${
        active ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-900 dark:text-white" : "text-neutral-500"
      }`}
    >
      {children}
    </button>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-neutral-500/15 px-2.5 py-0.5 text-xs font-medium">{children}</span>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="mt-0.5 text-sm text-neutral-700 dark:text-neutral-200">{children}</p>
    </div>
  );
}

function ListField({ label, items }: { label: string; items: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</p>
      <ul className="mt-1 list-inside list-disc space-y-0.5 text-sm text-neutral-700 dark:text-neutral-200">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}

function MetaTag({ meta }: { meta: RunMeta }) {
  return (
    <span className="text-xs text-neutral-400">
      {meta.model}
      {meta.usedFallback ? " (fallback)" : ""}
    </span>
  );
}
