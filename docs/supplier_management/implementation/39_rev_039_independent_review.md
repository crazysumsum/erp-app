# REV-039 — TASK-034 Bank API independent review

**Review:** REV-039 ・**Task:** TASK-034 (T34) ・**Phase:** PHASE-003 ・**Capability:** SUP-CAP-03
**Head reviewed:** `64ef1fc94346a930f516f4ddc0c5c3dc0a88dccd` (`claude/supplier-task-034`, PR #123)
**Worktree:** `/Users/sam/Documents/workspace/erp-app-worktrees/supplier-task-034`
**Reviewer:** independent agent (`agent-skills:security-auditor`); not the author.
**Design baseline as computed at this head:** `77ab26aa3d4ca6037416ffdc37c1c3f7c0e7c89504515f87e1291c621bc3d061`
(**not** the `e4083319…` the state file records — see H-1)

**Verdict: CHANGES_REQUESTED** — 2 High, 3 Medium, 4 Low.

The HTTP surface itself is solid. Every attack I aimed at the data boundary failed, and
several of them failed structurally rather than by luck. What did not hold is the
**baseline bookkeeping around** the change: one line in the manifest moved the DESIGN
baseline as well as the PLAN baseline, and neither the state file nor the two `-FINAL`
approval records notices. The harness reports `BLOCKED` on this head.

---

## Summary

| | |
| --- | --- |
| Critical | 0 |
| **High** | **2** — both from the second, manifest-driven baseline move |
| **Medium** | **3** — one unmet acceptance criterion, two non-discriminating tests |
| Low | 4 |
| Note | 6 positives, recorded because they were attacked and held |

CI: verified independently. `gh run list --commit 64ef1fc9…` returns exactly one run,
`35579664129`, `conclusion: success`, and `gh pr checks 123` shows all four checks green
(Lint, Build frontend, Dependency audit, Test + MySQL integration). No rerun. The author's
claim is accurate.

Everything below states what I ran. Anything I reasoned about but did not execute is
marked **PLAUSIBLE**. Every mutation was reverted immediately and
`git status --porcelain` was empty before and after; the head never moved.

---

## Findings

### [HIGH] H-1 — The manifest edit moved the DESIGN baseline too; the state file still records the old one, and two approval records assert the opposite

**Location:**
- `docs/supplier_management/00_module_manifest.json:48` (`scope.approval_required_paths`, `.github/workflows/ci.yml` added)
- `docs/supplier_management/00_harness_state.json:11` (`baseline.design`)
- `docs/supplier_management/00_harness_state.json` — `APPROVAL-HD-031-PLAN-FINAL.source_ref`
- `docs/supplier_management/implementation/38_task_034_bank_api.md:88`

**What is wrong.** The harness computes the DESIGN baseline as

```
design = digest({module_id, requirements sha, design sha, scope, contracts, risk})
```

(`~/.claude/skills/software-engineering-harness/scripts/harness_core.py:301-307`). `scope`
is the **manifest's** `scope` object, and `approval_required_paths` lives inside it.
Declaring `.github/workflows/ci.yml` there therefore moved the DESIGN baseline, not only
the PLAN baseline.

The report says the opposite — "Review 綁 design hash，唔受影響" (§6) — and
`APPROVAL-HD-031-PLAN-FINAL` states in its own `source_ref`: *"No requirement, design,
phase, task, suite, test flag or suite argv changed."* Both are false as recorded.

**What I ran.**

```
# on this head
python3 harness_core → Context('docs/supplier_management','.').baselines()
  computed design: 77ab26aa3d4ca6037416ffdc37c1c3f7c0e7c89504515f87e1291c621bc3d061
  recorded design: e4083319e526682f70b40a0b2676ae5b50cc72d8f03e9e07c6d6fbb671f211e4   MISMATCH
  computed plan  : f701e9b041707cd6ce0f2911f1090d1e4b387e067f1c90fb2fb212267025f467
  recorded plan  : f701e9b041707cd6ce0f2911f1090d1e4b387e067f1c90fb2fb212267025f467   match

# same computation on main (71616ec) as a negative control
  MAIN computed design == MAIN recorded design   (e4083319…)   match
  MAIN computed plan   == MAIN recorded plan     (a0d41e31…)   match
```

Isolated to the single cause — recomputing the design digest with `main`'s `scope` and
everything else from this head reproduces `e4083319…` exactly, and the only manifest key
that differs between `main` and this head is `scope`:

```
design with HEAD scope : 77ab26aa…
design with main scope : e4083319…
only difference in manifest: ['scope']
```

And the harness's own gate:

```
python3 state_tool.py inspect docs/supplier_management --repo-root . --json
  status: BLOCKED
   - BASELINE_STALE | state/baseline/design | reconcile; reapprove/retest affected work before proceeding
   - COMMIT_CHANGED | state/baseline/code_commit
   - SOURCE_CHANGED | state/baseline/source_fingerprint
```

(`COMMIT_CHANGED`/`SOURCE_CHANGED` are the ordinary merge-commit artefacts — the state
checkpoints `dd3b298` while HEAD is the merge `64ef1fc`. `BASELINE_STALE` on
`state/baseline/design` is not ordinary and is not recorded anywhere.)

**Why it matters.** `harness_checks.py:276-289` filters reviews with
`if r['reviewed_baseline'] != design_sha: continue`, where `design_sha = ctx.baselines()['design']`
— recomputed, not read from the state. At this head:

- **38 of 38 reviews** fail that comparison (28 of them bind to `e4083319…`, the rest to
  earlier design hashes). `good_reviews` is empty, so the module raises
  `REVIEW_NOT_SATISFIED` — REV-032 through REV-038 no longer count, including the REV-038
  APPROVED that gated the previous merge.
- `APPROVAL-HD-017-DESIGN` was the only DESIGN-kind approval bound to `e4083319…`;
  `approval_valid()` (`harness_core.py:334`) recomputes the same way, so it now fails, and
  no other DESIGN approval matches `77ab26aa…` → `APPROVAL_MISSING_STALE` for DESIGN.

This is precisely the failure class the module already knows about — a manifest edit
strands baseline-bound records in more than one class at once. HD-031 quantified the cost
of the **first** move (profile → PLAN) and the Product Owner chose it with that number in
front of them. The **second** move was presented to them as mechanical and design-neutral.
It was not: it silently invalidated every review in the module.

**Fix.** Either reconcile and re-record, or avoid the move:

1. Update `state.baseline.design` to `77ab26aa3d4ca6037416ffdc37c1c3f7c0e7c89504515f87e1291c621bc3d061`
   and record an observation that quantifies the second move the way HD-031 quantified the
   first: 38 reviews and `APPROVAL-HD-017-DESIGN` stranded, in addition to the PLAN-side
   count already recorded.
2. Re-bind `APPROVAL-HD-017-DESIGN` to the new design hash the way HD-030/HD-031 were
   re-bound, retaining the original unrewritten, and record REV-039 against `77ab26aa…`.
3. Correct the `source_ref` on `APPROVAL-HD-031-PLAN-FINAL`: it asserts the design did not
   change, and a human decision record that misstates its own consequence is worse than
   no record.

Alternative, if the Product Owner would rather not move the design baseline at all: the
boundary gate passes because `APPROVAL-HD-030-SCOPE-FINAL` is a valid SCOPE approval for
`.github/workflows/ci.yml` — I confirmed that below — so the question of whether the path
*also* needs to be listed in `approval_required_paths` is worth re-asking before paying
this cost.

---

### [HIGH] H-2 — The four evidence runs this PR commits are already invalid against the current PLAN baseline

**Location:** `docs/supplier_management/evidence/20260921T0844*/run.json` (`spec_baseline`),
listed in `00_harness_state.json` `evidence_files`, cited as the self-test evidence in
`38_task_034_bank_api.md:99-106`.

**What is wrong.** All four run.json files carry
`spec_baseline: "db5296785c7f74a5925e8f0f4e7edecb3ef4fa48f26fdcd33ffe4d7e0b95e087"` — the
**intermediate** PLAN hash, after the profile edit but before the manifest edit. The
current PLAN baseline is `f701e9b0…`. The approvals were re-bound with `-FINAL` records
when the hash moved the second time; the evidence was not re-run.

**What I ran.**

```
python3 → json.load(evidence/20260921T084400-a77f159e6e84/run.json)['spec_baseline']
  db5296785c7f74a5925e8f0f4e7edecb3ef4fa48f26fdcd33ffe4d7e0b95e087
computed plan baseline at this head
  f701e9b041707cd6ce0f2911f1090d1e4b387e067f1c90fb2fb212267025f467
```

Same value in all four directories. The three new observations added in `675c1cc` carry
the same stale `spec_baseline`.

**Why it matters.** `harness_checks.py:151` sets `baseline = ctx.baselines()['plan']` and
`:160` raises on `evidence['spec_baseline'] != baseline`; the coverage gate at `:353`
counts an evidence row only when `e['spec_baseline'] == ctx.baselines()['plan']`. So T34
currently ships **zero valid developer evidence** while the implementation report presents
a four-row PASS table. The suites really did pass — I re-ran them, green, 24/24 — but
nothing in the ledger can be used to say so.

**Fix.** Re-run the four suites through `run_check` at the current baseline and replace the
evidence references, or record an observation stating plainly that the four runs predate
the second baseline move and what was done about it. Do not leave a PASS table in the
report pointing at rows the gate rejects.

---

### [MEDIUM] M-1 — `Cache-Control: private` never reaches the wire; the check that replaced the manual header check cannot see it

**Location:**
- `server/src/handlers/suppliers/supplierBankHandlers.js:203`
- `server/src/framework/http/apiResponse.js:21` (and `:46` on the error path)
- `server/test/supplierBankHandlers.test.js:177-194`

**What is wrong.** The reveal handler sets `Cache-Control: no-store, private` inside
`execute`. `BaseRequestHandler.handle` then calls `sendSuccess`, whose first statement is
`res.setHeader("Cache-Control", "no-store")`. `setHeader` replaces; it does not append. The
`private` token is destroyed before the response is written. `sendError` does the same on
every error path.

T34's acceptance criteria name the value explicitly:
*"Manual header check：reveal 含 `Cache-Control: no-store, private` 及 `Pragma: no-cache`"*
(`05_development_tasks.md`, T34 Verification). The criterion is not met.

The test that replaced the manual check calls `handler.execute(...)` directly with a fake
`res`, so it observes the handler's intent and stops one call short of the overwrite. It
passes on a response that does not have the header it asserts.

**What I ran.** Two levels, both on the unmodified head.

1. Driving the real `BaseRequestHandler.handle` path with a stub `res`
   (scratchpad script, no repo files touched):

```
headers after full handle(): {"Cache-Control":"no-store","Pragma":"no-cache"}
```

2. Over real HTTP, a genuine 200 reveal (probe test appended to the integration file, then
   reverted). Headers read off the `fetch` Response:

```
PROBE reveal(view+bank.view) : 200 | Cache-Control: "no-store" | Pragma: "no-cache"
```

The same value appears on the 422 error path, for the same reason.

**Why it matters.** The *security* delta is small and I will not overstate it: `no-store`
already forbids any cache, shared or private, from storing the response, so a compliant
intermediary behaves identically. What actually matters here is that an explicit
acceptance criterion is unmet, and that the automated check written specifically to stop
a human check from being skipped **cannot fail** if the header is wrong — the same defect
class this module has repeatedly found in itself.

**Fix.** Assert the header on the response, not on the handler. In the integration test,
after a successful reveal:

```js
assert.equal(revealed.headers.get("cache-control"), "no-store, private");
assert.equal(revealed.headers.get("pragma"), "no-cache");
```

and then make it pass — either have `sendSuccess`/`sendError` not clobber an
already-narrower `Cache-Control`, or set the header after the framework does. If the team
concludes `private` adds nothing over `no-store`, that is a legitimate answer, but then the
acceptance criterion and the handler comment should be changed rather than left asserting
something untrue.

---

### [MEDIUM] M-2 — The new HTTP test's 403 does not distinguish "authenticated, not authorised" from "wrong password" (surviving mutation)

**Location:** `server/test/integration/supplierBank.integration.test.js:558-566`

**What is wrong.** The test asserts only `revealed.status === 403`. On this route,
`jwt-password` runs `assertPasswordConfirmed` **before** the authorization policy, and a
rejected password is *also* a 403 (`passwordReauth.js:71-76` — deliberately 403 and not
401, for good reasons stated there). So the assertion cannot tell apart the two outcomes.

The comment above it makes exactly the claim the assertion cannot support:
*"用真密碼 hash，所以佢證到嘅係「過到密碼再確認，但冇資格」，唔係死喺密碼比對度"*.

**Mutation, and the green run.** I changed only the password the test sends:

```js
-    body: JSON.stringify({ reason: "冇權限測試原因", password: PASSWORD })
+    body: JSON.stringify({ reason: "冇權限測試原因", password: "REV-039-MUTANT-WRONG-PASSWORD" })
```

Result:

```
MUTANT: reveal rejected with {"code":"PASSWORD_INVALID","message":"Please confirm your current password"}
✔ the Bank routes answer over real HTTP, and the masked list leaks nothing (706.918292ms)
```

Green, on a request that never reached the authorization layer. The whole apparatus of
seeding a real user with a real scrypt hash is doing no work that the assertion can see.
Mutation reverted; `git status --porcelain` empty afterwards.

**Fix.** One line:

```js
assert.equal(revealed.body.error.code, "Forbidden",
  "must be the authorization layer, not the password comparison");
```

I confirmed over the wire that the two are distinguishable: a caller with
`supplier.view + supplier.bank.mgmt` and the *correct* password gets
`403 {"code":"Forbidden"}`, while the correct permissions with a wrong password give
`403 {"code":"PASSWORD_INVALID"}`.

---

### [MEDIUM] M-3 — No test exercises a successful reveal or any write over HTTP, so AC-024/025/026 have no coverage at the layer T34 introduces

**Location:** `server/test/integration/supplierBank.integration.test.js:461-566`

**What is wrong.** The new HTTP test covers three things: 401 without a token, 200 on the
masked list with the body swept for leaks, and a 403 on reveal. Every one is a *denial* or
a *read*. T34's traceability names AC-024 (reveal succeeds and is audited), AC-025 (a
caller without `bank.mgmt` is refused and the data is unchanged) and AC-026 (default
switch), and none of them crosses the wire in any test.

This is not a theoretical gap — it is the direct cause of M-1. A test that performed one
successful reveal and read the response headers would have found the `private` overwrite
immediately.

AC-025 in particular cannot be reached over HTTP today without a device-bound client: I
tried, and a caller holding two of the three write permissions is refused at
`400 DEVICE_SIGNATURE_REQUIRED` by the auth strategy, before the authorization policy runs.
So the permission matrix on the write routes is enforced by (a) the static metadata, which
`supplierBankHandlers.test.js` pins declaratively, and (b) `SupplierBankService.#assertMay`
re-checking `supplier.bank.mgmt` against the database inside the transaction. Both are
real; neither is an HTTP-layer test.

**What I ran.** The probe in M-1/M-2 performed a real 200 reveal (body keys exactly
`['id','accountNumber','revealedAt']`, the plaintext present), which is the assertion that
is missing from the committed suite.

**Fix.** Extend the HTTP test with a second principal holding `supplier.view + supplier.bank.view`,
assert the 200 reveal returns only the three declared fields, assert the cache headers on
that response (M-1), and assert the `supplier.bank.reveal` audit row exists. If driving a
device-signed write from a test is genuinely out of reach, say so in the report as a
recorded limitation rather than leaving AC-025/026 silently uncovered at this layer.

---

### [LOW] L-1 — The "structural" response defence is one config flag deep, and nothing in this module pins it

**Location:** `server/config/request.js` (`validation.output.enabled`, `validateInProduction`),
`server/src/framework/validation/responseValidator.js:82`

The schemas' central claim — *"就算 service 有一日多回一個欄位，response validation 都會
攔住佢 … 呢個係結構性防線"* — is true today, and I proved it (see N-1). But
`ResponseValidator.compile` returns a closure whose first statement is
`if (!this.config.runtimeEnabled) return;`. Set `validation.output.enabled: false`, or
`validateInProduction: false` in production, and every masked Bank response silently
becomes a pass-through of whatever the service returns. `server/test/configNormalizers.test.js:445-472`
tests the *normalizer's* behaviour; nothing asserts that the shipped config has the flag on.

**Fix.** One assertion in `supplierBankHandlers.test.js`, next to the schema assertions
that lean on it:

```js
import requestConfig from "../config/request.js";
assert.equal(requestConfig.validation.output.enabled, true);
assert.equal(requestConfig.validation.output.validateInProduction, true);
```

---

### [LOW] L-2 — `command(req)` spreads the request body last, over `requestId`, `ip` and the actor

**Location:** `server/src/handlers/suppliers/supplierBankHandlers.js:48-62`

`...req.input.body` is the last spread, so a body property named `requestId`, `ip`,
`actorId`, `supplierId`, `bankAccountId` or `claimedPermissions` would overwrite the
framework-derived value on its way into the audit record and the service's own
authorization input. Today nothing can: every Bank body schema is
`additionalProperties: false` and declares none of those names, and I confirmed over the
wire that an undeclared field is refused with `400 REQUEST_VALIDATION_FAILED`. So this is a
latent hazard, not a live hole.

It is the module's convention (`supplierAddressHandlers.js:80`, `supplierContactHandlers.js:77`,
`supplierIdentifierHandlers.js:76` all do the same), so I am not asking for a refactor —
but note that `supplierApprovalWithdrawHandler.js:48` already writes
`const { requestId, ...body } = req.input.body;`, which means somebody in this codebase has
already been bitten by exactly this. On the route that writes the bank audit trail, put
`...req.input.body` first and the trusted fields after it.

---

### [LOW] L-3 — Two suites got the secrets in `redaction_env_keys` but no `env_keys`

**Location:** `docs/supplier_management/00_project_profile.json` — suites
`supplier-client-ui` and `supplier-uat-browser`.

Structural diff of the profile against `main`, per suite:

| suite | bank vars in `env_keys` | secrets in `redaction_env_keys` |
| --- | --- | --- |
| lint, client-build, supplier-phase-001-client | no | no |
| supplier-phase-001-server, supplier-server-integration, supplier-bank-security, supplier-security, supplier-performance, supplier-resilience, supplier-recovery, supplier-release-operations | yes | yes |
| **supplier-client-ui, supplier-uat-browser** | **no** | **yes** |

`harness_runner.py:146` forwards only what a suite lists in `env_keys`, so those two suites
will never see the variables their `redaction_env_keys` claims to redact. Harmless today —
I checked `client/e2e/supplier-management/playwright.config.js` and its `webServer` starts
only the Vite client on :5203, and the existing e2e specs `page.route`-mock the API, so no
browser suite boots the Node application. It stops being harmless the moment a Bank UAT
(T35) needs a real API server: that suite will fail closed at startup and the profile will
look as though it was already provisioned.

**Fix.** Either drop the two redaction entries, or add the four `env_keys` now and say in
the report which of the two you chose and why.

---

### [LOW] L-4 — The `expiresInSeconds` deviation lives only in the implementation report

**Location:** `docs/supplier_management/implementation/38_task_034_bank_api.md:74-78`,
`server/src/handlers/suppliers/supplierBankSchemas.js:185-189`

Design §6.6's reveal example carries `expiresInSeconds: 30`; the implementation omits it,
and the reasoning given is good — a number that implies server-side expiry when no
server-side state exists is worse than no number. I agree with the decision.

But it is recorded in a narrative document only. There is no observation, defect or
deviation record in `00_harness_state.json`, so nothing that reads the ledger or the
traceability matrix knows that FR-BANK-006's design shape was not implemented as written.
The next person to diff design §6.6 against the code will re-derive this from scratch.

**Fix.** Add a `MANUAL_TEST`/deviation observation naming design §6.6, the omitted field
and the reasoning, the same way the fail-closed verification and the `password` bug were
recorded.

---

## Attacks that failed

These are the ones I expected to produce findings and did not. Recorded because a review
that only lists what broke tells you nothing about what was actually tested.

### N-1 — The response-schema boundary is genuinely structural, and it holds over real HTTP

The claim was that a masked response cannot name an account even if the service starts
returning one. I tested it by **making the service return one** rather than by reading the
schemas.

Mutation in `server/src/modules/supplier/supplierProjections.js` (`toMaskedBankResponse`):

```js
     maskedAccountNumber,
+    lastFour: row.last_four,
+    accountNumber: "LEAKED-PLAINTEXT",
     status: row.status,
```

Real-HTTP result:

```
✖ the Bank routes answer over real HTTP, and the masked list leaks nothing
  AssertionError: {"success":false,"error":{"code":"INTERNAL_SERVER_ERROR",
                   "message":"Internal server error"}, "meta":{...}}
    actual: 500, expected: 200
```

Three things at once: the leak is refused rather than stripped
(`ResponseValidator` runs with `removeAdditional: false`, so an undeclared field is a hard
`ResponseValidationError` → 500); the public body carries no `details`, so the field names
that failed validation do not cross the wire either; and the committed integration test
**does** discriminate here — it fails the moment the projection starts leaking. Mutation
reverted.

### N-2 — Error paths, validation details and request logging carry no account and no crypto metadata

Over the wire, on the unmodified head:

| path | result |
| --- | --- |
| undeclared body field | `400 REQUEST_VALIDATION_FAILED`, details = `[{location:"body", path:"/", keyword:"additionalProperties", message:"must NOT have additional properties"}]` — field names only, never values (AJV does not embed data in messages, and `params` is not serialised) |
| wrong password | `403 PASSWORD_INVALID`, generic message |
| missing password | `400 PASSWORD_REQUIRED` |
| wrong supplier id (IDOR) | `404 SUPPLIER_BANK_NOT_FOUND` — not 403, not 200 |
| undecryptable row | `422 BANK_ACCOUNT_UNREADABLE`; system log carries `{bankAccountId, supplierId, reason}` and no ciphertext or key — I read the actual line out of `logs/system/system-2026-09-21.log` |
| response-validation 500 | generic `INTERNAL_SERVER_ERROR`, no `details` |

Request logging: `config/logging.js` sets `bodyCapture: "none"` and
`bodyCaptureErrorStatus: 500`, and the Bank routes do not override `logging`, so 4xx never
captures a body — which is exactly where the user-typed account number would be. I read
the four reveal entries out of `logs/requests-2026-09-21.log` after the probe run:

```
400 | req.body= "[NOT_LOGGED]" | res.body= "[NOT_LOGGED]"
400 | req.body= "[NOT_LOGGED]" | res.body= "[NOT_LOGGED]"
200 | req.body= "[NOT_LOGGED]" | res.body= "[NOT_LOGGED]"
404 | req.body= "[NOT_LOGGED]" | res.body= "[NOT_LOGGED]"
```

And for the ≥500 case where the body *is* captured, `redactValue` masks recursively:

```
{"accountHolderName":"ACME","accountNumber":"[REDACTED]","password":"[REDACTED]",
 "reason":"x","nested":{"accountNumber":"[REDACTED]"},"arr":[{"password":"[REDACTED]"}]}
```

`accountNumber` and `password` are in `redactedFields` for both the request and the system
logger.

**On the duplicate warning.** `SupplierBankService.#duplicates` gates the other Supplier's
code on `actor.permissions.includes("supplier.view")`, read from the database, not from the
JWT. Over HTTP that branch is unreachable — every write policy already requires
`supplier.view` — so the real gate is the route policy and the service check is
defence-in-depth for non-HTTP callers (import). Correct, but note it is therefore untested
on the HTTP path. The warning is a deliberate cross-Supplier enumeration oracle (design
§6.6 authorises it, "供人工判斷"); the caller who can use it already holds
`bank.mgmt` plus an approved device plus the current password, which is a high enough bar
that I am not raising it as a finding.

### N-3 — The auth matrix matches design §6.6 and is enforced by code, not only by metadata

Design §6.6 gives: list = `jwt`/`supplier.view`; the four writes =
`jwt-device-password`/`view+bank.view+bank.mgmt`; reveal =
`jwt-password`/`view+bank.view`. The static metadata matches exactly, including reveal
deliberately **not** requiring `bank.mgmt`. §7.4 is the create/detail editor section and
says nothing about permissions; §7.5 (Bank UX) is consistent with the implementation.

Enforcement, not declaration:

- `authorizationPolicyRegistry.authorize` runs every policy and throws `AuthorizationError`
  (403) on anything that is not `=== true`; `hasPermission` defaults to `match: "all"`.
- Reveal with `supplier.view + supplier.bank.mgmt` and the correct password →
  `403 {"code":"Forbidden"}` over real HTTP. **bank.mgmt does not buy reveal.**
- `SupplierBankService.authorize` = `assertActorFresh`, which re-reads the actor's roles and
  permissions from the database and compares them to the JWT claims
  (`directoryLookups.js:50`), then `#assertMay` re-checks the specific permission. So a
  stale or forged claim set does not survive the service layer either. That second layer is
  narrower than the route policy (it checks `bank.mgmt` on writes and `bank.view` on
  reveal, not all three), which is fine — the route policy is the wider gate.
- Trying to reach a write with two of the three permissions is refused at
  `400 DEVICE_SIGNATURE_REQUIRED` before authorization runs, so I could not isolate that
  case over the wire (see M-3).

### N-4 — The `password` fix is complete, and nothing else is read off the request outside schema validation

`passwordReauth.js:30` reads `req.body?.password` before `validateRequest` runs, so the
original omission would have killed all five step-up routes on `additionalProperties: false`.
All five schemas now declare it and require it, and
`supplierBankHandlers.test.js:122-135` pins name, type and `maxLength` on each.

I went looking for the same class of defect elsewhere in the diff by enumerating every
place the framework touches a request before or outside schema validation:

```
grep -rn "req\.body|req\.get\(|req\.headers\[" server/src/framework server/src/services/{idempotency,auth,deviceBinding}
```

Result: `passwordReauth.js:30` is the **only** body read. Everything else is a header —
`jwtAuthStrategy` (Authorization), `deviceSignatureRequest` (five `X-Device-*` headers),
`IdempotencyService` (`Idempotency-Key`), `securityMiddleware` (`X-Forwarded-For`),
`uploadMiddleware` (Content-Type/Length) — plus `req.rawBody`, which the device signature
hashes as opaque bytes. None of them needs a schema declaration.

Idempotency specifically: the Bank routes inherit `idempotency.enabled: false` from
`config/api.js`, so the header is never read. I verified this by sending
`Idempotency-Key: probe-key` on a reveal — same `200`, no change in behaviour, no
validation error. Nothing to declare.

### N-5 — Fail-closed reproduced, and every malformed key ring is refused without leaking material

Reproduced the author's check by removing the four variables and running the HTTP
integration test:

```
✖ the Bank routes answer over real HTTP, and the masked list leaks nothing
  TypeError: SupplierBankCrypto requires both the bankEncryption and bankLookup key rings
```

The throw is inside `createApplication`, not inside a route — the application does not
start. `handlerRegistry.js:76` constructs every handler eagerly (`new HandlerClass(services)`),
and `SupplierBankHandler`'s constructor has no fallback, which is what design §1700
demands and explicitly requires over the alternative of disabling the bank endpoints.
There is no half-initialised path: the handler either constructs with both rings or the
registry build throws.

Then the malformed cases, which the author did not test. All seven refused, none leaking:

| input | result |
| --- | --- |
| non-canonical base64 | `Supplier config "bankEncryption.keyRing.e1" must decode to exactly 32 bytes` |
| 16-byte key | same message |
| `activeKeyId` absent from ring | `Supplier config "bankEncryption.activeKeyId" must exist in its keyRing` |
| only the encryption ring configured | `Supplier config must provide both bankEncryption and bankLookup key rings` |
| `activeKeyId` set, `keyRing` missing | `Supplier config "bankEncryption.keyRing" must be a valid JSON object` |
| `keyRing` not JSON | same message |
| neither ring | `SupplierBankCrypto requires both the bankEncryption and bankLookup key rings` |

No message or stack contained the key material in any case. Better: `SecretValue` refuses
coercion outright —

```
TypeError: Supplier bankEncryption key e1 is a SecretValue and cannot be coerced to a
string. Call reveal() where the value is genuinely needed.
```

— and printing the whole normalised config through `util.inspect` or `JSON.stringify`
yields `[REDACTED]` for every key.

### N-6 — The evidence really is clean, and the PLAN baseline the `-FINAL` approvals bind to really is the current one

Swept the four new evidence directories independently of the author's sweep, with a pattern
that cannot match the empty string:

```
grep -rEoh '[A-Za-z0-9+/]{43}=' 20260921T0844*      → no matches
grep -rF <the two CI key literals> 20260921T0844*   → no matches
grep -rl "SUPPLIER_BANK" 20260921T0844*             → no matches
```

Extending the same sweep to **every file this PR touches**, the only 44-character base64
values in the entire diff are the two intentional CI keys in `.github/workflows/ci.yml`.
`run.json` records no environment block at all, so there was never a channel for the values
to arrive by; the `redaction_env_keys` addition guards `redact(stdout+stderr, …)`
(`harness_runner.py:154`) against a future test that prints one, which is the right place
for it.

**On the ci.yml keys**: I do not disagree with the author. Design §1700 says
*"開發／測試不得提交固定production key。Test直接inject固定fake key"* — committing generated
test-only keys is the sanctioned option, HD-030 approved it by name, and the two values
protect nothing but a throwaway CI database. I would only add: they should never be copied
into a `.env` anywhere, and if this repository ever becomes public they should be rotated
as hygiene rather than as incident response.

**Baseline binding, verified rather than read.** `APPROVAL-HD-031-PLAN-FINAL` and
`APPROVAL-HD-030-SCOPE-FINAL` both record
`baseline_sha256: f701e9b041707cd6ce0f2911f1090d1e4b387e067f1c90fb2fb212267025f467`, and I
recomputed the PLAN baseline from the worktree's manifest, profile, traceability and specs:
it is exactly that value. The superseded records are retained and unrewritten —
`APPROVAL-HD-031-PLAN` still at `db5296…`, `APPROVAL-HD-030-SCOPE` still at `a0d41e31…`.
`validate_module_boundary.py --base 71616ec` returns `LOCAL_CHECKS_PASS`, so the SCOPE
approval is doing its job for `.github/workflows/ci.yml`.

**The stranded-record count is exact.** Against the state as of `b0b63fb`:

| claimed | measured |
| --- | --- |
| 83 of 112 observations bound to `a0d41e31…` | **83 of 112** ✓ |
| 6 approvals, named | **exactly those 6** (HD-017 ×4, HD-027-SCHEMA, HD-030-SCOPE) ✓ |
| 78 evidence runs | `evidence_files` = 82 at HEAD − 4 new = **78** ✓ |

Every number in the ledger's account of the *first* baseline move is correct. What it does
not account for is the second one (H-1, H-2).

**The profile change is exactly what was claimed.** Structural comparison against `main`:
everything outside `suites` is byte-identical (`environment`, `permissions`,
`runtime_policy`, `ci`, `acceptance`, `evidence`, `schema_version`, `module_id` all
unchanged), suite count unchanged at 13, and within every suite the only keys that differ
are `env_keys` and `redaction_env_keys`. No `argv`, `stages`, `min_tests`, `max_skipped`,
`required_case_ids` or `tool_probes` moved. The manifest change is the single added path.

---

## Positive observations

- **The masked projection is enumerated in SQL, not filtered in JS.** `MASKED_COLUMNS`
  names its columns, so the ciphertext, IV, auth tag and blind index never leave MySQL on
  the list path. Combined with N-1, that is two independent barriers, and the outer one
  fails closed.
- **The reveal response can say exactly three things**, verified over the wire:
  `['id','accountNumber','revealedAt']`.
- **Two-layer authorization.** The route policy reads JWT claims; the service re-reads
  roles and permissions from the database inside the transaction and compares them to the
  claims. A forged or stale claim set does not reach the data.
- **`SecretValue` refuses string coercion.** This is the difference between "we remembered
  to redact" and "it cannot be printed", and it is why N-5's seven failure messages are all
  clean without anyone having to check each one.
- **The list route has no query schema at all**, so there is no flag anywhere on the widest
  route that could ask for plaintext (AC-023).
- **The author found a real bug by convention-checking rather than by testing, and said so**,
  including that the declarative tests were all green while every step-up route was broken.
  Likewise the false-positive leak sweep in §6 of the report. Both are the kind of thing
  that is easier to leave out than to write down.

---

## Recommendations

1. Fix H-1 and H-2 before merge. The module is `BLOCKED` by its own gate at this head, and
   a human decision record currently asserts something false about its own consequence.
2. Treat "a manifest edit moves both baselines" as a standing rule rather than a discovery.
   `scope`, `contracts` and `risk` feed the DESIGN digest; `manifest`, `profile`,
   `traceability` and the spec hashes feed the PLAN digest. The manifest is the only file
   in both. Any future edit to it should quantify both costs before the decision, the way
   HD-031 quantified one of them.
3. Make the HTTP test earn its place (M-1, M-2, M-3). It is the first layer in this module
   that runs dispatcher → handler → service → MySQL, and that is genuinely valuable — but
   right now it proves one thing well (the masked projection cannot leak) and two things
   only nominally.
4. Consider whether `.github/workflows/ci.yml` needed to be in `approval_required_paths` at
   all, given that `validate_module_boundary.py` already passes on the strength of
   `APPROVAL-HD-030-SCOPE-FINAL`. If it did not, the second baseline move — and everything
   in H-1 and H-2 — was avoidable.

---

## Review hygiene

- Every mutation was reverted immediately after its run. `git status --porcelain` was
  empty before the review, after every revert, and at the end.
- Head under review never changed: `64ef1fc94346a930f516f4ddc0c5c3dc0a88dccd` throughout.
- Scratch scripts were written to the session scratchpad outside the repository. The only
  files I wrote inside the repository were the two temporary probes appended to
  `server/test/integration/supplierBank.integration.test.js` and the one-line mutation to
  `server/src/modules/supplier/supplierProjections.js`, all reverted with
  `git checkout --`, plus this report.
- Final confirmation run of the three suites named in T34's Verification section:
  **24/24 pass, 0 fail**, tree clean.
- Nothing was fixed. Every finding above is a description and a proposed fix, not an edit.
