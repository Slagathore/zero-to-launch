import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { providerChain, generate, health, getSettingsFromEnv, type SettingsLike } from "../claude";

/** Minimal mock of the subset of Response our code actually reads. */
function mockResponse(init: { ok: boolean; status?: number; json?: () => Promise<unknown>; text?: () => Promise<string> }): Response {
  return init as unknown as Response;
}

const anthropicOnly: SettingsLike = {
  openaiCompatUrl: "",
  openaiCompatKey: "",
  primaryModel: "",
  fallbackLocalModel: "",
  anthropicApiKey: "sk-test",
  anthropicModel: "claude-sonnet-5",
  ollamaBaseUrl: "",
  embeddingModel: "",
};

const withOpenAICompat: SettingsLike = {
  ...anthropicOnly,
  openaiCompatUrl: "http://127.0.0.1:11434/v1",
  openaiCompatKey: "ollama",
  primaryModel: "gemini-3-flash-preview:cloud",
  fallbackLocalModel: "llama3.2",
};

describe("providerChain (deviation: openai-compat leg is opt-in, not automatic)", () => {
  it("is Anthropic-only when openaiCompatUrl is unset — the default for this project", () => {
    const chain = providerChain(anthropicOnly);
    expect(chain).toHaveLength(1);
    expect(chain[0].kind).toBe("anthropic");
  });

  it("omits anthropic entirely when no key and no compat url configured", () => {
    expect(providerChain({ ...anthropicOnly, anthropicApiKey: "" })).toHaveLength(0);
  });

  it("puts openai-compat first, then anthropic, then local fallback when all three are configured", () => {
    const chain = providerChain(withOpenAICompat);
    expect(chain.map((p) => p.kind)).toEqual(["openai-compat", "anthropic", "openai-compat"]);
  });

  it("drops the local fallback when it equals the primary model", () => {
    const chain = providerChain({ ...withOpenAICompat, fallbackLocalModel: "gemini-3-flash-preview:cloud" });
    expect(chain.filter((p) => p.name.startsWith("ollama-local"))).toHaveLength(0);
  });

  it("never adds a local-fallback leg when openaiCompatUrl is unset, even if fallbackLocalModel is set", () => {
    const chain = providerChain({ ...anthropicOnly, fallbackLocalModel: "llama3.2" });
    expect(chain).toHaveLength(1);
    expect(chain[0].kind).toBe("anthropic");
  });

  it("honors a model override for the primary slot", () => {
    expect(providerChain(anthropicOnly, "claude-opus-4-8")[0].model).toBe("claude-opus-4-8");
  });
});

describe("generate", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns Anthropic's text on success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => mockResponse({
      ok: true,
      json: async () => ({ content: [{ type: "text", text: "pong" }] }),
    })));

    const r = await generate(anthropicOnly, [{ role: "user", content: "ping" }]);
    expect(r.text).toBe("pong");
    expect(r.provider).toBe("anthropic");
    expect(r.usedFallback).toBe(false);
  });

  it("falls through from openai-compat to anthropic when the first leg fails", async () => {
    let call = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      call++;
      if (call === 1) return mockResponse({ ok: false, status: 502, text: async () => "bad gateway" });
      return mockResponse({ ok: true, json: async () => ({ content: [{ type: "text", text: "anthropic says hi" }] }) });
    }));

    const r = await generate(withOpenAICompat, [{ role: "user", content: "hi" }]);
    expect(r.text).toBe("anthropic says hi");
    expect(r.usedFallback).toBe(true);
    expect(r.provider).toBe("anthropic");
    expect(r.errors).toHaveLength(1);
  });

  it("throws only when every configured provider fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => mockResponse({ ok: false, status: 500, text: async () => "nope" })));
    await expect(generate(anthropicOnly, [{ role: "user", content: "hi" }])).rejects.toThrow(/All LLM providers failed/);
  });

  it("throws immediately with no providers configured at all", async () => {
    await expect(generate({ ...anthropicOnly, anthropicApiKey: "" }, [{ role: "user", content: "hi" }]))
      .rejects.toThrow(/All LLM providers failed/);
  });
});

describe("health", () => {
  it("reports no-network-call status when ollamaBaseUrl is unset (this project's default)", async () => {
    const status = await health(anthropicOnly);
    expect(status.ollamaUp).toBe(false);
    expect(status.anthropicConfigured).toBe(true);
    expect(status.detail).toMatch(/sole provider/);
  });
});

describe("getSettingsFromEnv", () => {
  const ORIGINAL_ENV = process.env;
  beforeEach(() => { process.env = { ...ORIGINAL_ENV }; });
  afterEach(() => { process.env = ORIGINAL_ENV; });

  it("reads ANTHROPIC_API_KEY / ANTHROPIC_MODEL and defaults the rest empty", () => {
    process.env.ANTHROPIC_API_KEY = "sk-live";
    process.env.ANTHROPIC_MODEL = "claude-opus-4-8";
    delete process.env.OPENAI_COMPAT_URL;

    const s = getSettingsFromEnv();
    expect(s.anthropicApiKey).toBe("sk-live");
    expect(s.anthropicModel).toBe("claude-opus-4-8");
    expect(s.openaiCompatUrl).toBe("");
  });

  it("defaults ANTHROPIC_MODEL to claude-sonnet-5 when unset", () => {
    delete process.env.ANTHROPIC_MODEL;
    expect(getSettingsFromEnv().anthropicModel).toBe("claude-sonnet-5");
  });
});
