import { describe, it, expect } from "vitest";
import {
  compliance, evaluateCopy, evaluateText, summarize, rulesForPlatform, activeRuleCount,
} from "../compliance";
import type { AdCopy, Platform } from "../types";

function ad(platform: Platform, fields: Partial<AdCopy>): AdCopy {
  return {
    angleId: "angle-1", platform,
    primaryText: "", headline: "", description: "", cta: "Learn More",
    ...fields,
  };
}

describe("ruleset wiring", () => {
  it("compiles a meaningful number of rules across all platforms", () => {
    expect(activeRuleCount()).toBeGreaterThanOrEqual(18);
  });
  it("applies shared/FTC rules to every platform, plus that platform's own", () => {
    const meta = rulesForPlatform("meta").map((r) => r.id);
    const taboola = rulesForPlatform("taboola").map((r) => r.id);
    // shared FTC rule present on both:
    expect(meta).toContain("ftc-guarantee-01");
    expect(taboola).toContain("ftc-guarantee-01");
    // platform-specific rule only on its platform:
    expect(meta).toContain("meta-health-cure-01");
    expect(taboola).not.toContain("meta-health-cure-01");
  });
});

describe("block-severity rules fire on their target copy", () => {
  it("blocks a Meta ad that claims to cure a disease", () => {
    const v = evaluateCopy(ad("meta", { headline: "This gummy can reverse diabetes for good" }));
    expect(v.status).toBe("block");
    expect(v.violations.some((x) => x.ruleId === "meta-health-cure-01")).toBe(true);
  });
  it("blocks 'doctors are stunned' fake-authority framing on Meta", () => {
    const v = evaluateCopy(ad("meta", { primaryText: "Doctors are stunned by this simple trick" }));
    expect(v.status).toBe("block");
  });
  it("blocks weight-loss framing on TikTok", () => {
    const v = evaluateCopy(ad("tiktok", { headline: "Our fat-burning formula works fast" }));
    expect(v.status).toBe("block");
  });
});

describe("flag-severity rules fire on their target copy", () => {
  it("flags an unqualified guarantee (FTC, any platform)", () => {
    const v = evaluateCopy(ad("taboola", { primaryText: "Guaranteed to work or your money back" }));
    expect(v.status).toBe("flag");
    expect(v.violations.some((x) => x.ruleId === "ftc-guarantee-01")).toBe(true);
  });
  it("flags a quantified weight-loss claim with the typicality fix", () => {
    const v = evaluateCopy(ad("meta", { headline: "Lose 20 lbs in a month" }));
    expect(v.status).toBe("flag");
    const hit = v.violations.find((x) => x.ruleId === "ftc-typicality-01");
    expect(hit?.fix).toMatch(/not typical/i);
  });
  it("flags 'one weird trick' clickbait on Taboola", () => {
    const v = evaluateCopy(ad("taboola", { headline: "This one weird trick melts belly fat" }));
    expect(v.status).toBe("flag");
    expect(v.violations.some((x) => x.ruleId === "taboola-one-trick-01")).toBe(true);
  });
});

describe("clean copy passes", () => {
  it("passes calm, honest copy with no violations", () => {
    const v = evaluateCopy(ad("meta", {
      headline: "A calmer way to focus",
      primaryText: "FlowDesk blocks distracting sites during a focus block and gives you a gentle weekly recap.",
      description: "Free 14-day trial.",
    }));
    expect(v.status).toBe("pass");
    expect(v.violations).toEqual([]);
  });
});

describe("offendingText + aggregation", () => {
  it("captures the actual matched substring as offendingText", () => {
    const violations = evaluateText("Results are guaranteed for everyone", "google");
    const hit = violations.find((v) => v.ruleId === "ftc-guarantee-01");
    expect(hit?.offendingText.toLowerCase()).toContain("guarantee");
  });
  it("escalates to block when both a flag and a block rule match", () => {
    const v = evaluateCopy(ad("meta", {
      headline: "Guaranteed to cure diabetes", // ftc-guarantee (flag) + meta-health-cure (block)
    }));
    expect(v.status).toBe("block");
    expect(v.violations.length).toBeGreaterThanOrEqual(2);
  });
});

describe("compliance() batch + summarize()", () => {
  it("scores a batch and rolls up a summary", () => {
    const verdicts = compliance([
      ad("meta", { headline: "A calmer way to focus", primaryText: "Honest copy." }),
      ad("meta", { headline: "Lose 20 lbs fast" }),
      ad("meta", { headline: "Reverse diabetes now" }),
    ]);
    const s = summarize(verdicts);
    expect(s.total).toBe(3);
    expect(s.pass).toBe(1);
    expect(s.flag).toBe(1);
    expect(s.block).toBe(1);
  });
});
