import { describe, it, expect } from "vitest";
import { coerceSettings, DEFAULT_SETTINGS, MODEL_STAGES } from "../settings";

describe("coerceSettings", () => {
  it("returns the defaults for junk input", () => {
    expect(coerceSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(coerceSettings("nope")).toEqual(DEFAULT_SETTINGS);
    expect(coerceSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps a valid per-stage model and defaults the rest", () => {
    const s = coerceSettings({ models: { copy: "glm-5.2:cloud" } });
    expect(s.models.copy).toBe("glm-5.2:cloud");
    expect(s.models.research).toBe(DEFAULT_SETTINGS.models.research);
    // every model stage is present
    for (const stage of MODEL_STAGES) expect(typeof s.models[stage]).toBe("string");
  });

  it("clamps angle count to 4..8", () => {
    expect(coerceSettings({ generation: { angleCount: 99 } }).generation.angleCount).toBe(8);
    expect(coerceSettings({ generation: { angleCount: 1 } }).generation.angleCount).toBe(4);
    expect(coerceSettings({ generation: { angleCount: 5 } }).generation.angleCount).toBe(5);
  });

  it("filters platforms to known values and never leaves it empty", () => {
    expect(coerceSettings({ generation: { defaultPlatforms: ["meta", "myspace", "tiktok"] } }).generation.defaultPlatforms)
      .toEqual(["meta", "tiktok"]);
    expect(coerceSettings({ generation: { defaultPlatforms: [] } }).generation.defaultPlatforms)
      .toEqual(DEFAULT_SETTINGS.generation.defaultPlatforms);
  });

  it("validates strictness", () => {
    expect(coerceSettings({ compliance: { strictness: "strict" } }).compliance.strictness).toBe("strict");
    expect(coerceSettings({ compliance: { strictness: "nuclear" } }).compliance.strictness).toBe("standard");
  });
});
