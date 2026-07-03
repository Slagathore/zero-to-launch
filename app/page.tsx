"use client";

import { useState } from "react";
import type { OfferBrief, Angle, AdCopy, Platform, ComplianceVerdict } from "@/agents/types";
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

  const [researchLoading, setResearchLoading] = useState(false);
  const [anglesLoading, setAnglesLoading] = useState(false);
  const [copyLoading, setCopyLoading] = useState(false);
  const [advertorialLoading, setAdvertorialLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    setError(null);
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

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={runResearch}
            disabled={!canRun || researchLoading}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            {researchLoading ? "Analyzing…" : "Analyze offer"}
          </button>
          {researchMeta && <MetaTag meta={researchMeta} />}
        </div>
      </Card>

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
              disabled={anglesLoading}
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
              disabled={copyLoading}
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
                  const verdict = verdictFor(verdicts, c);
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
              disabled={advertorialLoading}
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

/** Match a compliance verdict to its ad by (angleId, platform). */
function verdictFor(verdicts: ComplianceVerdict[] | null, c: AdCopy): ComplianceVerdict | undefined {
  return verdicts?.find((v) => v.angleId === c.angleId && v.platform === c.platform);
}

function VerdictPill({ status, count }: { status: ComplianceVerdict["status"]; count: number }) {
  return (
    <span className={`rounded-full px-2 py-0.5 font-semibold ring-1 ring-inset ${VERDICT_STYLES[status]}`}>
      {count} {status}
    </span>
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
