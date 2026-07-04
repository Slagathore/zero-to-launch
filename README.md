# Zero-to-Launch: Campaign Launch Agent

Drop in an affiliate offer and get back a launch-ready campaign package: an offer brief, a set of
distinct marketing angles, per-platform ad copy that has been checked by a compliance gate, a live
FTC-labeled advertorial pre-lander you can click, and a ranked launch set with a day-1 checklist. It
covers the pre-launch pipeline that a small media-buying team usually spends hours on, in a single
run.

Live: [https://aideas4ads.cognima.net/](https://aideas4ads.cognima.net/)

Example generated advertorial: https://marketingapp-ashy.vercel.app/p/ketoslim-gummies-curiosity-bt2j

> On the public URL the model runs on the operator's machine, so use the "watch a cached demo run"
> button to see the full pipeline stream end to end from a real cached run. The advertorial pages and
> the compliance gate are fully live there with no backend. To run everything live against a real
> model, see [Running it](#running-it).

---

## What it does

Paste an offer (or a URL) and click Run full pipeline. Six agents run in sequence, and each one
reveals its artifact as it lands:

1. **Research** produces a structured `OfferBrief`: the vertical, the audience (who they are, their
   pains, their desires), the USPs, the risky claims found on the page, and a compliance-risk rating.
2. **Angle Swarm** generates 4 to 6 distinct angles, each built on a different psychological hook,
   with a short rationale.
3. **Copy** writes per-platform ad copy (Meta and Taboola now; Google and TikTok wired), one ad per
   angle in the offer's voice.
4. **Compliance Gate** scores every ad as `pass`, `flag`, or `block` against platform and FTC policy,
   and returns the offending text with a concrete fix.
5. **Advertorial** develops the top angle into a full, styled, FTC-disclosed pre-lander, served live
   at `/p/[slug]`.
6. **Judge** ranks the angles, picks the launch set (down-ranking anything the gate blocked),
   assembles the launch package, and explains the choice.

After the run you can take the output out of the app. Export the launch set as platform-native CSV:
the Meta and Taboola files use the actual bulk-import column names and CTA enums rather than the Ads
Manager UI labels, and every row is set to `PAUSED` so nothing spends before a buyer reviews it. A
per-angle dropdown lets you preview any ranked, gate-passed angle as a live pre-lander. A settings
panel controls per-stage model routing (you can point the copy stage and the judge at different
models on the same Ollama host), angle count, platform mix, and compliance strictness. A footer
carries the generated-content disclaimer.

---

## Why I built this one

In a contest like this, most people can generate the same list of tools: dashboards, copy
generators, landing-page builders. The harder part is shipping the whole thing solo. What a
media-buying team actually lacks is not another dashboard; it is having the full launch pipeline
(offer, angles, compliant copy, live pre-lander, ranked launch set) run end to end in one pass, with
a QA step in the middle that a reviewer can actually check.

I built the orchestration on top of a pattern I had used before for multi-agent systems: divergence,
then a QA gate, then a judge. Here that pattern maps directly onto the app:

| Pattern stage | This app |
|---|---|
| divergence (swarm) | the Angle Swarm generating distinct hooks |
| QA gate | the deterministic Compliance Gate that blocks or flags copy |
| judge | the Judge that ranks, selects, and explains the launch set |

Two design decisions matter for trust:

- The Compliance Gate and the Judge are deterministic: a regex ruleset and a plain score, not another
  model you have to trust. The same copy always scores the same way, a reviewer can read exactly which
  rule fired, and both work with no model at all, which is why they run on the public URL.
- The advertorial model returns structured content, not HTML. A fixed template renders it with every
  string escaped, so the model cannot inject markup and cannot remove the FTC disclosure.

## What I'd build next (if this were the full-time job)

Every agent is a typed `input to output` module behind a fixed contract, so a new agent plugs into
the same pipeline without touching the rest.

- **Creative image generation**: mock up the ad visuals for each angle, so the package ships imagery a
  buyer can drop into a placement, not just copy and a pre-lander. The angle and its hook already
  exist in the pipeline, so feeding them into image generation is the next artifact.
- **Learn from the advertiser's own history**: let a company upload past campaigns with their real
  metrics, and use that as a signal so the Angle Swarm and Copy stages lean toward what has converted
  for them, in their voice and their vertical.
- **An adversarial critic**: a model whose only job is to attack each angle, ad, and advertorial
  before the Judge sees it (poke the claims, flag the weak CTA), so the output has to survive real
  criticism.
- **Competitor intelligence at copy time**: when writing copy, semantically pull what competitors are
  already running for similar offers, so each angle is written with the live landscape in view rather
  than blind to it.
- **Compliance Gate v2**: replace the curated ruleset with a live policy-RAG over the full Meta,
  Google, TikTok, Taboola, and FTC corpora. The interface stays the same; only the implementation
  changes. The current 22 rules are a curated subset, not the full policy.
- **Native Placement Optimizer**: after launch, ingest Taboola and Outbrain placement data, flag
  money-losing widgets, and recommend blacklists with projected savings.
- **Closed loop**: feed live performance back into the Angle Swarm so it can weight angles by what
  converts for a given vertical.

---

## Architecture

Orchestration is hand-written, with no LangChain. The typed contracts in `agents/types.ts` define how
the agents connect, and each agent is a single module you can read top to bottom.

```
app/
  page.tsx              stepper UI + one-click streamed run
  p/[slug]/page.tsx     live advertorial pages
  api/
    research | angles | copy | compliance | advertorial | judge   (per-stage)
    run                 orchestrated, streamed (SSE) end-to-end run + seeded fallback
    fix-copy            one-shot compliance-driven copy rewrite
    models | ping       Ollama model list + reachability probe (settings panel)
components/
  SettingsPanel.tsx     per-stage model routing + generation/compliance knobs
agents/
  types.ts              the typed contracts
  research, angles, copy, compliance, advertorial, judge
  orchestrator, orchestrator-core   (streamed run + its pure, testable core)
lib/
  llm.ts                multi-provider client with fallback (Ollama-first)
  planjson.ts           extract and repair the JSON that LLMs actually emit
  agentJson.ts          the shared generate, repair, coerce primitive
  fence.ts              prompt-injection defense for untrusted offer text
  fetchOffer.ts         URL fetch + readability + pasted-text fallback
  exporters.ts          platform-native CSV (Meta/Taboola bulk-import + enums)
  settings.ts           useSettings.ts   per-stage settings model + client hook
  examples.ts           built-in sample offers
  compliance-rules.json the curated policy ruleset
  advertorialStore.ts   memory, then data/, then bundled-seed persistence
  seededRun.ts          the seeded demo cache loader
```

The model is a reasoning model that sometimes truncates its JSON. Every generation agent repairs
malformed JSON (`planjson`), retries, and returns partial results instead of crashing. If the live
model is unreachable, the whole pipeline falls back to a real cached run, so a demo never fails cold.

## Tech

- Next.js (App Router) and TypeScript on Vercel: one repo for the API, the UI, and the hosted
  advertorials.
- Self-hosted Ollama over its OpenAI-compatible endpoint, model `kimi-k2.6:cloud`, which is good at
  persuasive copy and structured JSON. Anthropic is wired in as an optional fallback.
- Vitest, 143 tests covering the agent coercers, the compliance ruleset, XSS-safe rendering, judge
  scoring, the platform-native CSV exporters, the settings model, and the seeded fallback.

## Running it

```bash
npm install
cp .env.example .env.local     # local dev defaults to localhost Ollama, usually no edits needed
npm run dev                    # http://localhost:3000, full live pipeline against your Ollama
npm test                       # 143 tests
```

To expose a public demo backed by a local Ollama, this brings up a cloudflared tunnel before the app
so the full pipeline is reachable at a public URL:

```bash
npm run live                   # requires cloudflared on PATH; prints the public https URL
```

Vercel stays up as the always-on shell: the advertorial pages, the compliance gate, and the seeded
run all work there with no backend.

## Limitations

- The compliance rules are a curated subset (22 patterns), not the full policy corpora. This is noted
  in `compliance-rules.json`. A policy-RAG is the main next step.
- Live model calls need the operator's machine (local Ollama or the `npm run live` tunnel). The
  always-on Vercel deploy serves the deterministic and seeded demos.
- Generated advertorials on Vercel live in the serverless instance's tmp; the committed seeds are the
  durable public ones.

## License

PolyForm Noncommercial License 1.0.0 (see [LICENSE](LICENSE)). Free to use, modify, and share for any
noncommercial purpose. Commercial use requires a separate license from the copyright holder.
