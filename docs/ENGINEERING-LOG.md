# Engineering log

Bugs found while building this, how each was diagnosed, and what it changed. Kept because how a defect was *found* is usually more interesting than the patch.

Several of these were only findable by running the real thing — against real Postgres, real AWS, real Stripe. Every one of them would have passed a code review.

---

## 1. The "Add expense" button did nothing

**Symptom.** Clicking *Add expense* produced no request, no error, no feedback.

**Diagnosis.** Querying the database directly showed the expense never arrived, while the identical payload sent straight to the API returned `201`. That ruled out the server and pointed at the client. Reading the markup: `description` and `amount` carried the HTML `required` attribute, so the browser blocked submission with a native validation bubble — easy to miss in a wrapped flex row where the invalid field sits off to the side. The submit handler never ran, so the application's own validation never ran either, so nothing was ever displayed.

**Fix.** Every form now sets `noValidate` and validates in application code, so a rejected submit *always* renders a visible message beside the field that caused it. Exact and percentage splits additionally show a running "allocated" total so a mismatch is visible while typing.

**Lesson.** A silent failure is worse than a loud one. Native form validation is a silent failure by design when the invalid control is not in view.

---

## 2. `terraform validate` passed on a configuration that could not run

**Symptom.** None. Everything was green.

**Diagnosis.** Found by actually running Terraform rather than trusting the version constraint. The backend block uses `use_lockfile` — S3 native state locking — which requires **Terraform 1.10**, while `required_version` claimed `>= 1.6`. The configuration advertised support for versions it could not execute on, and `validate` does not check backend features against the declared version.

**Fix.** Constraint corrected to `>= 1.10`.

---

## 3. Performance Insights would have failed the first `terraform apply`

**Symptom.** None — caught before applying.

**Diagnosis.** AWS does not support Performance Insights on burstable micro and small instance classes, and the configuration enabled it unconditionally against a `db.t4g.micro` default. `terraform validate` cannot know this; it is a runtime AWS constraint.

**Fix.** Made it a variable defaulting to `false`, with the constraint documented at the declaration.

---

## 4. OIDC federation rejected with an opaque authorization error

**Symptom.** `Could not assume role with OIDC: Not authorized to perform sts:AssumeRoleWithWebIdentity`. The trust policy looked correct and matched every published example.

**Diagnosis.** Rather than guessing, a temporary CI step decoded the actual JWT and printed its claims:

```
sub: repo:sameerchohan@147352814/squared@1347870948:pull_request
```

not the universally documented:

```
sub: repo:sameerchohan/squared:pull_request
```

GitHub has moved to **immutable subject claims** that embed numeric account and repository ids, so that renaming a repository cannot silently break a trust policy — or worse, let whoever subsequently claims the freed-up name inherit access to the AWS role. It is a genuine security improvement, but essentially every tutorial still shows the legacy form, and the failure gives no hint that the subject is what is wrong.

**Fix.** Trust policy matches on the numeric ids with the names wildcarded, so a rename of either the account or the repository keeps working. Both forms are accepted.

**Lesson.** When an opaque auth error contradicts the documentation, read what the client actually sent instead of re-reading the docs.

---

## 5. Configuration drift between the code and the deployed role

**Symptom.** CI was green and the role worked, but `main` did not contain the fix that made it work.

**Diagnosis.** A `git push` had been rejected as non-fast-forward — the branch already carried commits pushed through the GitHub Contents API — so the merged PR was missing the local trust-policy change. The live role had the corrected policy; the source did not.

This is drift in the dangerous direction: the next `terraform apply` from `main` would have **reverted the live role and broken CI**, with the cause several commits behind whoever was debugging it.

**Fix.** Reapplied the change through a proper PR, then confirmed with `terraform plan` reporting *"No changes. Your infrastructure matches the configuration."*

**Lesson.** A rejected push is not a no-op. Verify what actually landed, and let `plan` be the arbiter of whether code and infrastructure agree.

---

## 6. The documented deploy sequence could not work

**Symptom.** None — caught by writing the runbook carefully.

**Diagnosis.** The ECS service definition references a container image by tag, but ECR is empty on a first apply. The documented order — apply everything, then build and push — would have failed on the very first deploy.

**Fix.** Sequence corrected: create the registry alone with `-target`, push an image, then apply the rest. Also documented `--platform linux/amd64`, since an arm64 image built on Apple Silicon starts and immediately dies against the `X86_64` task definition with an exec-format error.

---

## 7. Stripe misconfiguration surfaced as "Internal server error"

**Symptom.** The onboarding endpoint returned `500 Internal server error` on the first real Connect call.

**Diagnosis.** The server log carried the real message: *"You can only create new accounts if you've signed up for Connect."* Nothing was wrong with the code — Connect had not been enabled on the Stripe account — but the response gave the caller nothing to act on.

**Fix.** Stripe failures now map to distinct answers, because a misconfigured platform, a declined card, and an unreachable Stripe are three different problems: **402** declined, **503** misconfigured or unreachable, **429** rate limited. Detail is logged server-side and never returned.

**Lesson.** Collapsing every failure into 500 hides which one happened. This was only findable by making a real API call — a mocked Stripe would have returned success.

---

## 8. Stripe steering new integrations to a preview API

**Symptom.** Once Connect was enabled, account creation failed with *"Stripe no longer recommends Accounts v1 for new Connect integrations. Create connected accounts with POST /v2/core/accounts instead."*

**Diagnosis.** The instinct was to migrate — using the currently recommended API is normally the better choice. Probing the v2 endpoint directly revealed it only accepts requests carrying `Stripe-Version: 2026-07-29.preview`: **v2 Accounts is still in preview.** It also has its own event system, so migrating would have meant rewriting the webhook idempotency and onboarding state machine against an unstable API.

**Fix.** Enabled Accounts v1 support and stayed on the stable API. Reasoning recorded in [DECISIONS.md](DECISIONS.md#accounts-v1-not-the-v2-preview).

**Lesson.** "Recommended" and "stable" are not the same claim. Check which one an error message is actually making.

---

## 9. Connect enabled on the wrong account

**Symptom.** After completing the Connect signup, account creation still failed — but the error had *changed back* to the original "you haven't signed up for Connect."

**Diagnosis.** The changed error was the clue: the v2 blocker was gone, so the v1 setting had taken effect. Comparing ids showed the API key belonged to `acct_1U9U2ADmkAUkXG8V` (a **sandbox**) while the signup had been completed on `acct_1U9TrCDPAshd8ZJO` (the main account). Stripe sandboxes are isolated environments and require their own Connect enablement.

**Lesson.** When an error message changes, that *is* the signal — even when the call still fails. Something moved.

---

## 10. Cost estimate was wrong by ~40%

**Symptom.** The README claimed ~$20–30/month.

**Diagnosis.** Recomputed line by line against real us-east-2 pricing: RDS storage and the ALB's hourly base rate had both been under-counted. Actual figure is **~$42/month**, or **~$0.057/hour**.

**Fix.** Corrected, and reframed around the number that actually matters for a portfolio deployment — hourly, since the stack is meant to be stood up, captured, and destroyed.

---

## 11. Teardown would not have worked

**Symptom.** None — found by reasoning through the destroy path before needing it.

**Diagnosis.** Three settings each block or outlive `terraform destroy`: deletion protection on the ALB and database makes `destroy` refuse outright; the final RDS snapshot outlives the instance and keeps billing for storage; and the seven-day secret recovery window **blocks re-creating secrets under the same names**, so a second deploy would have failed for a week.

That last one is the nastiest — it only appears on the *second* attempt, long after the first looked successful.

**Fix.** All three follow one `enable_deletion_protection` flag, defaulting to `false`.

---

## 12. Light-mode ochre failed WCAG AA

**Symptom.** None visually — it looked fine.

**Diagnosis.** Rather than eyeballing the palette, every foreground/background pairing was run through a contrast script in both themes. The warning ochre came in at **4.11:1** against white, under the 4.5:1 floor for body text. Everything else passed.

**Fix.** Darkened to 5.51:1.

**Lesson.** Contrast is measurable. Guessing at it is a choice.

---

## 13. React lint caught two real state bugs

**`setState` synchronously inside an effect**, twice. The second was in the theme toggle, reading `localStorage` into state on mount — which also would have produced a hydration mismatch, since the server cannot know the stored value.

**Fix.** Reload counters for the data-fetching case, and `useSyncExternalStore` for the theme — the correct primitive for reading external state, with a distinct server snapshot so hydration matches and no cascading render occurs.

---

## 14. A wrong number in the README

**Symptom.** The worked example claimed `Carol → Alice $480.00`.

**Diagnosis.** Checked against the actual test expectation rather than trusting the prose. The test asserts `49000` cents — **$490.00**.

**Lesson.** Documentation drifts from code silently. Every figure in the README is now taken from a test or a measurement.
