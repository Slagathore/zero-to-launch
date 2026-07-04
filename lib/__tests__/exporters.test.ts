import { describe, it, expect } from "vitest";
import {
  toMetaCTA, csvField, buildMetaCsv, buildTaboolaCsv, buildGenericCsv, overLimitFields,
  type ExportCtx,
} from "../exporters";
import type { AdCopy, Angle } from "@/agents/types";

const angles: Angle[] = [
  { id: "a1", hookType: "curiosity", promise: "p1", emotionalDriver: "e", headlineSeed: "The 24-Hour Switch", rationale: "r" },
  { id: "a2", hookType: "fear", promise: "p2", emotionalDriver: "e", headlineSeed: "Before It's Too Late", rationale: "r" },
];

const ads: AdCopy[] = [
  { angleId: "a1", platform: "meta", headline: "Melt Fat Fast", primaryText: "You won't believe it, honestly.", description: "New formula", cta: "Shop Now" },
  { angleId: "a2", platform: "taboola", headline: "Doctors Are Talking", primaryText: "Here's the native teaser.", description: "", cta: "Read More" },
  { angleId: "a1", platform: "google", headline: "G head", primaryText: "g body", description: "g desc", cta: "Learn More" },
];

const ctx: ExportCtx = {
  product: "KetoSlim",
  origin: "https://aideas4ads.cognima.net",
  advertorialUrls: { a1: "/p/ketoslim-curiosity-x1" },
  fallbackUrl: "/p/ketoslim-curiosity-x1",
  recommendedIds: new Set(["a1"]),
};

describe("toMetaCTA", () => {
  it("maps human CTAs to Meta enum values", () => {
    expect(toMetaCTA("Shop Now")).toBe("SHOP_NOW");
    expect(toMetaCTA("learn more")).toBe("LEARN_MORE");
    expect(toMetaCTA("Sign Up")).toBe("SIGN_UP");
  });
  it("defaults unknown CTAs to LEARN_MORE (never free text)", () => {
    expect(toMetaCTA("Buy the thing")).toBe("LEARN_MORE");
    expect(toMetaCTA("")).toBe("LEARN_MORE");
  });
});

describe("csvField escaping", () => {
  it("quotes + doubles quotes for commas, quotes, and newlines", () => {
    expect(csvField("plain")).toBe("plain");
    expect(csvField("a,b")).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField("line1\nline2")).toBe('"line1\nline2"');
  });
});

describe("buildMetaCsv", () => {
  const out = buildMetaCsv(ads, angles, ctx);
  const lines = out.trim().split("\r\n");
  it("uses Meta's TEMPLATE headers (Title/Body), not the UI labels", () => {
    expect(lines[0]).toBe("Campaign Name,Ad Set Name,Ad Name,Title,Body,Link Description,Website URL,Call to Action,Status");
    expect(lines[0]).not.toContain("Headline");
    expect(lines[0]).not.toContain("Primary Text");
  });
  it("emits only meta ads, CTA as enum, Status PAUSED, absolute URL", () => {
    expect(lines).toHaveLength(2); // header + 1 meta ad
    const row = lines[1];
    expect(row).toContain("Melt Fat Fast"); // Title = headline
    expect(row).toContain("SHOP_NOW"); // enum, not "Shop Now"
    expect(row).toContain("PAUSED");
    expect(row).toContain("https://aideas4ads.cognima.net/p/ketoslim-curiosity-x1");
  });
});

describe("buildTaboolaCsv", () => {
  const out = buildTaboolaCsv(ads, angles, ctx);
  const lines = out.trim().split("\r\n");
  it("uses the native content-ad columns — DIFFERENT from Meta (Brand + Thumbnail, no Body)", () => {
    expect(lines[0]).toBe("Campaign Name,Brand Name,Title,Description,Landing Page URL,Thumbnail URL,CPC,Status");
    expect(lines[0]).not.toContain("Body");
    expect(lines[0]).toContain("Brand Name");
    expect(lines[0]).toContain("Thumbnail URL");
  });
  it("emits only taboola ads with brand + PAUSED and blank thumbnail", () => {
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("KetoSlim"); // Brand Name
    expect(lines[1]).toContain("Doctors Are Talking");
    expect(lines[1]).toContain("PAUSED");
  });
});

describe("buildGenericCsv", () => {
  it("includes every ad with a Recommended TRUE/FALSE column", () => {
    const out = buildGenericCsv(ads, angles, ctx);
    const lines = out.trim().split("\r\n");
    expect(lines[0]).toBe("Platform,Angle,Recommended,Headline,Primary Text,Description,CTA,Landing Page URL");
    expect(lines).toHaveLength(4); // header + 3 ads (all platforms)
    // a1 is recommended, a2 is not
    expect(lines.find((l) => l.startsWith("meta"))).toContain("TRUE");
    expect(lines.find((l) => l.startsWith("taboola"))).toContain("FALSE");
  });
});

describe("overLimitFields", () => {
  it("flags Meta copy that exceeds the soft caps (Title>40, Body>125)", () => {
    const long: AdCopy = { angleId: "a1", platform: "meta", headline: "x".repeat(50), primaryText: "y".repeat(130), description: "ok", cta: "Shop Now" };
    const over = overLimitFields(long);
    expect(over.map((o) => o.field).sort()).toEqual(["headline", "primaryText"]);
  });
  it("passes copy within limits", () => {
    expect(overLimitFields(ads[0])).toEqual([]);
  });
});
