# REV-129 — independent review of the T51 deliverables (runbook, sign-off sheet, deployment smoke)

- **Reviewer:** `agent-skills:code-reviewer` (a separate agent; I did not write this change)
- **Baseline:** branch `claude/supplier-t51-deliverables` at `1675cf0f`, reviewed as `git diff origin/main..HEAD` (base `6458d9d5`)
- **Verdict:** **CHANGES_REQUESTED**. 2 Required, 6 Optional, 5 Nits, and three points for the Product Owner.

## What the reviewer confirmed

- **TC-135 parity.** The reviewer ran main's and this branch's `runSupplierReleaseAcceptance.js`. Both pass, and the 19 check IDs come in the same order, plus `deploy.no_unknown_migration`. The moved code is textually the same.
- **Every §14.4 check can fail.** Faults were injected one at a time; each failed exactly its own check.
- **`check` only reads.** It passed 8 of 8 with a SELECT-only account that requires TLS.
- **`copy` only writes to a `_smoke` copy.** The name and `DB_NAME` guards throw before any connection opens. The reviewer ran the "equal to `DB_NAME`" case on its own.
- **Upgrade rehearsal works.** On a pre-0103 copy, `copy` applied 0103 and passed.
- **The runbook's sources match:** dump flags, rehearsal facts, the §2.1 statements, the renumbering order, log events, job names and the lease.
- **The ledger's PR #292 record matches GitHub,** and nothing marks TASK-051 complete.

## Disposition

| Finding | Disposition |
| --- | --- |
| R1: `copy` failed on any copy with approval ON. Direct activation returned `APPROVER_REQUIRED`. | `separatedRoleSmoke` now reads the settings first and, if approval is ON, turns it OFF on the copy. It throws if the response has no boolean `requireActivationApproval`. On a fresh schema this changes nothing. Results: `copy` passes with approval OFF and with approval ON (19 checks each); TC-134 and TC-135 still pass (20 checks). The runbook wording is corrected. |
| R2: in `copy`, the admin connection ignored the app's SSL and socket settings. | The admin connection now uses `createMySqlDatabasePool(normalizeDatabaseConfig({ ...databaseConfig, database, user, password }))`, the same as `check`. Results: with an admin account that requires TLS, `copy` passes with `DB_SSL_ENABLED=true` and is refused without it. `adminConnection` is unchanged for the other runners. |
| O1: `server/.env` was not loaded | `copy` loads it first, as `migrate.js` does, so the parent and the migrate child read the same settings. The other modules are imported after it. `check` deliberately does not load it, so the app's write-capable account is never picked up. The runbook says both. |
| O2: the app on the copy could listen beyond localhost, or use the test JWT secret | `copy` sets `APP_HOST=127.0.0.1` before the harness loads its config. It no longer imports `testEnv.js`, and refuses to start without `JWT_SECRET` (and without `DB_ADMIN_USER`). |
| O3: the script imports test code | The script header and the runbook say to run it from a full checkout with `npm ci` done. |
| O4: the worker-rollback "not safe" cell was unsupported | It is reworded to what TC-134 supports: do not clear or shorten a running job's lease by hand. |
| O5: the ledger record named a commit without the smoke code | The follow-up observation names `1675cf0f` and the fix commit. |
| O6: the `DB_NAME` guard was not isolated | It is now recorded on its own (`DB_NAME=erp_t51_rh_same_smoke`, same `--database`): refused. |
| Nit: "a wrong URL" listed as a fault injected into the copy | Reworded. |
| Nit: an unknown ledger row can also mean a rename | Added, with the real example. `00775059` renamed Fulfillment's 0101 and 0102 to 0105 and 0106; the reviewer's "0102 to 0105" was checked with `git show -M` and corrected. |
| Nit: no mode reported `unknown mode --output` | It now reports the usage. |
| Nit: no clear error without `DB_ADMIN_USER` | Added. |
| Nit: `deploy.every_migration_applied` ignored the framework files | They are now included, in both `check` and TC-135. |

## Points for the Product Owner

1. **Approval OFF on the first deployment.** §14.2 and §14.4 require OFF on the first Supplier deployment. Both modes now take `--first-deployment`, which makes OFF a check. Without it, approval is reported only. Controls: approval ON with `--first-deployment` fails in both modes.
2. **Schema hash.** §14.4's "schema hash matches the expected one" has no release baseline to compare against. The inspectors are used instead. This is recorded as a known limitation in `release_evidence.md`.
3. **The deployment account.** The `copy` app runs with the admin account, so the deployment account's grants are not exercised. Also recorded as a known limitation.
