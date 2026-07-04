import { describe, it, expect } from "vitest";
import { STAGES, stageDataFromResult, type RunResult } from "../orchestrator-core";

const result: RunResult = {
  brief: { url: "https://x", vertical: "v", product: "P", audience: { who: "", painPoints: [], desires: [] }, usps: [], claimsDetected: [], complianceRisk: "low", notes: "" },
  angles: [{ id: "a1", hookType: "curiosity", promise: "p", emotionalDriver: "e", headlineSeed: "h", rationale: "r" }],
  copy: [{ angleId: "a1", platform: "meta", headline: "H", primaryText: "b", description: "d", cta: "Learn More" }],
  verdicts: [{ angleId: "a1", platform: "meta", status: "pass", violations: [] }],
  advertorialSlug: "p-curiosity-ab12",
  advertorialUrl: "/p/p-curiosity-ab12",
  advertorialAngleId: "a1",
  judge: {
    ranking: [], rationale: "r", rationaleSource: "heuristic",
    launchPackage: { offerBrief: { url: "https://x", vertical: "v", product: "P", audience: { who: "", painPoints: [], desires: [] }, usps: [], claimsDetected: [], complianceRisk: "low", notes: "" }, recommendedAngles: [], copy: [], advertorialUrl: "/p/p-curiosity-ab12", checklist: [] },
  },
};

describe("stageDataFromResult", () => {
  it("derives a done-payload for every stage (so the seeded replay matches live)", () => {
    expect(STAGES).toEqual(["research", "angles", "copy", "compliance", "advertorial", "judge"]);
    expect(stageDataFromResult(result, "research")).toBe(result.brief);
    expect(stageDataFromResult(result, "angles")).toBe(result.angles);
    expect(stageDataFromResult(result, "copy")).toBe(result.copy);
    expect(stageDataFromResult(result, "compliance")).toBe(result.verdicts);
    expect(stageDataFromResult(result, "advertorial")).toEqual({ slug: "p-curiosity-ab12", url: "/p/p-curiosity-ab12", angleId: "a1" });
    expect(stageDataFromResult(result, "judge")).toBe(result.judge);
  });
});
