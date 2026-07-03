import { describe, it, expect, vi, afterEach } from "vitest";
import { coerceCopyForPlatform, toPlatform, COPY_PLATFORMS, copy, MAX_ANGLES_FOR_COPY } from "../copy";
import type { Angle, OfferBrief } from "../types";

const ANGLES: Angle[] = [
  { id: "angle-1", hookType: "curiosity", promise: "p1", emotionalDriver: "intrigue", headlineSeed: "h1", rationale: "r1" },
  { id: "angle-2", hookType: "fear", promise: "p2", emotionalDriver: "fear", headlineSeed: "h2", rationale: "r2" },
];

describe("coerceCopyForPlatform", () => {
  it("maps { copy: [...] } into typed AdCopy[] and stamps the platform", () => {
    const raw = {
      copy: [
        { angleId: "angle-1", primaryText: "body one", headline: "Head 1", description: "d1", cta: "Learn More" },
        { angleId: "angle-2", primaryText: "body two", headline: "Head 2", description: "d2", cta: "Shop Now" },
      ],
    };
    const out = coerceCopyForPlatform(raw, "meta", ANGLES);
    expect(out).toHaveLength(2);
    expect(out[0].platform).toBe("meta");
    expect(out[0].angleId).toBe("angle-1");
    expect(out[1].headline).toBe("Head 2");
  });

  it("falls back to positional angle id when the model echoes an unknown id", () => {
    const raw = { copy: [{ angleId: "hallucinated-99", headline: "H", primaryText: "b" }] };
    const out = coerceCopyForPlatform(raw, "taboola", ANGLES);
    expect(out[0].angleId).toBe("angle-1"); // position 0 -> angle-1
  });

  it("falls back to positional id when angleId is missing entirely", () => {
    const raw = { copy: [{ headline: "H1" }, { headline: "H2" }] };
    const out = coerceCopyForPlatform(raw, "meta", ANGLES);
    expect(out.map((c) => c.angleId)).toEqual(["angle-1", "angle-2"]);
  });

  it("defaults an empty cta to the platform's first whitelisted button", () => {
    const meta = coerceCopyForPlatform({ copy: [{ angleId: "angle-1", headline: "H" }] }, "meta", ANGLES);
    const taboola = coerceCopyForPlatform({ copy: [{ angleId: "angle-1", headline: "H" }] }, "taboola", ANGLES);
    expect(meta[0].cta).toBe("Learn More");
    expect(taboola[0].cta).toBe("Read More");
  });

  it("accepts a bare array as well as { copy: [...] }", () => {
    const out = coerceCopyForPlatform([{ angleId: "angle-2", headline: "H" }], "meta", ANGLES);
    expect(out[0].angleId).toBe("angle-2");
  });

  it("returns an empty array for a shape with no copy", () => {
    expect(coerceCopyForPlatform({ nope: 1 }, "meta", ANGLES)).toEqual([]);
  });
});

describe("toPlatform", () => {
  it("passes through valid platforms and defaults unknown ones to meta", () => {
    expect(toPlatform("taboola")).toBe("taboola");
    expect(toPlatform("myspace")).toBe("meta");
    expect(toPlatform(42)).toBe("meta");
  });
});

describe("COPY_PLATFORMS", () => {
  it("targets Meta and Taboola for L1", () => {
    expect(COPY_PLATFORMS).toEqual(["meta", "taboola"]);
  });
});

/* --- resilience: copy() degrades gracefully when a platform's model call fails --- */

const BRIEF: OfferBrief = {
  url: "", vertical: "v", product: "P",
  audience: { who: "w", painPoints: [], desires: [] },
  usps: [], claimsDetected: [], complianceRisk: "low", notes: "",
};

/** Mock an openai-compat chat response carrying `content`. */
function okOpenAI(content: string): Response {
  return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) } as unknown as Response;
}
const GOOD_COPY = '{"copy":[{"angleId":"angle-1","headline":"H","primaryText":"b","description":"d","cta":"Shop Now"}]}';

describe("copy() resilience", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns copy for every platform when all calls succeed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okOpenAI(GOOD_COPY)));
    const out = await copy(BRIEF, [ANGLES[0]]); // 1 angle x 2 platforms
    expect(out.copy).toHaveLength(2);
    expect(out.failedPlatforms).toEqual([]);
    expect(out.copy.map((c) => c.platform).sort()).toEqual(["meta", "taboola"]);
  });

  it("degrades to a partial result when one platform never parses", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body: string }) => {
      const sys = JSON.parse(init.body).messages[0].content as string;
      return sys.includes("TABOOLA") ? okOpenAI("this is not json") : okOpenAI(GOOD_COPY);
    }));
    const out = await copy(BRIEF, [ANGLES[0]]);
    expect(out.copy).toHaveLength(1);
    expect(out.copy[0].platform).toBe("meta");
    expect(out.failedPlatforms.some((f) => f.includes("taboola"))).toBe(true);
  });

  it("throws only when every platform fails both attempts", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okOpenAI("never valid json")));
    await expect(copy(BRIEF, [ANGLES[0]])).rejects.toThrow(/all platforms/i);
  });

  it("retries a platform once, succeeding on the second attempt", async () => {
    const calls = new Map<string, number>();
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body: string }) => {
      const sys = JSON.parse(init.body).messages[0].content as string;
      const key = sys.includes("TABOOLA") ? "taboola" : "meta";
      const n = (calls.get(key) ?? 0) + 1;
      calls.set(key, n);
      return n === 1 ? okOpenAI("garbage first try") : okOpenAI(GOOD_COPY);
    }));
    const out = await copy(BRIEF, [ANGLES[0]]);
    expect(out.copy).toHaveLength(2);
    expect(out.failedPlatforms).toEqual([]);
    expect(calls.get("meta")).toBe(2); // one retry each
  });

  it("caps the number of angles sent for copy", () => {
    expect(MAX_ANGLES_FOR_COPY).toBeGreaterThanOrEqual(4);
    expect(MAX_ANGLES_FOR_COPY).toBeLessThanOrEqual(6);
  });
});
