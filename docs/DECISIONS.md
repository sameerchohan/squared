# Decision record

Why this project is built the way it is, including the options rejected. Written as the decisions were made, not reconstructed afterward.

---

## Data and money

### Money is integer cents everywhere
No float ever touches a monetary value. Splitting $100 three ways cannot be done exactly in cents, so [`splits.ts`](../src/lib/splits.ts) uses largest-remainder apportionment: floor every share, then distribute leftover cents to the largest truncated remainders. Percentages convert to integer basis points *before* any arithmetic.

**Rejected:** decimal/numeric column types. They solve storage but not the apportionment problem, and they invite float arithmetic in application code.

### The database enforces the invariants, not just the app
`CHECK` constraints on amount signs and every enum-shaped column; `UNIQUE` on all Stripe object ids. If the application logic above it ever fails, the database still refuses a double-recorded charge or a negative expense.

### `settlements.group_id` does not cascade
Every other foreign key cascades. This one deliberately does not: settlements are money-movement records and must survive an attempt to delete their group. The consequence is that a group with payment history cannot be hard-deleted, which is the correct outcome.

---

## Payments

### Destination charges, not direct charges
The payer's PaymentIntent is created on the platform account with `transfer_data.destination` routing funds to the recipient's connected account. The platform is merchant of record: it appears on receipts and owns refunds and disputes.

**Rejected:** direct charges, where the charge is created *on* the connected account. That is the Shopify model — independent merchants running storefronts. Squared's users are friends repaying each other, not sellers.

### Express accounts, not Custom
Stripe owns identity verification, the onboarding form, and the account-management dashboard.

**Confirmed the hard way:** an attempt to set `individual` and `external_account` on an Express account is refused — *"this application does not have the required permissions."* That refusal is the feature. Custom accounts would move KYC and its compliance surface onto this project.

### Accounts v1, not the v2 preview
Stripe now steers new Connect integrations to `POST /v2/core/accounts`. Probing the API showed it only accepts requests carrying `Stripe-Version: 2026-07-29.preview` — **v2 Accounts is still a preview feature.**

Staying on stable v1 (via the Accounts v1 support setting) because preview APIs change without notice, and the webhook idempotency and onboarding state machine — the most carefully tested parts of this project — are built on v1's event model. Rebuilding proven logic against an API that can shift underneath it is the wrong trade for something meant to keep working.

### The platform absorbs Stripe's fee
No `application_fee_amount` is set, so the recipient receives the full amount and the platform pays ~2.9% + 30¢. Deliberate for a portfolio project with no real settlements. For anything real, a payer-side surcharge is the option that preserves the app's core invariant — *you're owed $50, you get $50* — where `on_behalf_of` would quietly break it.

### Stripe is called outside the database transaction
Settlement validation and insertion happen inside one advisory-locked transaction; the Checkout session is created after it commits. Holding a transaction and a lock open across a third party's network latency is how a payment provider's slow day becomes your outage.

The cost is a window where the row exists but the charge does not, so a Stripe failure marks the settlement `failed` — which returns the debt to the group's balances rather than freezing it behind a pending row no webhook will ever resolve.

---

## Correctness

### Recording a webhook event and handling it share one transaction
The naive implementation records the event id, then runs the handler. When the handler fails, Stripe's retry finds the id already recorded and skips it — the event is silently, permanently dropped. In a payments system that is a settlement stuck in `pending` forever.

Both happen in one transaction, so a failed handler rolls back the ledger row along with everything else and the retry genuinely reprocesses. See [the README](../README.md#1-processing-every-webhook-exactly-once).

### Greedy debt simplification, with its limits stated
Net every position, then repeatedly match the largest debtor with the largest creditor. At most *n − 1* transfers instead of the pairwise tangle.

Minimizing transfer count in the general case is NP-hard — it is the partition problem in disguise. For real group sizes (under twenty) greedy is the right trade: predictable, fast, and explainable to a user who wants to know why they are paying the person they are.

### Concurrent settlement of the same debt
Balance validation reads state and then writes, which is a race: two tabs could each read "you owe $50" and both create a $50 settlement. Settlement creation recomputes balances *inside* the transaction that inserts, serialized per group by `pg_advisory_xact_lock(hashtext(group_id))`, and caps the amount at `min(payer debt, recipient credit)` to preserve the zero-sum invariant.

### Only the payer can edit or delete an expense
Letting any member delete would mean a debtor could quietly erase what they owe. Tying the record to whoever actually spent the money keeps the ledger honest.

### Members carrying a balance cannot be removed
Removing a debtor would destroy the record of what they owe; removing a creditor would destroy what the group owes them. A member who paid for any expense also cannot be removed, because `expenses.paid_by` has no cascade and the reference would be orphaned. The rule lives in a [pure module](../src/lib/membership-rules.ts) with its own tests, and the route calls that module — a tested rule that production does not use proves nothing.

---

## Infrastructure

### The NAT gateway is a variable, not a default
A NAT gateway costs ~$32/month and buys network *topology*, not access control — the tasks' security group already admits nothing but the load balancer. `use_nat_gateway = false` runs tasks in public subnets with an outbound-only public IP; `true` moves them into private subnets. Both paths are in the code because the trade-off, not the default, is the point.

### The health check queries the database
`/api/health` runs `SELECT 1`, so a task that cannot reach Postgres is replaced rather than serving errors that look healthy at the process level. Combined with the deployment circuit breaker, a broken revision rolls itself back.

### The connection pool is constructed lazily
`new Pool()` does not open sockets — pg connects on first query — so the module imports without credentials and `next build` and CI need no placeholder secrets. A missing `DATABASE_URL` surfaces through the health check, which is the right place for it.

### Migrations run as a separate one-off task
With several tasks starting at once, migrating at boot means every task races to apply the same DDL. As a distinct step the deploy fails loudly on a bad migration instead of half-migrating under load.

### CI authenticates to AWS with OIDC, not stored keys
GitHub Actions exchanges a short-lived, repo-scoped token for AWS credentials that expire in minutes. Nothing long-lived lives in the repository. The role is read-only and carries an explicit `Deny` on `secretsmanager:GetSecretValue` and `kms:Decrypt` — `ReadOnlyAccess` alone is broad enough to read secret *values*, which CI has no business doing.

### Bootstrap infrastructure has its own state
The OIDC provider and CI role live in `infra/bootstrap/` with a separate state key, because the application stack is disposable — stood up, captured, destroyed — and the role must survive that cycle.

### Deletion protection is a flag, defaulted off
Deletion protection, final snapshots, and secret recovery windows each block or outlive `terraform destroy`. A demo that is stood up and torn down the same day wants none of them; anything real wants all three. One flag controls all three, and the refusal to destroy a database holding payment records is the entire point of setting it `true`.

---

## Interface

### Warm neutrals, not gray
A pure-gray UI is the clearest sign nobody chose the colors. Deep pine carries the brand — the green of ledgers and banknotes — against warm paper, clay red, and ochre. Money direction is never signalled by color alone: every figure is paired with "owes" or "is owed" in text.

### Every form sets `noValidate`
The browser's native validation bubbles block submission *silently* and cannot be styled, which reads to a user as a dead button. All validation is the application's, and every message renders next to the field that caused it. This came directly out of [a real bug](ENGINEERING-LOG.md#1-the-add-expense-button-did-nothing).

### Theme tokens are declared once with `light-dark()`
A light block plus a duplicated dark block inside a media query always eventually drift apart. `color-scheme` decides which half resolves, which additionally makes native controls, scrollbars, and form widgets follow the theme for free.

### The theme control has three states
A binary switch silently overrides the operating system forever, with no way back to following it.
