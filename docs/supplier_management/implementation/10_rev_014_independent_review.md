# Supplier Management — PHASE-002 TASK-025 REV-013 Remediation Review

## Decision

`CHANGES_REQUESTED` — **0 Critical, 0 High, 3 Medium, 4 Low, 1 nit**

Both REV-013 HIGH findings were confirmed fixed by experiment. The reviewer stated
directly that `DEF-011`'s closure is now adequately evidenced for the defect as
originally scoped. The remaining findings are narrower, and one of them — `M-1` — is
again a claim stated more broadly than the evidence supports.

> **SUPERSEDED IN PART — REV-018.** Every section below that describes the
> `GENERATION_EXPRESSION` text check, or the behavioural probe that replaced it, describes
> **code that no longer exists**. Five review rounds were spent on that guard; three of them
> found a defect in it, and each fix introduced the next. `0035` no longer attempts to verify
> the `pending_slot` predicate at all. The one-pending invariant is proved against real MySQL
> by `server/test/integration/supplierCoreMigrations.integration.test.js`. Read the findings
> below as the record of what was found when; do not read any "Fixed:" or "It now…" sentence
> as a description of the current code. See `14_rev_018_independent_review.md`.

## Provenance

| Item | Value |
| --- | --- |
| Reviewer | `agent-skills:code-reviewer`, fresh separate agent, no prior context |
| Author | Claude Opus 5 |
| Method | `SEPARATE_AGENT` |
| Worktree | `/Users/sam/Documents/workspace/erp-app-worktrees/supplier-phase-002` |
| Branch／PR | `codex/supplier-phase-002` ／ PR #109 |
| Reviewed HEAD | `9a9984b` (diff `5e00986..9a9984b`) |
| Design baseline | `e4083319e526682f70b40a0b2676ae5b50cc72d8f03e9e07c6d6fbb671f211e4` |
| Plan baseline | `a0d41e31d887447d669d0f8252991e43fcdd273eb9eadcbe0d211468092bd154` |

## Findings and disposition

### M-1 — "impossible by construction" claimed more than the code delivers → `DEF-016` opened

What is true by construction is that a transition **routed through `#changeStatus`**
cannot escape `LIFECYCLE_ACTIONS`. What is not true is the unqualified claim that a
status transition cannot. The reviewer injected a bespoke `submitSupplier` doing its
own `SELECT … FOR UPDATE`, its own `UPDATE suppliers SET status`, and its own
`audit.record({ action: "supplier.approval.submit" })` without touching
`#changeStatus`. With the test file byte-identical (md5 `377f589e88a0e06c97ad2c39fbe3ef3f`),
the suite stayed **10 pass / 0 fail**.

This matters now rather than hypothetically: `TASK-026` is the Supplier Settings
backend and `TASK-038` the approval flow, and a submit command with extra arguments
and a child-table write is exactly the thing somebody writes without reusing
`#changeStatus`.

Disposition: the closure text in `00_harness_state.json` and in
`09_rev_013_independent_review.md` now states the bounded claim, and **`DEF-016`
(MEDIUM, OPEN)** carries the residual: a transition that bypasses `#changeStatus` is
covered by neither the registry nor the test.

### M-2 — the `0036` test held a shared singleton mutated across a parallel window → fixed

`node --test` runs test files in parallel child processes against one shared
`erp_dev`. The test deleted `supplier_settings` id=1 and set
`require_activation_approval = 1`, restoring only in `t.after`. Harmless today only
because nothing outside that file reads the table — an accident that `TASK-026`
expires by design. Same shape as the recorded `TC-001` interference.

Fixed: the delete-and-reseed now runs inside a transaction with `rollback()` in a
`finally`. No other connection observes the intermediate values and nothing depends
on an after-hook running.

### M-3 — the author's verification leaked rows into `erp_dev`, and a record claimed otherwise → fixed

Supplier id 603 `MIG-8cbabc31` and its two `supplier_activation_requests` rows,
created `2026-09-16T09:31:22Z`, survived an earlier verification run whose connection
closed before its cleanup hook. The `TASK-025` record still asserted "Test rows
created during the manual check were deleted; the table is empty."

The **committed** test's cleanup is correct. REV-014 reported proving that by injecting
`assert.equal(1, 2)` *before* the insert — which cannot have shown it, since `supplierId`
is still `null` there and the hook's `if (supplierId !== null)` branch never runs. REV-015
re-established the same conclusion with the injection placed *after* the supplier and both
activation rows exist: the test went red and `erp_dev` came back with 0 `MIG-%` suppliers,
0 activation rows and `supplier_settings` untouched. So this was leaked state plus a false
cleanliness claim, not a test defect.

Fixed: the rows are deleted (`supplier_activation_requests` is empty, no `MIG-%`
supplier remains, `supplier_settings` id=1 is `require_activation_approval = 0`,
`version = 1`), and the record now states what is actually true.

### L-1 — stale non-probative citation → fixed

The `TASK-025` record still cited "migrations.integration.test.js 14/14", the exact
citation REV-013's MEDIUM-2 called non-probative for these migrations. Now labelled
as Item-side pre-existing coverage, with the real citation alongside it.

### L-2 — the REV-013 document claimed a clearance its reviewer never granted → fixed

Its Decision table read "Open after remediation | High | 0", written by the author.
It now records only what REV-013 decided on `5e00986` and points here for the
independent check.

### L-3 — `DEF-011` severity → raised `LOW` → `MEDIUM`

A gate counting open HIGH/MEDIUM defects would have undercounted a reopen. The
user-visible impact — a retried lifecycle command returning `409` instead of the
current state — is `MEDIUM` on its own terms, independent of the evidence failure
REV-013 classified as HIGH-1.

### L-4 — the generated column's predicate was unchecked → fixed, and now mutation-proven

`EXTRA LIKE '%GENERATED%'` passes for a column generated over the wrong predicate,
e.g. `IF(status = 'approved', 1, NULL)`. The inspection now also checks
`GENERATION_EXPRESSION`. MySQL stores that text with its quotes backslash-escaped
(`if((\`status\` = _utf8mb4\\'pending\\'),1,NULL)`), which the first attempt did not
account for — it failed against the real schema and the normalization was added.

The property assertions are exercised **without altering `erp_dev`** by
`server/test/supplierActivationRequestSchema.test.js`, which drives
`inspectSupplierActivationRequestSchema` with a fake connection returning a schema MySQL
never produced here — one violated property per case.

REV-014 recorded this as "mutation-proven". REV-015 found that overstated on exactly the
property it mattered for: the predicate check was a substring test, and the only mutation
tried was a different status literal. See `11_rev_015_independent_review.md#medium-1`; the
check is now anchored on the whole expression and the mutation set covers every form REV-015
demonstrated was accepted.

The fake also cannot prove the SQL is right. REV-015 removed `generation_expression` from
the real `SELECT` and the unit tests stayed green, because the fake hands the field back
regardless of what was asked for; only the integration test went red. Cite the pair, never
the unit file alone.

### Nit — `SUPPLIER_REFERENCED` on the delete path omits `details` → not fixed, deliberately

Both sibling throws pass a `referenceSummary`. This path has none: the driver error
says only that some row references the supplier. Producing a count would mean another
query after a rolled-back transaction, and the only honest alternative — echoing the
driver's `sqlMessage` — would leak SQL to a client. `grep -rn SUPPLIER_REFERENCED client/src`
is empty, so nothing reads `publicDetails`. Left as is rather than filled with a
placeholder.

## What the reviewer verified independently

Verified TRUE, each by running the command rather than reading the claim: the
registered-command injection turns the test red with the file byte-identical
(md5 compared); the inline descriptor throws at the seam; removing the HIGH-2 mapping
turns its test red; `deleteSupplier`'s re-indent is semantically unchanged
(`git diff -w` plus an indentation-stripped body diff); `LIFECYCLE_COMMANDS` is frozen
to the `allowedFrom` arrays; `DEF-011` was genuinely reopened in the ledger
(`git show ff2bd7e:…` → revision 94, `status: "OPEN"`, `closure_evidence: []`, so
93 CLOSED → 94 OPEN → 95 CLOSED is committed history, not prose); the four developer
suites match the reported numbers exactly; and the migration-ledger rewording is accurate.

**One check the author had not run.** The `deleteSupplier` unit test proves the mapping
only against a mock that rethrows the raw driver error. Production does not: the
reviewer exercised the real path through `createApplication` against `erp_dev` and
observed `MySqlDatabaseOperationError` with `code: DATABASE_OPERATION_FAILED` and
`cause.code: ER_ROW_IS_REFERENCED_2`, so `error?.cause?.code ?? error?.code` resolves
correctly through exactly one level of wrapping. **HIGH-2 works in production, not only
against the mock.** The reviewer also confirmed `supplier_activation_requests` is the
only `RESTRICT` foreign key to `suppliers` — addresses, contacts, identifiers and
name grams all `CASCADE` — so `SUPPLIER_REFERENCED` on this path is unambiguous.

Not verified: `TC-001` did not reproduce in the reviewer's single whole-suite run (it
is flaky by nature, and main's whole suite was not run); and the `source_fingerprint`
values, which have no independent recomputation path from outside the harness.

Cleanliness: all injections reverted, `git status --porcelain` empty, md5 of every
touched file matching `git show HEAD:<file>`.

## Residual

- `DEF-016` OPEN: transitions bypassing `#changeStatus` are covered by neither the
  registry nor the test. Relevant to `TASK-026` and `TASK-038`.
- `DEF-013` stays OPEN for `TASK-038`; registering real reference checkers remains
  `DEF-004`, deferred under `APPROVAL-HD-017-RISK`.
- `0035`／`0036` are also claimed by the unmerged `codex/customer-management-phase-001`;
  whichever merges second must renumber.
- This review did not replace CI, Technical Acceptance or UAT.
