import type { AdCopy, Angle, Platform } from "@/agents/types";

/**
 * Platform-native CSV exporters for the launch package. Pure string-building
 * from the in-memory data — NO API/model calls.
 *
 * The insider details this encodes (all verified against the real platform
 * bulk-import templates; every header/enum lives here so a drift is a one-line
 * fix):
 *   1. Meta's bulk-import template labels are NOT the Ads Manager UI labels —
 *      the headline column is `Title`, the primary-text column is `Body`.
 *      Exporting "Headline"/"Primary Text" makes the import silently fail.
 *   2. Meta's Call to Action is an ENUM (`LEARN_MORE`), not free text.
 *   3. Meta (feed ad: Title + Body) and Taboola (native content ad: Title +
 *      Branding + Thumbnail, no long body) need DIFFERENT columns — emitting
 *      identical columns for both is the naive tell.
 *   4. Every row ships `Status = PAUSED` — nothing spends until the buyer
 *      reviews. All generated ads are exported (not just the recommended set);
 *      the buyer filters in-platform.
 */

// --- Meta CTA enum map (bulk import rejects free-text CTAs) -----------------

const META_CTA: Record<string, string> = {
  "learn more": "LEARN_MORE",
  "shop now": "SHOP_NOW",
  "sign up": "SIGN_UP",
  "get offer": "GET_OFFER",
  "get quote": "GET_QUOTE",
  "subscribe": "SUBSCRIBE",
  "download": "DOWNLOAD",
  "see more": "LEARN_MORE",
  "read more": "LEARN_MORE",
  "order now": "ORDER_NOW",
  "book now": "BOOK_NOW",
  "contact us": "CONTACT_US",
  "apply now": "APPLY_NOW",
};

/** Map a human CTA to Meta's bulk-import enum. Free text = rejected row. */
export function toMetaCTA(cta: string): string {
  return META_CTA[cta.trim().toLowerCase()] ?? "LEARN_MORE"; // safe default
}

// --- CSV primitives ---------------------------------------------------------

/** Quote a CSV field iff it needs it (comma, quote, CR, or LF), doubling quotes. */
export function csvField(value: string): string {
  const v = value ?? "";
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function csvLine(fields: string[]): string {
  return fields.map(csvField).join(",");
}

/** Build a CSV string from a header row + data rows. Ends with a trailing newline. */
function csv(headers: string[], rows: string[][]): string {
  return [csvLine(headers), ...rows.map(csvLine)].join("\r\n") + "\r\n";
}

// --- shared context ---------------------------------------------------------

export interface ExportCtx {
  product: string;
  /** Absolute origin, e.g. "https://aideas4ads.cognima.net" (no trailing slash needed). */
  origin: string;
  /** Generated advertorial url (relative /p/slug or absolute) per angle id. */
  advertorialUrls: Record<string, string>;
  /** Fallback landing page (the recommended/top advertorial) when an ad's own angle has none. */
  fallbackUrl: string;
  /** Angle ids in the recommended launch set (for the generic CSV's Recommended column). */
  recommendedIds: Set<string>;
}

function absolute(origin: string, rel: string): string {
  if (!rel) return "";
  if (/^https?:\/\//i.test(rel)) return rel;
  return `${origin.replace(/\/$/, "")}${rel.startsWith("/") ? "" : "/"}${rel}`;
}

function landingFor(ctx: ExportCtx, angleId: string): string {
  return absolute(ctx.origin, ctx.advertorialUrls[angleId] || ctx.fallbackUrl);
}

function angleFor(angles: Angle[], angleId: string): Angle | undefined {
  return angles.find((a) => a.id === angleId);
}

/** A short, stable ad name for the platform's "Ad Name" column. */
function adName(product: string, a: Angle | undefined, i: number): string {
  const hook = a?.hookType ?? "angle";
  return `${product} — ${hook} #${i + 1}`;
}

// --- per-platform builders --------------------------------------------------

/** Meta bulk-import CSV — template labels (Title=headline, Body=primary text), CTA enum, PAUSED. */
export function buildMetaCsv(ads: AdCopy[], angles: Angle[], ctx: ExportCtx): string {
  const headers = [
    "Campaign Name", "Ad Set Name", "Ad Name", "Title", "Body",
    "Link Description", "Website URL", "Call to Action", "Status",
  ];
  const meta = ads.filter((a) => a.platform === "meta");
  const rows = meta.map((ad, i) => {
    const a = angleFor(angles, ad.angleId);
    return [
      `${ctx.product} — Meta`,
      a?.hookType ?? "Ad Set 1",
      adName(ctx.product, a, i),
      ad.headline,
      ad.primaryText,
      ad.description,
      landingFor(ctx, ad.angleId),
      toMetaCTA(ad.cta),
      "PAUSED",
    ];
  });
  return csv(headers, rows);
}

/** Taboola native CSV — content-ad structure (Title + Branding, no long body), PAUSED. */
export function buildTaboolaCsv(ads: AdCopy[], angles: Angle[], ctx: ExportCtx): string {
  const headers = [
    "Campaign Name", "Brand Name", "Title", "Description",
    "Landing Page URL", "Thumbnail URL", "CPC", "Status",
  ];
  const taboola = ads.filter((a) => a.platform === "taboola");
  const rows = taboola.map((ad) => [
    `${ctx.product} — Taboola`,
    ctx.product,
    ad.headline,
    ad.primaryText, // native "body" is short
    landingFor(ctx, ad.angleId),
    "", // Thumbnail URL — no image generation in this build
    "", // CPC — buyer sets
    "PAUSED",
  ]);
  return csv(headers, rows);
}

/** Generic fallback CSV — extensible, for Google/TikTok/dropdown extras. */
export function buildGenericCsv(ads: AdCopy[], angles: Angle[], ctx: ExportCtx): string {
  const headers = [
    "Platform", "Angle", "Recommended", "Headline", "Primary Text",
    "Description", "CTA", "Landing Page URL",
  ];
  const rows = ads.map((ad) => {
    const a = angleFor(angles, ad.angleId);
    return [
      ad.platform,
      a?.headlineSeed || a?.hookType || ad.angleId,
      ctx.recommendedIds.has(ad.angleId) ? "TRUE" : "FALSE",
      ad.headline,
      ad.primaryText,
      ad.description,
      ad.cta,
      landingFor(ctx, ad.angleId),
    ];
  });
  return csv(headers, rows);
}

/** Which export a platform maps to (meta/taboola native; everything else generic). */
export function hasNativeExport(platform: Platform): boolean {
  return platform === "meta" || platform === "taboola";
}

// --- soft char limits (UI markers only; never mutate the copy) --------------

export interface FieldLimit { field: "headline" | "primaryText" | "description"; max: number; }

/** Per-platform soft caps (the real ones) for an "over limit" UI marker. */
export const CHAR_LIMITS: Partial<Record<Platform, FieldLimit[]>> = {
  meta: [
    { field: "headline", max: 40 },
    { field: "primaryText", max: 125 },
    { field: "description", max: 30 },
  ],
  taboola: [
    { field: "headline", max: 60 },
    { field: "primaryText", max: 90 },
  ],
};

/** Return the fields of an ad that exceed their platform's soft cap. */
export function overLimitFields(ad: AdCopy): { field: string; max: number; len: number }[] {
  const limits = CHAR_LIMITS[ad.platform] ?? [];
  const out: { field: string; max: number; len: number }[] = [];
  for (const { field, max } of limits) {
    const len = (ad[field] ?? "").length;
    if (len > max) out.push({ field, max, len });
  }
  return out;
}
