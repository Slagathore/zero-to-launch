import { askLLM, type ChatMessage, type GenerateOpts, type GenerateResult } from "@/lib/llm";
import { extractPlanJson } from "@/lib/planjson";

/**
 * The shared "structured generation" primitive every agent uses. It:
 *   1. calls the LLM (askLLM → self-hosted Ollama / kimi-k2.6:cloud),
 *   2. pulls the JSON out of the reply and repairs the usual LLM-JSON breakage
 *      via planjson's extractPlanJson (smart quotes, trailing commas,
 *      mid-output truncation — the #1 real failure mode of a JSON pipeline),
 *   3. hands the parsed value to a caller-supplied `coerce` that validates it
 *      into a typed, trusted shape (throwing on anything malformed).
 *
 * Keeping this in one place means each agent is just "a prompt + a coercer",
 * and every agent inherits the same JSON-repair robustness.
 */

export class AgentJsonError extends Error {
  constructor(message: string, readonly raw: string) {
    super(message);
    this.name = "AgentJsonError";
  }
}

export interface StructuredResult<T> {
  value: T;
  meta: GenerateResult;
}

/**
 * Generate a JSON value and coerce it into T. `coerce` receives the parsed
 * (untyped) JSON and must return a valid T or throw. Because kimi-k2.6:cloud
 * is a thinking model, maxTokens defaults high here (4096) so the JSON isn't
 * truncated by the reasoning phase; callers can override.
 */
export async function generateJson<T>(
  messages: ChatMessage[],
  coerce: (raw: unknown) => T,
  opts: GenerateOpts = {},
): Promise<StructuredResult<T>> {
  const meta = await askLLM(messages, { maxTokens: 4096, ...opts });
  const { json } = extractPlanJson(meta.text);
  if (!json) {
    throw new AgentJsonError("Model returned no parseable JSON.", meta.text);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new AgentJsonError(`Model JSON did not parse: ${msg}`, meta.text);
  }
  const value = coerce(parsed);
  return { value, meta };
}

// --- small coercion helpers shared by agent coercers -----------------------

export function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

export function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

/** Narrow an arbitrary value to a plain object record for field access. */
export function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}

/** Clamp a value to one of `allowed`, else return `fallback`. Case-insensitive:
 *  models routinely return "Paragraph" / "High" / "Meta" for a lowercase enum,
 *  and a case-sensitive match would silently drop them to the fallback. */
export function asEnum<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  if (typeof v !== "string") return fallback;
  const lower = v.trim().toLowerCase();
  const hit = (allowed as readonly string[]).find((a) => a.toLowerCase() === lower);
  return (hit as T | undefined) ?? fallback;
}
