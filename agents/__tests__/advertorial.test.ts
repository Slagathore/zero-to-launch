import { describe, it, expect } from "vitest";
import {
  escapeHtml, safeHref, makeSlug, coerceAdvertorialContent, renderAdvertorialHtml,
  FTC_BASELINE, FTC_RESULTS, type AdvertorialContent,
} from "../advertorial";
import type { Angle, OfferBrief } from "../types";

const BRIEF: OfferBrief = {
  url: "https://offer.example/keto",
  vertical: "keto weight-loss supplement",
  product: "KetoSlim Gummies",
  audience: { who: "adults", painPoints: ["cravings"], desires: ["fast results"] },
  usps: ["BHB ketones"],
  claimsDetected: ["lose 20 lbs"],
  complianceRisk: "high",
  notes: "",
};

const ANGLE: Angle = {
  id: "angle-1", hookType: "curiosity", promise: "the 24-hour switch",
  emotionalDriver: "intrigue", headlineSeed: "The 24-Hour Fat Switch", rationale: "impatience",
};

const CONTENT: AdvertorialContent = {
  headline: "The 24-Hour Switch Everyone Ignores",
  deck: "A closer look at a simpler approach.",
  authorLabel: "The Wellness Desk",
  sections: [
    { type: "paragraph", text: "It starts with a question." },
    { type: "heading", text: "The Problem" },
    { type: "bullets", text: "Why people try it", items: ["Supports ketosis", "Curbs cravings"] },
    { type: "pullquote", text: "A different way to think about it." },
    { type: "cta", text: "See if it fits your routine." },
  ],
  ctaText: "Check Availability",
  disclaimerNotes: ["These statements have not been evaluated by the FDA."],
};

describe("escapeHtml", () => {
  it("neutralizes script tags, quotes, and ampersands", () => {
    const out = escapeHtml(`<script>alert("x&y'z")</script>`);
    expect(out).toBe("&lt;script&gt;alert(&quot;x&amp;y&#39;z&quot;)&lt;/script&gt;");
  });
});

describe("safeHref", () => {
  it("passes http(s) URLs through", () => {
    expect(safeHref("https://offer.example/keto")).toBe("https://offer.example/keto");
  });
  it("inerts javascript: and garbage to #", () => {
    expect(safeHref("javascript:alert(1)")).toBe("#");
    expect(safeHref("not a url")).toBe("#");
    expect(safeHref("")).toBe("#");
  });
});

describe("makeSlug", () => {
  it("builds a url-safe slug from product + hook with the given suffix", () => {
    expect(makeSlug(BRIEF, ANGLE, "ab12")).toBe("ketoslim-gummies-curiosity-ab12");
  });
  it("random suffix keeps the slug within the store's allowed charset", () => {
    expect(makeSlug(BRIEF, ANGLE)).toMatch(/^[a-z0-9][a-z0-9-]*$/);
  });
});

describe("coerceAdvertorialContent", () => {
  it("passes a valid object through with all sections", () => {
    const c = coerceAdvertorialContent(CONTENT, BRIEF, ANGLE);
    expect(c.headline).toBe(CONTENT.headline);
    expect(c.sections).toHaveLength(5);
  });
  it("defaults thin replies from the brief/angle instead of throwing", () => {
    const c = coerceAdvertorialContent({}, BRIEF, ANGLE);
    expect(c.headline).toBe(ANGLE.headlineSeed);
    expect(c.deck).toBe(ANGLE.promise);
    expect(c.authorLabel).toContain(BRIEF.product);
    expect(c.ctaText).toBe("Learn More");
    expect(c.sections).toEqual([]);
  });
  it("drops empty sections and bullets without items", () => {
    const c = coerceAdvertorialContent({
      sections: [
        { type: "paragraph", text: "" },
        { type: "bullets", items: [] },
        { type: "paragraph", text: "keeps this" },
        { type: "mystery", text: "unknown type becomes paragraph" },
      ],
    }, BRIEF, ANGLE);
    expect(c.sections).toHaveLength(2);
    expect(c.sections[0].text).toBe("keeps this");
    expect(c.sections[1].type).toBe("paragraph");
  });
});

describe("renderAdvertorialHtml", () => {
  const html = renderAdvertorialHtml(CONTENT, BRIEF, "2026-07-03T12:00:00.000Z");

  it("always renders the hardcoded FTC baseline + results lines", () => {
    expect(html).toContain(FTC_BASELINE);
    expect(html).toContain(FTC_RESULTS);
  });
  it("renders headline, deck, byline (Sponsored), and vertical disclaimer", () => {
    expect(html).toContain("The 24-Hour Switch Everyone Ignores");
    expect(html).toContain("A closer look at a simpler approach.");
    expect(html).toContain("Sponsored");
    expect(html).toContain("The Wellness Desk");
    expect(html).toContain("evaluated by the FDA");
  });
  it("links every CTA to the offer URL with sponsored rel", () => {
    expect(html).toContain(`href="https://offer.example/keto"`);
    expect(html).toContain(`rel="nofollow sponsored"`);
    expect(html).toContain("Check Availability");
  });
  it("escapes hostile model output instead of rendering it", () => {
    const evil: AdvertorialContent = {
      ...CONTENT,
      headline: `<script>alert('pwn')</script>`,
      sections: [{ type: "paragraph", text: `<img src=x onerror=alert(1)>` }],
    };
    const out = renderAdvertorialHtml(evil, BRIEF, "2026-07-03T12:00:00.000Z");
    expect(out).not.toContain("<script>alert");
    expect(out).not.toContain("<img src=x");
    expect(out).toContain("&lt;script&gt;");
  });
  it("inerts a hostile offer URL in the CTA", () => {
    const out = renderAdvertorialHtml(CONTENT, { ...BRIEF, url: "javascript:alert(1)" }, "2026-07-03T12:00:00.000Z");
    expect(out).not.toContain("javascript:alert");
    expect(out).toContain(`href="#"`);
  });
  it("gives the first paragraph the drop-cap lede class", () => {
    expect(html).toContain(`<p class="lede">`);
  });
});
