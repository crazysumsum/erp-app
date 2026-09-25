# Inventory Management Implementation Readiness

## Status

`BLOCKED` — TASK-001～TASK-011 are complete on this branch. `HD-026` resolved the observed `0054` collision by selecting a contiguous shift to `0055`～`0064`; migration renames and TASK-012 remain blocked until the exact candidate DESIGN and PLAN hashes are approved.

## Baseline

- Historical 0.3 design approval: `fabc75e34e1331570e6a276cabd7392ee598b1e992dc6e8b9402e638bab63273`.
- Historical 0.3 plan approval: `8a647f900e8b21ba0cacb3361beb489aa30085cec1c2b8d6c043bf0e72e92bbf`.
- Historical 0.5 DESIGN: `23bdae2d85dc2546e641c19ccf3cd604ef3a068fb43149ae10341f0e54c87eef`.
- Historical 0.5 PLAN: `43b3bd4fc285d531f19bd2e3f8d7f22cb44a1ef2091d1d524e3007f45d28b2f8`.
- Approved 0.7 DESIGN: `474fc6e215cc86ce9be2866c17156e18ac3dc91ad320937af7a310a2a099e08b`.
- Approved 0.7 PLAN: `12b274ba8529f70c058d9393d9fb83ccc57319641fc3ee756907d73cdc9031e4`.
- Approved 0.8 DESIGN: `56dd0913f0dedf891eb9885d9d89ceb763c3daca1fae3887226ae5358563784e`.
- Approved 0.8 PLAN: `4ac86650205134dacc954badc3e54b2610f2fe43f0625e0eb2b6922616fb3434`.
- Approved 0.9 DESIGN: `4c27910933198d1de4f287e23d83d68775d0707a837c531cc79b5460f2ecc4ff`.
- Approved 0.9 PLAN: `27a3f616185d5b6ed865cbb962bafb05e23c74347df7ea994037d81f9e5583be`.
- Historical IMPLEMENT authorization: Sam, active Codex task, 2026-09-23: `Inventory Management 切換到 IMPLEMENT`.
- `HD-008`: Sam approved adopting TASK-004's transaction-aware `ItemLookupService` contract on 2026-09-23.
- `HD-010`: Sam approved exactly `server/src/modules/item/ItemLookupService.js` and `server/test/itemLookupService.test.js` as the shared publication scope on 2026-09-24.
- `HD-012`／`APR-015`: Sam approved TASK-005's exact two migration paths and execution of `0054`～`0056` only in a fresh disposable MySQL 26.7.0 schema on 2026-09-24.
- `HD-013`: Sam approved TASK-006 operation／Audit services and focused developer tests on 2026-09-24, without TASK-007, push, PR or merge.
- `HD-014`: Sam approved TASK-007's fixed lock protocol, transaction-required internal command context and test support on 2026-09-24, without TASK-008, production migrations or remote actions.
- `HD-015`: Sam selected the isolated disposable MySQL 26.7.0 option for TASK-007's two-connection contention smoke test on 2026-09-24; only test-owned minimal DDL was permitted and the schema had to be removed afterwards.
- `HD-016`～`HD-018`: Sam approved adding exactly the two planned TASK-007 test-support paths to the module allowlist and approved the resulting 0.9 DESIGN／PLAN hashes on 2026-09-25.
- `HD-019`: Sam approved TASK-008 migration `0057`, its schema inspector, focused developer tests and isolated disposable MySQL 26.7.0 verification on 2026-09-25, without TASK-009 or remote actions.
- `HD-020`／`APR-019`: Sam selected and approved the complete TASK-009 option on 2026-09-25: Warehouse／Bin domain service, projection, focused tests and isolated MySQL 26.7.0 deactivate/posting race verification, without TASK-010 or remote actions.
- `HD-021`／`APR-020`: Sam selected and approved the complete TASK-010 strict handlers, schemas, route metadata, owner-safe client contract, Traditional Chinese error coverage and focused tests on 2026-09-25, without TASK-011 or remote actions.
- `HD-022`／`APR-021`: Sam approved the minimal TASK-010 service extension for designed Bin `lockStatus` filtering and `currentLock` detail, without advancing the Stocktake migration.
- `HD-023`／`APR-022`: Sam approved allowlisted Warehouse／Bin `sortBy` and `descending` behavior with `id` as the final tie-breaker.
- `HD-024`／`APR-023`: Sam selected and approved the complete TASK-011 responsive Warehouse／Bin UI, separate Inventory menu group, focused component tests and mocked local Playwright validation on 2026-09-25, without TASK-012, CI or remote actions.
- `HD-026`／`APR-025`: after local and `origin/main` were observed to contain Customer migration `0054_create_customer_export_jobs.js`, Sam selected the minimal contiguous Inventory shift from `0054`～`0063` to `0055`～`0064` and returned the module to `DESIGN_AND_PLAN` for fresh hash-bound approval.

## Reconciled P0 checks

- Latest `main` includes PR #141 and PR #142; the published Item contract matches this branch's TASK-004 implementation.
- TASK-001～TASK-004 implementation commits remain isolated on this branch and are not claimed as merged product work.
- The implemented service contract hashes to `ca31b00f228e092fce27def6c5322ec804e9969c83853e90d0965e59a6e86ab1`.
- Both new methods require the caller's transaction executor; they do not open an independent connection.
- The Inventory profile is an explicit whitelist and exposes Serial so Inventory can reject it fail closed.
- UOM resolution accepts only an active SKU UOM with an integer factor from 1 to 1,000,000 and requires Base UOM factor 1.
- After merging latest `origin/main`, focused Item lookup checks passed 33/33 and focused ESLint passed.
- TASK-007 stayed inside the approved module boundary and did not add a migration, start TASK-008 or perform any remote action.
- TASK-008 stayed inside its HD-019-approved migration boundary and did not start TASK-009 or perform any remote action.
- TASK-009 stayed inside its HD-020-approved four-file boundary and did not start TASK-010 or perform any remote action.
- TASK-010 stayed inside its approved handler／client boundary plus the two explicitly approved service-extension files; it did not start TASK-011, add a migration or perform any remote action.
- TASK-011 stayed inside the HD-024／APR-023-approved page, Inventory menu, component-test and browser-test boundary; it did not start TASK-012, add a migration, run CI or perform any remote action.
- The corrected 0.9 module boundary and traceability validations pass; the only scope change from 0.8 is the two planned TASK-007 test-support paths.
- Multi-axis TASK-006 self-review found and fixed one unsafe-summary issue before commit: allowlisted summary keys now accept scalar values only, so a nested raw payload cannot hide under an approved key. No correctness, security, maintainability or contract-blocking issue remains in the isolated diff.
- Full `PHASE-001 MERGE_READY` remains blocked by pending remote CI/review; this local task completion does not claim that Phase gate.
- TASK-005 used a newly observed MySQL 26.7.0 lease; its schema, server and exact temporary root were removed after developer verification and cannot be reused by later tasks.

## TASK-005 developer verification

- Commit `143fd9eb79db27590ae45dff74eb80baf91f1d28` creates only `0055_create_inventory_operations.js`, `0056_create_inventory_audit.js` and the focused Inventory migration integration test.
- The source tuple unique key contains exactly module, document type, document ID, non-null line ID and event ID; `command_type` is excluded. A real two-connection duplicate race produced one winner and one `ER_DUP_ENTRY`.
- Audit permits only exact `SUCCEEDED`／`REJECTED`／`FAILED` outcomes, keeps actor/source snapshots, applies actor `SET NULL` and operation `RESTRICT`, and rejects direct `UPDATE`／`DELETE` through immutable triggers.
- The migration rerun preserved identical DDL, no `inventory_movements` table was created, and the schema test passed on observed MySQL `26.7.0` at the isolated schema `erp_inventory_task005_20260924_1008`.
- Focused Inventory migration test: 1 passed, 0 failed, 0 skipped. Full server developer suite with the repository's CI test keys: 1,684 passed, 0 failed, 303 DB-gated tests skipped. Full repository ESLint passed.
- These are developer checks, not formal `TC-001`／`TC-004` Technical Acceptance or business acceptance.

## TASK-006 developer verification

- Commit `03df3f4c2a13840f44f3420ae0f692a90f7b6225` implements canonical SHA-256 operation hashes, exact source-tuple claim/replay/conflict handling, completed-result source lookup and guarded single completion.
- Command type is part of the hash but not the source unique tuple. Password／token／authorization／reauthentication proof fields are recursively excluded from the hash, while business-field changes alter it.
- Durable result and Audit summaries use explicit server allowlists, scalar-only values and an 8 KiB cap. Required `SUCCEEDED` Audit uses the caller's transaction and propagates insert failure; post-rollback `REJECTED`／`FAILED` Audit uses a short independent transaction, stores no success projection or operation link, and falls back to a safe structured error log if persistence fails.
- Focused operation／Audit tests: 13 passed, 0 failed. Full server developer suite with the repository's CI test keys: 1,697 passed, 0 failed, 303 MySQL-gated tests skipped. Full repository ESLint passed.
- Full server coverage execution was attempted, but without an authorized active MySQL runtime the 303 integration cases were skipped and the repository-wide lines/functions thresholds could not be established. No schema was created or migrated for TASK-006.
- These are developer checks, not formal `TC-004` Technical Acceptance, CI, independent code approval or business acceptance.

## TASK-007 developer verification

- Commits `626be3e83e1511ba1cd4370727a03dc96298beca`, `09863379cf09767f0bd8dcc5d40cbc15d2f8e819`, `34e2f6fdf20bb9d49cfba3e2c08105c7e0ece520` and `ff35f5f0aa13b68de198929753a0a5a74634cf4c` implement the transaction-required internal command context, one fixed-order lock entry point, fault injection／barrier fixtures and the real-connection smoke test.
- The lock helper deduplicates and sorts every key, enforces Warehouse／Stock Control／Bin scope dependencies, uses upsert-before-`FOR UPDATE` for missing control／balance rows, and maps MySQL deadlock／lock-timeout errors to `CONCURRENT_OPERATION`.
- The command context requires the caller's transaction executor and a service-owned authorization contract; it rejects unknown fields, invalid identities and recursively nested sensitive payload fields without opening a pool connection or nested transaction.
- Fault injection covers operation, current state, Movement, Audit and commit boundaries. The concurrency barrier releases only after both parties arrive.
- Focused Inventory checks: 28 passed, 0 failed. The dedicated two-connection MySQL smoke test: 1 passed, 0 failed on observed MySQL `26.7.0`, using test-only schema `erp_inventory_task007_20260925_0855` and no production migration. Full server developer suite with the repository's CI test keys: 1,707 passed, 0 failed, 304 gated tests skipped. Full repository ESLint passed. These checks were rerun after approval of PLAN `27a3f616185d5b6ed865cbb962bafb05e23c74347df7ea994037d81f9e5583be`.
- The disposable schema, local test account, MySQL server and temporary data root were removed after the smoke test. No reusable runtime lease remains.
- Multi-axis self-review found no correctness, security, architecture, performance or maintainability blocker. These are developer checks, not formal `TC-010` Technical Acceptance, CI, independent code approval or business acceptance.

## TASK-008 developer verification

- Commit `9207aff16b435895ee34bf7687dbfa372ac76d85` adds only migration `0057_create_inventory_master.js`, its schema-inspector unit test and its isolated integration test.
- Warehouse normalized code is company-wide unique. Bin normalized code is unique within Warehouse, and `(id, warehouse_id)` is a unique candidate key for later composite ownership FKs.
- Actor FKs use `SET NULL`; Bin-to-Warehouse uses `RESTRICT`. Status checks, version/status defaults and the approved list indexes are present.
- The inspector rejects an incompatible partial schema before DDL. A compatible interrupted state with Warehouse present and Bin absent converges on rerun, and a complete rerun preserves identical DDL without relying on transaction rollback.
- Focused Inventory plus migration-ordering checks: 37 passed, 0 failed. Focused ESLint, `git diff --check`, module-boundary validation and traceability validation passed. The dedicated MySQL migration test passed 1/1 on observed server `26.7.0` in schema `erp_inventory_task008_20260925_0924`.
- The disposable schema, local test account, isolated server and `/private/tmp/erp-inventory-task008-mysql-2670.wAtsfk` data root were removed after verification. No runtime lease remains.
- Multi-axis self-review found no correctness, security, architecture, performance or maintainability blocker. These are developer checks, not formal `TC-003`／`TC-010` Technical Acceptance, CI, independent code approval or business acceptance.

## TASK-009 developer verification

- Commit `1cf960b3d21fab95b5c6e8489659d70ba1776f3b` implements Warehouse／Bin list, detail, create, update, deactivate, reactivate and controlled delete plus explicit response projections.
- Every write revalidates the actor's current `inventory.mgmt` permission, uses optimistic version checks, acquires the shared Warehouse row lock before Warehouse-scoped mutation and writes required Audit in the same transaction.
- Codes are trimmed, NFKC-normalized and case-folded for uniqueness. Cross-Warehouse child lookup fails closed; an Inactive Warehouse rejects Bin create/reactivate.
- Warehouse and Bin deactivation recheck current On Hand, active Reservation／Allocation, open Transfer and active Stocktake blockers while holding the Warehouse lock. Historical Movement is excluded from deactivation guards but blocks permanent delete.
- Focused Inventory plus migration-ordering checks: 46 passed, 0 failed. Focused ESLint and `git diff --check` passed. The final dedicated MySQL race test passed 1/1 on observed server `26.7.0` in schema `erp_inventory_task009_20260925_0944`, covering complete lifecycle and both posting-first／deactivate-first lock orderings.
- The final disposable schema, local test account, isolated server and `/private/tmp/erp-inventory-task009-mysql-2670.OBzifa` data root were removed after verification. The earlier passing pre-final run and its `/private/tmp/erp-inventory-task009-mysql-2670.eO5k9B` root were also removed; only the final source fingerprint is evidence-bearing.
- Multi-axis self-review found no correctness, security, architecture, performance or maintainability blocker. These are developer checks, not formal `TC-002` Technical Acceptance, CI, independent code approval or business acceptance.

## TASK-010 developer verification

- Commit `4b1ad68da7885ee41430d4859f602d9264575131` adds all 14 Warehouse／Bin GET and POST handlers, closed request／response schemas and the Inventory client service.
- Read routes require `inventory.view`; every write requires `inventory.view`＋`inventory.mgmt`, enables framework idempotency and uses the fixed password or device-password strength from design. Authentication passwords are removed before domain-service invocation.
- Bin detail remains owner-safe through the Warehouse＋Bin lookup. Lists use allowlisted sorting with a stable `id` tie-breaker; Bin lists support `ALL`／`LOCKED`／`UNLOCKED`, and detail exposes only the current Stocktake lock projection.
- Every client POST enables `Idempotency-Key`; caller-supplied retry keys are excluded from strict bodies. The client performs one request only on `VERSION_CONFLICT`. Existing shared Traditional Chinese mappings already covered every Warehouse／Bin public error, so no duplicate error-map change was needed.
- Focused Inventory／handler／permission checks: 52 passed, 0 failed. Focused client HTTP／Inventory checks: 30 passed, 0 failed. Full repository ESLint, client production build, `git diff --check`, module-boundary validation and traceability validation passed. The build retained only the repository's pre-existing bundle-size warning.
- No MySQL runtime was started: TASK-010 adds no DDL, while active Bin locks depend on planned migration `0063`; real lock-filter integration remains gated by the later Stocktake persistence task. Multi-axis self-review found no correctness, security, architecture, performance or maintainability blocker within the approved contract diff.
- These are developer checks, not formal `TC-002` Technical Acceptance, CI, Sam's independent code approval or business acceptance.

## TASK-011 developer verification

- Commit `fed56e40e959c97afc4d047f85f22e23d6fbb050` adds the separate Inventory menu group and one Warehouse／Bin master-detail page built from the existing `PageHeader`, `DataTable`, `FormPanel` and password＋reason confirmation helper.
- Warehouse and Bin create／edit, permission-gated lifecycle actions, owner-safe blocker counts, lock detail and optimistic-version conflict handling are connected to the strict TASK-010 service. A 409 reloads current data while preserving the user's form input.
- Desktop uses a two-panel master-detail layout. At 375 px the same accessible controls become a sequential Warehouse → Bin flow with a keyboard-operable return path; no parallel UI framework or dependency was added.
- Full client developer suite: 656 passed, 0 failed. Focused Inventory component／service checks: 9 passed, 0 failed. Mocked local Playwright: 4 passed, covering desktop master-detail, blocker-confirmed high-risk action, idempotency header, 409 retention, error/retry/empty states, view-only permissions, browser console/page errors and the 375 px keyboard flow.
- Full repository ESLint, client production build, `git diff --check`, TASK-011 module-boundary validation and traceability validation passed. The build retained only the repository's pre-existing bundle-size warning. Multi-axis self-review found no correctness, security, accessibility, architecture or maintainability blocker.
- These are developer checks, not formal `TC-002` Technical Acceptance, CI, Sam's independent code approval or business acceptance.

## Approved physical allocation

| Prefix | Migration | Owner |
| --- | --- | --- |
| `0055` | `seed_inventory_permissions` | P0-T03 |
| `0056` | `create_inventory_operations` | P0-T05 |
| `0057` | `create_inventory_audit` | P0-T05 |
| `0058` | `create_inventory_master` | P1-T01 |
| `0059` | `create_inventory_stock` | P1-T05 |
| `0060` | `create_inventory_movements` | P1-T05 |
| `0061` | `create_inventory_reservations` | P2-T01 |
| `0062` | `create_inventory_transfers` | P3-T01 |
| `0063` | `create_inventory_stocktakes` | P4-T01 |
| `0064` | `create_inventory_opening` | P5-T01 |

## Boundaries

- No shared／production database access, deployment, Technical Acceptance or UAT has occurred.
- TASK-005 migration execution occurred only under `HD-012` in its disposable schema; no other project migration was executed there.
- TASK-005 historically created `0055_create_inventory_operations.js` and `0056_create_inventory_audit.js`; after candidate approval they will be renamed to `0056` and `0057`. Movement is now planned as P1 migration `0060`.
- TASK-006 created only the two approved services, one shared safe-JSON helper and the three planned focused test files.
- TASK-007 created only the approved lock／validation services, test support and focused tests; the smoke test's minimal DDL was disposable and is not a migration or product schema authority.
- TASK-008 historically created the HD-019-approved `0057` migration, inspector and focused tests; after candidate approval it will be renamed to `0058`. Its prior execution was confined to the disposable TASK-008 schema and remains historical evidence only.
- TASK-009 created only the HD-020-approved service, projection and focused tests; both MySQL executions were confined to disposable TASK-009 schemas.
- TASK-010 created only the approved handlers, schemas, client service, focused tests and narrow master-service query extensions; it did not create Stocktake persistence or UI code.
- TASK-011 created only the approved responsive UI, shared Inventory menu entry, focused component tests and mocked Playwright suite; it did not create persistence or start TASK-012.
- The remaining implementation commits are local; no TASK-006 through TASK-011 push, PR, CI or merge is claimed.

## Next safe action

Validate and present the exact 1.0 candidate DESIGN and PLAN hashes for Sam's independent approval. No migration rename, TASK-012 code, database runtime, CI, push, PR or merge is authorized before both approvals.
