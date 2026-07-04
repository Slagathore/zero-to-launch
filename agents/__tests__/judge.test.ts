import { describe, it, expect } from "vitest";
import {
  scoreAngle, rankAngles, selectLaunchSet, buildChecklist, heuristicRationale, judge,
} from "../judge";
import type { AdCopy, Angle, ComplianceVerdict } from "../types";

const angles: Angle[] = [
  { id: "a1", hookType: "curiosity", promise: "p1", emotionalDriver: "e1", headlineSeed: "Clean angle", rationale: "r1" },
  { id: "a2", hookType: "fear", promise: "p2", emotionalDriver: "e2", headlineSeed: "Flagged angle", rationale: "r2" },
  { id: "a3", hookType: "social-proof", promise: "p3", emotionalDriver: "e3", headlineSeed: "Blocked angle", rationale: "r3" },
];

function copyFor(angleId: string): AdCopy[] {
  return (["meta", "taboola"] as const).map((platform) => ({
    angleId, platform, headline: "H", primaryText: "body", description: "d", cta: "Learn More",
  }));
}
const copy: AdCopy[] = [...copyFor("a1"), ...copyFor("a2"), ...copyFor("a3")];

const verdicts: ComplianceVerdict[] = [
  { angleId: "a1", platform: "meta", status: "pass", violations: [] },
  { angleId: "a1", platform: "taboola", status: "pass", violations: [] },
  { angleId: "a2", platform: "meta", status: "flag", violations: [{ ruleId: "x", severity: "flag", offendingText: "t", fix: "f" }] },
  { angleId: "a2", platform: "taboola", status: "pass", violations: [] },
  { angleId: "a3", platform: "meta", status: "block", violations: [{ ruleId: "y", severity: "block", offendingText: "t", fix: "f" }] },
  { angleId: "a3", platform: "taboola", status: "pass", violations: [] },
];

describe("scoreAngle", () => {
  it("scores a clean angle above a flagged one above a blocked one", () => {
    const s1 = scoreAngle(angles[0], copy, verdicts).score;
    const s2 = scoreAngle(angles[1], copy, verdicts).score;
    const s3 = scoreAngle(angles[2], copy, verdicts).score;
    expect(s1).toBeGreaterThan(s2);
    expect(s2).toBeGreaterThan(s3);
  });
  it("reports the worst compliance status of an angle's copy", () => {
    expect(scoreAngle(angles[2], copy, verdicts).worstStatus).toBe("block");
    expect(scoreAngle(angles[1], copy, verdicts).worstStatus).toBe("flag");
    expect(scoreAngle(angles[0], copy, verdicts).worstStatus).toBe("pass");
  });
});

describe("rankAngles", () => {
  it("orders clean → flagged → blocked", () => {
    const ranked = rankAngles(angles, copy, verdicts);
    expect(ranked.map((r) => r.angleId)).toEqual(["a1", "a2", "a3"]);
  });
});

describe("selectLaunchSet", () => {
  it("prefers non-blocked angles and respects the set size", () => {
    const ranked = rankAngles(angles, copy, verdicts);
    const set = selectLaunchSet(ranked, angles, 2);
    expect(set.map((a) => a.id)).toEqual(["a1", "a2"]);
    expect(set.map((a) => a.id)).not.toContain("a3");
  });
  it("falls back to blocked angles only if nothing else exists", () => {
    const allBlocked: ComplianceVerdict[] = angles.map((a) => ({ angleId: a.id, platform: "meta", status: "block", violations: [] }));
    const ranked = rankAngles(angles, copy, allBlocked);
    const set = selectLaunchSet(ranked, angles, 2);
    expect(set).toHaveLength(2); // still returns something rather than nothing
  });

  // Regression for the high-sev finding: a copy-less angle (from a partial /
  // truncated copy stage) must NEVER be recommended as launch-ready.
  it("excludes angles that have no ad copy, even though they score as clean 'pass'", () => {
    const copyOnlyA1A2 = [...copyFor("a1"), ...copyFor("a2")]; // a3 has NO copy
    const v = [
      { angleId: "a1", platform: "meta", status: "pass", violations: [] },
      { angleId: "a1", platform: "taboola", status: "pass", violations: [] },
      { angleId: "a2", platform: "meta", status: "pass", violations: [] },
      { angleId: "a2", platform: "taboola", status: "pass", violations: [] },
    ] as ComplianceVerdict[];
    const ranked = rankAngles(angles, copyOnlyA1A2, v);
    const set = selectLaunchSet(ranked, angles, 3);
    expect(set.map((a) => a.id)).not.toContain("a3"); // copy-less, excluded
    expect(set.map((a) => a.id).sort()).toEqual(["a1", "a2"]);
  });

  it("prefers a blocked-but-has-copy angle over a clean-scoring copy-less angle", () => {
    // a1 has copy but blocks; a3 has no copy (scores 0/pass). a1 must win.
    const copyOnlyA1 = copyFor("a1");
    const v = [
      { angleId: "a1", platform: "meta", status: "block", violations: [{ ruleId: "x", severity: "block", offendingText: "t", fix: "f" }] },
      { angleId: "a1", platform: "taboola", status: "block", violations: [{ ruleId: "x", severity: "block", offendingText: "t", fix: "f" }] },
    ] as ComplianceVerdict[];
    const ranked = rankAngles(angles, copyOnlyA1, v);
    const set = selectLaunchSet(ranked, angles, 1);
    expect(set.map((a) => a.id)).toEqual(["a1"]);
  });
});

describe("buildChecklist", () => {
  it("leads with a BLOCK warning when any copy is blocked", () => {
    const list = buildChecklist(angles[0] && { url: "", vertical: "v", product: "P", audience: { who: "", painPoints: [], desires: [] }, usps: [], claimsDetected: [], complianceRisk: "high", notes: "" }, verdicts, [angles[0]], ["meta", "taboola"]);
    expect(list[0]).toMatch(/BLOCK/);
    expect(list.some((i) => /pixel|tracking/i.test(i))).toBe(true);
    expect(list.some((i) => /advertorial/i.test(i))).toBe(true);
  });
});

describe("heuristicRationale", () => {
  it("names the picked angles and notes held-back blocked ones", () => {
    const ranked = rankAngles(angles, copy, verdicts);
    const set = selectLaunchSet(ranked, angles, 2);
    const text = heuristicRationale(ranked, set);
    expect(text).toContain("Clean angle");
    expect(text).toMatch(/1 angle\(s\) were held back/);
  });
  it("handles the empty launch set gracefully", () => {
    expect(heuristicRationale([], [])).toMatch(/No launch-ready/);
  });
});

describe("judge() end-to-end (heuristic path, no model)", () => {
  it("assembles a LaunchPackage with recommended angles, their copy, and a rationale", async () => {
    // Force the model path to fail fast so we exercise the heuristic fallback.
    const prevUrl = process.env.OPENAI_COMPAT_URL;
    const prevKey = process.env.ANTHROPIC_API_KEY;
    process.env.OPENAI_COMPAT_URL = "";
    process.env.ANTHROPIC_API_KEY = "";
    try {
      const { result } = await judge({
        brief: { url: "https://x", vertical: "v", product: "P", audience: { who: "", painPoints: [], desires: [] }, usps: [], claimsDetected: [], complianceRisk: "med", notes: "" },
        angles, copy, verdicts, advertorialUrl: "/p/demo-x",
      });
      expect(result.rationaleSource).toBe("heuristic");
      expect(result.launchPackage.recommendedAngles.length).toBeGreaterThan(0);
      expect(result.launchPackage.recommendedAngles.some((a) => a.id === "a3")).toBe(false); // blocked, excluded
      expect(result.launchPackage.advertorialUrl).toBe("/p/demo-x");
      // recommended copy only covers recommended angles
      const recIds = new Set(result.launchPackage.recommendedAngles.map((a) => a.id));
      expect(result.launchPackage.copy.every((c) => recIds.has(c.angleId))).toBe(true);
      expect(result.launchPackage.checklist.length).toBeGreaterThan(3);
    } finally {
      process.env.OPENAI_COMPAT_URL = prevUrl;
      process.env.ANTHROPIC_API_KEY = prevKey;
    }
  });
});
