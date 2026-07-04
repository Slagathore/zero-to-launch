import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  providerChain, generate, health, getSettingsFromEnv,
  DEFAULT_MODEL, DEFAULT_OLLAMA_BASE_URL, type SettingsLike,
} from "../llm";

/** Minimal mock of the subset of Response our code actually reads. */
function mockResponse(init: { ok: boolean; status?: number; json?: () => Promise<unknown>; text?: () => Promise<string> }): Response {
  return init as unknown as Response;
}

/** This project's real posture: self-hosted Ollama via the NATIVE /api/chat leg. */
const nativeDefault: SettingsLike = {
  openaiCompatUrl: "http://127.0.0.1:11434/v1",
  openaiCompatKey: "ollama",
  primaryModel: "kimi-k2.6:cloud",
  fallbackLocalModel: "",
  anthropicApiKey: "",
  anthropicModel: "claude-sonnet-5",
  ollamaBaseUrl: "http://127.0.0.1:11434",
  embeddingModel: "",
};

/** Ollama via the openai-compat /v1 leg only (native base unset — legacy/fallback). */
const ollamaPrimary: SettingsLike = { ...nativeDefault, ollamaBaseUrl: "" };

/** Anthropic configured as the optional fallback only (no Ollama URL). */
const anthropicOnly: SettingsLike = {
  ...ollamaPrimary,
  openaiCompatUrl: "",
  openaiCompatKey: "",
  primaryModel: "",
  anthropicApiKey: "sk-test",
};

/** All three legs configured: Ollama primary → Anthropic fallback → local Ollama model. */
const allThree: SettingsLike = {
  ...ollamaPrimary,
  fallbackLocalModel: "llama3.2",
  anthropicApiKey: "sk-test",
};

describe("providerChain (every leg is opt-in; Ollama is this project's primary)", () => {
  it("uses the NATIVE Ollama leg (think:false) when ollamaBaseUrl is set — the default posture", () => {
    const chain = providerChain(nativeDefault);
    expect(chain).toHaveLength(1);
    expect(chain[0].kind).toBe("ollama-native");
    expect(chain[0].baseUrl).toBe("http://127.0.0.1:11434");
    expect(chain[0].model).toBe("kimi-k2.6:cloud");
  });

  it("falls back to the openai-compat leg when only openaiCompatUrl is set (no native base)", () => {
    const chain = providerChain(ollamaPrimary);
    expect(chain).toHaveLength(1);
    expect(chain[0].kind).toBe("openai-compat");
    expect(chain[0].model).toBe("kimi-k2.6:cloud");
  });

  it("uses Anthropic alone when only its key is set (fallback-only config)", () => {
    const chain = providerChain(anthropicOnly);
    expect(chain).toHaveLength(1);
    expect(chain[0].kind).toBe("anthropic");
  });

  it("has an empty chain when nothing is configured", () => {
    expect(providerChain({ ...anthropicOnly, anthropicApiKey: "" })).toHaveLength(0);
  });

  it("orders legs Ollama → Anthropic → local-Ollama-fallback when all are configured", () => {
    const chain = providerChain(allThree);
    expect(chain.map((p) => p.kind)).toEqual(["openai-compat", "anthropic", "openai-compat"]);
  });

  it("drops the local fallback when it equals the primary model", () => {
    const chain = providerChain({ ...allThree, fallbackLocalModel: "kimi-k2.6:cloud" });
    expect(chain.filter((p) => p.name.startsWith("ollama-local"))).toHaveLength(0);
  });

  it("never adds a local-fallback leg when openaiCompatUrl is unset, even if fallbackLocalModel is set", () => {
    const chain = providerChain({ ...anthropicOnly, fallbackLocalModel: "llama3.2" });
    expect(chain).toHaveLength(1);
    expect(chain[0].kind).toBe("anthropic");
  });

  it("honors a model override for the primary slot", () => {
    expect(providerChain(ollamaPrimary, "kimi-k2-thinking:cloud")[0].model).toBe("kimi-k2-thinking:cloud");
  });
});

describe("generate", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns Ollama's text via the native /api/chat leg (message.content shape)", async () => {
    const fetchMock = vi.fn(async () => mockResponse({ ok: true, json: async () => ({ message: { content: "pong" } }) }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await generate(nativeDefault, [{ role: "user", content: "ping" }]);
    expect(r.text).toBe("pong");
    expect(r.provider).toBe("ollama (native, think:false)");
    // Hit /api/chat, and requested think:false.
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toContain("/api/chat");
    expect(JSON.parse(init.body).think).toBe(false);
  });

  it("returns Ollama's text on success (openai-compat response shape)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => mockResponse({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "pong" } }] }),
    })));

    const r = await generate(ollamaPrimary, [{ role: "user", content: "ping" }]);
    expect(r.text).toBe("pong");
    expect(r.provider).toBe("ollama (openai /v1)");
    expect(r.usedFallback).toBe(false);
  });

  it("falls through from a failing Ollama to the Anthropic fallback leg", async () => {
    let call = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      call++;
      if (call === 1) return mockResponse({ ok: false, status: 502, text: async () => "bad gateway" });
      return mockResponse({ ok: true, json: async () => ({ content: [{ type: "text", text: "anthropic says hi" }] }) });
    }));

    const r = await generate(allThree, [{ role: "user", content: "hi" }]);
    expect(r.text).toBe("anthropic says hi");
    expect(r.usedFallback).toBe(true);
    expect(r.provider).toBe("anthropic");
    expect(r.errors).toHaveLength(1);
  });

  it("throws only when every configured provider fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => mockResponse({ ok: false, status: 500, text: async () => "nope" })));
    await expect(generate(ollamaPrimary, [{ role: "user", content: "hi" }])).rejects.toThrow(/All LLM providers failed/);
  });

  it("throws immediately with no providers configured at all", async () => {
    await expect(generate({ ...anthropicOnly, anthropicApiKey: "" }, [{ role: "user", content: "hi" }]))
      .rejects.toThrow(/All LLM providers failed/);
  });
});

describe("health", () => {
  it("returns the early no-op status when ollamaBaseUrl (native endpoint) is unset — this project's default", async () => {
    const status = await health(ollamaPrimary);
    expect(status.ollamaUp).toBe(false);
    expect(status.detail).toMatch(/No local Ollama configured/);
  });
});

describe("getSettingsFromEnv", () => {
  const ORIGINAL_ENV = process.env;
  beforeEach(() => { process.env = { ...ORIGINAL_ENV }; });
  afterEach(() => { process.env = ORIGINAL_ENV; });

  it("defaults to the self-hosted Ollama + cloud Kimi with no .env at all", () => {
    delete process.env.OPENAI_COMPAT_URL;
    delete process.env.OPENAI_COMPAT_MODEL;
    delete process.env.OPENAI_COMPAT_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    delete process.env.OLLAMA_BASE_URL;
    const s = getSettingsFromEnv();
    expect(s.ollamaBaseUrl).toBe(DEFAULT_OLLAMA_BASE_URL);
    expect(s.primaryModel).toBe(DEFAULT_MODEL);
    expect(s.anthropicApiKey).toBe("");
    // The default settings must yield a native-Ollama-only chain.
    expect(providerChain(s).map((p) => p.kind)).toEqual(["ollama-native"]);
  });

  it("lets env vars override the model + native URL (e.g. a tunnel URL in production)", () => {
    process.env.OLLAMA_BASE_URL = "https://ollama.example.trycloudflare.com";
    process.env.OPENAI_COMPAT_MODEL = "glm-5.2:cloud";
    const s = getSettingsFromEnv();
    expect(s.ollamaBaseUrl).toBe("https://ollama.example.trycloudflare.com");
    expect(s.primaryModel).toBe("glm-5.2:cloud");
  });

  it("adds Anthropic as a fallback leg when ANTHROPIC_API_KEY is set", () => {
    process.env.ANTHROPIC_API_KEY = "sk-live";
    const s = getSettingsFromEnv();
    expect(providerChain(s).map((p) => p.kind)).toEqual(["ollama-native", "anthropic"]);
  });
});
