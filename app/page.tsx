"use client";

import { useState } from "react";
import type { OfferBrief, Angle } from "@/agents/types";
import { EXAMPLE_OFFERS } from "@/lib/examples";

/**
 * L0 stepper UI (ZERO_TO_LAUNCH_BUILD_PLAN.md §2, L0): paste an offer (or a
 * URL) → Research Agent produces an OfferBrief → Angle Swarm produces divergent
 * angles. Each stage reveals its artifact in turn, matching the demo script
 * (build plan §8). Copy/compliance/advertorial/judge stages arrive in S2-S5.
 */

interface RunMeta {
  provider: string;
  model: string;
  usedFallback: boolean;
}

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
  const [researchMeta, setResearchMeta] = useState<RunMeta | null>(null);
  const [anglesMeta, setAnglesMeta] = useState<RunMeta | null>(null);

  const [researchLoading, setResearchLoading] = useState(false);
  const [anglesLoading, setAnglesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setBrief(null);
    setAngles(null);
    setResearchMeta(null);
    setAnglesMeta(null);
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
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAnglesLoading(false);
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
        </Card>
      )}
    </main>
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
