# Credits & billing

A single **credit wallet**, keyed by the teacher's email, shared across
LessonScope and TeacherScope. Teachers buy credit packs through Stripe (which
shows Google Pay / Apple Pay / cards automatically) and spend 1 credit per
generated lesson (LessonScope) or comment set (TeacherScope).

Enforcement is **off by default** — set `BILLING_ENABLED=true` only when you're
ready to charge. Until then everything generates for free, exactly as before.

## 1. Stripe setup (once)

1. Create a Stripe account at https://dashboard.stripe.com.
2. **API key**: Developers → API keys → copy the **Secret key** (`sk_live_…`,
   or `sk_test_…` while testing).
3. **Webhook**: Developers → Webhooks → **Add endpoint**:
   - Endpoint URL: `https://lesson.educscope.com/api/billing/webhook`
   - Events: `checkout.session.completed`
   - After creating it, copy the **Signing secret** (`whsec_…`).
4. Make sure **Google Pay / Apple Pay** are enabled: Settings → Payments →
   Payment methods (they're on by default for Checkout).

## 2. Railway variables (LessonScope service)

```
STRIPE_SECRET_KEY       = sk_live_…            # or sk_test_… while testing
STRIPE_WEBHOOK_SECRET   = whsec_…
# optional:
BILLING_CURRENCY        = usd                  # any Stripe currency
FREE_CREDITS            = 3                     # one-time trial per teacher
BILLING_ENABLED         = true                 # flip ON to actually charge
```

- With just the two Stripe vars set (and `BILLING_ENABLED` unset), teachers can
  **buy** credits but generation is still free — good for a soft launch.
- Set `BILLING_ENABLED=true` to start spending credits on generation.

## 3. Pack prices

Edit the `PACKS` array in `billing.js` (amounts are in cents):

```js
const PACKS = [
  { id: 'credits-10',  credits: 10,  amount: 500  },  // $5
  { id: 'credits-30',  credits: 30,  amount: 1200 },  // $12
  { id: 'credits-100', credits: 100, amount: 3500 },  // $35
];
```

## 4. Wiring TeacherScope to the shared wallet

TeacherScope already connects to LessonScope via OAuth. To use the shared
wallet it needs the two credit scopes and two API calls.

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
  LessonScope's Credits page, or a Stripe Checkout you create the same way).

That's the whole integration: request two scopes, call `consume` on generate,
handle `402`.
