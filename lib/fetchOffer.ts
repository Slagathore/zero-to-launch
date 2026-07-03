import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

/**
 * Fetch + extract the readable content of an affiliate offer page so the
 * Research agent has clean text to analyze (ZERO_TO_LAUNCH_BUILD_PLAN.md §1 /
 * L0). Two entry paths, because real offer pages routinely defeat naive
 * fetching (bot walls, JS-only rendering — build plan §7 #4):
 *
 *   1. extractFromUrl(url)   — fetch the HTML, run Mozilla Readability to
 *      isolate the article/main content (dropping nav/ads/boilerplate).
 *   2. extractFromText(text) — the pasted-offer fallback: the operator copies
 *      the offer text in directly, bypassing the fetch entirely.
 *
 * Both return the same ExtractedOffer shape, which agents/research.ts turns
 * into an OfferBrief. The extracted `content` is UNTRUSTED (see lib/fence.ts):
 * research.ts must fence it before putting it in a prompt.
 */

export interface ExtractedOffer {
  source: "url" | "text";
  url: string; // the offer url, or "" for pasted text
  title: string;
  content: string; // plain-text main content, whitespace-normalized
  excerpt: string; // short summary if Readability found one
  truncated: boolean; // whether content was capped at MAX_CONTENT_CHARS
}

/** Cap on extracted text handed to the model — keeps token cost bounded. */
export const MAX_CONTENT_CHARS = 12_000;

/** A realistic UA reduces (doesn't eliminate) trivial bot walls. */
const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/122.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

function normalizeWhitespace(s: string): string {
  return s.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function cap(s: string): { text: string; truncated: boolean } {
  if (s.length <= MAX_CONTENT_CHARS) return { text: s, truncated: false };
  return { text: s.slice(0, MAX_CONTENT_CHARS), truncated: true };
}

/**
 * Run Readability over a raw HTML string. Exported + pure (no network) so it's
 * unit-testable with fixture HTML. Falls back to stripped body text when
 * Readability can't find an article (common on thin/landing-page markup).
 */
export function extractFromHtml(html: string, url: string): ExtractedOffer {
  const dom = new JSDOM(html, { url: url || "https://offer.example" });
  const doc = dom.window.document;
  const domTitle = doc.querySelector("title")?.textContent?.trim() || "";

  let title = domTitle;
  let content = "";
  let excerpt = "";

  try {
    const article = new Readability(doc).parse();
    if (article) {
      title = (article.title || domTitle).trim();
      excerpt = (article.excerpt || "").trim();
      content = (article.textContent || "").trim();
    }
  } catch {
    // Readability throws on some malformed docs — fall through to body text.
  }

  if (!content) {
    // Fallback: strip scripts/styles, take the body's text.
    doc.querySelectorAll("script,style,noscript,template").forEach((el) => el.remove());
    content = doc.body?.textContent?.trim() || "";
  }

  const { text, truncated } = cap(normalizeWhitespace(content));
  return { source: "url", url, title: title || domTitle, content: text, excerpt, truncated };
}

/**
 * Fetch an offer URL and extract its readable content. Throws a descriptive
 * error (bad status, network failure, empty page) so the caller can surface
 * "try the pasted-text fallback" to the user.
 */
export async function extractFromUrl(url: string): Promise<ExtractedOffer> {
  let res: Response;
  try {
    res = await fetch(url, { headers: FETCH_HEADERS, redirect: "follow", signal: AbortSignal.timeout(15_000) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Could not fetch the offer URL (${msg}). Paste the offer text instead.`);
  }
  if (!res.ok) {
    throw new Error(`Offer URL returned HTTP ${res.status}. Paste the offer text instead.`);
  }
  const html = await res.text();
  const extracted = extractFromHtml(html, url);
  if (!extracted.content || extracted.content.length < 40) {
    throw new Error(
      "Fetched the page but found almost no readable text (it may be JS-rendered or bot-walled). Paste the offer text instead.",
    );
  }
  return extracted;
}

/** The pasted-offer fallback: treat raw pasted text as the offer content. */
export function extractFromText(text: string): ExtractedOffer {
  const normalized = normalizeWhitespace(text);
  const { text: capped, truncated } = cap(normalized);
  // Use the first non-empty line as a provisional title.
  const firstLine = normalized.split("\n").map((l) => l.trim()).find(Boolean) || "Pasted offer";
  return {
    source: "text",
    url: "",
    title: firstLine.slice(0, 140),
    content: capped,
    excerpt: "",
    truncated,
  };
}

/**
 * Convenience dispatcher used by the API route: prefer a URL, fall back to
 * pasted text. Exactly one of `url` / `text` should be meaningfully populated.
 */
export async function getOffer(input: { url?: string; text?: string }): Promise<ExtractedOffer> {
  const url = input.url?.trim();
  const text = input.text?.trim();
  if (text && text.length >= 40) return extractFromText(text);
  if (url) return extractFromUrl(url);
  if (text) return extractFromText(text); // short text — let research decide if it's enough
  throw new Error("Provide an offer URL or paste the offer text.");
}
