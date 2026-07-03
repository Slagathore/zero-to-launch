import { describe, it, expect } from "vitest";
import { repairJsonish, extractPlanJson, parsePlan, isDestructive, closeTruncatedJson } from "../planjson";

describe("repairJsonish", () => {
  it("fixes trailing commas", () => {
    expect(JSON.parse(repairJsonish('{"a":1,}'))).toEqual({ a: 1 });
  });
  it("converts smart quotes to straight quotes", () => {
    const fixed = repairJsonish("{“a”:“b”}");
    expect(JSON.parse(fixed)).toEqual({ a: "b" });
  });
  it("strips // comments", () => {
    expect(JSON.parse(repairJsonish('{"a":1 // note\n}'))).toEqual({ a: 1 });
  });
});

describe("extractPlanJson", () => {
  it("pulls JSON out of a ```json fence", () => {
    const text = 'blah\n```json\n{"summary":"s","steps":[]}\n```\nmore';
    const { json } = extractPlanJson(text);
    expect(json && JSON.parse(json)).toEqual({ summary: "s", steps: [] });
  });

  it("pulls a balanced object with no fence (the shape agents/*.ts will emit)", () => {
    const text = 'Here is the brief: {"vertical":"skincare","usps":["a","b"]} — done.';
    const { json } = extractPlanJson(text);
    expect(json && JSON.parse(json)).toEqual({ vertical: "skincare", usps: ["a", "b"] });
  });
});

describe("parsePlan", () => {
  it("parses a valid plan with a known step type", () => {
    const text = '```json\n{"summary":"install","steps":[{"type":"pullModel","model":"x"}]}\n```';
    const res = parsePlan(text);
    expect(res.ok).toBe(true);
    expect(res.plan?.steps[0].type).toBe("pullModel");
  });
  it("fails gracefully on non-JSON", () => {
    expect(parsePlan("just prose, no plan here").ok).toBe(false);
  });
});

describe("isDestructive", () => {
  it("flags shell steps as destructive", () => {
    expect(isDestructive({ type: "shell", command: "rm", args: ["-rf", "/"] })).toBe(true);
  });
  it("treats a note as non-destructive", () => {
    expect(isDestructive({ type: "note", text: "hi" })).toBe(false);
  });
});

describe("truncation recovery", () => {
  it("recovers a plan truncated mid-string", () => {
    const text = '```json\n{"summary":"install it","steps":[{"type":"shell","command":"npm insta';
    const res = parsePlan(text);
    expect(res.ok).toBe(true);
    expect(res.plan?.steps[0].type).toBe("shell");
  });
  it("recovers an offer-brief-shaped object truncated mid-array (the failure mode agents/research.ts must survive)", () => {
    const text = '{"vertical":"weight-loss","usps":["fast","natural"';
    const out = closeTruncatedJson(text);
    expect(() => JSON.parse(out)).not.toThrow();
  });
});
