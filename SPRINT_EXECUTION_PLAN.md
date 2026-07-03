# Sprint Execution Plan — Zero-to-Launch (through L4)

**Companion to [ZERO_TO_LAUNCH_BUILD_PLAN.md](ZERO_TO_LAUNCH_BUILD_PLAN.md).** That doc is the
**what** (product, architecture, typed contracts, file tree, degradation ladder). This doc is the
**how / who**: the build is split into six self-contained sprints, each assigned to exactly one
model mode, sequenced so the whole app reaches **L4** while spending scarce Fable compute only
where it pays off.

> **Read the build plan's §2 (architecture), §4 (file tree), and §5 (degradation ladder) before
> starting any sprint.** Every sprint below references them by section.

---

## 0. How this doc is used

- Sprints run **in order, 0 → 5**. Each sprint is owned by **one model mode** and is executed to
  completion by that mode before we switch models. **Model switches happen only at sprint
  boundaries** — never mid-sprint.
- The **plan doc + git history + code comments are the handoff medium.** Because each sprint runs in
  a fresh model context, the outgoing model must leave the repo and this doc in a state the next
  model can resume from cold. Each sprint ends by appending to the **Handoff Log** (§9).
- The **Shared Sprint Contract (§2)** is binding on **every** sprint. Each sprint header restates it
  by reference — treat it as prepended to that sprint's instructions.

---

## 1. Model roster & compute budget

Fable is rate/quota-limited for us, and **Fable xHigh + ultracode is a large token burn.** So Fable
appears **twice total** across the whole build (once for `max`, once for `xhigh+ultracode`), and the
ultracode run is scoped to the one sprint where multi-agent fan-out genuinely earns its cost.
Opus and Sonnet carry the bulk.

| Mode | Used for | Why this mode | # sprints |
|---|---|---|---|
| **Sonnet 5** | Mechanical, fully-specified, high-volume work | Fast + cheap; ideal when the spec leaves little ambiguity (scaffold, per-platform copy from templates, UI cards) | 2 |
| **Opus 4.8 high** | Reasoning-heavy, pattern-setting, correctness-critical work | Strongest general reasoning; owns the code the judge reads and the adversarial compliance logic. Not compute-constrained for us | 2 |
| **Fable max** | The single most creative artifact | The advertorial is persuasive long-form copy + styled page design — Fable's creative strength, spent on the judge-clicks-it centerpiece | 1 |
| **Fable xHigh + ultracode** | The capstone integration + adversarial end-to-end hardening | Multi-agent fan-out to verify the *entire* pipeline works and harden every edge before submit — the one place exhaustive orchestration pays for its burn | 1 |

**Sprint → mode → build-plan level:**

| Sprint | Mode | Ships | Build-plan level |
|---|---|---|---|
| **S0 — Foundation & Infra** | Sonnet 5 | Scaffold, deploy, contracts, LLM client, one live route | Day 0 |
| **S1 — Research + Angle Swarm** | Opus 4.8 high | Offer → `OfferBrief` → `Angle[]`, minimal stepper UI | **L0** |
| **S2 — Copy Agent** | Sonnet 5 | Per-platform `AdCopy[]` (Meta + Taboola) + copy cards | **L1** |
| **S3 — Advertorial** | Fable max | Live `/p/[slug]` advertorial + FTC disclosure | **L2** |
| **S4 — Compliance Gate** | Opus 4.8 high | `compliance-rules.json` + inline gate + badges | **L3** |
| **S5 — Judge + Orchestrator + Harden + Submit** | Fable xHigh + ultracode | Judge, streamed `/run`, seeded-run, README, full hardening | **L4** |

---

## 2. Shared Sprint Contract (binding on every sprint)

**This section is prepended, in spirit, to every sprint's instructions. A sprint is not done until
all of it is satisfied.**

1. **Finish the whole sprint.** No TODOs, no stubs, no commented-out placeholders, no
   partially-applied edits. Every file the sprint lists ships complete and working. If you can't
   finish an item, you are not done — keep going.
2. **No mid-sprint breaks.** Do not stop to check in with the human partway. Run the sprint end to
   end. The only allowed interruptions are the questions in rule 3.
3. **Questions — front-load or defer.** Ask every question you can foresee **at the very start of the
   sprint, before writing code.** Any question you couldn't foresee, you **hold** and keep working
   around until you literally cannot make progress on *any* remaining part of the sprint without the
   answer — only then ask. Never trickle questions.
4. **Reference the plan.** Read this doc + the relevant [build-plan](ZERO_TO_LAUNCH_BUILD_PLAN.md)
   sections before coding, and follow them.
5. **Update the plan.** As you go, keep this doc accurate: check off your sprint's deliverables, and
   record any deviation from the build plan (with a one-line reason) in the Handoff Log (§9).
6. **Comment the code.** Explain *why*, not *what* — especially the agent prompts, the typed
   contracts, and any reuse you vendored. The judge reads this code.
7. **Commit at every green.** Small, meaningful commits with clear messages. Commit whenever
   something works; never batch the whole sprint into one commit. End the sprint on a clean tree.
8. **Design and run your own tests.** Write the tests that prove *your* sprint's deliverables work
   (unit for pure logic, a smoke/integration test for anything hitting a route or model), and run
   them green before you consider the sprint done. Don't wait for a later sprint to test your work.
9. **Deploy where the sprint says to.** If the sprint ships a user-visible level, deploy it (Vercel)
   and confirm the live URL works before handoff.
10. **Hand off cleanly.** End every sprint by appending a Handoff Log entry (§9): what shipped,
    where it lives, anything the next model must know, and the live URL if applicable.

---

## 3. Sprint 0 — Foundation & Infra — **Sonnet 5**

**Goal:** Kill the two scariest unknowns (hosting + live model calls) and lay the typed spine. Maps
to build-plan **Day 0 / §3 / §4**. Pure mechanical, fully-specified work → Sonnet.

**Ask at sprint start (front-loaded questions):**
- Anthropic API key + which models to wire for swarm vs. judge (default: Sonnet for swarm, Opus-tier
  for judge per build-plan §3).
- Vercel account/CLI access + whether to connect a domain now or post-submit.
- Confirm Node/npm version and that this repo (currently **not** a git repo) should be `git init`'d
  here.

**Reuse (vendor into the repo, don't rebuild):**
- `dependencies/llmswitch` → `lib/claude.ts` (multi-provider client w/ cloud→local-Ollama fallback).
- `dependencies/planjson` → `lib/planjson.ts` (extract + repair malformed LLM JSON — every agent
  will parse through this).

**Deliverables:**
- [ ] `create-next-app` (TS, App Router); `git init`; first commit.
- [ ] Deploy hello-world to **Vercel**; confirm live URL.
- [ ] `agents/types.ts` — transcribe the contracts from build-plan §2 **verbatim** (`OfferBrief`,
      `Angle`, `ComplianceVerdict`, `AdCopy`, `Advertorial`, `LaunchPackage`, `Platform`). These are
      the architecture; keep them clean and commented.
- [ ] `lib/claude.ts` over `llmswitch`; `lib/planjson.ts` from `planjson`.
- [ ] `app/api/ping/route.ts` — returns **real** Claude output through `lib/claude.ts`.
- [ ] `.env.example` + README note on env vars.

**Tests:** typecheck passes; unit test that `parsePlan` repairs a known-broken JSON blob; smoke test
that `/api/ping` returns live model text.

**Done when:** infra + API + typed contracts are live and committed; hello-world is on Vercel.

---

## 4. Sprint 1 — Research + Angle Swarm (L0) — **Opus 4.8 high**

**Goal:** The pipeline spine and the divergence pattern every later agent copies. Maps to build-plan
**L0 / §2**. Reasoning-heavy and pattern-setting → Opus.

**Ask at sprint start:** confirm the 2–3 seed example offers to use for dev/demo (build-plan §8);
confirm readability-extraction lib choice (e.g. `@mozilla/readability` + `jsdom`).

**Reuse:**
- Model the swarm's roster/roles on `claw-deck/electron/council/agents.ts`
  (`panelist`/`qa-gate`/`judge` role model) so the README's "Fusion Council" claim points at real
  code.
- Fence scraped offer-page text before it enters the Research prompt — port the *concept* from
  `dependencies/promptfence` (Python): wrap untrusted page text in a sentinel/role-labeled block.
- Parse all agent JSON through `lib/planjson.ts`.

**Deliverables:**
- [ ] `lib/fetchOffer.ts` — URL fetch + readability extraction **+ pasted-text fallback**.
- [ ] `agents/research.ts` — `fetchOffer` output → real `OfferBrief` (with claim detection +
      compliance-risk rating).
- [ ] `agents/angles.ts` — divergence swarm prompt → 4–6 `Angle[]`, each with `rationale`.
- [ ] `app/api/research/route.ts`, `app/api/angles/route.ts`.
- [ ] `app/page.tsx` — minimal stepper: paste offer → see Brief → see Angles.
- [ ] Deploy L0 live.

**Tests:** research returns a valid `OfferBrief` for a seed offer and for pasted text; angles returns
≥4 distinct `Angle[]`; a route-level smoke test end-to-end paste→angles.

**Done when:** L0 is live on Vercel — a real "offer → brief → angles" tool. This is the floor.

---

## 5. Sprint 2 — Copy Agent (L1) — **Sonnet 5**

**Goal:** Per-platform ad copy from the surviving angles. Maps to build-plan **L1**. The pattern
exists now; this is well-scoped, high-volume prompt+UI work → Sonnet.

**Ask at sprint start:** confirm platform priority (default **Meta + Taboola** per build-plan §10);
confirm copy field lengths/format per platform.

**Reuse:** mine `Misc/other_ppls_gits/roboco/agents/prompts/` (marketing/role prompts) as raw
material for the per-platform system prompts; parse through `lib/planjson.ts`.

**Deliverables:**
- [ ] `agents/copy.ts` — `Angle[]` → per-platform `AdCopy[]` (Meta + Taboola: `primaryText`,
      `headline`, `description`, `cta`).
- [ ] `app/api/copy/route.ts`.
- [ ] UI: copy cards grouped per platform in the stepper.
- [ ] Deploy L1 live.

**Tests:** copy returns well-formed `AdCopy[]` for each platform from a fixed `Angle[]`; per-platform
field-length assertions; UI renders cards without crash on empty/edge input.

**Done when:** L1 is live — "offer → angles → per-platform copy." Finalist-grade.

---

## 6. Sprint 3 — Advertorial (L2) — **Fable max**

**Goal:** The judge-clicks-it centerpiece: a full, live, styled, FTC-compliant advertorial
pre-lander. Maps to build-plan **L2**. Persuasive long-form copy + page design is Fable's strength —
this is its one `max` spend.

**Ask at sprint start:** confirm advertorial visual style/brand direction and the exact FTC
disclosure wording to standardize on.

**Reuse:** the `Advertorial` contract from `types.ts`; the top angle + `OfferBrief` from prior
sprints as input.

**Deliverables:**
- [ ] `agents/advertorial.ts` — top `Angle` + `OfferBrief` → `Advertorial` (persuasive HTML +
      `ftcDisclosure`), persisting a `slug`.
- [ ] `app/p/[slug]/page.tsx` — serves the advertorial **live** on the same deploy.
- [ ] `app/api/advertorial/route.ts`; link to the live page from the stepper UI.
- [ ] Deploy L2 live; **click the real page** to confirm.

**Tests:** advertorial returns non-empty HTML containing the FTC disclosure; `/p/[slug]` renders a
generated advertorial end-to-end; slug persistence round-trips.

**Done when:** a judge can click through to a real, styled, compliant advertorial page. Crushes
"does it work?"

---

## 7. Sprint 4 — Compliance Gate (L3) — **Opus 4.8 high**

**Goal:** The QA gate — score copy against platform policy + FTC, wired **inline** between
angles→copy. Maps to build-plan **L3 / §4 (rules JSON) / §2 (gate)**. Adversarial policy reasoning +
correctness-critical → Opus.

**Ask at sprint start:** confirm the platform set to cover (Meta + Taboola + FTC minimum) and whether
`block` verdicts should hard-stop copy or just flag-with-fix in the demo.

**Reuse:** the `qa-gate` role model from `claw-deck/electron/council/agents.ts`; the
`ComplianceVerdict` contract.

**Deliverables:**
- [ ] `lib/compliance-rules.json` — **real, ~20 high-risk patterns/platform + FTC** (expand the
      build-plan §4 seed; label it a curated subset honestly).
- [ ] `agents/compliance.ts` — `{angle, copy}` → `ComplianceVerdict[]` (pass/flag/block + fixes).
- [ ] `app/api/compliance/route.ts`; wire the gate **inline** angles→copy.
- [ ] UI: compliance badges (pass/flag/block) + suggested fixes on copy cards.
- [ ] Deploy L3 live.

**Tests:** each rule matches its intended offending text and not clean text (per-rule unit tests);
gate blocks/flags a deliberately non-compliant copy sample; inline wiring verified via route smoke
test.

**Done when:** L3 is live — agentic orchestration with a working QA stage. Winning tier.

---

## 8. Sprint 5 — Judge + Orchestrator + Harden + Submit (L4) — **Fable xHigh + ultracode**

**Goal:** The capstone. Rank + select the launch set with reasoning, chain everything into a
streamed one-click run, make the demo un-killable, and harden every edge before submit. Maps to
build-plan **L4 / §6 (Fri) / §8 (demo) / §9 (README)**.

**Why ultracode here (and nowhere else):** this is the one sprint whose value is *exhaustive
end-to-end verification* — fan out adversarial checks across all six agents, every failure mode in
build-plan §7, and the demo script §8. **Scope the fan-out to integration, verification, and
hardening — do not re-generate earlier sprints' work.** That keeps the burn on the payoff.

**Ask at sprint start:** confirm submission target/URL + deadline-time buffer; confirm whether the
Judge uses a distinct stronger model (route via `dependencies/llmroute`).

**Reuse:**
- `claw-deck/src/lib/planner.ts` — the plan→run→feed-back loop for `orchestrator.ts`.
- `Misc/other_ppls_gits/llm-council-mcp-server/council_core.py` — reference for the
  divergence→synthesize judge structure.
- `dependencies/llmroute` — route the Judge stage to the stronger model.
- `dependencies/agentgateway` (optional) or plain SSE for streaming `/api/run`.

**Deliverables:**
- [ ] `agents/judge.ts` — full state → ranked recommendation + "why" (top-N by compliance-pass +
      angle diversity as heuristic fallback per build-plan §10).
- [ ] `agents/orchestrator.ts` + `app/api/run/route.ts` — streamed, stage-by-stage end-to-end run.
- [ ] `examples/seeded-run.json` — a cached full run so the demo **never** cold-fails; UI falls back
      to it silently on any live-call failure (build-plan §8 anti-fail rules).
- [ ] **Public exposure via cloudflared** (decided S1): the LLM provider is the developer's
      self-hosted Ollama at `localhost:11434`, unreachable from Vercel. Create a cloudflared tunnel
      fronting Ollama via CLI, set `OPENAI_COMPAT_URL` to the tunnel URL as a Vercel env var, and
      write a **single unified startup script** that brings the tunnel up *before* the app and runs
      them as one fluid start (mirrors the developer's DungeonMaster app). This is what makes the
      Vercel URL a real clickable live demo.
- [ ] Harden every build-plan §7 failure mode: bad URLs, empty offers, API timeout → seeded
      fallback.
- [ ] `README.md` — answer the three scored questions in build-plan §9, **in the human's voice**
      (leave voice/tone final pass flagged for the human if needed — but ship a complete draft).
- [ ] Final deploy; **submit a working version.**

**Tests:** full-pipeline integration test (paste → run → launch package); fault-injection tests
proving each failure mode falls back to `seeded-run.json`; judge produces a stable ranking +
rationale for a fixed input.

**Done when:** the full L4 pipeline is live and streamed, the demo is un-killable, the README is
complete, and a working version is **submitted**.

---

## 9. Handoff Log (each sprint appends here before switching models)

> Format per entry: **Sprint N (mode) — YYYY-MM-DD** · shipped: … · lives in: … · live URL: … ·
> next model must know: … · deviations from build plan: …

- **Sprint 0 (Sonnet 5, + tail finished by Opus 4.8) — 2026-07-03** ·
  **shipped:** Next.js 16 (TS/App Router/Tailwind) scaffold; `agents/types.ts` (contracts verbatim
  from build-plan §2); `lib/llm.ts` (vendored llmswitch) + `lib/planjson.ts` (vendored planjson);
  `app/api/ping` infra-proof route; vitest + 26 unit tests; deployed to Vercel. ·
  **lives in:** repo root; GitHub `Slagathore/zero-to-launch` (private). ·
  **live URL:** https://marketingapp-ashy.vercel.app (static shell + `/api/ping`). ·
  **next model must know:** (1) **Provider is self-hosted Ollama, NOT Anthropic** — decided after
  S0. Talks to `localhost:11434/v1`, model **`kimi-k2.6:cloud`**, via `lib/llm.ts` `askLLM()`.
  Anthropic is only a fallback leg (chains in iff `ANTHROPIC_API_KEY` set). (2) `kimi-k2.6:cloud`
  is a **thinking model** — always pass generous `maxTokens` (≥2048 for JSON agents) or output gets
  eaten by the reasoning phase; `content` holds the answer, `reasoning` is the CoT. (3) Local dev
  needs no `.env` — `getSettingsFromEnv()` defaults to Ollama+Kimi. (4) Vercel can't reach
  `localhost`; **live LLM demo runs locally (`npm run dev`) until the S5 cloudflared tunnel**. ·
  **deviations from build plan:** `lib/claude.ts` → **`lib/llm.ts`** (provider is Ollama, not
  Claude); `providerChain()` legs are opt-in rather than always-Ollama-first (documented in
  `lib/llm.ts` header).

---

## 10. Cut line (if the clock beats a sprint)

Follow build-plan **§10** in order: drop Judge ranking → drop `/run` streaming → keep only Meta +
Taboola → keep compliance standalone (not inline). **Never cut:** Research + Angles + Copy + one live
advertorial (that's L0–L2, sprints S1–S3). If S5 can't finish, a submitted L3 build is still a
finalist entry — so **submit at the end of S4 as a safety net** before S5 begins its capstone.
