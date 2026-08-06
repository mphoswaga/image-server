# EducScope / LessonScope — monetization roadmap

**Set 2026-08-06.** Goal: stop losing money on free paths, then make money through
conversion. Ordered — later steps assume earlier ones. Spans two repos:
`image-agent` (LessonScope app) and `website` (EducScope accounts, wallet, billing).

---

## The principle this is built on

**You cannot lose money on paid usage.** Every priced action runs at 6–96× markup;
the worst margin is still 6×. Money is only lost on *free* paths. So the work
splits cleanly:

- **Stop losing money** → close the free leaks (steps 1–3)
- **Make money** → give the trial enough runway to convert, then subscriptions (4–6)

## Reference numbers (measured 2026-08-06, re-check before relying on them)

Cost to us per action (OpenAI, `usage.js` pricing table):

| Action | Cost | Price | Markup |
|---|---|---|---|
| Slide deck | $0.0027 | 3 cr | 96× |
| Lesson plan | $0.0028 | 2 cr | 62× |
| Pack item | $0.0018 | 1 cr | 48× |
| AI diagram | $0.0280 | 3 cr | 9× |
| AI image | $0.0400 | 5 cr | 11× |

Credit sale price: $0.078–$0.1125 (packs of 80/$9, 220/$19, 500/$39).
Signup grant: 30 credits, released on email verification (`DEFAULT_TRIAL_CREDITS`, website repo).

**AI images cost 15× a whole deck.** They are simultaneously the thinnest margin
and the thing that makes a farmed account worth farming.

---

## Step 1 — Grant credits on email verification, not signup  ✅ DONE 2026-08-06
**Repo:** `website` · **Why first:** the only *unbounded* loss in the system.

`createAccount` validates `email.includes('@')` and nothing else, then
`signup.ts` immediately bootstraps a wallet with the full trial grant. One
throwaway address = 15 credits. Worst case per fake account is $0.20 (spent
entirely on AI images); typical ~$0.01. At 10,000 farmed accounts, ~$2,000 lost.

**Done when:** a new account holds 0 credits until its email is verified; the
`trial_grant` fires on verification, still idempotent per organisation.

**Do not** ship step 4 before this — a bigger grant on unverified signup doubles
the exposure instead of halving it.

## Step 2 — Reprice AI image 3 → 5, diagram 2 → 3
**Repo:** `image-agent` (`credit-prices.js`) · one-line change, does three jobs:

1. Margin 6× → 11×
2. Cuts a farmed account's maximum damage 40% ($0.20 → $0.12)
3. **Fixes the subscription model.** `subscription-pricing-analysis/assumptions.md`
   uses "$0.04 image ÷ 3 credits = $0.01333/credit" as its conservative cost
   basis. At 5 credits that becomes $0.008 — a 40% better safety margin on every
   plan modelled there.

| Plan | Contribution now | After |
|---|---|---|
| $19 / 250cr | $14.12 | $15.45 |
| $29 / 400cr | $21.57 | $23.71 |
| $35 / 500cr | $25.91 | $28.58 |

## Step 3 — Full pack 3 → 4 credits
**Repo:** `image-agent`. The full pack is five documents (worksheet, exit ticket,
quiz, homework, differentiated) and currently costs the same as a single deck.

## Step 4 — Raise the trial grant to 30 credits  ✅ DONE 2026-08-06
**Repo:** `website` (`DEFAULT_TRIAL_CREDITS`).

Counter-intuitive but this is the *make money* step. At current prices a
plan+deck lesson costs 5 credits, so 15 credits = **3 lessons** — too thin to
convince a teacher to change how they plan. 30 credits ≈ 6 lessons and costs us
**under 5 cents**. We are not protecting revenue at 15; we are protecting cents
while risking the conversion.

## Step 5 — Subscriptions  ✅ ALREADY LIVE (confirmed 2026-08-06)
**Repo:** `website`. Built and in production for weeks — this was surveyed as
'next' before confirming it was already running. Working end to end: plan
catalogue, Lemon Squeezy checkout, signed webhooks, the `subscription_*` state
machine, mid-period plan changes preserving consumed credits, and spending that
drains the monthly allowance before purchased credits (correct — the allowance
expires, the credits don't). Renewal resets the allowance idempotently via a
`subscription_allowance_periods` ledger keyed on the period, so a replayed
webhook can't double-grant.

**Allowances stay at 250/400/500.** They were sized against the old prices, so
repricing cut what they buy by ~80% — but that correction was needed. At the old
prices every realistic workload (even 2 fully-resourced lessons a day) fitted
inside the cheapest tier, so the tiers were indistinguishable and nobody would
ever upgrade. Now: 1 lesson/day fully resourced = 180 credits (Teacher $19),
2/day fully resourced = 360 (Teacher Plus $29). The upgrade path is real.

Only 3 subscribers existed at the time of the change, all test accounts, so no
paying teacher was affected.

## Step 6 — Referral programme  ⟵ NEXT (step 1 done, so unblocked)
**Repo:** `website` (wallet lives there; LessonScope can only report the event).

- **Reward:** 10 credits to the referrer, a few to the referee (two-sided converts better)
- **Gate:** verified email → generates a lesson → **returns on a later day**.
  A returning teacher is a real teacher. Gating on signup or first-lesson alone
  is farmable, because the referee's own free grant pays for that first lesson.
- **Cap:** 10 credits/month, rolling window over `referral_grant` transactions
- **Idempotency:** one grant per referred organisation, `referral:<referredOrgId>`
- ⚠️ **Never block same-IP signups.** The best referral is the colleague at the
  next desk — same school, same NAT. IP heuristics kill the referrals we want.
  Use as a soft review signal above a threshold, never a hard block.

Be generous (10, not 3): credits are not cash. The gate protects us, not the size.

---

## Deferred — real but minor, don't let them jump the queue

- **Unbilled scaling paths.** `/api/images/fetch` rewrites the query and
  vision-captions up to 6 images per search (~$0.001/search); auto-grading is
  ~$0.07 per 30-student assignment. Both catalogued as free in
  `credit-prices.js` with reasons. Cheap fix if needed: pass `skipCaption: true`
  in the image-search path.
- **Cache-charges-anyway.** `cache.wrap()` can return a cached result with no AI
  call while `reserve()` has already charged. Pre-existing and consistent across
  decks and plans. Only a fairness issue if teachers actually re-submit
  identical inputs — needs evidence before changing.

## Already done (2026-08-06)

- Lesson plan billed at 2 credits (was free — the largest unbilled AI call)
- Slide deck and import-to-slides raised 1 → 3
- Plan rewrites made fair-use (3 free per lesson), and the "Regenerate plan"
  button fixed — it had never actually regenerated, and pricing turned that into
  a charge for a no-op
- Two billing guards: uncatalogued actions are refused rather than silently
  free, and an AI call that declares no action fails under test
