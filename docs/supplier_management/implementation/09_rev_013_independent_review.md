# Supplier Management — PHASE-002 TASK-025 (PR #109) Independent Review

## Decision

`CHANGES_REQUESTED`

| Severity | Findings raised | Open at the time of this decision |
| --- | ---: | ---: |
| Critical | 0 | 0 |
| High | 2 | 2 |
| Medium | 3 | 3 |
| Low | 1 + 1 nit | 1 + 1 nit |

This table records what REV-013 decided on `5e00986`. The reviewer never saw the
remediation below, so nothing here clears those findings; that is REV-014's record
(`10_rev_014_independent_review.md`). The author's remediation and its evidence are
set out below as claims, and REV-014 is where they were independently checked.

## Provenance

| Item | Value |
| --- | --- |
| Reviewer | `agent-skills:code-reviewer`, separate agent, fresh read-only review |
| Author | Claude Opus 5 |
| Method | `SEPARATE_AGENT` |
| Worktree | `/Users/sam/Documents/workspace/erp-app-worktrees/supplier-phase-002` |
| Branch／PR | `codex/supplier-phase-002` ／ PR #109 |
| Reviewed HEAD | `5e00986` |
| Design baseline | `e4083319e526682f70b40a0b2676ae5b50cc72d8f03e9e07c6d6fbb671f211e4` |
| Plan baseline | `a0d41e31d887447d669d0f8252991e43fcdd273eb9eadcbe0d211468092bd154` |

## Findings

### HIGH-1 — the `DEF-011` regression test did not discriminate; the closure rested on false evidence

`server/test/supplierLifecycleService.test.js` derived the command list with
`Object.getOwnPropertyNames(SupplierAdminService.prototype).filter((name) => … && name in starting)`.
`name in starting` is a hand-maintained allowlist, so a lifecycle command added
without touching the test was filtered **out** of the very list meant to catch it.
The hard-coded `commands.length === 7` sat behind the same allowlist.

The author had recorded this test as proof that `DEF-011` could no longer recur.
That claim was false: the original "proof" required editing the test in two places
first. Reproduced by injecting `submitSupplier` with the test **untouched** — 9/9
still green. `DEF-011` was therefore closed on false evidence, and the recorded
observation stated the opposite of what the test does. This is the same failure
mode as `DEF-009`, raised immediately after the author stated the lesson was learned.

### HIGH-2 — `supplier_activation_requests` RESTRICT FK can reach `deleteSupplier` unmapped

`0035` gives `supplier_activation_requests.supplier_id` an `ON DELETE RESTRICT`
foreign key. `SupplierAdminService#deleteSupplier` decides deletability from
`this.references.describeReferences()`, which only reports checkers a caller
registered — and no composition root registers any (`DEF-004`, deferred). A draft
Supplier with an activation request therefore passes `assertSupplierDeletable`,
reaches the `DELETE`, and raises `ER_ROW_IS_REFERENCED_2` unmapped: a 500 where a
domain conflict belongs. Second occurrence of the `DEF-013` shape.

### MEDIUM-1 — `inspectSupplierActivationRequestSchema` checked names, not properties

The inspection asserted that a column called `pending_slot` and an index called
`uq_supplier_activation_pending` exist. A plain `TINYINT` column and a non-unique
index of those names would have satisfied it while enforcing nothing, so the
one-pending-request guarantee was not actually verified on an existing schema.

### MEDIUM-2 — `0035`／`0036` had no migration integration coverage

`TASK-025` named `server/test/integration/migrations.integration.test.js`, which was
never touched; the cited "14/14" is that file's pre-existing Item-side coverage and
is non-probative for these migrations.

### MEDIUM-3 — `LIFECYCLE_COMMANDS` was shallow-frozen

`Object.freeze` left each descriptor and every `allowedFrom` array mutable.

### LOW-1 — the slot guard's dependence on exact casing was undocumented

`IF(status = 'pending', 1, NULL)` compares against a lowercase literal under
`ascii_bin`, so any other casing silently frees the slot.

### Nit — "a clean rerun of the runner skipped both as already applied"

That sentence describes the migration ledger, not `up()` idempotency.

## Claims the reviewer independently validated

- `pending_slot` transitions are correct: a `STORED` generated column is recomputed on `UPDATE`.
- The `0036` seed is race-safe as written.
- The `LIFECYCLE_COMMANDS` refactor changed no behaviour.
- "Existing activation behaviour unchanged" is true — the seed writes `0`.

## Remediation

| Finding | Resolution |
| --- | --- |
| HIGH-1 | `#changeStatus` now takes a **key** of `LIFECYCLE_COMMANDS`, not a descriptor, so a transition cannot reach the transition path without being registered — and registering it puts its action in `LIFECYCLE_ACTIONS` by derivation. The test walks the registry itself instead of an allowlist. |
| HIGH-2 | `deleteSupplier` maps `ER_ROW_IS_REFERENCED`／`ER_ROW_IS_REFERENCED_2` to `SUPPLIER_REFERENCED`, reusing the `SupplierIdentifierService` helper shape. |
| MEDIUM-1 | The inspection now asserts `pending_slot` carries `EXTRA LIKE '%GENERATED%'` and that `uq_supplier_activation_pending` is `NON_UNIQUE = 0` over exactly `(supplier_id, pending_slot)`. |
| MEDIUM-2 | `server/test/integration/supplierCoreMigrations.integration.test.js` — the Supplier module's actual migration integration file — now covers `0035` and `0036`. |
| MEDIUM-3 | `LIFECYCLE_COMMANDS` is deep-frozen. |
| LOW-1 | The casing dependency is documented at the generated-column definition. |
| Nit | Both `00_harness_state.json` records now say what was actually observed. |

### Discrimination proof, with the test file byte-identical throughout

- **Registered command injected** (`submit` added to `LIFECYCLE_COMMANDS` plus a
  `submitSupplier` method): `✖ every registered lifecycle command is covered by the
  replay filter` — `1 fail`, `AssertionError: a lifecycle command was registered
  without a starting status here`.
- **Inline descriptor injected** (the original `DEF-011` shape): reaches the seam and
  throws `TypeError: Unknown supplier lifecycle command: [object Object]`. It cannot
  silently bypass the replay filter, because the parameter no longer accepts one.
- **HIGH-2 mapping removed**: `✖ a RESTRICT foreign key that no reference checker
  covers is reported as a reference conflict` — `1 fail`.

`md5` of `server/test/supplierLifecycleService.test.js` was compared before and after
each injection.

### Verification after remediation

| Suite | Result |
| --- | --- |
| `lint` | exit 0 |
| `client-build` | exit 0 |
| `supplier-phase-001-server` (`DB_INTEGRATION_TESTS=1`, real `erp_dev`) | 163 pass, 0 fail, 0 skipped |
| `supplier-phase-001-client` | 40 pass, 0 fail |
| `supplierCoreMigrations.integration.test.js`, run twice consecutively | 3 pass, 0 fail both times; `supplier_settings` restored to its prior value |

## Residual

- `DEF-013` stays `OPEN` for `TASK-038`: the Item-side occurrence is untouched, and
  registering real reference checkers remains `DEF-004`, deferred under `APPROVAL-HD-017-RISK`.
- `0035`／`0036` are still also claimed by the unmerged `codex/customer-management-phase-001`;
  whichever merges second must renumber.
- This review did not replace CI, Technical Acceptance or UAT.
