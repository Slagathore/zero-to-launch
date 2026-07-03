import { describe, it, expect } from "vitest";
import { extractFromHtml, extractFromText, getOffer, MAX_CONTENT_CHARS } from "../fetchOffer";

const ARTICLE_HTML = `<!doctype html><html><head><title>KetoSlim Offer</title></head>
<body>
  <nav>Home About Contact</nav>
  <article>
    <h1>KetoSlim Gummies</h1>
    <p>Melt fat without diet or exercise. Our patented BHB formula forces ketosis in 24 hours.</p>
    <p>Users report losing 20 lbs in the first month — guaranteed results or your money back.</p>
    <p>Clinically proven ketones suppress appetite and crush cravings all day long, every day.</p>
  </article>
  <footer>Copyright 2026</footer>
  <script>console.log("tracking pixel")</script>
</body></html>`;

describe("extractFromHtml", () => {
  it("pulls the title and main content, dropping scripts", () => {
    const out = extractFromHtml(ARTICLE_HTML, "https://example.com/offer");
    expect(out.source).toBe("url");
    expect(out.title.toLowerCase()).toContain("ketoslim");
    expect(out.content).toContain("BHB");
    expect(out.content).toContain("ketosis");
    expect(out.content).not.toContain("tracking pixel"); // script removed
  });

  it("falls back to body text when there is no article element", () => {
    const html = `<html><head><title>Bare</title></head><body><div>Just a naked promo line about a product with enough words to matter here.</div></body></html>`;
    const out = extractFromHtml(html, "https://x.test");
    expect(out.content).toContain("naked promo line");
  });

  it("caps very long content and flags truncation", () => {
    const huge = "word ".repeat(MAX_CONTENT_CHARS); // ~5x the cap in chars
    const html = `<html><head><title>Big</title></head><body><article><p>${huge}</p></article></body></html>`;
    const out = extractFromHtml(html, "https://x.test");
    expect(out.content.length).toBeLessThanOrEqual(MAX_CONTENT_CHARS);
    expect(out.truncated).toBe(true);
  });
});

describe("extractFromText", () => {
  it("uses the first non-empty line as the title and keeps the body", () => {
    const out = extractFromText("  \n Amazing Offer Headline \n details about the amazing offer follow here");
    expect(out.source).toBe("text");
    expect(out.url).toBe("");
    expect(out.title).toBe("Amazing Offer Headline");
    expect(out.content).toContain("details about the amazing offer");
  });
});

describe("getOffer dispatch", () => {
  it("prefers pasted text when it is substantial", async () => {
    const out = await getOffer({ url: "https://ignored.test", text: "This is a sufficiently long pasted offer body to be used directly." });
    expect(out.source).toBe("text");
  });

  it("throws a helpful error when neither input is provided", async () => {
    await expect(getOffer({})).rejects.toThrow(/offer URL or paste/i);
  });
});
