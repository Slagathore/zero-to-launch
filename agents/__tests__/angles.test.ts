import { describe, it, expect } from "vitest";
import { coerceAngles, HOOK_TYPES } from "../angles";

describe("coerceAngles", () => {
  it("maps { angles: [...] } into typed Angle[] with stable ids", () => {
    const raw = {
      angles: [
        { hookType: "curiosity", promise: "Find out the trick", emotionalDriver: "intrigue", headlineSeed: "The 24-hour switch", rationale: "matches their impatience" },
        { hookType: "fear", promise: "Stop the decline", emotionalDriver: "fear", headlineSeed: "Before it's too late", rationale: "targets health anxiety" },
      ],
    };
    const angles = coerceAngles(raw);
    expect(angles).toHaveLength(2);
    expect(angles[0].id).toBe("angle-1");
    expect(angles[1].hookType).toBe("fear");
  });

  it("accepts a bare array as well as { angles: [...] }", () => {
    const angles = coerceAngles([{ hookType: "scarcity", promise: "Only today", headlineSeed: "Last chance" }]);
    expect(angles).toHaveLength(1);
    expect(angles[0].hookType).toBe("scarcity");
  });

  it("preserves a model-provided id when present", () => {
    const angles = coerceAngles({ angles: [{ id: "custom-x", promise: "p", headlineSeed: "h" }] });
    expect(angles[0].id).toBe("custom-x");
  });

  it("drops entries that have neither a promise nor a headline", () => {
    const angles = coerceAngles({ angles: [
      { hookType: "curiosity", promise: "", headlineSeed: "" },
      { hookType: "authority", promise: "Doctors trust it", headlineSeed: "" },
    ] });
    expect(angles).toHaveLength(1);
    expect(angles[0].promise).toBe("Doctors trust it");
  });

  it("returns an empty array for a shape with no angles", () => {
    expect(coerceAngles({ nope: true })).toEqual([]);
  });

  it("exposes a hook palette of distinct types for divergence", () => {
    expect(new Set(HOOK_TYPES).size).toBe(HOOK_TYPES.length);
    expect(HOOK_TYPES.length).toBeGreaterThanOrEqual(6);
  });
});
