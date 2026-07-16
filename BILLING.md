# Credits & billing

A single **credit wallet**, keyed by the teacher's email, shared across
LessonScope and TeacherScope. Teachers buy credit packs through **Paystack**
(South Africa) and spend 1 credit per generated lesson (LessonScope) or comment
set (TeacherScope).

Enforcement is **off by default** — set `BILLING_ENABLED=true` only when you're
ready to charge. Until then everything generates for free, exactly as before.

> Switching processor later (Payfast, Stripe, etc.) is a one-file change:
> `billing.js` is the only place the processor lives. Everything else — the
> wallet, gating, UI, and the `/api/v1/credits` API — stays the same.

## 1. Paystack setup (once)

1. Create a Paystack account at https://dashboard.paystack.com (South African
   business).
2. **API key**: Settings → API Keys & Webhooks → copy the **Secret key**
   (`sk_live_…`, or `sk_test_…` while testing).
3. **Webhook**: on the same page, set the **Webhook URL** to
   `https://lesson.educscope.com/api/billing/webhook`.
   (Paystack signs webhooks with your secret key — there's no separate webhook
   secret to copy. Crediting also happens on the return redirect, so it still
   works even before the webhook is set.)
4. Make sure **ZAR** is your account currency (or set `BILLING_CURRENCY`).

## 2. Railway variables (LessonScope service)

```
PAYSTACK_SECRET_KEY = sk_live_…      # or sk_test_… while testing
# optional:
BILLING_CURRENCY    = zar            # any currency your Paystack account supports
FREE_CREDITS        = 3              # one-time trial per teacher
BILLING_ENABLED     = true           # flip ON to actually charge
```

- With just `PAYSTACK_SECRET_KEY` set (and `BILLING_ENABLED` unset), teachers can
  **buy** credits but generation is still free — good for a soft launch.
- Set `BILLING_ENABLED=true` to start spending credits on generation.

## 3. Pack prices

Edit the `PACKS` array in `billing.js` (amounts are in the currency subunit —
cents for ZAR):

```js
const PACKS = [
  { id: 'credits-10',  credits: 10,  amount: 9000  },  // R90
  { id: 'credits-30',  credits: 30,  amount: 24000 },  // R240
  { id: 'credits-100', credits: 100, amount: 75000 },  // R750
];
```

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
  LessonScope's Credits page, or a Paystack checkout you create the same way).

That's the whole integration: request two scopes, call `consume` on generate,
handle `402`.
