/**
 * Vendored + adapted from dependencies/llmswitch (Cole, MIT) — extracted from
 * job_finder_v2/electron/llm/provider.ts. Zero-runtime-dependency LLM client
 * with automatic fallback chaining (see providerChain/generate below).
 *
 * PROVIDER (decided S1, updated from S0's Anthropic default): the pipeline
 * runs on the developer's self-hosted Ollama via its OpenAI-compatible
 * endpoint (http://localhost:11434/v1), using a cloud-tagged model
 * (kimi-k2.6:cloud — a general Kimi K2, strong at persuasive copy + structured
 * JSON). Anthropic is retained purely as an optional fallback leg: if
 * ANTHROPIC_API_KEY is ever set it slots in after Ollama, otherwise it is
 * skipped entirely. There is no localhost reachability from Vercel, so for now
 * the live pipeline runs locally (`npm run dev`); a cloudflared tunnel that
 * fronts Ollama is a planned S5 deliverable (see SPRINT_EXECUTION_PLAN.md §8).
 *
 * ONE structural deviation from the source package, per SPRINT_EXECUTION_PLAN.md
 * §2 rule 5: the source unconditionally adds the openai-compat leg first. Here
 * every leg is opt-in — the openai-compat leg is added only when
 * `openaiCompatUrl` is set, and Anthropic only when its key is set — so the
 * chain is exactly the providers that are actually configured, in priority
 * order. With the default env (Ollama URL set, no Anthropic key) that yields a
 * single-provider Ollama chain.
 *
 * getSettingsFromEnv() + askLLM() below are this project's wire-in: they read
 * the SettingsLike fields from env vars and give agents a one-line call.
 *
 * The `j: any` response parsing in the source has also been narrowed to real
 * response-shape interfaces (OpenAICompatResponse/AnthropicMessagesResponse/
 * OllamaTagsResponse/OllamaEmbedResponse) to satisfy this project's
 * `no-explicit-any` ESLint rule — behavior is unchanged.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GenerateOpts {
  temperature?: number;
  maxTokens?: number;
  model?: string; // override the chain's model for this call
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export interface ProviderDescriptor {
  name: string; // human label for logs / health
  kind: "ollama-native" | "openai-compat" | "anthropic";
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface GenerateResult {
  text: string;
  provider: string;
  model: string;
  usedFallback: boolean;
  errors: { provider: string; error: string }[];
}

export interface SettingsLike {
  openaiCompatUrl: string;
  openaiCompatKey: string;
  primaryModel: string;
  fallbackLocalModel: string;
  anthropicApiKey: string;
  anthropicModel: string;
  ollamaBaseUrl: string;
  embeddingModel: string;
}

/**
 * Build the ordered provider chain for the current settings. Pure + exported
 * so it can be unit-tested without any network.
 *
 * PRIMARY is Ollama's NATIVE /api/chat endpoint (ollamaBaseUrl) with thinking
 * DISABLED — kimi-k2.6:cloud otherwise spends ~4x its output budget "thinking",
 * which is the pipeline's main latency AND the source of the chain-of-thought
 * text leaking into the UI (the openai-compat /v1 endpoint ignores think:false
 * and returns the reasoning when content is empty). If ollamaBaseUrl is unset,
 * we fall back to the openai-compat leg. Anthropic joins only when its key is set.
 */
export function providerChain(s: SettingsLike, modelOverride?: string): ProviderDescriptor[] {
  const chain: ProviderDescriptor[] = [];
  const primaryModel = modelOverride || s.primaryModel;

  if (s.ollamaBaseUrl && s.ollamaBaseUrl.trim()) {
    chain.push({
      name: "ollama (native, think:false)",
      kind: "ollama-native",
      baseUrl: s.ollamaBaseUrl,
      apiKey: s.openaiCompatKey || "ollama",
      model: primaryModel,
    });
  } else if (s.openaiCompatUrl && s.openaiCompatUrl.trim()) {
    chain.push({
      name: "ollama (openai /v1)",
      kind: "openai-compat",
      baseUrl: s.openaiCompatUrl,
      apiKey: s.openaiCompatKey || "ollama",
      model: primaryModel,
    });
  }

  if (s.anthropicApiKey && s.anthropicApiKey.trim()) {
    chain.push({
      name: "anthropic",
      kind: "anthropic",
      baseUrl: "https://api.anthropic.com",
      apiKey: s.anthropicApiKey.trim(),
      model: modelOverride || s.anthropicModel,
    });
  }

  // Local fallback model on the same OpenAI-compat surface, only if it's
  // configured and differs from the primary (otherwise it's a pointless
  // retry of the same thing).
  const localModel = s.fallbackLocalModel;
  if (s.openaiCompatUrl && s.openaiCompatUrl.trim() && localModel && localModel !== (modelOverride || s.primaryModel)) {
    chain.push({
      name: `ollama-local (${localModel})`,
      kind: "openai-compat",
      baseUrl: s.openaiCompatUrl,
      apiKey: s.openaiCompatKey || "ollama",
      model: localModel,
    });
  }

  return chain;
}

interface OpenAICompatResponse {
  choices?: { message?: { content?: string; reasoning?: string } }[];
}

interface OllamaNativeResponse {
  message?: { content?: string; thinking?: string };
}

/** Per-call timeout so a stalled provider can't hang the request (and the
 *  /api/run SSE stream) forever. Generous by default because kimi-k2.6:cloud
 *  is a thinking model that legitimately takes 60-90s on the big prompts;
 *  override with LLM_TIMEOUT_MS. The agents' own retries handle a timeout. */
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) || 150_000;

/**
 * Ollama's native /api/chat with `think: false` — no reasoning phase, so it's
 * ~3-4x faster than the /v1 path on kimi-k2.6:cloud and returns clean content
 * (no chain-of-thought). This is the project's primary transport.
 */
async function chatOllamaNative(
  p: ProviderDescriptor, messages: ChatMessage[], opts: GenerateOpts
): Promise<string> {
  const url = `${p.baseUrl.replace(/\/$/, "")}/api/chat`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${p.apiKey}` },
    body: JSON.stringify({
      model: p.model,
      messages,
      stream: false,
      think: false,
      options: {
        temperature: opts.temperature ?? 0.4,
        num_predict: opts.maxTokens ?? 2048,
      },
    }),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`ollama-native HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j: OllamaNativeResponse = await res.json();
  return j?.message?.content ?? "";
}

async function chatOpenAICompat(
  p: ProviderDescriptor, messages: ChatMessage[], opts: GenerateOpts
): Promise<string> {
  const url = `${p.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${p.apiKey}` },
    body: JSON.stringify({
      model: p.model,
      messages,
      temperature: opts.temperature ?? 0.4,
      max_tokens: opts.maxTokens ?? 2048,
    }),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`openai-compat HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j: OpenAICompatResponse = await res.json();
  const msg = j?.choices?.[0]?.message;
  const content = msg?.content;
  if (typeof content === "string" && content.trim()) return content;
  if (typeof msg?.reasoning === "string" && msg.reasoning.trim()) return msg.reasoning;
  return content ?? "";
}

interface AnthropicMessagesResponse {
  content?: { type: string; text?: string }[];
}

async function chatAnthropic(
  p: ProviderDescriptor, messages: ChatMessage[], opts: GenerateOpts
): Promise<string> {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const turns = messages.filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role, content: m.content }));
  const res = await fetch(`${p.baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": p.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: p.model,
      system: system || undefined,
      messages: turns,
      temperature: opts.temperature ?? 0.4,
      max_tokens: opts.maxTokens ?? 2048,
    }),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`anthropic HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j: AnthropicMessagesResponse = await res.json();
  const parts = Array.isArray(j?.content) ? j.content : [];
  return parts.filter((b) => b?.type === "text").map((b) => b.text ?? "").join("");
}

/** Generate text, walking the fallback chain. Throws only if every provider fails. */
export async function generate(
  s: SettingsLike, messages: ChatMessage[], opts: GenerateOpts = {}
): Promise<GenerateResult> {
  const chain = providerChain(s, opts.model);
  const errors: { provider: string; error: string }[] = [];

  for (let i = 0; i < chain.length; i++) {
    const p = chain[i];
    try {
      const text = p.kind === "anthropic"
        ? await chatAnthropic(p, messages, opts)
        : p.kind === "ollama-native"
          ? await chatOllamaNative(p, messages, opts)
          : await chatOpenAICompat(p, messages, opts);
      return { text, provider: p.name, model: p.model, usedFallback: i > 0, errors };
    } catch (e) {
      errors.push({ provider: p.name, error: errMessage(e) });
    }
  }
  throw new Error(`All LLM providers failed: ${errors.map((e) => `${e.provider}: ${e.error}`).join(" | ")}`);
}

export interface HealthStatus {
  ollamaUp: boolean;
  baseUrl: string;
  primaryModel: string;
  primaryModelPresent: boolean | null; // null = couldn't determine (e.g. cloud tag)
  anthropicConfigured: boolean;
  detail: string;
}

/** Probe Ollama reachability + whether the primary model tag is available. Only meaningful when ollamaBaseUrl is configured. */
export async function health(s: SettingsLike): Promise<HealthStatus> {
  const base = s.ollamaBaseUrl.replace(/\/$/, "");
  const status: HealthStatus = {
    ollamaUp: false,
    baseUrl: base,
    primaryModel: s.primaryModel,
    primaryModelPresent: null,
    anthropicConfigured: !!(s.anthropicApiKey && s.anthropicApiKey.trim()),
    detail: "",
  };
  if (!base) {
    status.detail = status.anthropicConfigured
      ? "No local Ollama configured — Anthropic is the sole provider"
      : "No local Ollama configured and no Anthropic key set";
    return status;
  }
  try {
    const ver = await fetch(`${base}/api/version`, { signal: AbortSignal.timeout(4000) });
    status.ollamaUp = ver.ok;
    if (ver.ok) {
      const tags = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(4000) });
      if (tags.ok) {
        const j: OllamaTagsResponse = await tags.json();
        const names: string[] = (j?.models ?? []).map((m) => m?.name).filter((n): n is string => !!n);
        status.primaryModelPresent = s.primaryModel.includes(":cloud") ? null : names.includes(s.primaryModel);
      }
      status.detail = "Ollama reachable";
    } else {
      status.detail = `Ollama responded ${ver.status}`;
    }
  } catch (e) {
    status.detail = `Ollama unreachable: ${errMessage(e)}` +
      (status.anthropicConfigured ? " — will fall back to Anthropic" : "");
  }
  return status;
}

interface OllamaTagsResponse {
  models?: { name?: string }[];
}

interface OllamaEmbedResponse {
  embeddings?: number[][];
}

/** Local embeddings via Ollama's native /api/embed. Only meaningful when ollamaBaseUrl is configured. */
export async function embed(s: SettingsLike, texts: string[]): Promise<number[][]> {
  const base = s.ollamaBaseUrl.replace(/\/$/, "");
  if (!base) throw new Error("embed() requires ollamaBaseUrl to be configured");
  const res = await fetch(`${base}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: s.embeddingModel, input: texts }),
  });
  if (!res.ok) throw new Error(`embed HTTP ${res.status}`);
  const j: OllamaEmbedResponse = await res.json();
  return j?.embeddings ?? [];
}

// --- Project wire-in ---------------------------------------------------

/** This project's default provider config: self-hosted Ollama + a cloud Kimi.
 *  Primary transport is the native /api/chat endpoint (think:false) — see
 *  providerChain. The /v1 URL is kept as the fallback surface. */
export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";
export const DEFAULT_OPENAI_COMPAT_URL = "http://localhost:11434/v1";
export const DEFAULT_MODEL = "kimi-k2.6:cloud";

/**
 * Read a SettingsLike from env vars. The self-hosted Ollama is this project's
 * primary provider via its NATIVE /api/chat endpoint (ollamaBaseUrl, defaulted
 * to localhost:11434) with thinking disabled — so local dev needs no .env at
 * all. Anthropic is an optional fallback (only if ANTHROPIC_API_KEY is set).
 * Point at a different Ollama (e.g. a tunnel URL) via OLLAMA_BASE_URL.
 */
export function getSettingsFromEnv(): SettingsLike {
  return {
    openaiCompatUrl: process.env.OPENAI_COMPAT_URL ?? DEFAULT_OPENAI_COMPAT_URL,
    openaiCompatKey: process.env.OPENAI_COMPAT_KEY ?? "ollama",
    primaryModel: process.env.OPENAI_COMPAT_MODEL ?? DEFAULT_MODEL,
    fallbackLocalModel: process.env.OPENAI_COMPAT_FALLBACK_MODEL ?? "",
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
    anthropicModel: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5",
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_BASE_URL,
    embeddingModel: process.env.OLLAMA_EMBEDDING_MODEL ?? "",
  };
}

/** One-line convenience for agents: generate() against env-sourced settings. */
export async function askLLM(messages: ChatMessage[], opts: GenerateOpts = {}): Promise<GenerateResult> {
  return generate(getSettingsFromEnv(), messages, opts);
}
