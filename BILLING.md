# Credits & billing

> **Direction (EducScope wallet):** EducScope is becoming the billing/wallet home
> base. LessonScope no longer deducts credits directly — every paid AI action
> goes through the wallet client ([wallet.js](wallet.js)) as **reserve → run →
> capture (success) / release (failure)**, so a failed generation never costs a
> teacher a credit. Prices live in one place ([credit-prices.js](credit-prices.js)).
>
> The wallet has two interchangeable backends behind one interface:
> - **remote** — set `EDUCSCOPE_WALLET_URL` (and `EDUCSCOPE_WALLET_KEY`) to call
>   EducScope's wallet API. This is the destination once EducScope ships it.
> - **local fallback** — used until then: the per-email wallet below plus a
>   reservations ledger (`DATA_DIR/reservations.json`). Swapping to remote is a
>   config change, not a code change.
>
> Prices (credits): full pack 3 · slide deck 1 · import-plan 1 · pack item 1 ·
> game 1 · AI diagram 1 · AI image 2. Free: import/parse slides, lesson plan
> (beta), auto-grade, pacing-guide parse. Regenerating a slide is free the first
> `FREE_REGENS_PER_LESSON` (default 3) times per lesson, then 1 credit.
> AI images/diagrams also keep the monthly `AI_VISUAL_LIMIT` cap as an abuse
> guard on top of credits.
>
> **Lemon Squeezy belongs to EducScope only.** LessonScope (and TeacherScope)
> are wallet *clients* — they call the wallet API and must NOT implement a
> payment processor. The Lemon Squeezy pieces documented below are a
> **temporary local fallback** for pre-EducScope top-ups; leave them unset and
> plan to remove them once EducScope owns purchasing. Do not build on them.


A single **credit wallet**, keyed by the teacher's email, shared across
LessonScope and TeacherScope. Teachers buy credit packs through **Lemon Squeezy**
(a global Merchant of Record) and spend 1 credit per generated lesson
(LessonScope) or comment set (TeacherScope).

Lemon Squeezy is the seller of record, so teachers **anywhere** — Africa,
Vietnam, the Middle East — pay in **their own local currency** with local
methods (cards, Google Pay, PayPal, …), Lemon Squeezy remits VAT/sales tax
globally, and it pays *you* out via PayPal or Wise.

Enforcement is **off by default** — set `BILLING_ENABLED=true` only when you're
ready to charge. Until then everything generates for free, exactly as before.

> Switching processor later (Paddle, Paystack, Stripe, …) is a one-file change:
> `billing.js` is the only place the processor lives. Everything else — the
> wallet, gating, UI, and the `/api/v1/credits` API — stays the same.

## 1. Lemon Squeezy setup (once)

1. Create a store at https://app.lemonsqueezy.com.
2. **Product**: create **one** product/variant called e.g. "LessonScope Credits"
   (any price — we override it per pack at checkout). Note its **variant ID**
   (Products → your product → the variant's ID).
3. **API key**: Settings → API → create a key.
4. **Store ID**: Settings → Stores (the numeric ID).
5. **Webhook**: Settings → Webhooks → **+**:
   - Callback URL: `https://lesson.educscope.com/api/billing/webhook`
   - Signing secret: make one up (a long random string) — you'll set it as
     `LEMONSQUEEZY_WEBHOOK_SECRET`.
   - Events: **order_created**.

## 2. Railway variables (LessonScope service)

```
LEMONSQUEEZY_API_KEY         = eyJ0…              # from Settings → API
LEMONSQUEEZY_STORE_ID        = 12345
LEMONSQUEEZY_VARIANT_ID      = 67890              # the "Credits" variant
LEMONSQUEEZY_WEBHOOK_SECRET  = <the signing secret you set on the webhook>
# optional:
BILLING_CURRENCY             = usd                # store currency; buyers see local
FREE_CREDITS                 = 3                  # one-time trial per teacher
BILLING_ENABLED              = true               # flip ON to actually charge
```

- With the four Lemon Squeezy vars set (and `BILLING_ENABLED` unset), teachers
  can **buy** credits but generation is still free — good for a soft launch.
- Set `BILLING_ENABLED=true` to start spending credits on generation.

## 3. Pack prices

Edit the `PACKS` array in `billing.js` (amounts are in the store-currency
subunit — USD cents):

```js
const PACKS = [
  { id: 'credits-10',  credits: 10,  amount: 500  },  // $5
  { id: 'credits-30',  credits: 30,  amount: 1200 },  // $12
  { id: 'credits-100', credits: 100, amount: 3500 },  // $35
];
```

One product/variant serves all three — the checkout overrides the price per pack
via `custom_price`.

## 4. Wiring TeacherScope to the shared wallet

TeacherScope already connects to LessonScope via OAuth. To use the shared
wallet it needs the two credit scopes and two API calls (unchanged regardless of
which payment processor LessonScope uses).

**a. Request the new scopes** when TeacherScope starts the OAuth flow — add
`credits:read` and `credits:write` to the `scope` parameter (alongside whatever
it already requests). The teacher re-consents once.

**b. Check the balance** (optional, e.g. to show it):

```
GET https://lesson.educscope.com/api/v1/credits
Authorization: Bearer <teacher's OAuth access token>
→ { "balance": 27, "billingEnabled": true }
```

**c. Charge a credit** right after TeacherScope generates a comment set:

```
POST https://lesson.educscope.com/api/v1/credits/consume
Authorization: Bearer <teacher's OAuth access token>
Content-Type: application/json
{ "amount": 1, "reason": "comment-set" }

→ 200 { "ok": true, "charged": 1, "balance": 26, "billingEnabled": true }
→ 402 { "ok": false, "needCredits": true, "balance": 0 }   // out of credits
```

Behaviour notes:
- When `BILLING_ENABLED` is off, `consume` returns `{ ok: true, charged: 0 }`
  without deducting — so TeacherScope needs no special-casing for the pre-launch
  period. Just call it and respect a `402`.
- On `402`, block the generation and point the teacher to buy credits (either
  LessonScope's Credits page, or a Lemon Squeezy checkout you create the same
  way).

That's the whole integration: request two scopes, call `consume` on generate,
handle `402`.
