import { randomBytes } from "node:crypto";
import type { Advertorial, Angle, OfferBrief } from "@/agents/types";
import { generateJson, asString, asStringArray, asRecord, asEnum, AgentJsonError } from "@/lib/agentJson";
import type { GenerateResult } from "@/lib/llm";

/**
 * Advertorial Agent (ZERO_TO_LAUNCH_BUILD_PLAN.md §2, L2) — the
 * judge-clicks-it centerpiece. Top angle + OfferBrief → a full, styled,
 * FTC-compliant advertorial pre-lander served live at /p/[slug].
 *
 * Design decisions (S3, Fable):
 *
 * 1. The model generates STRUCTURED CONTENT (headline/deck/sections JSON),
 *    never raw HTML. We render it through a fixed template
 *    (renderAdvertorialHtml) with every model string HTML-escaped. That gives
 *    a consistently polished page, and the model cannot inject markup or
 *    scripts — the XSS surface is our escape function, which is unit-tested.
 *
 * 2. The FTC baseline is HARDCODED into the template (banner + footer). The
 *    model contributes vertical-specific disclaimer lines (e.g. an FDA line
 *    for supplements) via disclaimerNotes, but it cannot remove the baseline.
 *    Tests assert the baseline strings appear in every rendered page.
 *
 * 3. Integrity rules in the prompt forbid invented people, statistics,
 *    doctor/clinical citations, or claims not present in the brief — both an
 *    FTC posture and the setup for the S4 compliance gate to audit honestly.
 *
 * Visual direction: magazine-editorial — fictional "THE DAILY ANGLE" masthead
 * clearly labeled Sponsored Feature, serif display headline, drop-cap lede,
 * crimson accent, checkmark benefit cards, pull-quotes, high-contrast CTAs.
 * Self-contained (system font stacks, inline <style>) so Advertorial.html is
 * portable anywhere, matching the contract's "deployable HTML" intent.
 */

// --- FTC baseline (hardcoded; template always renders these) ---------------

export const FTC_BASELINE =
  "PAID ADVERTISEMENT — This is sponsored content, not a news article. " +
  "The publisher may earn a commission from purchases made through links on this page.";

export const FTC_RESULTS = "Results are not typical; individual results vary.";

// --- structured content the model produces ---------------------------------

export type SectionType = "paragraph" | "heading" | "bullets" | "pullquote" | "cta";

export interface AdvertorialSection {
  type: SectionType;
  /** paragraph/heading/pullquote body, or the short urgency line above a CTA button. */
  text?: string;
  /** bullets only */
  items?: string[];
}

export interface AdvertorialContent {
  headline: string;
  deck: string; // one-sentence subheadline under the headline
  authorLabel: string; // e.g. "The Wellness Desk" — template appends "· Sponsored"
  sections: AdvertorialSection[];
  ctaText: string; // button label used by every cta section
  disclaimerNotes: string[]; // vertical-specific lines appended to the FTC footer
}

const MAX_SECTIONS = 16;

const SYSTEM_PROMPT = `You are a senior advertorial writer for native-ad pre-landers (Taboola/Outbrain style).
You write persuasive, editorial-toned sponsored articles that convert cold traffic — while staying honest.

You will receive an offer brief and ONE marketing angle. Write a complete advertorial article
(600-900 words) that develops THAT angle's hook into a story-driven pre-lander.

Structure the article in this proven arc:
1. A hook lede that opens the angle's curiosity/emotion loop (2-3 short paragraphs).
2. Problem agitation grounded in the audience's real pain points.
3. The discovery/mechanism story — how the product addresses the problem (use the brief's USPs).
4. A benefits section as bullets.
5. Soft, hedged social proof ("many users report…") — aggregate only.
6. A clear call-to-action, a risk-reversal/reassurance beat, then a closing call-to-action.

INTEGRITY RULES (non-negotiable — a compliance gate audits your output):
- Do NOT invent named people, testimonials, doctors, experts, statistics, percentages, or studies.
- Only make claims supported by the brief's usps/claimsDetected; hedge everything else ("may", "can", "many report").
- No "guaranteed", no disease-cure language, no income promises.
- disclaimerNotes: 1-3 short vertical-appropriate disclaimer lines (e.g. an FDA line for supplements,
  "not financial advice" for finance). Do not restate the affiliate disclosure; that is already handled.

Return ONLY a JSON object (no prose, no markdown fence) with EXACTLY this shape:
{
  "headline": string,          // develops the angle's headlineSeed — editorial, curiosity-driven
  "deck": string,              // one-sentence subheadline, <= 30 words
  "authorLabel": string,       // an editorial-desk style byline label; NO personal names, NO credentials
  "sections": [
    { "type": "paragraph", "text": string },
    { "type": "heading",   "text": string },
    { "type": "bullets",   "text": string, "items": [string] },   // text = optional mini-title
    { "type": "pullquote", "text": string },
    { "type": "cta",       "text": string }                        // short urgency line above the button
  ],
  "ctaText": string,           // the CTA button label, 2-5 words
  "disclaimerNotes": [string]
}

Rules of form: 8-13 sections total; include at least one "bullets", one "pullquote", and finish with a "cta";
short paragraphs (2-4 sentences); headings every 2-3 sections to keep it scannable.`;

function buildUserMessage(brief: OfferBrief, angle: Angle): string {
  return `OFFER BRIEF:
${JSON.stringify({ product: brief.product, vertical: brief.vertical, audience: brief.audience, usps: brief.usps, claimsDetected: brief.claimsDetected, complianceRisk: brief.complianceRisk }, null, 2)}

THE ANGLE TO DEVELOP:
${JSON.stringify({ hookType: angle.hookType, promise: angle.promise, emotionalDriver: angle.emotionalDriver, headlineSeed: angle.headlineSeed, rationale: angle.rationale }, null, 2)}`;
}

// --- coercion (defensive, house pattern: default, never throw) -------------

const SECTION_TYPES = ["paragraph", "heading", "bullets", "pullquote", "cta"] as const;

function coerceSection(raw: unknown): AdvertorialSection | null {
  const s = asRecord(raw);
  const type = asEnum(s.type, SECTION_TYPES, "paragraph");
  const text = asString(s.text).trim();
  const items = asStringArray(s.items);
  if (type === "bullets") {
    if (items.length === 0) return null; // bullets without items are useless
    return { type, text, items };
  }
  if (!text) return null; // every other type needs text
  return { type, text };
}

/** Coerce arbitrary parsed JSON into validated AdvertorialContent. */
export function coerceAdvertorialContent(raw: unknown, brief: OfferBrief, angle: Angle): AdvertorialContent {
  const o = asRecord(raw);
  const sections = (Array.isArray(o.sections) ? o.sections : [])
    .map(coerceSection)
    .filter((s): s is AdvertorialSection => s !== null)
    .slice(0, MAX_SECTIONS);
  // Structural invariant, enforced in code rather than trusted to the prompt
  // (live testing caught the model skipping it): every non-empty advertorial
  // ends with a CTA block — a pre-lander without a call-to-action is broken.
  // Empty section lists stay empty so generateAdvertorial() can retry instead.
  if (sections.length > 0 && !sections.some((s) => s.type === "cta")) {
    sections.push({ type: "cta", text: `Curious whether ${brief.product} fits your routine?` });
  }
  return {
    headline: asString(o.headline).trim() || angle.headlineSeed || brief.product,
    deck: asString(o.deck).trim() || angle.promise,
    authorLabel: asString(o.authorLabel).trim() || `${brief.product} Editorial Partner`,
    sections,
    ctaText: asString(o.ctaText).trim() || "Learn More",
    disclaimerNotes: asStringArray(o.disclaimerNotes).slice(0, 4),
  };
}

// --- rendering (fixed template; ALL model strings escaped) ------------------

/** Escape a model/offer string for safe interpolation into HTML. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Only http(s) offer URLs may become the CTA href; anything else inerts to "#". */
export function safeHref(url: string): string {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : "#";
  } catch {
    return "#";
  }
}

/** URL-safe slug from product + angle, with a random suffix (injectable for tests). */
export function makeSlug(brief: OfferBrief, angle: Angle, suffix?: string): string {
  const base = `${brief.product} ${angle.hookType}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  const tail = suffix ?? randomBytes(3).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "x");
  return `${base || "advertorial"}-${tail}`;
}

function readingMinutes(content: AdvertorialContent): number {
  const words = [content.deck, ...content.sections.flatMap((s) => [s.text ?? "", ...(s.items ?? [])])]
    .join(" ")
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.min(9, Math.max(2, Math.ceil(words / 220)));
}

function renderSection(s: AdvertorialSection, index: number, ctaLabel: string, href: string): string {
  switch (s.type) {
    case "heading":
      return `<h2>${escapeHtml(s.text ?? "")}</h2>`;
    case "pullquote":
      return `<blockquote class="pull">${escapeHtml(s.text ?? "")}</blockquote>`;
    case "bullets": {
      const title = s.text ? `<p class="bullets-title">${escapeHtml(s.text)}</p>` : "";
      const items = (s.items ?? []).map((it) => `<li>${escapeHtml(it)}</li>`).join("");
      return `<div class="benefits">${title}<ul>${items}</ul></div>`;
    }
    case "cta":
      return `<div class="cta-block"><p class="cta-lead">${escapeHtml(s.text ?? "")}</p><a class="cta-btn" href="${escapeHtml(href)}" rel="nofollow sponsored">${escapeHtml(ctaLabel)}</a></div>`;
    case "paragraph":
    default:
      return `<p${index === 0 ? ' class="lede"' : ""}>${escapeHtml(s.text ?? "")}</p>`;
  }
}

/**
 * Render the full advertorial page HTML. A self-contained fragment (inline
 * <style>, system fonts, zero external assets) scoped under .advertorial-page
 * so it embeds cleanly in the Next app shell AND ports anywhere as-is.
 */
export function renderAdvertorialHtml(
  content: AdvertorialContent,
  brief: OfferBrief,
  createdAtISO: string,
): string {
  const href = safeHref(brief.url);
  const minutes = readingMinutes(content);
  const dateLabel = new Date(createdAtISO).toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });
  // First paragraph gets the drop cap: find its index among sections.
  const firstParagraphIdx = content.sections.findIndex((s) => s.type === "paragraph");
  const body = content.sections
    .map((s, i) => renderSection(s, s.type === "paragraph" && i === firstParagraphIdx ? 0 : i + 1, content.ctaText, href))
    .join("\n");
  const disclaimers = [FTC_BASELINE, FTC_RESULTS, ...content.disclaimerNotes]
    .map((d) => `<p>${escapeHtml(d)}</p>`)
    .join("");

  return `<div class="advertorial-page">
<style>
  .advertorial-page{--ink:#16181d;--muted:#5b6068;--accent:#b3223a;--accent-dark:#951c30;--paper:#f7f5f2;--rule:#e4e1db;
    font-family:Georgia,'Times New Roman',serif;color:var(--ink);background:#fff;line-height:1.7;-webkit-font-smoothing:antialiased}
  .advertorial-page *{margin:0;padding:0;box-sizing:border-box}
  .advertorial-page ::selection{background:var(--accent);color:#fff}
  .ftc-banner{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:var(--ink);color:#fff;
    font-size:.72rem;letter-spacing:.02em;text-align:center;padding:.55rem 1rem;line-height:1.45}
  .masthead{text-align:center;border-bottom:3px double var(--rule);padding:1.4rem 1rem 1.1rem}
  .masthead .wordmark{font-family:Georgia,serif;font-weight:700;font-size:1.35rem;letter-spacing:.35em;text-transform:uppercase}
  .masthead .tagline{font-family:system-ui,sans-serif;font-size:.7rem;letter-spacing:.28em;text-transform:uppercase;color:var(--accent);margin-top:.35rem}
  .wrap{max-width:680px;margin:0 auto;padding:2.2rem 1.4rem 3rem}
  .advertorial-page h1{font-size:clamp(1.9rem,4.6vw,2.85rem);line-height:1.13;letter-spacing:-.015em;font-weight:800;margin-bottom:.9rem}
  .deck{font-size:1.22rem;line-height:1.5;color:var(--muted);font-style:italic;margin-bottom:1.4rem}
  .byline{font-family:system-ui,sans-serif;font-size:.8rem;color:var(--muted);display:flex;flex-wrap:wrap;gap:.45rem;
    align-items:center;border-top:1px solid var(--rule);border-bottom:1px solid var(--rule);padding:.7rem 0;margin-bottom:1.9rem}
  .byline .spon{background:var(--accent);color:#fff;font-weight:700;font-size:.62rem;letter-spacing:.08em;
    text-transform:uppercase;padding:.18rem .5rem;border-radius:3px}
  .advertorial-page p{font-size:1.075rem;margin-bottom:1.15rem}
  .advertorial-page p.lede::first-letter{font-size:3.2em;font-weight:800;float:left;line-height:.85;
    padding:.06em .12em 0 0;color:var(--accent)}
  .advertorial-page h2{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:1.3rem;font-weight:800;
    letter-spacing:-.01em;margin:1.9rem 0 .85rem}
  blockquote.pull{font-size:1.35rem;line-height:1.45;font-style:italic;font-weight:600;color:var(--ink);
    border-left:4px solid var(--accent);padding:.35rem 0 .35rem 1.15rem;margin:1.7rem 0}
  .benefits{background:var(--paper);border:1px solid var(--rule);border-radius:12px;padding:1.25rem 1.4rem;margin:1.6rem 0}
  .benefits .bullets-title{font-family:system-ui,sans-serif;font-weight:700;font-size:1rem;margin-bottom:.6rem}
  .benefits ul{list-style:none}
  .benefits li{font-size:1.03rem;padding-left:1.6em;position:relative;margin-bottom:.55rem}
  .benefits li::before{content:'\\2713';position:absolute;left:.15em;color:var(--accent);font-weight:800;font-family:system-ui,sans-serif}
  .cta-block{text-align:center;margin:2rem 0;padding:1.6rem 1.2rem;background:var(--paper);border:1px solid var(--rule);border-radius:14px}
  .cta-lead{font-family:system-ui,sans-serif;font-weight:600;font-size:1rem;margin-bottom: .9rem}
  .cta-btn{display:inline-block;font-family:system-ui,sans-serif;font-weight:800;font-size:1.06rem;color:#fff;
    background:var(--accent);text-decoration:none;padding:.85rem 2.1rem;border-radius:10px;
    box-shadow:0 3px 10px rgba(179,34,58,.28);transition:background .15s}
  .cta-btn:hover{background:var(--accent-dark)}
  .ftc-footer{border-top:1px solid var(--rule);margin-top:2.4rem;padding-top:1.1rem}
  .ftc-footer p{font-family:system-ui,sans-serif;font-size:.74rem;line-height:1.55;color:var(--muted);margin-bottom:.5rem}
  @media (max-width:520px){.wrap{padding:1.6rem 1.1rem 2.2rem}.advertorial-page p{font-size:1.02rem}}
</style>
<div class="ftc-banner">${escapeHtml(FTC_BASELINE)}</div>
<header class="masthead">
  <div class="wordmark">The Daily Angle</div>
  <div class="tagline">Sponsored Feature</div>
</header>
<article class="wrap">
  <h1>${escapeHtml(content.headline)}</h1>
  <p class="deck">${escapeHtml(content.deck)}</p>
  <div class="byline">
    <span class="spon">Sponsored</span>
    <span>By ${escapeHtml(content.authorLabel)}</span>
    <span>&middot;</span>
    <span>${escapeHtml(dateLabel)}</span>
    <span>&middot;</span>
    <span>${minutes} min read</span>
  </div>
${body}
  <footer class="ftc-footer">${disclaimers}</footer>
</article>
</div>`;
}

// --- generation --------------------------------------------------------------

export interface AdvertorialOutput {
  advertorial: Advertorial;
  content: AdvertorialContent;
  meta: GenerateResult;
}

/**
 * Generate the advertorial for one angle. Longest artifact in the pipeline →
 * biggest token budget; one retry on a no-JSON/empty reply (the S2 resilient
 * pattern), since the thinking model occasionally truncates on long output.
 */
export async function generateAdvertorial(brief: OfferBrief, angle: Angle): Promise<AdvertorialOutput> {
  let lastError = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { value: content, meta } = await generateJson<AdvertorialContent>(
        [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserMessage(brief, angle) },
        ],
        (raw) => coerceAdvertorialContent(raw, brief, angle),
        { temperature: 0.85, maxTokens: 12000 },
      );
      // A structurally-empty article is a failed generation, not a renderable one.
      if (content.sections.length === 0) {
        lastError = "model returned no usable sections";
        continue;
      }
      const createdAtISO = new Date().toISOString();
      const slug = makeSlug(brief, angle);
      const html = renderAdvertorialHtml(content, brief, createdAtISO);
      const ftcDisclosure = [FTC_BASELINE, FTC_RESULTS, ...content.disclaimerNotes].join(" ");
      return { advertorial: { angleId: angle.id, slug, html, ftcDisclosure }, content, meta };
    } catch (e) {
      lastError = e instanceof AgentJsonError ? e.message : e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(`Advertorial generation failed after 2 attempts: ${lastError}`);
}
