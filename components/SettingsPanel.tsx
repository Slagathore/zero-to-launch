"use client";

import { useEffect, useState } from "react";
import type { Platform } from "@/agents/types";
import { MODEL_STAGES, DEFAULT_SETTINGS, type ModelStage, type Settings } from "@/lib/settings";

/**
 * Settings panel — the point of it is MODEL-PER-STAGE routing (the operator's
 * Ollama serves many cloud models; each stage can use a different one). Model
 * names are sent per request; API keys never leave the server. Fetches the
 * live model list + provider status from /api/models (booleans only).
 */

interface ModelsResponse {
  ollama: boolean;
  anthropic: boolean;
  models: string[];
  defaultModel: string;
}

const STAGE_LABEL: Record<ModelStage, string> = {
  research: "Research", angles: "Angle swarm", copy: "Copy", advertorial: "Advertorial", judge: "Judge",
};
const ALL_PLATFORMS: Platform[] = ["meta", "taboola", "google", "tiktok"];

export function SettingsPanel({ settings, onChange }: { settings: Settings; onChange: (s: Settings) => void }) {
  const [info, setInfo] = useState<ModelsResponse | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/models")
      .then((r) => r.json())
      .then((d: ModelsResponse) => { if (alive) setInfo(d); })
      .catch(() => { if (alive) setInfo({ ollama: false, anthropic: false, models: [], defaultModel: DEFAULT_SETTINGS.models.research }); });
    return () => { alive = false; };
  }, []);

  // Model options: the live list, unioned with whatever the settings already
  // reference (so a saved choice never disappears from its dropdown).
  const modelOptions = Array.from(new Set([
    ...(info?.models ?? []),
    ...MODEL_STAGES.map((s) => settings.models[s]),
  ])).filter(Boolean);

  const setModel = (stage: ModelStage, model: string) =>
    onChange({ ...settings, models: { ...settings.models, [stage]: model } });

  const togglePlatform = (p: Platform) => {
    const has = settings.generation.defaultPlatforms.includes(p);
    const next = has
      ? settings.generation.defaultPlatforms.filter((x) => x !== p)
      : [...settings.generation.defaultPlatforms, p];
    onChange({ ...settings, generation: { ...settings.generation, defaultPlatforms: next.length ? next : settings.generation.defaultPlatforms } });
  };

  return (
    <div className="rounded-2xl border border-neutral-500/15 bg-neutral-500/3 p-5">
      {/* provider status — booleans only, never keys */}
      <div className="mb-4 flex flex-wrap items-center gap-3 text-xs">
        <StatusDot ok={!!info?.ollama} label={info?.ollama ? "Ollama connected" : "Ollama not reachable here"} />
        <StatusDot ok={!!info?.anthropic} label={info?.anthropic ? "Anthropic configured" : "Anthropic not set"} muted={!info?.anthropic} />
        {info && <span className="text-neutral-400">{info.models.length} models available</span>}
      </div>

      {/* model per stage — the flex */}
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Model routing (per stage)</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {MODEL_STAGES.map((stage) => (
          <label key={stage} className="flex items-center justify-between gap-2 text-sm">
            <span className="shrink-0 text-neutral-500">{STAGE_LABEL[stage]}</span>
            <select
              value={settings.models[stage]}
              onChange={(e) => setModel(stage, e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-neutral-500/20 bg-transparent px-2 py-1.5 text-xs outline-none focus:border-neutral-500/50"
            >
              {modelOptions.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] text-neutral-400">
        Compliance is a deterministic regex gate — no model. Keys stay server-side; only model names are sent.
      </p>

      {/* generation + compliance */}
      <div className="mt-4 grid gap-4 border-t border-neutral-500/15 pt-4 sm:grid-cols-3">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">Angles</span>
          <input
            type="number" min={4} max={8} value={settings.generation.angleCount}
            onChange={(e) => onChange({ ...settings, generation: { ...settings.generation, angleCount: Math.min(8, Math.max(4, Number(e.target.value) || 6)) } })}
            className="w-20 rounded-lg border border-neutral-500/20 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-neutral-500/50"
          />
        </label>

        <div className="text-sm">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">Copy platforms</span>
          <div className="flex flex-wrap gap-1.5">
            {ALL_PLATFORMS.map((p) => {
              const on = settings.generation.defaultPlatforms.includes(p);
              return (
                <button
                  key={p} onClick={() => togglePlatform(p)}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset transition ${on ? "bg-neutral-900 text-white ring-neutral-900 dark:bg-white dark:text-neutral-900 dark:ring-white" : "text-neutral-500 ring-neutral-500/25 hover:ring-neutral-500/50"}`}
                >
                  {p}
                </button>
              );
            })}
          </div>
        </div>

        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">Compliance</span>
          <select
            value={settings.compliance.strictness}
            onChange={(e) => onChange({ ...settings, compliance: { strictness: e.target.value as Settings["compliance"]["strictness"] } })}
            className="rounded-lg border border-neutral-500/20 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-neutral-500/50"
          >
            <option value="lenient">Lenient (flags tolerated)</option>
            <option value="standard">Standard</option>
            <option value="strict">Strict (flags = block)</option>
          </select>
        </label>
      </div>

      <button
        onClick={() => onChange(DEFAULT_SETTINGS)}
        className="mt-4 text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-800 dark:hover:text-neutral-200"
      >
        Reset to defaults
      </button>
    </div>
  );
}

function StatusDot({ ok, label, muted }: { ok: boolean; label: string; muted?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${ok ? "bg-emerald-500" : muted ? "bg-neutral-400" : "bg-rose-500"}`} />
      <span className="text-neutral-500">{label}</span>
    </span>
  );
}
