import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { lookup } from "node:dns/promises";
import net from "node:net";

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

/** Max bytes we'll buffer from an offer page — bounds a memory-exhaustion DoS
 *  via an attacker-controlled URL that streams an enormous body. */
const MAX_FETCH_BYTES = 5_000_000; // 5 MB of HTML is already absurd for an offer page

/** Is an IP literal in a private / loopback / link-local / metadata range? */
export function isPrivateAddress(ip: string): boolean {
  const fam = net.isIP(ip);
  if (fam === 4) {
    const o = ip.split(".").map(Number);
    if (o.length !== 4 || o.some((n) => Number.isNaN(n))) return true; // treat unparseable as unsafe
    return (
      o[0] === 0 || o[0] === 127 || o[0] === 10 || // this-host, loopback, private
      (o[0] === 172 && o[1] >= 16 && o[1] <= 31) || // 172.16/12
      (o[0] === 192 && o[1] === 168) || // 192.168/16
      (o[0] === 169 && o[1] === 254) || // link-local incl. 169.254.169.254 cloud metadata
      (o[0] === 100 && o[1] >= 64 && o[1] <= 127) // CGNAT 100.64/10
    );
  }
  if (fam === 6) {
    const a = ip.toLowerCase();
    if (a === "::1" || a === "::") return true; // loopback / unspecified
    if (a.startsWith("fe80") || a.startsWith("fc") || a.startsWith("fd")) return true; // link-local / ULA
    const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }
  return true; // not a valid IP → unsafe
}

/**
 * SSRF guard: validate an offer URL before fetching it. Enforces http(s),
 * blocks obviously-internal hostnames, and resolves the host to reject any
 * private / loopback / link-local / cloud-metadata address. This matters
 * because the app is publicly reachable and fetches a user-supplied URL
 * server-side — without this, a request could pivot to internal services or
 * the cloud metadata endpoint.
 */
export async function assertSafeUrl(rawUrl: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error("That doesn't look like a valid URL. Paste the offer text instead.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("Only http(s) offer URLs are allowed. Paste the offer text instead.");
  }
  const host = u.hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  if (/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(host)) {
    throw new Error("Refusing to fetch an internal host. Paste the offer text instead.");
  }
  // If it's already an IP literal, check it directly; otherwise resolve.
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new Error("Refusing to fetch a private address. Paste the offer text instead.");
    return u;
  }
  let addrs: { address: string }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new Error("Could not resolve the offer host. Paste the offer text instead.");
  }
  if (addrs.length === 0 || addrs.some((a) => isPrivateAddress(a.address))) {
    throw new Error("Refusing to fetch that host (resolves to a private address). Paste the offer text instead.");
  }
  return u;
}

/** Read a response body up to a byte cap, aborting if it's exceeded. */
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error("Offer page is too large to process. Paste the offer text instead.");
  }
  if (!res.body) return (await res.text()).slice(0, maxBytes);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error("Offer page is too large to process. Paste the offer text instead.");
      }
      chunks.push(value);
    }
  }
  return new TextDecoder("utf-8").decode(concatBytes(chunks, total));
}

function concatBytes(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  return out;
}

/**
 * Fetch an offer URL and extract its readable content. Throws a descriptive
 * error (bad status, network failure, empty page) so the caller can surface
 * "try the pasted-text fallback" to the user. SSRF-guarded + size-capped.
 */
export async function extractFromUrl(url: string): Promise<ExtractedOffer> {
  const safe = await assertSafeUrl(url);
  let res: Response;
  try {
    res = await fetch(safe, { headers: FETCH_HEADERS, redirect: "manual", signal: AbortSignal.timeout(15_000) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Could not fetch the offer URL (${msg}). Paste the offer text instead.`);
  }
  // redirect:"manual" — a redirect could point at an internal host, bypassing
  // the SSRF check. Treat any redirect as "use the pasted-text fallback".
  if (res.status >= 300 && res.status < 400) {
    throw new Error("Offer URL redirected; follow it in your browser and paste the final page's text instead.");
  }
  if (!res.ok) {
    throw new Error(`Offer URL returned HTTP ${res.status}. Paste the offer text instead.`);
  }
  const html = await readCapped(res, MAX_FETCH_BYTES);
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
