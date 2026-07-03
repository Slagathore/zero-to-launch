# Zero-to-Launch — 4-Day Build Plan
### It's Today Media $5K Build Challenge · Deadline: Sat July 4, 2026, 11:59 PM ET

---

## 0. The Call

Build a **Campaign Launch Agent**: drop in an affiliate offer URL, get back a complete, ready-to-launch campaign package — offer analysis, marketing angles, per-platform ad copy, a **live** advertorial pre-lander, and a launch checklist. It wins because it's the one entry that (a) matches the brief's "bigger is better," (b) demonstrates *real multi-agent orchestration* (their stated critical need), and (c) proves it works by handing the judge a page they can click.

**The strategic bet:** idea-secrecy is dead in an AI-armed field — the moat is *execution most people can't ship solo in 4 days*. That's your Fusion Council background, applied.

---

## 1. Product Definition

**Input:** an affiliate offer URL (fallback: pasted offer text — web-fetch hits bot walls).

**Output — the "Launch Package":**
1. **Offer Brief** — vertical, product, target audience (who/pains/desires), USPs, detected claims, compliance-risk rating.
2. **Angles** — 4–6 distinct psychological hooks, each with a rationale.
3. **Ad Copy** — per-platform (Meta, Taboola prioritized; Google, TikTok if time) for the recommended angles.
4. **Advertorial Pre-Lander** — a full, live-hosted advertorial page with FTC disclosure. *This is the click-the-judge-clicks.*
5. **Launch Checklist** — tracking/pixel setup notes, budget-start guidance, what to watch day 1.

**The demo the judge sees:** paste offer → watch the pipeline run stage-by-stage → click a live advertorial → read the recommended launch set with reasoning.

---

## 2. Architecture — The Fusion Council Mapping

Your Fusion Council pattern is **divergence → QA gate → judge**. This maps 1:1:

| Fusion Council stage | Zero-to-Launch agent | Job |
|---|---|---|
| (context) | **Research Agent** | Offer URL → structured `OfferBrief` (tool: web fetch) |
| Ollama swarm debate | **Angle Swarm** | Generate M candidate `Angle[]` (divergence) |
| Codex QA gate | **Compliance Gate** | Score copy vs. platform policy + FTC; block/flag (the gate) |
| — | **Copy Agent** | Surviving angles → per-platform `AdCopy[]` |
| — | **Advertorial Agent** | Top angle → deployable advertorial HTML |
| Claude Code judge | **Judge / Selector** | Rank angles+copy, pick launch set, explain why |
| Orchestrator | **Orchestrator** | Chains 1→6, holds state, streams progress |

**Say this explicitly in the README.** No other applicant can credibly claim "I've already built adversarial multi-agent orchestration with QA gates — here it is on campaign launch."

### Agent interfaces (your skeleton — keep these clean; the judge reads code)

```typescript
// agents/types.ts  — the typed contracts between agents ARE the architecture
export interface OfferBrief {
  url: string;
  vertical: string;                 // e.g. "weight-loss supplement"
  product: string;
  audience: { who: string; painPoints: string[]; desires: string[] };
  usps: string[];
  claimsDetected: string[];         // raw claims found on the offer page
  complianceRisk: "low" | "med" | "high";
  notes: string;
}

export interface Angle {
  id: string;
  hookType: string;                 // curiosity | fear | social-proof | before-after | news-jack ...
  promise: string;
  emotionalDriver: string;
  headlineSeed: string;
  rationale: string;                // WHY this angle fits this audience
}

export interface ComplianceVerdict {
  angleId: string;
  platform: Platform;
  status: "pass" | "flag" | "block";
  violations: { ruleId: string; severity: string; offendingText: string; fix: string }[];
}

export interface AdCopy {
  angleId: string;
  platform: Platform;               // "meta" | "taboola" | "google" | "tiktok"
  primaryText: string;
  headline: string;
  description: string;
  cta: string;
}

export interface Advertorial {
  angleId: string;
  slug: string;                     // served live at /p/[slug]
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

export type Platform = "meta" | "taboola" | "google" | "tiktok";
```

Each agent is a module: `input → typed output`. No LangChain — hand-rolled orchestration reads cleaner and you can reason about every line (both judged criteria: "code quality" + "another engineer could extend").

---

## 3. Tech Stack + Rationale

| Choice | Why |
|---|---|
| **Next.js (App Router) + TypeScript** | Your Electron/TS comfort transfers; one repo for API + UI + hosted advertorials. |
| **Vercel** | Judge's stated preferred host; one-click live URL; connect a real domain ($12 = free EV, they hinted at it). |
| **Anthropic API (Claude)** | "AI-first," flatters the Claude-fan judge, already wired in your stack. Sonnet for the swarm (speed/cost), a stronger model for the Judge stage only. |
| **Stateless per-run** | No DB = one fewer 4-day rabbit-hole. Add edge-KV run history only as post-submit polish. |
| **Advertorials as Next routes** (`/p/[slug]`) | Live instantly on the same deploy. Zero extra infra. |
| **Curated compliance JSON** | ~20 high-risk patterns/platform + FTC. Real and demoable now; full policy-RAG goes in what's-next. |

---

## 4. File Tree

```
zero-to-launch/
├─ app/
│  ├─ page.tsx                    # main stepper UI
│  ├─ p/[slug]/page.tsx           # LIVE advertorial pages (the judge clicks these)
│  └─ api/
│     ├─ research/route.ts        # POST offer url/text -> OfferBrief
│     ├─ angles/route.ts          # POST OfferBrief -> Angle[]
│     ├─ compliance/route.ts      # POST {angle, copy} -> ComplianceVerdict[]
│     ├─ copy/route.ts            # POST {angles} -> AdCopy[]
│     ├─ advertorial/route.ts     # POST {angle, brief} -> Advertorial (+ persists slug)
│     ├─ judge/route.ts           # POST full state -> ranked recommendation
│     └─ run/route.ts             # orchestrated end-to-end (streamed)  <-- the flex
├─ agents/
│  ├─ types.ts                    # the contracts above
│  ├─ research.ts
│  ├─ angles.ts
│  ├─ compliance.ts
│  ├─ copy.ts
│  ├─ advertorial.ts
│  ├─ judge.ts
│  └─ orchestrator.ts             # chains agents, emits progress events
├─ lib/
│  ├─ claude.ts                   # thin Anthropic client wrapper
│  ├─ fetchOffer.ts               # url fetch + readability extraction
│  └─ compliance-rules.json       # curated policy/FTC patterns
├─ examples/                      # 2-3 known-good offers for demo safety
│  └─ seeded-run.json             # cached full run so demo NEVER cold-fails
├─ components/                    # StepCard, ArtifactViewer, RunAllButton
└─ README.md                      # answers their 3 questions (see §9)
```

### compliance-rules.json — concrete shape (build it real, admit it's a curated subset)

```json
{
  "meta": [
    { "id": "meta-health-01", "pattern": "\\b(cure|reverse|treat|heal)\\b.*\\b(diabetes|cancer|disease)\\b",
      "severity": "block", "reason": "Meta prohibits claims of curing/treating conditions",
      "fix": "reframe as wellness/support; drop the medical claim" },
    { "id": "meta-bodyimage-01", "pattern": "\\b(lose|shed)\\b.*\\b\\d+\\s?(lbs|pounds)\\b",
      "severity": "flag", "reason": "Personal-attribute / unrealistic body-image scrutiny",
      "fix": "avoid targeting the viewer's body; use third-person framing" }
  ],
  "ftc": [
    { "id": "ftc-testimonial-01", "pattern": "\\b(guaranteed|typical) results\\b",
      "severity": "flag", "reason": "FTC requires typicality substantiation",
      "fix": "add 'results not typical' + basis-of-claim" }
  ]
}
```

---

## 5. The Degradation Ladder — Your Floor (read this twice)

Build the spine **thin and end-to-end first**, then widen. Each level is independently demoable and committable.

| Level | Ships | State |
|---|---|---|
| **L0** | Research + Angle Swarm → real angles from a real offer, visible in UI | Floor. Works. Demoable. |
| **L1** | + Copy Agent (per-platform) | Real "offer → angles → copy" tool. Finalist-grade. |
| **L2** | + Advertorial Agent → **live `/p/[slug]` page** | Judge clicks a real page. Crushes "does it work?" |
| **L3** | + Compliance Gate wired *inline* (not standalone) | Agentic orchestration with a QA stage. Winning. |
| **L4** | + Judge/Selector ranking + one-click `/run` streamed flow | The flex. Full pipeline. |

**If you reach only L2, you still have a strong entry.** That's the point.

---

## 6. Hour-by-Hour (commit at every green — non-negotiable)

> It's Tue eve now. Real deadline = **submit a working version Friday night**; Saturday is pure polish. Buffer is not optional.

### Day 0 — Tonight (2–3 hrs): Prove the risky infra first
- `npx create-next-app` (TS), push to GitHub, **deploy to Vercel immediately** (hello-world).
- Wire `lib/claude.ts`; one API route returns real Claude output.
- Stub `research.ts` → returns a real `OfferBrief` for one hardcoded offer.
- ✅ **COMMIT + DEPLOY.** Hosting + API + one agent proven. The two scariest unknowns are dead on night one.

### Day 1 — Wed: L0 floor
- `research.ts` full: `fetchOffer.ts` (url + readability) + pasted-text fallback → real `OfferBrief`.
- `angles.ts`: swarm prompt → 4–6 `Angle[]` with rationale.
- Minimal stepper UI: paste offer → see Brief → see Angles.
- ✅ **COMMIT + DEPLOY.** L0 live. You now have a floor no matter what.

### Day 2 — Thu: L1 + L3 core
- `copy.ts`: per-platform `AdCopy[]` (start Meta + Taboola — your named-stack + native asymmetry).
- `compliance.ts` + `compliance-rules.json`: score copy, return verdicts, wire the gate between angles→copy.
- UI: copy cards per platform; compliance badges (pass/flag/block + fixes).
- ✅ **COMMIT + DEPLOY.** By tonight it's genuinely strong. Breathe.

### Day 3 — Fri: L2 + L4 + SUBMIT
- `advertorial.ts` → `Advertorial`; serve live at `/p/[slug]`; link from UI.
- `judge.ts`: rank + pick launch set + explain.
- `orchestrator.ts` + `/api/run`: streamed one-click flow.
- `examples/seeded-run.json`: cache a full run for demo safety.
- Write README (§9). Record a 3-min Loom as fallback.
- ✅ **COMMIT + DEPLOY + SUBMIT A WORKING VERSION.** You are now safe.

### Day 4 — Sat: Polish only (NO new features)
- Connect a real domain. Harden edge cases (bad URLs, empty offers, API timeout → fall back to seeded run).
- Tighten prompts, UI spacing, loading states.
- Final README pass in *your* voice. Re-submit final.
- ✅ **COMMIT + DEPLOY + FINAL SUBMIT.**

---

## 7. Pre-Mortem — 6 Ways It Dies + Mitigations (all baked into the plan)

1. **Scope creep → nothing fully works.** → Degradation ladder + "working version by Friday." Spine thin before wide.
2. **Orchestrated `/run` breaks live during judging.** → Every stage independently runnable in the UI; `/run` is the flex, not the dependency. Plus `seeded-run.json` so it never cold-fails.
3. **Advertorial hosting rabbit-hole.** → Render as a Next route on the same app. No separate deploy.
4. **Web-fetch fails on real offer pages** (bot walls, JS). → Pasted-text fallback path + 2–3 known-good example offers.
5. **Compliance becomes a policy-RAG rabbit-hole.** → Curated ~20-pattern JSON. Real, demoable, honest. "Full corpus" = what's-next.
6. **API cost/rate during dev.** → Cache aggressively, Sonnet for the swarm, iterate on one offer.

---

## 8. Demo Script (never hard-fails)

1. Land on a clean page with 2–3 example offers pre-loaded + a paste box.
2. Click an example → pipeline runs stage-by-stage, each stage revealing its artifact (Brief → Angles → Compliance badges → Copy).
3. Click through to the **live advertorial** — a real, styled, FTC-compliant page.
4. Show the Judge's recommended launch set + the "why."
5. (Flex) Paste a *fresh* offer and hit "Run all" streamed.

**Anti-fail rules:** if a live API call fails mid-demo, the UI falls back to `seeded-run.json` silently. Loom recorded as the page-allowed fallback. Real domain in the address bar.

---

## 9. README Skeleton (it's scored — write it in YOUR voice, not an AI's)

Every entry will be AI-built with AI-generated boilerplate READMEs. A sharp, opinionated one stands out *because* the field is flooded with flat prose.

**What does this tool do?** (2–3 tight sentences. The launch package, end to end.)

**Why did you build THIS one?**
> Because in an AI-armed contest, everyone can *generate* the same tool list — dashboards, copy generators, LP builders. The moat is execution. The hardest, highest-value thing a lean media-buying team lacks isn't another dashboard; it's the *compression of the whole launch pipeline* — offer → angles → compliant copy → live pre-lander — into one orchestrated run. I built the orchestration because I've already built adversarial multi-agent systems (divergence → QA gate → judge); this is that architecture pointed at revenue.

**What would you build next if this were my full-time job?** (This proves the architecture extends — a judged criterion. List concrete plug-in agents:)
- **Native Placement Optimizer** — post-launch, ingest Taboola/Outbrain placement data, auto-flag money-losing widgets, recommend blacklists with projected savings. (You named Taboola — native spend hygiene is where the pipeline's ROI compounds.)
- **Creative Fatigue Radar** — watch per-creative CTR/CVR decay, auto-spin fresh variants of winners before they die.
- **Compliance Gate v2** — swap the curated ruleset for a live policy-RAG over Meta/Google/TikTok/Taboola + FTC corpora.
- **Closed loop** — feed live performance back into the Angle Swarm so the system *learns which angles convert* for your verticals.

Framing it this way says: *I designed a platform, not a demo.*

---

## 10. Cut List (drop in THIS order if you fall behind)

1. Judge/Selector ranking → replace with a simple heuristic (top-N by compliance-pass + angle diversity).
2. `/run` streaming → sequential-with-spinner.
3. Platforms 4 → 2 (keep **Meta + Taboola**).
4. Compliance-inline → keep it standalone (still shows the capability).

**Never cut:** Research + Angles + Copy + **one live advertorial.** That's the irreducible core that still wins a finalist slot.

---

### Where to lean on Claude Code hard vs. keep your hands on the wheel
- **Lean hard:** Next.js scaffolding, route boilerplate, per-platform copy prompt templates, UI components, the advertorial HTML/CSS.
- **Your hands on the wheel:** the agent interfaces in `types.ts` (the judge reads these — they *are* your architecture), the orchestration flow, and the README voice. These are your differentiators; don't let them read as generated.
