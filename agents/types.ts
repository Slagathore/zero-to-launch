/**
 * Typed contracts between agents (ZERO_TO_LAUNCH_BUILD_PLAN.md §2). These ARE
 * the architecture: every agent module is `input -> typed output` against
 * these shapes, chained by agents/orchestrator.ts (Sprint 5). Keep this file
 * clean — it's the file a judge reads to understand the pipeline.
 */

export type Platform = "meta" | "taboola" | "google" | "tiktok";

export interface OfferBrief {
  url: string;
  vertical: string; // e.g. "weight-loss supplement"
  product: string;
  audience: { who: string; painPoints: string[]; desires: string[] };
  usps: string[];
  claimsDetected: string[]; // raw claims found on the offer page
  complianceRisk: "low" | "med" | "high";
  notes: string;
}

export interface Angle {
  id: string;
  hookType: string; // curiosity | fear | social-proof | before-after | news-jack ...
  promise: string;
  emotionalDriver: string;
  headlineSeed: string;
  rationale: string; // WHY this angle fits this audience
}

export interface ComplianceVerdict {
  angleId: string;
  platform: Platform;
  status: "pass" | "flag" | "block";
  violations: { ruleId: string; severity: string; offendingText: string; fix: string }[];
}

export interface AdCopy {
  angleId: string;
  platform: Platform;
  primaryText: string;
  headline: string;
  description: string;
  cta: string;
}

export interface Advertorial {
  angleId: string;
  slug: string; // served live at /p/[slug]
  html: string;
  ftcDisclosure: string;
}

export interface LaunchPackage {
  offerBrief: OfferBrief;
  recommendedAngles: Angle[];
  copy: AdCopy[];
  advertorialUrl: string;
  checklist: string[];
}
