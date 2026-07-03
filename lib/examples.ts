/**
 * Known-good example offers for the demo (ZERO_TO_LAUNCH_BUILD_PLAN.md §8:
 * "2-3 example offers pre-loaded"). These are pasted-TEXT offers on purpose —
 * they exercise the pipeline without depending on a live fetch that could hit
 * a bot wall mid-demo. They also deliberately span compliance-risk levels so
 * the brief's risk rating (and later the compliance gate) has something to
 * chew on. Fictional products; any resemblance to real brands is coincidental.
 */

export interface ExampleOffer {
  label: string;
  text: string;
}

export const EXAMPLE_OFFERS: ExampleOffer[] = [
  {
    label: "Keto gummies (high risk)",
    text: `KetoSlim Gummies — Melt Fat Without Diet or Exercise!

Doctors are STUNNED. KetoSlim's patented BHB formula forces your body into ketosis
in 24 hours, so you burn fat for energy around the clock. Users report losing 20 lbs
in the first month — guaranteed results or your money back.

- Clinically proven BHB ketones
- Suppresses appetite and crushes cravings
- No diet. No exercise. No effort.
- #1 keto gummy in America

Limited stock — 90% of visitors claim their discounted bottle today. Risk-free 30-day
trial. As seen on TV.`,
  },
  {
    label: "Solar program (med risk)",
    text: `SunGrid Home Solar — Cut Your Power Bill Up to 70%

Homeowners in your area may qualify for a new solar program with $0 down. Lock in
today's rates before utility prices climb again this winter. Typical households save
thousands over the life of the system, and federal incentives can cover a large share
of the cost.

- $0 down for qualified homeowners
- Fixed monthly payment, often lower than your current bill
- 25-year performance warranty
- Federal + state incentives handled for you

Check your eligibility in 60 seconds — no obligation.`,
  },
  {
    label: "Focus app (low risk)",
    text: `FlowDesk — The calm focus timer for people who hate productivity apps

FlowDesk is a simple desktop timer that blocks distracting sites during focus blocks
and gives you a gentle end-of-session summary. No streaks to guilt you, no gamified
nonsense — just quiet, structured deep work.

- One-click focus sessions
- Optional site blocking during a block
- A calm weekly recap of where your time went
- Works offline; your data stays on your machine

Free 14-day trial, then $6/month. Cancel anytime.`,
  },
];
