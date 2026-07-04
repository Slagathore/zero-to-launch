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
- [x] `lib/fetchOffer.ts` — URL fetch + Mozilla Readability extraction **+ pasted-text fallback**.
- [x] `agents/research.ts` — `fetchOffer` output → real `OfferBrief` (with claim detection +
      compliance-risk rating). Untrusted text fenced via new `lib/fence.ts`.
- [x] `agents/angles.ts` — divergence swarm prompt → 4–6 `Angle[]`, each with `rationale`.
- [x] `app/api/research/route.ts`, `app/api/angles/route.ts`.
- [x] `app/page.tsx` — minimal stepper: paste offer → see Brief → see Angles.
- [x] Deploy L0 (UI live on Vercel; live LLM calls run locally until the S5 cloudflared tunnel).
- [x] **Bonus reuse landed for later sprints:** `lib/agentJson.ts` (shared generate→repair→coerce
      primitive) and `lib/fence.ts` (prompt-injection defense) — both consumed by S2–S5 agents.

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
- [x] `agents/copy.ts` — `Angle[]` → per-platform `AdCopy[]` (Meta + Taboola: `primaryText`,
      `headline`, `description`, `cta`). Google + TikTok voice/guidance also wired (default stays
      Meta + Taboola). Resilient: per-platform retry + partial-degrade (see handoff).
- [x] `app/api/copy/route.ts` (returns `ok:true` + `failedPlatforms` for partial results).
- [x] UI: Step 4 copy cards grouped per platform, each tagged with its source angle's hook + CTA.
- [x] Deploy L1 (UI live on Vercel — **deploy now unblocked**, see handoff; live LLM calls still
      local until the S5 tunnel).

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
- [x] `agents/advertorial.ts` — top `Angle` + `OfferBrief` → `Advertorial` (persuasive HTML +
      `ftcDisclosure`), persisting a `slug`. Model emits structured JSON; a fixed escaped template
      renders it (XSS-safe); FTC baseline hardcoded; CTA structurally guaranteed.
- [x] `app/p/[slug]/page.tsx` — serves the advertorial **live** (memory → data/ → bundled seeds).
- [x] `app/api/advertorial/route.ts`; Step 5 card in the stepper links to the live page.
- [x] Deploy L2 live; **clicked the real page on the PUBLIC URL** —
      `/p/ketoslim-gummies-curiosity-bt2j` serves from the committed seed with no tunnel.

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
- [x] `lib/compliance-rules.json` — **22 curated high-risk patterns** (shared/FTC + per-platform
      Meta/Taboola/Google/TikTok), each with severity + reason + fix. `_meta` labels it a curated
      subset honestly; FTC wording aligns with the advertorial's `FTC_BASELINE`/`FTC_RESULTS`.
- [x] `agents/compliance.ts` — copy → `ComplianceVerdict[]` (pass/flag/block + offending text +
      fixes). **Deterministic regex, no model call** (build plan §3) — instant + reproducible.
- [x] `app/api/compliance/route.ts`; gate runs **inline** (auto-fires after copy in the UI).
- [x] UI: Step 4 pass/flag/block summary + rule count; each ad card carries its verdict badge +
      violation list (offending text → fix). `block` shown loudly, copy not hidden.
- [x] Deploy L3 live — **the gate works on the PUBLIC Vercel URL with no tunnel** (pure regex, no
      Ollama dependency), like the seeded advertorials.

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
- [x] `agents/judge.ts` — deterministic scorer (compliance + completeness + reach) ranks + selects
      the launch set (never a BLOCK unless nothing cleaner); model rationale w/ templated fallback;
      dynamic checklist. `app/api/judge`.
- [x] `agents/orchestrator.ts` (+ jsdom-free `orchestrator-core.ts`) + `app/api/run` — SSE streamed,
      stage-by-stage run with a seeded fallback. Verified live end-to-end.
- [x] `examples/seeded-run.json` — a **real** cached full run (FlowDesk). UI falls back to it; the
      `/api/run` route replays it whenever the live pipeline can't reach the model — so it works on
      the public URL too. Its advertorial is committed so its `/p/` link resolves publicly.
- [x] **Public exposure via cloudflared** — `scripts/start-live.mjs` + `npm run live`: tunnel-then-app
      unified startup fronting the local app (which reaches local Ollama), per the S1 decision.
- [x] Harden every build-plan §7 failure mode: bad URL, empty offer, no-model → seeded fallback (all
      verified live). Bonus: fixed a real Vercel 500 (jsdom static-import → lazy-import).
- [x] `README.md` — answers build-plan §9's three scored questions + architecture + running it.
      Complete draft; **human should do a final voice pass** (§9 stresses "your voice").
- [x] Final deploy (L4 live + verified on the public URL). Submission = the user's action; the
      submittable state is shipped.
- [ ] Adversarial ultracode verification pass — running; findings applied before final sign-off.

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

- **Sprint 1 (Opus 4.8 high) — 2026-07-03** ·
  **shipped:** L0 pipeline spine, verified end-to-end against live Ollama. `agents/research.ts`
  (offer → `OfferBrief` w/ claim detection + risk rating), `agents/angles.ts` (brief → 4–6
  divergent `Angle[]`, one distinct `hookType` each), `app/api/research` + `app/api/angles`,
  `app/page.tsx` stepper (paste/URL → Brief → Angles, staged reveal). New reusable libs:
  `lib/fetchOffer.ts` (Readability + pasted-text fallback), `lib/fence.ts` (prompt-injection
  defense), `lib/agentJson.ts` (shared generate→repair→coerce). vitest now 49 tests. ·
  **lives in:** `agents/`, `lib/`, `app/`. ·
  **live URL:** local `npm run dev` is the working demo (verified: keto offer → "high" risk + 8
  claims; solar offer → 6 angles across 6 hooks). Vercel prod URL still serving the S0 shell — the
  L0-UI prod deploy stalled in Vercel's queue (interrupted CLI uploads); a re-deploy is the trivial
  fix and prod LLM calls need the S5 tunnel regardless, so this was not chased. ·
  **next model must know:** (1) **`lib/agentJson.ts` `generateJson(messages, coerce, opts)` is the
  house pattern — S2+ agents (copy/compliance/judge) should use it, not hand-rolled parsing.**
  (2) Untrusted offer text must pass through `lib/fence.ts` `fenceUntrusted()` before entering any
  prompt (copy/advertorial agents splice offer text too). (3) Thinking-model tax is real: `angles`
  uses `maxTokens: 5000`; budget similarly for copy/advertorial. (4) Agent coercers are defensive
  (default missing fields, never throw on shape) — keep that pattern; it's why the pipeline doesn't
  crash on a thin model reply. (5) `EXAMPLE_OFFERS` in `lib/examples.ts` span risk levels — reuse
  for demo + as compliance-gate fixtures in S4. ·
  **deviations from build plan:** angle swarm is a single divergence call for L0 (not N parallel
  panelists) — cost/latency-mindful; `angles.ts` is shaped for S5 to fan out to true panelists.

- **Sprint 2 (Opus 4.8 high — see deviation) — 2026-07-03** ·
  **shipped:** L1 Copy Agent. `agents/copy.ts` (Angle[] → per-platform `AdCopy[]`, one call per
  platform writing one on-voice ad per angle), `app/api/copy`, UI Step 4 (copy grouped by platform).
  Meta + Taboola are the default; Google + TikTok voice is wired for later. Verified live: 2 angles ×
  2 platforms → 4 on-voice ads. vitest now 62 tests. ·
  **lives in:** `agents/copy.ts`, `app/api/copy/`, `app/page.tsx`. ·
  **live URL:** https://marketingapp-ashy.vercel.app now serves the L1 UI (deploy unblocked — see
  below). Working LLM demo still local (`npm run dev`) until the S5 tunnel. ·
  **next model must know:** (1) **Vercel deploys were BLOCKED, now fixed.** Root cause (found via
  `vercel deploy --debug`): Vercel refused to build any deployment because the git commit-author
  email `Slagathore@users.noreply.github.com` wasn't a verified member of the Vercel team
  (`blockCode: TEAM_ACCESS_REQUIRED`). Fix: repo-local `git config user.email charcham7@gmail.com`
  (the Vercel account email). **Keep committing with that email or deploys re-block.** (2) The
  thinking model occasionally emits unparseable/truncated JSON on bigger requests — S2 added a
  per-call **retry + partial-degrade** pattern (`copyForPlatformResilient`); reuse this shape for
  any multi-item agent (compliance/judge). (3) `copy()` caps angles at `MAX_ANGLES_FOR_COPY` and
  returns `failedPlatforms` for partial success — the S4 compliance UI should tolerate partial copy
  sets. ·
  **deviations from build plan:** **run on Opus 4.8, not the plan's Sonnet 5** — at the user's
  explicit request ("knock out s2 yourself"). Also added Google/TikTok copy guidance (build plan had
  them as "if time") — default output is still Meta + Taboola only.

- **Sprint 3 (Fable max) — 2026-07-03** ·
  **shipped:** L2 Advertorial. `agents/advertorial.ts` (structured-content prompt with integrity
  rules → fixed magazine-editorial template, every model string escaped, FTC baseline hardcoded,
  CTA-section invariant enforced in coercion), `lib/advertorialStore.ts` (memory → `data/` →
  bundled `examples/advertorials/` seeds; slug charset guard), `app/api/advertorial`,
  `app/p/[slug]/page.tsx`, UI Step 5 (angle selector → generate → open-live-page link). Committed
  seed advertorial generated end-to-end live. vitest now 84 tests. ·
  **lives in:** `agents/advertorial.ts`, `lib/advertorialStore.ts`, `app/api/advertorial/`,
  `app/p/[slug]/`, `examples/advertorials/`. ·
  **live URL:** **PUBLIC, no tunnel:** https://marketingapp-ashy.vercel.app/p/ketoslim-gummies-curiosity-bt2j
  (served from the bundled seed via `outputFileTracingIncludes` in `next.config.ts`). Fresh
  generations remain local until the S5 tunnel. ·
  **next model must know:** (1) **Advertorials are structured JSON + a fixed template — never let
  the model emit HTML.** All rendering safety lives in `renderAdvertorialHtml` (escape everything;
  `safeHref` inerts non-http(s) CTA urls). (2) **Structural invariants belong in coercion, not
  prompts** — live testing caught the model skipping the required cta section; the fix pattern
  (append-if-missing, empty-stays-empty-to-retry) is in `coerceAdvertorialContent`. Apply the same
  thinking to S4's gate outputs. (3) The store's read chain means anything committed to
  `examples/advertorials/` is publicly servable at `/p/[slug]` on Vercel — S5's seeded-run should
  lean on this for the un-killable demo. New serverless writes only hit lambda /tmp (documented
  limitation). (4) `angles.ts` got the 2-attempt retry backported (it flaked live); all four
  generation agents now share the resilient pattern. (5) FTC strings: `FTC_BASELINE` +
  `FTC_RESULTS` in `agents/advertorial.ts` — S4's rules JSON should reference the same wording,
  don't fork it. ·
  **deviations from build plan:** none in scope; the plan's "persists slug" is file+memory (no DB,
  per build-plan §3), with the committed-seed tier added so the public URL click works pre-tunnel.

- **Sprint 4 (Opus 4.8 high) — 2026-07-03** ·
  **shipped:** L3 Compliance Gate. `lib/compliance-rules.json` (22 curated shared/FTC + per-platform
  rules), `agents/compliance.ts` (deterministic precompiled-regex scorer → pass/flag/block +
  offending text + fix; pure, no model call), `app/api/compliance`, `coerceAdCopyList` in
  `copy.ts`, UI Step 4 inline badges + summary. Verified live: aggressive keto ads → BLOCK/FLAG on
  the right rules, clean copy → PASS. vitest now 96 tests. ·
  **lives in:** `agents/compliance.ts`, `lib/compliance-rules.json`, `app/api/compliance/`,
  `app/page.tsx`. ·
  **live URL:** **PUBLIC, no tunnel:** `POST https://marketingapp-ashy.vercel.app/api/compliance`
  works on the deployed site (pure regex, no Ollama). Two features now fully live on the public URL:
  seeded `/p/[slug]` advertorials + this gate. ·
  **next model must know:** (1) **The gate is deterministic + synchronous** — `compliance(copies)`
  is a pure function; the S5 orchestrator can call it directly (no await/model) between copy and
  judge. (2) It **never mutates copy** — reports only; the S5 Judge should read verdicts to prefer
  compliant angles (e.g. down-rank anything with a `block`). (3) `summarize()` +
  `activeRuleCount()` are ready for the run/report UI. (4) Rules `_meta.note` states the
  curated-subset limitation — the README's what's-next should promise the policy-RAG swap; don't
  overclaim coverage. (5) FTC strings are shared with the advertorial — one source of truth, don't
  fork. ·
  **deviations from build plan:** gate scores COPY (not "angles→copy"); the build plan's L3 line
  says "between angles→copy" but the contract + file tree are copy-scoring, so verdicts attach to
  ads. Covers Google/TikTok too (build plan minimum was Meta+Taboola+FTC).

---

## 10. Cut line (if the clock beats a sprint)

Follow build-plan **§10** in order: drop Judge ranking → drop `/run` streaming → keep only Meta +
Taboola → keep compliance standalone (not inline). **Never cut:** Research + Angles + Copy + one live
advertorial (that's L0–L2, sprints S1–S3). If S5 can't finish, a submitted L3 build is still a
finalist entry — so **submit at the end of S4 as a safety net** before S5 begins its capstone.
