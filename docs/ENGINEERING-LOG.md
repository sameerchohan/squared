# Engineering log

Bugs found while building this, how each was diagnosed, and what it changed. Kept because how a defect was *found* is usually more interesting than the patch.

Several of these were only findable by running the real thing — against real Postgres, real AWS, real Stripe. Every one of them would have passed a code review.

Entries 15 to 21 came from a single afternoon: the first time this Terraform was actually applied, on 31 August 2026. Five pull requests had planned the same configuration cleanly against the live AWS account before that day. Applying it found six failures in the first twenty minutes, and a seventh in the teardown. They are grouped at the end because what they have in common is more interesting than any one of them: a plan cannot evaluate string encoding, account entitlements, or trust chains, because none of those are consulted until a create call is made.

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

---

## 15. The runtime image could not seed a database it had just migrated

**Symptom.** None yet — caught while preparing the first real deployment.

**Diagnosis.** The Dockerfile copied `scripts/migrate.mjs` into the runtime image and nothing else from `scripts/`. Locally this is invisible: seeding runs against Docker Compose with the whole repository on disk. It only matters where the database is unreachable from a laptop, which is exactly what RDS in private subnets is. Seeding has to run from the image, inside the VPC, or it cannot run at all.

A second problem sat behind the first. `bcryptjs` looks like it must already be present — the application hashes a password on every sign-in — but Next.js bundles it into the compiled server output, so nothing remains in the standalone `node_modules` for a plain script to import. The seed task would have started, resolved `drizzle-orm` and `pg` fine, and died on `ERR_MODULE_NOT_FOUND` for the one dependency that looked safest.

**Fix.** Both files copied into the runner stage. Seeding reuses the migrate task definition with an overridden command rather than adding a second definition, since that definition already injects `DATABASE_URL` and nothing else — precisely what the seed script reads.

**Lesson.** "It works locally" and "it works in the image" are different claims about different filesystems. The gap only shows up somewhere you cannot reach with a shell.

---

## 16. ACM refused to issue a certificate for a domain that pointed at Vercel

**Symptom.** `terraform apply` hung on certificate validation, then failed. The DNS validation record was correct and ACM confirmed it had been seen: `ValidationStatus: SUCCESS`.

**Diagnosis.** The validation succeeding and the certificate failing are two different gates, and only `FailureReason` distinguishes them:

```
FailureReason: CAA_ERROR
```

CAA records declare which certificate authorities may issue for a name, and **CAA lookups follow CNAMEs**. `squared.sameerchohan.com` is a CNAME to `cname.vercel-dns.com`, so the policy governing issuance for that name is Vercel's:

```
0 issue "sectigo.com"
0 issue "globalsign.com"
0 issue "letsencrypt.org"
0 issue "pki.goog"
```

Amazon is not on that list. ACM asked for permission and was refused. The zone apex has no CAA records at all — the entire restriction was inherited through the alias.

**Fix.** Deployed to `aws-squared.sameerchohan.com`, a sibling name rather than a child, whose CAA path is unrestricted all the way to the root. The certificate issued in under a minute. The alternative — adding `amazon.com` to CAA — is not available: a name that is a CNAME cannot carry its own records, and the CAA being served is not ours to edit.

**Lesson.** Delegating a hostname to a platform delegates more than traffic. Vercel's certificate policy became ours the moment we pointed a name at them, and it applies to anything that name aliases.

---

## 17. A single em dash aborted the first apply

**Symptom.** `terraform apply` failed after creating 48 of 53 resources.

```
InvalidParameterValue: Value (RDS Postgres — reachable only from application
tasks) for parameter GroupDescription is invalid. Character sets beyond ASCII
are not supported.
```

**Diagnosis.** EC2 rejects any character outside ASCII in a security group description. This repository uses em dashes freely in prose and comments, and one had made it into a resource argument that reaches an API.

Nothing upstream could catch it. The value is valid HCL, the provider does not constrain it, and the API is not consulted until the resource is created.

The failure also lands badly. `aws_db_instance` depends on this security group, so RDS was never created; the ECS service then sat at zero running tasks waiting for a `DATABASE_URL` secret version that did not exist. **The reported error was about punctuation and the visible symptom was a service that would not start.**

**Fix.** Plain punctuation, with a comment above the resource explaining why — because the surrounding style would otherwise reintroduce it on the next edit. Only this one description reached an EC2 API; the em dashes in `outputs.tf` and `variables.tf` never leave Terraform, and the two in `secrets.tf` go to Secrets Manager, which accepts UTF-8.

**Lesson.** When a partial apply fails, read the first error, not the loudest symptom. Everything downstream of a failed resource fails for reasons that have nothing to do with the cause.

---

## 18. Backup retention exceeded a Free-plan account's entitlement

**Symptom.** The next apply failed on `CreateDBInstance`.

```
FreeTierRestrictionError: The specified backup retention period exceeds the
maximum available to free tier customers.
```

**Diagnosis.** Seven days of automated backups is correct for a database holding payment records, and it is what the stack asked for. AWS accounts on the Free plan cannot have it. The entitlement is attached to the account's support plan and evaluated only at creation, so the plan output is byte-identical on an account that can create this database and one that cannot.

**Fix.** `backup_retention_days`, still defaulting to **7**. Lowering the default would have quietly downgraded the production configuration to suit one restricted account; instead the restricted account opts down in its own tfvars, alongside `use_nat_gateway` and `enable_performance_insights`, which exist for the same reason.

**Lesson.** A plan validates a configuration against an API. It does not validate it against your billing relationship.

---

## 19. RDS's certificate authority is not in Node's trust store

**Symptom.** Migrations failed against real RDS.

```
Error: self-signed certificate in certificate chain
code: 'SELF_SIGNED_CERT_IN_CHAIN'
```

**Diagnosis.** Three call sites carried the same comment and the same wrong assumption: *"RDS requires TLS; the bundled CA set validates it."*

It does not. RDS presents a certificate chaining to `Amazon RDS <region> Root CA RSA2048 G1` — a private Amazon root, not present in the Mozilla CA bundle Node ships with. `rejectUnauthorized: true` was correctly rejecting a perfectly valid certificate.

This blocked far more than migrations. The application pool is configured identically, and `/api/health` runs `SELECT 1`, so every task would have failed its health check and the service would never have reached a healthy target. The stack would have looked like a networking problem.

**Fix.** Amazon's global RDS trust bundle is committed to the repository, copied into the image, and referenced by `NODE_EXTRA_CA_CERTS` from both task definitions. That variable **adds** roots to Node's defaults rather than replacing them, so verification stays fully on. The bundle is committed rather than downloaded during the build so images stay reproducible.

The tempting fix — `rejectUnauthorized: false` — would have converted a certificate error into no certificate checking at all, on the connection carrying the database credentials. It would also have worked, which is what makes it dangerous.

**Lesson.** "TLS fails" and "TLS is misconfigured" are not the same finding. Read which check failed before deciding what to relax, because the fastest way to make a certificate error disappear is to stop checking certificates.

---

## 20. The stack had never actually converged

**Symptom.** With everything deployed and serving traffic, `terraform plan` still reported a change: the database parameter group, removing and re-adding an identical `rds.force_ssl` parameter. Applying it changed nothing. The next plan reported it again.

**Diagnosis.** `rds.force_ssl` is a **static** parameter. RDS applies it only on reboot and reports it back with `apply_method: "pending-reboot"`. The block declared no `apply_method`, so the provider supplied its default of `"immediate"`, which can never match what AWS returns. A permanent diff, invisible until something was actually deployed to diff against.

**Fix.** Declared explicitly. `terraform plan` now reports **No changes**.

**Lesson.** A clean plan against nothing proves nothing. Convergence — the code and the running infrastructure agreeing — is a stronger claim than creation, and it is only observable after an apply.

---

## 21. The teardown instructions described behaviour the code did not implement

**Symptom.** Caught during the pre-teardown audit, before running `destroy`.

**Diagnosis.** `infra/README.md` stated that the ECR repository, its images, and the budget alarm survive a `terraform destroy`. All three were in the application stack's state with no `prevent_destroy` and no separate lifecycle, so `destroy` would have deleted every one of them.

Worse, it would have **failed while doing it**. `aws_ecr_repository` has no `force_delete`, and the repository held images, so the teardown would have aborted partway through with `RepositoryNotEmptyException` — leaving a half-destroyed stack still billing.

**Fix.** Documentation corrected to describe what the code does. The three resources were removed from state before the destroy so they genuinely survived, which is what the README had promised. The real fix is architectural and is recorded as such: resources whose lifecycle differs from the application stack belong in a separate state file, exactly as `infra/bootstrap/` already does for the OIDC provider and CI role.

**Lesson.** Teardown is a code path. It had been written, documented, and never executed — and it was wrong in both directions at once: it claimed resources would survive that would not, and it would have crashed before proving either way.
