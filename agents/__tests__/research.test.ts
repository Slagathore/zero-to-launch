import { describe, it, expect } from "vitest";
import { coerceOfferBrief } from "../research";

describe("coerceOfferBrief", () => {
  it("maps a well-formed model object into an OfferBrief and injects the url", () => {
    const raw = {
      vertical: "weight-loss supplement",
      product: "KetoSlim Gummies",
      audience: { who: "overweight adults 35-60", painPoints: ["slow metabolism", "failed diets"], desires: ["fast results"] },
      usps: ["BHB ketones", "appetite control"],
      claimsDetected: ["lose 20 lbs in a month", "guaranteed results"],
      complianceRisk: "high",
      notes: "Aggressive claims.",
    };
    const brief = coerceOfferBrief(raw, "https://offer.test");
    expect(brief.url).toBe("https://offer.test");
    expect(brief.product).toBe("KetoSlim Gummies");
    expect(brief.audience.painPoints).toHaveLength(2);
    expect(brief.complianceRisk).toBe("high");
  });

  it("defaults missing fields instead of throwing (robust to a thin model reply)", () => {
    const brief = coerceOfferBrief({ product: "X" }, "");
    expect(brief.product).toBe("X");
    expect(brief.vertical).toBe("unknown");
    expect(brief.audience.who).toBe("");
    expect(brief.audience.painPoints).toEqual([]);
    expect(brief.usps).toEqual([]);
    expect(brief.complianceRisk).toBe("med"); // safe default when unspecified
  });

  it("clamps an out-of-range complianceRisk to the safe default", () => {
    expect(coerceOfferBrief({ complianceRisk: "nuclear" }, "").complianceRisk).toBe("med");
  });

  it("accepts capitalized + synonym risk values instead of silently downgrading", () => {
    expect(coerceOfferBrief({ complianceRisk: "High" }, "").complianceRisk).toBe("high");
    expect(coerceOfferBrief({ complianceRisk: "LOW" }, "").complianceRisk).toBe("low");
    expect(coerceOfferBrief({ complianceRisk: "Medium" }, "").complianceRisk).toBe("med");
    expect(coerceOfferBrief({ complianceRisk: "moderate" }, "").complianceRisk).toBe("med");
  });

  it("drops non-string array entries from list fields", () => {
    const brief = coerceOfferBrief({ usps: ["real", 42, null, "also real"] }, "");
    expect(brief.usps).toEqual(["real", "also real"]);
  });

  it("tolerates a completely wrong shape (e.g. an array) without throwing", () => {
    const brief = coerceOfferBrief([1, 2, 3], "");
    expect(brief.product).toBe("unknown");
  });
});
