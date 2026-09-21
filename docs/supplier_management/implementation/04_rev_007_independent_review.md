# Supplier Management — REV-007 Independent Review of PR #106

## Decision

`CHANGES_REQUESTED`

| Severity | Open findings |
| --- | ---: |
| Critical | 0 |
| High | 0 |
| Medium | 1 |
| Low | 2 (plus observations) |

The reviewer confirmed both defect fixes are correct, the `origin/main` merge is provably inert, and the author's rejection of the `REV-006` secondary finding is right. The single Medium is a gap in the author's own test coverage, not in the product fix.

## Provenance

| Item | Value |
| --- | --- |
| Reviewer | `agent-skills:code-reviewer` (separate-agent instance, fresh context, read-only) |
| Author | Claude Opus 5, the DEF-001/DEF-002 remediation |
| Method | `SEPARATE_AGENT` |
| Reviewed candidate | PR #106 head `235c202` on `codex/supplier-defect-001-002` |
| Design baseline | `dcb74d3c781236860d85b4dc15e2efce4ea33b58b0ed9739241d2d2c8cd61445` |
| Authorization | `HD-011`; user message on 2026-09-16 authorizing the independent agent review |

The reviewer left the worktree unmodified (`git status --porcelain` empty) and performed its experiments on a disposable scratch copy.

## What the reviewer confirmed

- **DEF-001 fix is correct.** The premise was verified, not assumed: there is no `supplier_bank_accounts` table in PHASE-001 — migrations stop at `0034`, and `bankAccounts = []` in `supplierProjections.js:20` is a hardcoded default. Design §456 lists Bank among completeness warnings and §77 confirms a supplier may be Active without one, so deferring evaluation preserves the requirement rather than dropping it. `SupplierCompletenessBanner.vue` is purely server-driven with no hardcoded codes, so the fix is complete across the stack and leaves no dead client code.
- **DEF-002 fix is complete and the action set is exactly right.** The reviewer independently enumerated every `"supplier.*"` literal in `server/src` and every `#changeStatus` call site. `LIFECYCLE_ACTIONS` contains exactly the seven transition actions. `supplier.view` / `mgmt` / `approval` / `bank.*` / `settings` are permission names in `permissionCatalogue.js`, never audit actions — correctly absent. Excluding `supplier.delete` is correct for two independent reasons: it never goes through `#changeStatus`, and the row is gone afterwards so the replay branch is unreachable.
- Additional correctness checks the diff does not make obvious: the new query is strictly a narrowing, so it can never select a stale row over a fresher matching one and there is no path from a correct 409 to an incorrect 200; `ORDER BY id DESC` on the AUTO_INCREMENT PK is the right recency key where `occurred_at` could tie; the read runs inside the transaction already holding `SELECT … FOR UPDATE` on the supplier row, so no concurrent transition can interleave; `action` is `ascii_bin` and equality against the bound literals matches exactly; placeholders are generated `?` marks with no injection surface.
- **The merge is provably inert.** `git diff 681b3ae^2 681b3ae` is exactly the branch's own 8 files, proving the merge commit introduced zero conflict-resolution edits and dropped nothing from `origin/main`. The one shared file PR #105 touched, `adminGuard.js`, only extracts a `permissionStaleError()` helper with a byte-identical error object. All 8 changed files fall inside `allowed_write_paths`.

## Adjudication of the REV-006 secondary finding — author was right

The reviewer reached this independently and stated it directly. `REV-006` asked for `assertExpectedVersion` to run before the replay `return`; the author refused, citing §476 and §1387. The reviewer agreed, on four grounds:

1. The opposing reading makes §476 clause 1 unreachable. A redelivered command by definition carries the version the client held at first send, and the first delivery bumped it — so *every* genuine replay is version-stale. A rule that cannot fire in its own designed scenario is not a plausible construction.
2. Clause 2's two error codes already map cleanly onto the non-replay path: `STATUS_TRANSITION_INVALID` for the contradictory command, `VERSION_CONFLICT` for the legal-but-outdated one via `assertExpectedVersion` and the `affectedRows === 0` check. Clause 2 is fully satisfied without touching the replay branch.
3. There is nothing for optimistic locking to protect — the replay branch performs no write, and `#changeStatus` returns the current supplier, so the stale version is repaired by the response rather than perpetuated.
4. The behavior is pinned by **two** pre-existing tests, not one: `supplierLifecycleService.test.js:85` and `supplierManagement.integration.test.js:298`, the latter against real MySQL. The author did not bend a test to fit the argument.

The reviewer noted the residual concern — distinguishing "my retry" from "a different actor's coincidentally identical command" — is real, but `assertExpectedVersion` cannot distinguish them either. The correct instrument is a request-scoped idempotency key, which design DES-007 already calls for. Recorded as an observation, not a finding.

## MEDIUM — the author's unit test could not detect the defect it was written for

`server/test/supplierLifecycleService.test.js:19-28`

The fake connection derived its filter from the implementation's own bound params (`params.slice(1)`) and never looked at the SQL text. It therefore modelled the *params*, and the params are not where DEF-002 lived.

**The reviewer demonstrated this rather than asserting it.** It applied a deliberately broken hybrid — `WHERE supplier_id = ? AND (action LIKE 'supplier.%' OR action IN (?,?,?,?,?,?,?))`, with the correct params still bound, which against real MySQL returns `supplier.address.update` and reproduces DEF-002 exactly — and **all 8 lifecycle unit tests passed**.

The integration suite did not close the gap either: the existing replay at `supplierManagement.integration.test.js:298` replays immediately after activate with no intervening non-lifecycle audit row, so it passed before the fix and does not discriminate it.

The author's claim in `03_def_001_002_remediation.md` that the fake "models the statement's bound action filter… so the test exercises the filtering rather than assuming it" **overstated what it does**. That claim was wrong and is corrected here.

### Resolution — applied

`server/test/integration/supplierManagement.integration.test.js` now inserts a `supplier.contact.create` audit row directly via `pool.query` between the activate and its replay, so the newest `supplier.%` row is non-lifecycle when replay detection runs. The expected audit-action sequence was updated to include it, and `replay.status` is now asserted alongside `replay.version`.

**The author reproduced the reviewer's experiment to confirm the new test actually discriminates:**

| Implementation | New integration test | Unit suite |
| --- | --- | --- |
| Correct `IN (...)` | 5/5 pass | 8/8 pass |
| Broken `LIKE … OR IN (...)` hybrid | **1 failure** | 8/8 pass |

The unit suite still cannot see the SQL — that is inherent to a fake — but the defect now has real-SQL regression coverage in a test that runs in CI.

## LOW findings — recorded, not fixed

### DEF-010 — bank flag uses the opposite absent-key convention from its siblings

`supplierValidation.js:68`. The three sibling flags treat an absent key as "missing" and warn; `hasBankAccount` treats an absent key as "not evaluable" and stays silent. That inverts the failure mode from noisy to silent.

Failure scenario: PHASE-003 wires `hasBankAccount` into `getSupplier` but forgets `getSupplierCompleteness`. The detail endpoint warns correctly, `/completeness` silently never does, the two disagree, and nothing fails. Under the sibling convention the same omission produces a spurious warning caught on the first test run. Recommended for the PHASE-003 task: make the flag required at all call sites, or add a dev-mode assertion.

### DEF-011 — `LIFECYCLE_ACTIONS` is a hand-maintained duplicate with no structural link

`SupplierAdminService.js:29-38`. The seven strings are defined 420 lines from the `action:` values they must mirror.

Failure scenario: PHASE-002 adds the approval transitions the state machine already permits (`supplierStateMachine.js:7-8`) as a new `#changeStatus` command and forgets to extend the constant. Submitting the same supplier for approval twice then throws 409 instead of the §476 idempotent 200, silently. Suggested one-line guard at the top of `#changeStatus`: `if (!LIFECYCLE_ACTIONS.includes(action)) throw new Error(...)`.

## Observations, no change requested

- **Status commands carry no framework idempotency key.** `createSupplierHandler.js` declares `idempotency: { enabled: true }`; the lifecycle handlers declare none. Design DES-007 calls for framework plus durable domain idempotency for create, approval, **status** and import outcomes. The module implements the domain half, which §476 authorises. Pre-existing on the PHASE-001 baseline and outside this PR.
- **A supplier created with `activate: true` has no `supplier.activate` audit row** — `createSupplier` writes `supplier.create` while inserting `status = 'active'`. Replaying `POST /:id/activate` on it returns 409 rather than the §476 idempotent 200. Identical under the old `LIKE`, so **not a regression from this PR**.
- The `Object.hasOwn` idiom cited in the remediation doc comes from `updateSupplier`, where it means PATCH semantics; `supplierCompletenessWarnings` receives a computed fact set, not a patch. Citation drifted from `:189` to `:202` after the constant block was added — cosmetic.
- `createSupplier` passing only `defaultPaymentTermId` is right, but for the wrong reason: `WRITABLE_FIELDS` admits only scalars, so a PHASE-001-created supplier provably has no children. If the §1256 CSV import path ever reuses `createSupplier` to create a supplier with child data in one transaction, that call site returns `ORDERING_ADDRESS_MISSING` for a supplier that has an address. Pre-existing, untouched by this PR.
- None of DEF-003…DEF-008 is aggravated by this change. DEF-004 remains the one to prioritise when Purchasing lands.

## Coverage gaps — this review is not complete

Reproduced from the reviewer without softening.

- **No browser validation.** The app was not started and no flow was driven with Playwright. Under the project UI testing standard this review is incomplete on the frontend axis, exactly as REV-006 was. The reviewer read `SupplierCompletenessBanner.vue` and established it is purely server-driven, which is why it judged the DEF-001 client risk near zero — but that is static reasoning, not observation. The author's Playwright evidence is unverified by the reviewer.
- No integration tests were run by the reviewer and `erp_dev` was not touched; the suite, lint and build results were taken as given.
- No `EXPLAIN` against a populated `supplier_audit_logs`. The judgement that `IN (...)` does not regress the plan versus `LIKE` is reasoning from the index definition, not measurement.
- The ~150 server and 40 client tests outside the three files in the diff were not reviewed, `08_traceability.json` was not audited, and Checkpoint H / §T24 acceptance criteria were not checked against the delivered state.
