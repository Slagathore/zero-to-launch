# Zero-to-Launch — Campaign Launch Agent

**Drop in an affiliate offer. Get back a launch-ready campaign package:** an offer brief, a spread of
distinct marketing angles, per-platform ad copy that's been run through a compliance gate, a **live,
FTC-labeled advertorial pre-lander you can click**, and a ranked launch set with a day-1 checklist.
It's the whole pre-launch pipeline — the part a lean media-buying team actually loses hours to —
compressed into one orchestrated run.

**▶ Live:** https://marketingapp-ashy.vercel.app
**Click a real generated advertorial:** https://marketingapp-ashy.vercel.app/p/ketoslim-gummies-curiosity-bt2j

> On the public URL the model runs on the operator's machine, so hit **"watch a cached demo run"** to
> see the full pipeline stream end-to-end from a real cached run. The advertorial pages and the
> compliance gate are fully live there with no backend. To run everything live against a real model,
> see [Running it](#running-it).

---

## What it does

Paste an offer (or a URL) and hit **Run full pipeline**. Six agents run in sequence, each revealing
its artifact as it lands:

1. **Research** → a structured `OfferBrief`: vertical, audience (who / pains / desires), USPs, the
   risky claims detected on the page, and a compliance-risk rating.
2. **Angle Swarm** → 4–6 *distinct* angles, each a different psychological hook, with a rationale.
3. **Copy** → per-platform ad copy (Meta + Taboola; Google/TikTok wired), one on-voice ad per angle.
4. **Compliance Gate** → every ad scored `pass` / `flag` / `block` against real platform + FTC policy,
   with the offending text and a concrete fix.
5. **Advertorial** → the top angle developed into a full, styled, FTC-disclosed pre-lander, served
   live at `/p/[slug]`.
6. **Judge** → ranks the angles, picks the launch set (down-ranking anything the gate blocked),
   assembles the launch package, and explains why.

---

## Why I built THIS one

Because in an AI-armed contest, everyone can *generate* the same tool list — dashboards, copy
generators, LP builders. The moat isn't the idea; it's execution most people can't ship solo. The
hardest, highest-value thing a media-buying team lacks isn't another dashboard — it's the
*compression of the whole launch pipeline* (offer → angles → compliant copy → live pre-lander →
ranked launch set) into one orchestrated run, with a **real QA gate in the middle** instead of vibes.

I built the orchestration because I've already built adversarial multi-agent systems — a Fusion
Council pattern of **divergence → QA gate → judge**. This is that architecture pointed at revenue:

| Fusion Council stage | This app |
|---|---|
| divergence (swarm) | the Angle Swarm generating distinct hooks |
| QA gate | the deterministic Compliance Gate that blocks/flags copy |
| judge | the Judge that ranks, selects, and explains the launch set |

Two deliberate engineering calls that make it *trustworthy*, not just impressive:

- **The Compliance Gate and the Judge are deterministic** (regex ruleset + a transparent score), not
  another LLM you have to trust. Same copy always scores the same way, a reviewer can read exactly
  which rule fired, and both work with **no model at all** — which is why they run live on the public
  URL. A QA gate you can't reproduce isn't a QA gate.
- **The advertorial model emits structured content, never HTML.** A fixed template renders it with
  every string escaped, so the model can't inject markup and can't remove the FTC disclosure. The
  persuasion is the model's job; the safety is the code's.

## What I'd build next (if this were the full-time job)

The architecture is built to extend — every agent is a typed `input → output` module behind a clean
contract, so new agents plug into the same pipeline:

- **Compliance Gate v2** — swap the curated ruleset for a live policy-RAG over the full Meta / Google
  / TikTok / Taboola + FTC corpora. The gate's interface doesn't change; only its brain does. *(This
  is the honest #1 — the current 22 rules are a high-signal curated subset, not the full policy.)*
- **Native Placement Optimizer** — post-launch, ingest Taboola/Outbrain placement data, auto-flag
  money-losing widgets, and recommend blacklists with projected savings. Native spend hygiene is
  where the pipeline's ROI compounds.
- **Creative Fatigue Radar** — watch per-creative CTR/CVR decay and auto-spin fresh variants of
  winners before they die.
- **Closed loop** — feed live performance back into the Angle Swarm so the system *learns which
  angles convert* for a given vertical. That's when it stops being a generator and becomes a system.

---

## Architecture

Hand-rolled orchestration — no LangChain. The typed contracts between agents (`agents/types.ts`)
*are* the architecture; every agent is a module you can read top to bottom.

```
app/
  page.tsx              stepper UI + one-click streamed run
  p/[slug]/page.tsx     LIVE advertorial pages
  api/
    research | angles | copy | compliance | advertorial | judge   (per-stage)
    run                 orchestrated, streamed (SSE) end-to-end run + seeded fallback
agents/
  types.ts              the typed contracts (the architecture)
  research · angles · copy · compliance · advertorial · judge · orchestrator
lib/
  llm.ts                multi-provider client w/ fallback (Ollama-first)
  planjson.ts           extract + repair the JSON LLMs actually emit
  agentJson.ts          the shared generate → repair → coerce primitive
  fence.ts              prompt-injection defense for untrusted offer text
  fetchOffer.ts         URL fetch + readability + pasted-text fallback
  compliance-rules.json the curated policy ruleset
  advertorialStore.ts   memory → data/ → bundled-seed persistence
  seededRun.ts          the un-killable-demo cache loader
```

**Resilience is a feature, not an afterthought.** The model here is a *thinking* model that
occasionally truncates its JSON; every generation agent repairs malformed JSON (`planjson`), retries,
and degrades to partial results rather than crashing. The whole pipeline falls back to a real cached
run if the live model is unreachable, so a demo never cold-fails.

## Tech

- **Next.js (App Router) + TypeScript** on **Vercel** — one repo for API, UI, and the hosted
  advertorials.
- **Self-hosted Ollama** via its OpenAI-compatible endpoint, model **`kimi-k2.6:cloud`** (strong at
  persuasive copy + structured JSON). Anthropic is wired as an optional fallback leg.
- **Vitest** — 109 tests (agent coercers, the compliance ruleset, XSS-safe rendering, judge scoring,
  the seeded fallback).

## Running it

```bash
npm install
cp .env.example .env.local     # local dev defaults to localhost Ollama — usually no edits needed
npm run dev                    # http://localhost:3000 — full live pipeline against your Ollama
npm test                       # 109 tests
```

**Public live demo backed by local Ollama** — one fluid startup that brings up a cloudflared tunnel
*before* the app, so the whole live pipeline is reachable at a public URL:

```bash
npm run live                   # requires cloudflared on PATH; prints the public https URL
```

Vercel stays up as the always-on shell: the advertorial pages, the compliance gate, and the seeded
run all work there with no backend.

## Honest limitations

- **Compliance rules are a curated subset** (22 high-signal patterns), not the full policy corpora —
  labeled as such in `compliance-rules.json`. Policy-RAG is the top what's-next.
- **Live model calls need the operator's machine** (local Ollama or the `npm run live` tunnel); the
  always-on Vercel deploy serves the deterministic + seeded demos.
- **Generated advertorials on Vercel** live in the serverless instance's tmp; committed seeds are the
  durable public ones.
