# Supplier Management — REV-008 Independent Re-verification of PR #106

## Decision

`APPROVED`

| Severity | Open findings |
| --- | ---: |
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 2 (DEF-010, DEF-011 — deferred under `APPROVAL-HD-013-RISK`) |

The single Medium from `REV-007` (`DEF-009`) is closed and verified. This review supersedes `REV-007` for gate purposes.

## Provenance

| Item | Value |
| --- | --- |
| Reviewer | `agent-skills:code-reviewer` — the same separate-agent instance that produced `REV-007`, resumed with its own context |
| Author | Claude Opus 5 |
| Method | `SEPARATE_AGENT` |
| Reviewed candidate | PR #106 head `dc378090f694f1e5d2d1a7fe624eb3354ab8cd86` |
| Design baseline | `dcb74d3c781236860d85b4dc15e2efce4ea33b58b0ed9739241d2d2c8cd61445` |
| Authorization | `HD-011` and `HD-013`; user messages on 2026-09-16 |

The reviewer worked from a disposable scratch copy and left the review worktree untouched (`git status --porcelain` empty).

## What was verified for this delta

### The fixture is faithful

`server/test/integration/supplierManagement.integration.test.js:298-307`. The reviewer checked the INSERT column-by-column against migration `0031`:

- Every `NOT NULL`-without-default column is supplied; the omitted ones have defaults or are nullable, so it cannot fail under strict mode.
- `target_id: null` is legal, and `actor_user_id` satisfies `fk_supplier_audit_actor`. `t.after` deletes audit rows before `cleanupActor`, so the FK is never violated on teardown.
- `action: "supplier.contact.create"` is correct on both halves: it genuinely matches `LIKE 'supplier.%'` and is genuinely absent from `LIFECYCLE_ACTIONS`. It is also an action the module really writes (`SupplierContactService.js:132`), so it is a realistic fixture rather than a string chosen to pass.

The reviewer raised one cosmetic infidelity as a nit rather than a finding: the fixture used `target_type: "supplier_contact"` while the service writes `"contact"`. **Corrected after the review** — the fixture now uses `"contact"`, and the integration file was re-run at 5/5. The replay query filters on `supplier_id` and `action` only, so this changed no outcome; it was fixed so the row does not misrepresent the module to anyone who later asserts on `target_type`.

### The `deepEqual` update was required and masks nothing

`id` is `AUTO_INCREMENT`, the INSERT runs after `activateSupplier` has resolved and before `suspendSupplier`, and the assertion reads `ORDER BY id` — not `occurred_at` — so it is robust even if the fixture clock ties with the service clock. The position of `supplier.contact.create` is what the implementation actually produces, not an assumption.

The reviewer specifically checked whether adding a row to the expected array weakened the §476 "no duplicate audit on replay" guarantee that assertion was originally written for. **It does not**: a replay that wrongly wrote a second `supplier.activate` would place it after `supplier.contact.create` and fail the `deepEqual`. Adding `assert.equal(replay.status, "active")` is a genuine strengthening — previously only `version` was asserted.

### It fails on a plain revert — executed, not reasoned

The author had only proven discrimination against the reviewer's contrived `LIKE … OR IN` hybrid. The reviewer ran the stricter test itself, against real MySQL:

| Implementation | `supplierManagement.integration.test.js` |
| --- | --- |
| HEAD (`action IN (...)`) | **5/5 pass** |
| Plain revert to `action LIKE 'supplier.%'` | **1 failure**, 4 pass |

The failure payload pins it to the replay branch beyond argument:

```
code: 'STATUS_TRANSITION_INVALID',  statusCode: 409,
details: { from: 'active', to: 'active' }
```

`from === to === 'active'` can only be thrown from the `current.status === targetStatus` branch at `SupplierAdminService.js:371`. This closes `DEF-009`.

The reviewer also confirmed the new coverage cannot silently evaporate: `integrationTest` resolves to `test.skip` without `DB_INTEGRATION_TESTS=1`, which reports as *skipped*, and the harness suite contract enforces `max_skipped: 0`.

### Nothing else regressed

Full supplier suite in the scratch copy at HEAD: **105/105 pass, 0 failures, 0 skipped**. `grep -c "LIKE 'supplier"` on `SupplierAdminService.js` returns 0 — no transient hybrid left behind. The product source is byte-identical to `235c202`, where the reviewer had already verified the DEF-001 fix, the merge inertness and the §476 adjudication; it did not re-verify those and says so.

### CI on the exact candidate

The reviewer independently confirmed run `35051145278` has `headSha` `dc378090f694f1e5d2d1a7fe624eb3354ab8cd86`, 4/4 checks passed **first time with no re-run**, and `gh pr view 106` reports `headRefOid` = `dc37809` with `mergeStateStatus: CLEAN`. This satisfies the "CI green on the final head" rule without relying on the earlier `235c202` run, whose test job needed a re-run after an unrelated Item Management flake.

### Test-database hygiene

The reviewer queried `erp_dev` after its deliberately failing run and confirmed zero residue: no leftover `LIFE-`/`DEL-` suppliers and no `integration`-actor contact audit rows. `t.after` cleans up correctly even on failure. Two orphaned audit rows dated 2026-09-15 from actor `pw_supplier_0915` are the author's prior Playwright session and are the intended "audit survives supplier deletion" behavior that migration `0031` exists to provide.

## Deferred LOW findings — reviewer concurs

`DEF-010` (bank-flag convention) and `DEF-011` (hand-maintained `LIFECYCLE_ACTIONS`) are both forward-looking maintainability hazards with no live exposure in PHASE-001. The reviewer agrees deferral is correct, and specifically endorses scheduling `DEF-011`'s one-line invariant assert as the first task of PHASE-002 — that is precisely the phase that will add the approval transitions the state machine already permits (`supplierStateMachine.js:7-8`), where the omission would otherwise bite silently.

## Coverage gaps — unchanged from REV-007, reproduced without softening

- **No browser validation.** The app was not started; the frontend axis remains unreviewed under the project UI testing standard, and the author's Playwright evidence is unverified by the reviewer.
- No `EXPLAIN` against a populated `supplier_audit_logs`.
- No traceability audit of `08_traceability.json`.
- Checkpoint H and §T24 acceptance criteria were not checked against the delivered state.
- The ~150 server and 40 client tests outside the files in this diff were not reviewed.
- The DEF-001 fix, merge inertness and §476 adjudication were not re-verified in this pass; they were verified at `235c202` and the product source is unchanged.
