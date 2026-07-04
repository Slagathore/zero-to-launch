/**
 * Vendored from dependencies/planjson (Cole, MIT) — extracted from
 * claw-deck/src/lib/planner.ts. Zero-dependency, pure functions: extracts a
 * JSON payload from an LLM response (inside a fenced code block or bare
 * object) and repairs the usual LLM JSON-dialect breakage — smart quotes,
 * single-quoted strings, trailing commas, bareword keys, // comments, and
 * mid-output truncation.
 *
 * Behavior is unchanged from the source; parsePlan()'s internals were
 * rewritten from `any` to `unknown` + narrowing (and `setSetting.value` typed
 * `unknown` instead of `any`) to satisfy this project's `no-explicit-any`
 * ESLint rule. The source's PLANNER_SYSTEM_PROMPT (a Claw-Deck-specific
 * assistant prompt) was dropped — this app's agents write their own
 * per-agent system prompts starting Sprint 1.
 *
 * Every agent in this app (research/angles/copy/compliance/advertorial/judge)
 * parses its model output through parsePlan()/extractPlanJson() so a
 * malformed-JSON response degrades to a typed error instead of a crash.
 *
 * The plan/step-type registry (PlanStep, isDestructive, describeStep) is kept
 * for parity with the source package but is not used by this app's agents,
 * which parse their own OfferBrief/Angle[]/AdCopy[]/etc. shapes out of the
 * repaired JSON via JSON.parse directly.
 */

export type StepStatus = "pending" | "running" | "ok" | "error" | "skipped";

export type PlanStep =
  | { type: "pullModel"; model: string }
  | { type: "setSetting"; key: string; value: unknown }
  | { type: "addMcpServer"; name: string; command: string; args?: string[]; env?: Record<string, string> }
  | { type: "shell"; command: string; args?: string[]; cwd?: string; description?: string }
  | { type: "openTab"; tab: string }
  | { type: "webFetch"; url: string; description?: string }
  | { type: "note"; text: string };

export interface Plan {
  summary: string;
  steps: PlanStep[];
}

export interface ParsedPlan {
  ok: boolean;
  plan?: Plan;
  error?: string;
  raw?: string; // the chunk we extracted (or full text)
  /** 'explanation' = model answered in prose (no JSON attempted) — NOT an error.
   *  'malformed'   = model tried to give a plan but it didn't parse.
   *  'valid'       = parsed cleanly. */
  intent?: "explanation" | "malformed" | "valid";
}

const STEP_TYPES = new Set([
  "pullModel", "setSetting", "addMcpServer", "shell", "openTab", "webFetch", "note",
]);

/** Strip <think>...</think> blocks (deepseek-r1, qwq, qwen3-thinking, etc.). */
function stripThinking(text: string): string {
  if (!text) return "";
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .replace(/<\|thinking\|>[\s\S]*?<\|\/thinking\|>/gi, "")
    .trim();
}

/** Repair common JSON dialect issues emitted by small models:
 *   - smart quotes “” ‘’ → "
 *   - single-quoted strings → double-quoted
 *   - trailing commas before } or ]
 *   - // and /* ... *\/ comments
 *   - JS bareword keys (foo: → "foo":)
 *
 * CRITICAL: every structural repair runs on a version of the text where valid
 * double-quoted string LITERALS have been masked out, so none of these rules
 * can ever touch string CONTENT. Without this, a value like
 * "Visit https://x.com — don't miss it," had its `//` stripped, its `don't`
 * apostrophe treated as a single-quote delimiter, and "word: text" re-quoted —
 * corrupting perfectly good model output and defeating the repair on exactly
 * the realistic replies it exists to fix.
 */
export function repairJsonish(s: string): string {
  if (!s) return s;

  // Smart quotes → straight delimiters first (rarely legit string content in
  // model JSON), so the masking step below sees normal " and ' delimiters.
  const normalized = s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");

  // Mask valid double-quoted strings so structural repairs can't see inside them.
  const literals: string[] = [];
  const S = String.fromCharCode(1); // U+0001 sentinel, cannot occur in JSON
  let out = normalized.replace(/"(?:[^"\\]|\\.)*"/g, (m) => {
    literals.push(m);
    return `${S}${literals.length - 1}${S}`;
  });

  out = out
    .replace(/\/\/.*$/gm, "") // // line comments (structure only now)
    .replace(/\/\*[\s\S]*?\*\//g, ""); // /* block comments */
  // single-quoted strings → double-quoted
  out = out.replace(/'([^'\\\n]*(?:\\.[^'\\\n]*)*)'/g, (_m, body) => `"${body.replace(/"/g, '\\"')}"`);
  // bareword object keys → quoted keys
  out = out.replace(/([{,]\s*)([A-Za-z_$][A-Za-z0-9_$]*)\s*:/g, '$1"$2":');
  // trailing commas
  out = out.replace(/,(\s*[}\]])/g, "$1");

  // Restore the masked string literals verbatim.
  out = out.replace(new RegExp(`${S}(\\d+)${S}`, "g"), (_m, idx) => literals[Number(idx)] ?? "");
  return out;
}

/**
 * Best-effort repair of JSON truncated mid-output (the model hit its token
 * limit). Walks the text tracking string state + the open {/[ stack, then:
 *   - closes an unterminated string literal,
 *   - drops a dangling property that has no value ("key":<eof>) or a trailing comma,
 *   - appends the missing }/] closers in the correct order.
 * Returns a candidate string; callers still JSON.parse to confirm.
 */
export function closeTruncatedJson(src: string): string {
  let inStr = false, esc = false;
  const stack: string[] = [];
  for (const c of src) {
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") stack.push(c);
    else if (c === "}") { if (stack[stack.length - 1] === "{") stack.pop(); }
    else if (c === "]") { if (stack[stack.length - 1] === "[") stack.pop(); }
  }
  let out = src;
  if (inStr) out += '"'; // close dangling string
  out = out.replace(/\s+$/, "");
  out = out.replace(/,?\s*"(?:[^"\\]|\\.)*"\s*:\s*$/, ""); // drop dangling "key":<eof>
  out = out.replace(/,\s*$/, ""); // drop trailing comma
  out = out.replace(/:\s*$/, ""); // drop bare colon
  for (let i = stack.length - 1; i >= 0; i--) out += stack[i] === "{" ? "}" : "]";
  return out;
}

/**
 * Extract the first JSON object that looks like a plan from arbitrary LLM
 * output. Tries (in order):
 *   1. A fenced ```json``` block
 *   2. A fenced ``` block whose content parses as JSON
 *   3. The first balanced { ... } substring that parses
 */
export function extractPlanJson(text: string): { json: string | null; raw: string } {
  if (!text) return { json: null, raw: "" };
  const cleaned = stripThinking(text);
  // 1. fenced json
  const jsonFence = /```json\s*([\s\S]*?)```/i.exec(cleaned);
  if (jsonFence) {
    const repaired = repairJsonish(jsonFence[1].trim());
    try { JSON.parse(repaired); return { json: repaired, raw: jsonFence[0] }; } catch { /* fall through to balanced parse */ }
    return { json: jsonFence[1].trim(), raw: jsonFence[0] };
  }
  // 2. any fenced block
  const anyFence = /```\s*([\s\S]*?)```/i.exec(cleaned);
  if (anyFence) {
    const repaired = repairJsonish(anyFence[1].trim());
    try { JSON.parse(repaired); return { json: repaired, raw: anyFence[0] }; } catch { /* fall through */ }
  }
  // 3. first balanced { ... }
  const start = cleaned.indexOf("{");
  if (start < 0) return { json: null, raw: cleaned };
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === "\\") { esc = true; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        const candidate = cleaned.slice(start, i + 1);
        const repaired = repairJsonish(candidate);
        try { JSON.parse(repaired); return { json: repaired, raw: candidate }; }
        catch {
          try { JSON.parse(candidate); return { json: candidate, raw: candidate }; }
          catch { return { json: null, raw: cleaned }; }
        }
      }
    }
  }
  // Ran off the end with unbalanced structure -> truncated mid-output. Recover.
  const recovered = repairJsonish(closeTruncatedJson(cleaned.slice(start)));
  try { JSON.parse(recovered); return { json: recovered, raw: cleaned.slice(start) }; }
  catch { return { json: null, raw: cleaned }; }
}

export function parsePlan(text: string): ParsedPlan {
  const cleaned = stripThinking(text || "");
  const { json, raw } = extractPlanJson(text);
  if (!json) {
    const looksLikeAttempt = /```|"steps"\s*:|"summary"\s*:|\bsteps\b\s*:/i.test(cleaned);
    if (!looksLikeAttempt) {
      return { ok: false, intent: "explanation", raw: cleaned };
    }
    return { ok: false, intent: "malformed", error: "No JSON plan found in model output.", raw };
  }
  let parsed: unknown;
  try { parsed = JSON.parse(json); }
  catch (e) { return { ok: false, intent: "malformed", error: `Invalid JSON: ${errMessage(e)}`, raw: json }; }
  if (typeof parsed !== "object" || parsed === null) return { ok: false, intent: "malformed", error: "Plan must be an object.", raw: json };
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.summary !== "string") return { ok: false, intent: "malformed", error: "Plan.summary must be a string.", raw: json };
  if (!Array.isArray(obj.steps)) return { ok: false, intent: "malformed", error: "Plan.steps must be an array.", raw: json };
  const steps: PlanStep[] = [];
  for (let i = 0; i < obj.steps.length; i++) {
    const raw = obj.steps[i];
    if (typeof raw !== "object" || raw === null) return { ok: false, intent: "malformed", error: `Step ${i} is not an object.`, raw: json };
    const s = raw as Record<string, unknown>;
    if (typeof s.type !== "string" || !STEP_TYPES.has(s.type)) return { ok: false, intent: "malformed", error: `Step ${i} has unknown type "${String(s.type)}".`, raw: json };
    switch (s.type) {
      case "pullModel": if (typeof s.model !== "string" || !s.model) return { ok: false, intent: "malformed", error: `Step ${i} pullModel.model missing`, raw: json }; break;
      case "setSetting": if (typeof s.key !== "string" || !s.key) return { ok: false, intent: "malformed", error: `Step ${i} setSetting.key missing`, raw: json }; break;
      case "addMcpServer": if (typeof s.name !== "string" || !s.name || typeof s.command !== "string") return { ok: false, intent: "malformed", error: `Step ${i} addMcpServer missing name/command`, raw: json }; break;
      case "shell": if (typeof s.command !== "string" || !s.command) return { ok: false, intent: "malformed", error: `Step ${i} shell.command missing`, raw: json }; break;
      case "openTab": if (typeof s.tab !== "string" || !s.tab) return { ok: false, intent: "malformed", error: `Step ${i} openTab.tab missing`, raw: json }; break;
      case "webFetch": if (typeof s.url !== "string" || !s.url) return { ok: false, intent: "malformed", error: `Step ${i} webFetch.url missing`, raw: json }; break;
      case "note": if (typeof s.text !== "string") return { ok: false, intent: "malformed", error: `Step ${i} note.text missing`, raw: json }; break;
    }
    steps.push(s as unknown as PlanStep);
  }
  return { ok: true, intent: "valid", plan: { summary: obj.summary, steps }, raw: json };
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** One-line human label for a step (unused by this app's agents; kept for parity). */
export function describeStep(s: PlanStep): string {
  switch (s.type) {
    case "pullModel": return `Pull Ollama model: ${s.model}`;
    case "setSetting": return `Set setting "${s.key}" → ${JSON.stringify(s.value)}`;
    case "addMcpServer": return `Add MCP server "${s.name}" (${s.command} ${(s.args ?? []).join(" ")})`;
    case "shell": return `Run shell: ${s.command}${s.args && s.args.length ? " " + s.args.join(" ") : ""}${s.cwd ? ` (cwd: ${s.cwd})` : ""}`;
    case "openTab": return `Open tab: ${s.tab}`;
    case "webFetch": return `Fetch URL: ${s.url}`;
    case "note": return `Note: ${s.text}`;
  }
}

/** Steps that change system state need explicit approval (unused by this app's agents). */
export function isDestructive(s: PlanStep): boolean {
  return s.type === "shell" || s.type === "pullModel" || s.type === "setSetting" || s.type === "addMcpServer";
}
