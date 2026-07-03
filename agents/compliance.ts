import type { AdCopy, ComplianceVerdict, Platform } from "@/agents/types";
import rulesData from "@/lib/compliance-rules.json";

/**
 * Compliance Gate (ZERO_TO_LAUNCH_BUILD_PLAN.md §2 — the "Codex QA gate" of
 * the Fusion Council mapping, L3). Scores ad copy against a CURATED,
 * deterministic ruleset (lib/compliance-rules.json) covering Meta / Taboola /
 * Google / TikTok policy + FTC, and returns a per-copy verdict:
 * pass / flag / block, with the offending text and a concrete fix for each hit.
 *
 * Why deterministic regex, not an LLM (build plan §3): a QA gate should be
 * fast, free, and REPRODUCIBLE — the same copy always scores the same way, and
 * a reviewer can read exactly which rule fired and why. The honest limitation
 * (a curated subset, not the full policy corpora; regex misses paraphrase) is
 * stated in the ruleset's _meta and the README; a live policy-RAG is the top
 * what's-next. This module does NOT call the model — it's instant.
 *
 * The gate never rewrites or deletes copy. It reports. Wiring it "inline"
 * (build plan L3) means the pipeline runs it automatically after copy and
 * attaches verdicts to each ad; a `block` is surfaced loudly with its fix, not
 * silently dropped — the value is showing the catch + the remedy.
 */

export interface ComplianceRule {
  id: string;
  pattern: string;
  severity: "flag" | "block";
  reason: string;
  fix: string;
}

interface RuleSet {
  _meta?: unknown;
  shared: ComplianceRule[];
  meta: ComplianceRule[];
  taboola: ComplianceRule[];
  google: ComplianceRule[];
  tiktok: ComplianceRule[];
}

const RULES = rulesData as unknown as RuleSet;

/** Precompile every rule's regex ONCE at module load. Invalid patterns are
 *  dropped (with a warning) rather than crashing the gate — a bad rule must
 *  never take the whole pipeline down. */
interface CompiledRule extends ComplianceRule {
  regex: RegExp;
}

function compile(rules: ComplianceRule[]): CompiledRule[] {
  const out: CompiledRule[] = [];
  for (const r of rules ?? []) {
    try {
      // Case-insensitive; no global flag — we want a single first match + its
      // index, and a stateful /g regex across calls is a footgun.
      out.push({ ...r, regex: new RegExp(r.pattern, "i") });
    } catch (e) {
      console.warn(`compliance: skipping rule ${r.id} — invalid regex: ${e instanceof Error ? e.message : e}`);
    }
  }
  return out;
}

const COMPILED: Record<Platform | "shared", CompiledRule[]> = {
  shared: compile(RULES.shared),
  meta: compile(RULES.meta),
  taboola: compile(RULES.taboola),
  google: compile(RULES.google),
  tiktok: compile(RULES.tiktok),
};

/** Rules that apply to a given platform: the shared/FTC set + that platform's. */
export function rulesForPlatform(platform: Platform): CompiledRule[] {
  return [...COMPILED.shared, ...(COMPILED[platform] ?? [])];
}

type Violation = ComplianceVerdict["violations"][number];

/** Escalation order for aggregating a verdict status. */
function worse(a: ComplianceVerdict["status"], b: ComplianceVerdict["status"]): ComplianceVerdict["status"] {
  const rank = { pass: 0, flag: 1, block: 2 } as const;
  return rank[b] > rank[a] ? b : a;
}

/** Run one platform's applicable rules over a blob of ad text. One violation
 *  per rule (first match), capturing the matched substring as offendingText. */
export function evaluateText(text: string, platform: Platform): Violation[] {
  const violations: Violation[] = [];
  for (const rule of rulesForPlatform(platform)) {
    const m = rule.regex.exec(text);
    if (m) {
      violations.push({
        ruleId: rule.id,
        severity: rule.severity,
        offendingText: m[0].trim().slice(0, 160),
        fix: rule.fix,
      });
    }
  }
  return violations;
}

/** The scannable text of an ad: its human-visible copy fields. */
function copyText(copy: AdCopy): string {
  return [copy.headline, copy.primaryText, copy.description].filter(Boolean).join("  •  ");
}

/** Evaluate a single ad into a ComplianceVerdict. */
export function evaluateCopy(copy: AdCopy): ComplianceVerdict {
  const violations = evaluateText(copyText(copy), copy.platform);
  const status = violations.reduce<ComplianceVerdict["status"]>(
    (acc, v) => worse(acc, v.severity === "block" ? "block" : "flag"),
    "pass",
  );
  return { angleId: copy.angleId, platform: copy.platform, status, violations };
}

/** Score a batch of ads. Pure + synchronous — no network, no model. */
export function compliance(copies: AdCopy[]): ComplianceVerdict[] {
  return copies.map(evaluateCopy);
}

export interface ComplianceSummary {
  total: number;
  pass: number;
  flag: number;
  block: number;
}

/** Roll a set of verdicts into headline counts for the UI. */
export function summarize(verdicts: ComplianceVerdict[]): ComplianceSummary {
  const summary: ComplianceSummary = { total: verdicts.length, pass: 0, flag: 0, block: 0 };
  for (const v of verdicts) summary[v.status] += 1;
  return summary;
}

/** Number of active (successfully compiled) rules — surfaced honestly in the UI. */
export function activeRuleCount(): number {
  return COMPILED.shared.length + COMPILED.meta.length + COMPILED.taboola.length + COMPILED.google.length + COMPILED.tiktok.length;
}
