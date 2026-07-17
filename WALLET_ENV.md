# LessonScope wallet / credit env vars (for later)

Reference for when we wire LessonScope to the EducScope wallet. **Nothing here
is set yet** — the app runs exactly as before with all of these unset (billing
off, local fallback, free generation). Values verified against the code.

## 1. Turning billing on (the switch)

| Var | Default (unset) | Set it to | Notes |
|---|---|---|---|
| `BILLING_ENABLED` | off (free) | `true` | The master switch. Strict `=== 'true'` — any other value = off. Flip ON only when the wallet (remote or local) is ready to actually charge. |

## 2. EducScope wallet (remote backend — the destination)

Set these once EducScope's wallet API is live. With `EDUCSCOPE_WALLET_URL`
set, `wallet.js` uses the remote backend and **fails closed** on an outage.

| Var | Default (unset) | Set it to | Notes |
|---|---|---|---|
| `EDUCSCOPE_WALLET_URL` | empty → local fallback | e.g. `https://wallet.educscope.com/api` | **Canonical.** Base URL of EducScope's wallet API. Presence of this var is what switches remote mode on. |
| `EDUCSCOPE_WALLET_KEY` | empty (no auth header) | service token | **Canonical.** Bearer token LessonScope sends to the wallet API. Pair with the URL. |
| `WALLET_FAIL_CLOSED` | follows mode: **open** locally, **closed** when remote URL set | `true` / `false` | Override the outage behaviour. `true` = block generation if the wallet is unreachable; `false` = allow it. Leave unset to use the sensible per-mode default. |

> **Aliases:** `EDUCSCOPE_WALLET_API_URL` / `EDUCSCOPE_WALLET_API_KEY` are still
> read as backward-compatible fallbacks, but the **canonical** names above win
> and should be the only ones used going forward.

### Shared session (identity + org id)

LessonScope runs on `lesson.educscope.com`; EducScope sets its session cookie on
`COOKIE_DOMAIN=.educscope.com`, so that cookie reaches LessonScope. The server
resolves the signed-in teacher by **forwarding that cookie** to EducScope's
account API and reading back the **trusted** `user.id` + `organization.id`. That
`organization.id` is the only id used for wallet reserve/capture/release — never
an org id from the browser.

- Account API URL is derived from `EDUCSCOPE_WALLET_URL`'s origin as
  `…/api/account/me`. Override with `EDUCSCOPE_ACCOUNT_API_URL` if it ever differs.
- A 401 from `/api/account/me` → the UI sends the teacher to
  `EDUCSCOPE_ACCOUNT_URL?mode=login`.
- Balance shown in LessonScope is EducScope's `wallet.available` (remote mode);
  the local `credits.js` wallet is used only when `EDUCSCOPE_WALLET_URL` is unset.

Production values:

```
BILLING_ENABLED=true
EDUCSCOPE_WALLET_URL=https://educscope.com/api/wallet
EDUCSCOPE_ACCOUNT_URL=https://educscope.com/account
EDUCSCOPE_WALLET_KEY=<shared key from EducScope Railway — set in Railway, not here>
```

## 3. Top-up link (UI)

| Var | Default (unset) | Set it to | Notes |
|---|---|---|---|
| `EDUCSCOPE_ACCOUNT_URL` | empty → "coming soon" text, no link | e.g. `https://educscope.com/account` | Where the "Top up" button points. **Optional / fallback-safe** — empty just hides the link. |

## 4. Local fallback credit vars (used until EducScope owns the wallet)

These drive the local wallet (`credits.js` + reservations ledger) and the
pricing/quota knobs. All optional — sensible defaults baked in.

| Var | Default | Purpose |
|---|---|---|
| `FREE_CREDITS` | `3` | One-time free credit grant per new teacher (first use). Integer ≥ 0. |
| `FREE_REGENS_PER_LESSON` | `3` | Fair-use: free slide-regenerations per lesson before a regen costs 1 credit. |
| `AI_VISUAL_LIMIT` | `50` | Monthly per-teacher cap on AI images + diagrams — kept as an **abuse guard on top of credits** (admins exempt). |

## 5. Local purchasing (Lemon Squeezy — TEMPORARY / FALLBACK ONLY)

> ⚠️ **Temporary.** These exist only as a stop-gap so LessonScope *could* sell
> credits before EducScope's wallet is live. **EducScope owns purchasing long
> term** — once its wallet API is the seller of record, leave these unset and
> plan to remove this path. Do not build on it.

Optional. Without these, LessonScope simply doesn't offer purchasing; balances
still work. See `BILLING.md` for the full setup.

| Var | Purpose |
|---|---|
| `LEMONSQUEEZY_API_KEY` | Lemon Squeezy API key |
| `LEMONSQUEEZY_STORE_ID` | numeric store id |
| `LEMONSQUEEZY_VARIANT_ID` | the single "Credits" product variant |
| `LEMONSQUEEZY_WEBHOOK_SECRET` | signing secret for the `order_created` webhook |
| `BILLING_CURRENCY` | store currency (default `usd`); buyers still see local currency |

## 6. Cost-tracking overrides (optional, cosmetic)

`usage.js` accepts `PRICE_GPT_4O_MINI_IN`, `PRICE_GPT_4O_MINI_OUT`,
`PRICE_GPT_4O_IN`, `PRICE_GPT_4O_OUT`, `PRICE_GPT_IMAGE_1`, `PRICE_DALL_E_3` to
match OpenAI's live prices for the admin usage/cost report. No effect on credit
charging.

---

## 7. Canonical action names + prices (EducScope wallet contract)

Shared naming across apps. LessonScope's are the single source of truth in
`credit-prices.js`; every reserve/capture uses these exact `action` strings.

| Action | Credits |
|---|---|
| `lessonscope.generate_lesson_pack` | 3 |
| `lessonscope.generate_slide_deck` | 1 |
| `lessonscope.import_plan_to_slides` | 1 |
| `lessonscope.generate_pack_item` | 1 (worksheet / exit ticket / quiz) |
| `lessonscope.generate_game` | 1 |
| `lessonscope.generate_diagram` | 2 |
| `lessonscope.generate_ai_image` | 3 |
| `lessonscope.regenerate_slide` | first 3 per lesson free, then 1 / batch |

Free (no charge): import/parse existing slides, lesson plan (beta), auto-grade,
pacing-guide parse, image-query rewrite, captioning.

**TeacherScope** (owned by that app/agent, listed here for the shared contract):
`teacherscope.generate_class_comments` (≤30 students 10, ≤60 students 18, then
+ one 30-student block each), `teacherscope.generate_class_insights` (3),
`teacherscope.rewrite_comment` (free within fair use), `teacherscope.map_objectives`
(free). Uploads, parsing, exports, dashboards, approvals, login: free.

Every reserve → capture logs this usage metadata: user id, organization id (if
available), product (`lessonscope`/`teacherscope`), action, credits charged,
reservation id, model/provider, input tokens, output tokens, estimated provider
cost, result reference, success/failure status.

### Minimal "go live" set, in order
1. EducScope ships the wallet API → set `EDUCSCOPE_WALLET_URL` (+ `EDUCSCOPE_WALLET_KEY`).
2. Set `EDUCSCOPE_ACCOUNT_URL` so top-up links resolve.
3. Test cross-app reserve/capture/release with `BILLING_ENABLED` still **off** (reserves 0, logs the lifecycle).
4. Flip `BILLING_ENABLED=true` to actually charge.

`WALLET_FAIL_CLOSED` defaults correctly for each mode — only set it if you want
to override.
