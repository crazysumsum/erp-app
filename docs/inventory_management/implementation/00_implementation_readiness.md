# Inventory Management Implementation Readiness

## Status

`IMPLEMENTING` local HD-068 rebaseline — Sam approved HD-066's exact DESIGN／PLAN hashes through HD-067 and authorized only local main integration／migration renumbering through HD-068. TASK-001～TASK-018 are integrated into `main` through PR #164. TASK-019～TASK-022 have local developer checks on the P2 branch; TASK-023～TASK-025 remain pending. P2 has not passed its Phase merge gate, and no formal Technical Acceptance or UAT is claimed.

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
- Approved 1.0 DESIGN: `567a0cbe46596cad8cd763b4343ce2133b327c0f7bd565f071b38cf4b51954f7`.
- Approved 1.0 PLAN: `124950a3fdcd8236ef5a519b47e4f8d779fda8da9696dcb40937d66389dfc2e8`.
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
- `HD-027`～`HD-028`／`APR-026`～`APR-027`: Sam independently approved the exact 1.0 DESIGN and PLAN hashes after the migration reallocation.
- `HD-029`／`APR-028`: Sam approved returning to IMPLEMENT, renaming existing Inventory migrations to `0055`～`0058`, validating the complete Inventory `0055`～`0060` history on disposable MySQL 26.7.0 and completing TASK-012 locally, without TASK-013, CI or remote actions.
- `HD-030`／`APR-029`: Sam approved updating the completed TASK-001～TASK-012 branch from latest `main`, local post-merge verification, commit, push, PR creation and merge without CI, followed by merged branch/worktree cleanup; TASK-013 remains excluded.
- `HD-032`～`HD-034`／`APR-032`～`APR-035`: Sam approved the exact 1.1 DESIGN and PLAN baselines, the minimal `ItemLookupService` Inventory-profile extension exposing `skuName`, and local TASK-014 Receipt implementation plus developer verification on the continuing PHASE-002 branch. Migration execution, CI and remote publication remained excluded until separately approved.
- `HD-035`／`APR-036`: Sam approved one guarded disposable MySQL 26.7.0 TASK-014 integration run using an `erp_inventory_task014_*` schema and Inventory migrations `0055`～`0060`, followed by exact schema/runtime cleanup. CI and remote publication remained excluded.
- `HD-036`／`APR-037`: Sam approved TASK-015's transaction-required downstream Receipt contracts and focused tests, while keeping Issue, migrations, MySQL, CI and remote publication excluded.
- `HD-037`／`APR-038`: Sam approved fixed Receiving mapping `PURCHASE_RECEIPT`／`receiving.operation`／`PURCHASING_RECEIVING`／`GOODS_RECEIPT`, fixed Returns mapping `CUSTOMER_RETURN_RECEIPT`／`returns.operation`／`RETURNS`／`CUSTOMER_RETURN`, and mandatory `QUARANTINED` status for Customer Return Receipt.
- `HD-038`／`APR-039`: Sam selected and approved the complete local TASK-016 Stock／Lot／Movement inquiry service, eight read-only APIs and focused tests, while excluding UI, migrations, MySQL, CI and remote publication.
- `HD-039`／`APR-040`: Sam selected and approved the complete local TASK-017 Stock／Lot／Movement UI, URL-restorable filters, server pagination, responsive/accessibility states, focused client tests, production build and mocked Playwright, while excluding MySQL, CI and remote publication.
- `HD-040`／`APR-041`: after implementation discovery proved the existing APIs could not correctly paginate the designed default SKU aggregate list, Sam selected option A and approved the minimal server-side paginated `/api/v1/inventory/stocks/aggregates` extension inside TASK-017 instead of an incorrect client-side page aggregate.
- `HD-042`／`APR-043`: Sam selected and approved complete local TASK-019 Reservation／Allocation persistence migration `0061`, focused tests, guarded disposable MySQL 26.7.0 verification and exact cleanup, while excluding TASK-020, CI and remote publication.
- `HD-043`～`HD-044`／`APR-044`～`APR-047`: Sam approved complete local TASK-020 ATP／Reservation state service and disposable MySQL 26.7.0 verification. For `SALE`, effective `minimumRemainingDays` is the greater of the source request and SKU `minimumSaleLifeDays`, persisted on Reservation. TASK-021, CI and remote publication remain excluded.
- `HD-045`／`APR-048`: Sam approved local TASK-021 FEFO／FIFO candidate ranking and Allocation create service, including quantity／version checks, authorized overrides, Audit evidence and focused developer tests. Disposable MySQL execution, TASK-022, CI and remote publication remain excluded.

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
- TASK-012 stayed inside the HD-029／APR-028-approved migration and focused-test boundary; it did not start TASK-013, run CI or perform any remote action.
- TASK-013 stayed inside the APR-030-approved pure-rule and focused-test boundary; it did not start TASK-014, add or execute a migration, run CI or perform any remote action.
- TASK-014 stayed inside APR-035's Receipt posting service, handler, strict schema and focused-test boundary. It reused the approved transaction, lock, Item lookup, operation and Audit primitives without adding a migration or performing a remote action.
- TASK-015 stayed inside APR-037／APR-038's downstream Receipt contract and focused-test boundary. It reused the atomic Receipt posting core, exposed no Issue contract, added no migration and performed no database or remote action.
- TASK-016 stayed inside APR-039's inquiry service, strict GET handler/schema and focused-test boundary. It did not start TASK-017, add persistence or perform database or remote actions.
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

## TASK-012 developer verification

- Commit `d5b1e7f318e02dbf5c375ec72148dcb08eedbe4f` renames the existing Inventory migrations to `0055`～`0058`, creates `0059_create_inventory_stock.js` and `0060_create_inventory_movements.js`, updates their imports and adds one focused real-MySQL integration test.
- `0059` creates Lot ownership, Warehouse＋SKU serialization rows and unique current Balance buckets. The generated `lot_scope=IFNULL(lot_id,0)` closes MySQL's nullable-unique gap; composite FKs enforce Bin／Warehouse and Lot／SKU ownership.
- `0060` creates the immutable Movement ledger with source operation, actor and master snapshots; all designed warehouse／SKU／Bin／Lot／actor／type／date, group and source indexes are present. Database triggers reject UPDATE and DELETE.
- TDD red was captured before the migrations existed. The final MySQL 26.7.0 test passed 1/1 after applying and rerunning the complete renamed Inventory `0055`～`0060` history, then exercising generated uniqueness, composite ownership FKs, snapshots, indexes and immutable triggers. The two renamed historical migration tests also passed 2/2.
- Focused Inventory and migration checks passed 58 with 5 gated integration skips. The complete local server suite passed 1,726 with 307 gated skips after using the repository's public CI-only test keys and permitting temporary localhost test ports. Full repository ESLint, `git diff --check`, module-boundary validation and traceability validation passed.
- The exact schemas `erp_inventory_task005_20260925_1144`, `erp_inventory_task008_20260925_1144` and `erp_inventory_task012_20260925_1144` were dropped and confirmed absent. The isolated MySQL 26.7.0 server stopped, port 3313 and its socket were absent, and `/private/tmp/erp-inventory-task012-history-mysql-2670.mGLld3` was removed.
- Multi-axis self-review found no correctness, security, architecture, performance or maintainability blocker. These are developer checks, not formal `TC-003`／`TC-004`／`TC-010` Technical Acceptance, CI, Sam's independent code approval or business acceptance.

## TASK-013 developer verification

- Commits `ad9c194`, `66336f0`, `24886e8`, `8cb85cd` and `3c49765` implement Base UOM safe-integer quantities, integer pack conversion, ATP/uncovered reservation calculation, date-only expiry/minimum-life rules, tracking-policy and Lot consistency checks, fixed Stock Status validation and explicit stock／Movement projections.
- Projections use explicit allowlisted fields, preserve immutable Movement snapshots and fail closed on missing, unsafe or impossible quantities; no database row spread is used. Serial tracking remains explicitly unsupported as required by the approved design.
- TDD red was captured for each slice before implementation. Focused Inventory checks passed 31/31. The complete local server suite passed 1,920 with 326 gated skips and 0 failures using the repository's public CI-only Customer and Supplier test keys. Full repository ESLint and client production build passed; the build retained only the existing bundle-size warning.
- `git diff --check`, module-boundary validation and traceability validation passed. Multi-axis self-review found no open critical or high correctness, security, contract, performance or maintainability issue.
- No migration or database execution occurred. CI, push, PR and merge were not performed. These are developer checks, not formal `TC-003` Technical Acceptance, CI, Sam's independent code approval or business acceptance.

## TASK-014 developer verification

- Commits `d601772`, `db847aa`, `263cb99`, `e499015` and `b88cb14` implement Receipt posting primitives, one atomic posting service, the strict `POST /api/v1/inventory/receipts` endpoint, a guarded MySQL integration test and the pre-Stocktake schema compatibility fix found by that test.
- Receipt posting performs fixed authorization and fresh actor checks, Item／UOM resolution, Base／Pack conversion, tracking／Lot／expiry／minimum-life validation, exact override evidence, source-tuple replay／conflict handling, fixed-order locking, Balance mutation, immutable Movement insertion, required Audit and operation completion in one transaction.
- TDD covers success, exact replay, source conflict, all three Stock Statuses, five rollback injection points, inactive master data, unsupported Serial, untracked and Lot consistency rules, minimum-life override evidence and expired-lot rejection. The complete post-fix local server suite passed 1,934 with 327 gated skips and 0 failures using the repository's public CI-only bank test keys.
- The first real-MySQL run correctly failed because the PHASE-002 schema has no future `inventory_bin_locks` table. The fix treats the complete absence of Stocktake tables as the pre-feature state, while a partial Stocktake schema still fails closed; focused Receipt/lock checks passed 15/15.
- The final guarded integration passed 1/1 on MySQL 26.7.0 in `erp_inventory_task014_20260928_1052`, proving success, exact replay, source conflict and Audit-failure rollback after migrations `0055`～`0060`. The schema, port 3314, isolated server and `/private/tmp/erp-inventory-task014-mysql-2670.Cm9eZt` root were removed and confirmed absent.
- Full repository ESLint and `git diff --check` passed. Module-boundary validation and traceability validation passed. CI, push, PR and merge were not performed. These checks are not formal `TC-004` Technical Acceptance, independent code approval or business acceptance.

## TASK-015 developer verification

- Commit `040de0b` adds only transaction-required Receiving and Customer Return Receipt contracts around the existing atomic Receipt posting core; no public route or Issue method was added.
- Receiving is fixed to purpose `PURCHASE_RECEIPT`, permission `receiving.operation` and source `PURCHASING_RECEIVING`／`GOODS_RECEIPT`. Customer Return is fixed to purpose `CUSTOMER_RETURN_RECEIPT`, permission `returns.operation` and source `RETURNS`／`CUSTOMER_RETURN`, with `QUARANTINED` forced by the service. Callers cannot inject authorization or source-module/type values.
- Focused tests prove current actor permission checks, dependency-unavailable failure, exact replay without duplicate posting, and caller-transaction rollback in both directions. They also reject a non-Quarantined return and confirm the Issue API remains absent.
- TDD red was captured before the downstream methods existed. Focused Inventory checks passed 84/84. The complete local server suite passed 1,939 with 327 gated skips and 0 failures using the repository's public CI-only bank test keys.
- Full repository ESLint, `git diff --check`, module-boundary validation and traceability validation passed. No migration or MySQL execution occurred; CI, push, PR and merge were not performed. These checks are not formal Technical Acceptance, independent code approval or business acceptance.

## TASK-016 developer verification

- Commit `1a6b677` adds the Stock／Lot／Movement inquiry service and eight `inventory.view` GET endpoints for paginated Stock buckets, bucket detail, SKU summary, Lots, expiry, Movement list/detail and exact operation-source lookup.
- Stock search gives exact SKU Code／Barcode matches priority over safely escaped partial SKU Name matches. All filters and sorts are allowlisted, page size is capped at 100, offsets remain safe integers and every ordering has a stable ID tie-breaker; Movement history is fixed to `posted_at DESC, id DESC`.
- Responses are explicit projections: quantities retain separate On Hand／Allocated／Free／Reserved／ATP／status meanings, expiry uses the application local date, Movement uses immutable snapshots and safe source tuples, and bucket detail limits recent Movement history to 20 rows. Pre-`0061` allocation detail uses the authoritative Balance allocated total; pre-`0062` In Transit is explicitly zero until Transfer current-state persistence exists.
- TDD red was captured before the service and handlers existed. Focused TASK-016 checks passed 13/13; all focused Inventory unit checks passed 97/97. The complete local server suite passed 1,952 with 327 gated skips and 0 failures using the repository's public CI-only bank test keys.
- Full repository ESLint, `git diff --check`, module-boundary validation and traceability validation passed. No migration or MySQL execution occurred, so SQL execution and query-plan evidence remain deferred to the later authorized integration gate. CI, push, PR and merge were not performed.

## TASK-017 developer verification

- Commit `1a834c7` adds the Stock overview, Lot／expiry and Movement pages plus their Inventory client methods. URL state restores filters, paging and allowed sorting; every page uses server pagination and aborts stale list/detail requests.
- The approved scope correction adds `GET /api/v1/inventory/stocks/aggregates`, which groups and paginates complete SKU totals on the server before the UI drills into Warehouse → Bin → Lot／No Lot → Status buckets. Quantity columns remain explicit for On Hand, Available, Reserved, ATP, uncovered Reserved, Quarantined, Damaged, In Transit, Allocated and Bucket Free.
- Expired／low-life／status and Movement direction/reversal states use icon plus text. Movement detail exposes only safe source tuples, group legs and bidirectional reversal links. All three routes require `inventory.view`.
- TDD red was captured for the aggregate API and client service. Focused server inquiry checks passed 14/14 and focused client checks passed 11/11. The complete server suite passed 1,953 with 327 gated skips and 0 failures using the repository's public CI-only bank keys; the complete client suite passed 681/681.
- Mocked local Inventory Playwright passed 11/11, including TASK-017 keyboard drill-down, URL restoration, permission denial, error/retry/empty states, safe network fixtures, no relevant console errors and 375／768／1024／1440 px layouts without body overflow. Repository ESLint, client production build, `git diff --check`, module-boundary validation and traceability validation passed; the build retained only the existing bundle-size warning.
- Multi-axis self-review found no open critical or high correctness, security, accessibility, architecture, performance or maintainability blocker. No migration or MySQL execution occurred, so aggregate SQL execution and query-plan evidence remain for TASK-018. CI, push, PR and merge were not performed. These are developer checks, not formal `TC-003`／`TC-010` Technical Acceptance, independent code approval or business acceptance.

## TASK-018 developer verification

- Complete evidence is preserved in [01_task018_core_stock_gate.md](./01_task018_core_stock_gate.md). A disposable MySQL 26.7.0 schema held exactly 100,000 SKUs, 500,000 non-zero Stock buckets and 2,000,000 Movements; 20 workers produced 100 samples per query shape.
- Exact SKU, exact Barcode, Warehouse/SKU stock summary, bucket drill-down and recent Warehouse Movement filter all passed the `< 2s` p95 gate. Final p95 values were 11.669ms, 1.459ms, 1.530ms, 2.896ms and 8.088ms respectively. Preserved EXPLAIN plans use the designed exact, stock and Movement indexes without a large-table full scan.
- The measured Movement bottleneck was an unnecessary operation-table join in the count query when no source filter existed. Removing it improved the original all-history-like stress p95 from 3,168.6ms to 2,307.8ms before the fixture's time distribution was corrected; source-filter counts retain the join.
- Same-source/two-connection Receipt competition produced one operation and one Movement with exact replay. A real lock timeout returned `CONCURRENT_OPERATION` with zero partial effects after fixing an omitted `await` that had let the raw asynchronous DB error escape. Warehouse posting/deactivate races passed both orderings.
- All 24 Core endpoint contracts were enumerated for unauthenticated, missing-permission and stale-actor denial, strict request schemas, owner-scoped Bin paths and sensitive response-field exclusion. Focused security/inquiry checks passed 14/14, focused lock checks passed 6/6, capacity/concurrency passed 1/1 and Warehouse race passed 1/1. The complete local server suite passed 1,958 with 328 gated skips and 0 failures.
- Repository ESLint, client production build, `git diff --check`, TASK-018 module-boundary validation and traceability validation passed. The build retained only the existing bundle-size warning.
- All three exact test-owned schemas, both isolated runs on port 3318 and runtime roots `/private/tmp/erp-inventory-task018-mysql-2670.J0LCkz` and `/private/tmp/erp-inventory-task018-final-mysql-2670.1u1Icz` were removed and confirmed absent. CI, push, PR and merge were not performed. These are developer checks, not formal `TC-003`／`TC-004`／`TC-010` Technical Acceptance, independent code approval or business acceptance.

## TASK-019 developer verification

- Commit `0a0371c` adds migration `0061_create_inventory_reservations.js` and its guarded focused integration test. The migration creates Reservation／Allocation quantity breakdowns, status／version fields, approved indexes and delete-rule FKs, then adds the two deferred Movement FKs.
- Native MySQL checks enforce positive unsigned Base UOM quantities, row-local quantity equations, allowed statuses／selection strategies, positive versions and complete override evidence. Service-level cross-row invariants remain deferred to TASK-020／TASK-021 as designed.
- TDD red was captured before migration `0061` existed. The final guarded migration test passed 1/1 on MySQL 26.7.0, proving `0055`～`0061` execution, identical rerun DDL, quantity types, indexes, FK delete rules, valid writes and rejection of invalid quantity／override writes.
- `EXPLAIN FORMAT=TRADITIONAL` used `idx_inventory_reservations_scope`, `idx_inventory_allocations_reservation` and `idx_inventory_allocations_balance` for the three planned query shapes. No speculative indexes or dependencies were added.
- The complete local server suite passed 1,958 with 329 gated skips and 0 failures. Repository ESLint, `git diff --check`, module-boundary validation and traceability validation passed. Multi-axis self-review found no open critical or high correctness, security, architecture, performance or maintainability issue.
- The exact schema `erp_inventory_task019_20260928_1605`, isolated MySQL listener on port 3319 and runtime root `/private/tmp/erp-inventory-task019-mysql-2670.lofcir` were removed and confirmed absent. CI, push, PR and merge were not performed. These are developer checks, not formal `TC-001`／`TC-004`／`TC-005` Technical Acceptance, independent code approval or business acceptance.

## Post-main-merge publication verification

- Latest `origin/main` at `9b2d0d3e0b2e0da284a0bfb99da861705279993f` was merged without conflicts as `e6c7108f0e717a2d3b199d1a7a039ce3f1f9658b`; Inventory migrations remain contiguous at `0055`～`0060` after main's `0054` Customer migration.
- Full server suite passed 1,902 with 324 gated skips and 0 failures using the repository's public CI-only Customer and Supplier test keys. Full client suite, repository ESLint and client production build passed; the build retained only the existing bundle-size warning.
- Mocked local Inventory Playwright passed 4/4 after the merge, covering the desktop and 375 px flows, permissions, 409 retention and error/empty states. `git diff --check`, module-boundary validation and traceability validation passed.
- Multi-axis post-merge self-review found no open critical or high correctness, security, architecture, performance or maintainability issue. These are local developer checks; CI was explicitly excluded by APR-029.
- [PR #148](https://github.com/crazysumsum/erp-app/pull/148) and corrective [PR #150](https://github.com/crazysumsum/erp-app/pull/150) are present in current `main`; the former Inventory branch and worktree have been removed.

## Approved physical allocation

| Prefix | Migration | Owner |
| --- | --- | --- |
| `0055` | `seed_inventory_permissions` | P0-T03 |
| `0056` | `create_inventory_operations` | P0-T05 |
| `0057` | `create_inventory_audit` | P0-T05 |
| `0058` | `create_inventory_master` | P1-T01 |
| `0059` | `create_inventory_stock` | P1-T05 |
| `0060` | `create_inventory_movements` | P1-T05 |
| `0063` | `create_inventory_reservations` plus P2 downstream permission seed | P2-T01／T05 |
| `0064` | `create_inventory_transfers` | P3-T01 |
| `0065` | `create_inventory_stocktakes` | P4-T01 |
| `0066` | `create_inventory_opening` | P5-T01 |

## Boundaries

- No shared／production database access, deployment, Technical Acceptance or UAT has occurred.
- TASK-005 migration execution occurred only under `HD-012` in its disposable schema; no other project migration was executed there.
- TASK-005 historically created `0055_create_inventory_operations.js` and `0056_create_inventory_audit.js`; they are now `0056` and `0057` under the approved allocation.
- TASK-006 created only the two approved services, one shared safe-JSON helper and the three planned focused test files.
- TASK-007 created only the approved lock／validation services, test support and focused tests; the smoke test's minimal DDL was disposable and is not a migration or product schema authority.
- TASK-008 historically created the HD-019-approved `0057` migration, inspector and focused tests; it is now `0058` under the approved allocation. Its prior execution remains historical evidence under the old filename.
- TASK-009 created only the HD-020-approved service, projection and focused tests; both MySQL executions were confined to disposable TASK-009 schemas.
- TASK-010 created only the approved handlers, schemas, client service, focused tests and narrow master-service query extensions; it did not create Stocktake persistence or UI code.
- TASK-011 created only the approved responsive UI, shared Inventory menu entry, focused component tests and mocked Playwright suite; it did not create persistence or start TASK-012.
- TASK-012 created only the approved stock and Movement persistence plus its focused test; it did not start TASK-013.
- TASK-013 created only the approved pure quantity, expiry, Lot／tracking and projection rules plus focused tests; it did not start TASK-014 or change persistence.
- TASK-014 created only the approved posting service, handler/schema updates and focused tests. It added no production migration and reused the approved Inventory `0055`～`0060` history.
- APR-036 authorized the guarded TASK-014 MySQL run and exact cleanup. CI, push, PR and merge remain explicitly excluded.
- TASK-015 created only the approved downstream Receipt contract methods and focused tests in existing TASK-014 files. It did not add Issue, persistence, routes, migrations or database execution.
- TASK-016 created only the approved inquiry service, read-only handlers/schemas and focused tests. It did not add UI, write routes, migrations or database execution.
- TASK-017 created only the approved inquiry UI/client/tests plus the HD-040-approved read-only SKU aggregate endpoint needed for correct server pagination. It did not add writes, migrations, database execution or begin TASK-018.
- TASK-018 added only the guarded capacity/security/concurrency tests, two measured root-cause fixes and the minimum reusable Warehouse race fixture alignment. It added no business feature, migration, dependency, CI or remote action.
- TASK-019 added only the approved Reservation／Allocation migration and guarded focused integration test. It did not start TASK-020, add a dependency, run CI or perform any remote action.
- TASK-020 added only the local Reservation service, operation replay summary fields and focused tests. It did not start Allocation implementation, add a migration or dependency, run CI or perform a remote action.
- TASK-021 added only the approved candidate ranking／lookup, Allocation create, override evidence and focused tests, followed by the separately approved guarded MySQL integration test. It did not start release／reallocate／Issue, add a migration, run CI or perform a remote action.

## TASK-020 local developer evidence

- Focused service tests passed 4/4; lint passed. Full server suite with the repository's public CI-only test keys passed 1962, failed 0, skipped 330. A first sandboxed suite run could not bind localhost (`listen EPERM`); rerunning with local socket permission and the required test keys passed.
- MySQL 26.7.0 integration passed 1/1 in `erp_inventory_task020_20260928_1630`: two independent transactions crossed a barrier after initial consistent reads, then competed for the same Stock Control. Exactly one Reservation succeeded, the other failed `INSUFFICIENT_ATP`; source replay and conflicting replay were checked.
- Expiry crossing to the next day yielded `rawAtp = -3` and `uncoveredReserved = 3` without deleting the existing Reservation. Partial release, stale version rejection, terminal cancel and injected Audit failure rollback preserved Reservation, Stock Control, operation and Audit consistency.
- The exact disposable schema was dropped, the isolated port 3320 listener stopped and `/private/tmp/erp-inventory-task020-mysql-2670.JHx2FZ` removed. No shared or production schema was used. These are IMPLEMENT-stage developer checks, not formal `TC-005`, CI, independent approval or business acceptance.

## TASK-021 local developer evidence

- Candidate lookup returns eligible free quantity, Balance version and deterministic FEFO／FIFO rank. Allocation create rechecks Reservation and Balance versions, free quantity, unallocated Reservation capacity, active Bin and Stocktake locks before updating allocated quantity; On Hand is unchanged.
- Sequence deviations require a 5～500-character reason; FEFO deviation additionally requires fresh `inventory.fefo.override` permission. Allocation and FEFO override Audit evidence, operation replay and rollback on required Audit failure are covered by focused tests.
- Focused candidate／Reservation tests passed 13/13; full server developer suite passed 1,971, failed 0, skipped 330 using the repository's public CI-only test keys. Repository ESLint, module-boundary validation and `git diff --check` passed. The prior provided-contract hash mismatch was corrected in `f03e537` under separately approved DESIGN／PLAN baselines; traceability structure now passes.
- `APR-052` separately authorized the guarded MySQL run below. It is IMPLEMENT-stage developer evidence, not formal `TC-005`; no CI, push, PR or merge was performed.

### TASK-021 guarded developer integration cases

| ID | Priority／risk | Preconditions and data | Steps／input | Expected persisted result and required evidence | Status |
| --- | --- | --- | --- | --- | --- |
| DEV-021-DB-01 | P1／SQL and FEFO integrity | Fresh disposable MySQL 26.7.0 schema with Inventory `0055`～`0061`; one Active Reservation and eligible expiry Lots in Active Bins | Query candidates; create recommended Allocation; replay; attempt a row-local quantity-constraint violation | Stable FEFO order and free/version projection; `ACTIVE` Allocation and Audit persist once, On Hand stays unchanged, invalid quantity update is rejected by MySQL; service output plus table rows／error code | PASS — FEFO IDs／expiry／free／version matched; one `ACTIVE` Allocation and Audit, stable replay, unchanged On Hand, invalid update returned `ER_CHECK_CONSTRAINT_VIOLATED` |
| DEV-021-DB-02 | P1／oversubscription race | Same schema; one Reservation and Balance with enough stock for only one competing request | Launch two independent Allocation transactions with distinct source events and a barrier before current-state reads | Exactly one commits, the other gets a concurrency/version/capacity rejection; outstanding Allocation and Balance allocated never exceed Reservation or On Hand; two-connection result plus table rows | PASS — one committed, one rejected `VERSION_CONFLICT`／`CONCURRENT_OPERATION`; one Allocation for quantity 3 and Balance stayed On Hand 5, allocated 3, version 2 |
| DEV-021-DB-03 | P1／atomic rollback | Same schema; valid remaining Reservation capacity | Inject required Audit failure after attempted Allocation writes | Reservation version, Balance allocated, Allocation／operation／Audit row counts stay identical to the pre-command snapshot; before／after table rows and error | PASS — injected Audit failure rejected the command; before／after persisted snapshot matched exactly |

The focused MySQL suite passed 4/4 (parent plus three cases), failed 0, on a socket-only MySQL 26.7.0 instance using `erp_inventory_task021_20260928_1728`. The exact schema was dropped, the instance shut down, and its temporary root removed; no shared or production database was touched.

After this change, the complete local server suite passed 1,971, failed 0, skipped 331 (the new guarded test is skipped outside its explicit MySQL opt-in). Repository ESLint, module-boundary validation, traceability structure validation and `git diff --check` passed.

## TASK-022 local developer evidence

- Allocation release updates only the matching Balance hold and Allocation outstanding; source cancel releases active holds before closing the Reservation. Reallocate releases and creates holds under one operation and transaction, with rollback on stale destination or required Audit failure.
- Issue consumes only matching Reservation／Allocation／Balance lines in Base UOM. It checks versions, active locations, Stocktake locks, available status and Lot remaining life; each line writes one immutable Movement while the same transaction updates On Hand, allocated, Control reserved, Reservation outstanding／consumed, Allocation outstanding／consumed, operation replay and Audit.
- Focused Reservation／Allocation／Posting tests passed 39/39, including two Allocations sharing a Balance, 100-line release replay within the operation-summary limit, mismatched bucket, expired／short-life Lot, locked Bin and Audit-failure rollback. The full local server suite passed 1,984, failed 0, skipped 331 using public CI-only test keys; repository ESLint, module-boundary and traceability-structure validators, and `git diff --check` passed.
- At this earlier local-only checkpoint, no TASK-022 MySQL execution or real concurrency test had occurred; the guarded run below was separately approved afterward. Formal `TC-004`／`TC-005`, CI, independent review, push, PR and merge remain open. TASK-023 owns the Issue HTTP route and provider-fixed contracts; generic Reverse Issue belongs to the later P3 posting scope.

### TASK-022 guarded developer integration cases

`HD-051`／`APR-054`: Sam approved a fresh isolated socket-only MySQL 26.7.0 developer run, exact test-owned cleanup and no CI／publication.

| ID | Priority／requirement risk | Preconditions and data | Steps／input | Expected persisted result and required evidence | Status |
| --- | --- | --- | --- | --- | --- |
| DEV-022-DB-01 | P1／TC-005 Allocation transition integrity | Fresh disposable MySQL 26.7.0 schema with Inventory `0055`～`0061`; one Reservation and two eligible Lot Balances | Allocate, partially release and replay; reallocate remaining hold; cancel source | Only matching Balance holds change; Reservation／Control quantities stay aligned until cancel; replay has no second effect; final Allocation／Balance／Reservation／Operation／Audit rows are consistent | PASS — fresh-schema retest; first-run Audit failure retained below |
| DEV-022-DB-02 | P1／TC-004 and TC-005 Issue atomic posting | Same isolated schema; separate Reservation with two eligible Allocation lines | Issue both lines, replay same source and reject changed payload | On Hand, allocated, Control reserved, Reservation／Allocation consumed/outstanding agree; exactly one Movement per line and one Issue Audit／operation; persisted row values and conflict code | PASS — fresh-schema retest; first-run Audit failure retained below |
| DEV-022-DB-03 | P1／TC-004 and TC-005 rejection／rollback | Same schema; allocated Lots crossing eligibility date, mismatched Balance reference and injected required Audit failure | Attempt each invalid Issue after a persisted-state snapshot | Stable rejection; every current-state, Movement, Operation and Audit row remains identical to its pre-command snapshot | PASS — persisted snapshots equal in both runs |
| DEV-022-DB-04 | P1／TC-005 lost-update race | Same schema; one outstanding Allocation; two separate MySQL connections and distinct source events | Release the Allocation and Issue it concurrently from the same versions | Exactly one commits and the other returns a stable conflict; no negative or duplicate quantity effect; final persisted Allocation／Balance／Reservation／Control and Movement totals reconcile | PASS — fresh-schema retest; exactly one winner |

The initial guarded run against `erp_inventory_task022_20260929_0854` found `DEF-002`: both Allocation release and Issue used quantity fields missing from the shared Audit summary allowlist, so MySQL transactions rolled back at Audit. DEV-022-DB-03 passed; the other three cases failed. A focused Audit regression test reproduced the failure before the five exact quantity fields were allowlisted and passed after that local correction. The retest on a recreated empty schema passed 5/5 including the parent test, failed 0. Focused local tests passed 46/46; the full server suite passed 1,985, failed 0, skipped 332. Repository ESLint, module-boundary and traceability-structure checks passed. These are IMPLEMENT-stage developer checks, not formal `TC-004`／`TC-005`, independent review or business acceptance.

The exact `erp_inventory_task022_20260929_0854` schema was dropped and confirmed absent; the private MySQL process was shut down, its socket／PID disappeared, and `/private/tmp/erp-inventory-task022-mysql-2670.AdPesg` was removed and confirmed absent. Only disposable synthetic test data was deleted; no shared or production database was touched.

## TASK-023 local developer progress

- Direct Reservation／Allocation／Issue HTTP contracts and client methods remain local on the P2 branch. The direct Inventory Issue route still requires `inventory.view`＋`inventory.operation`; its security regression test now includes the route in the endpoint count.
- Under Sam-approved DESIGN `c4ef4c1b9cadee1c87a4b3041a080ee005fa5533c33d266dea4b0c3013240843`, PLAN `00f237d83e9933f5c3f6c014be8ec3ea3ff30fd25c57c8770933320e6691fa38` and shared-path scope, `0061` now idempotently seeds `sales.operation`／`fulfillment.operation` without role grants. The catalogue and seed-convention test match both names and descriptions.
- Sales Reservation and Fulfillment candidates／Allocation／Issue provider entry points fix permission, purpose and source mapping, reject caller-supplied authorization or source module, require caller-owned transactions and recheck current actor permission. Focused tests exercise one-transaction rollback, revoked permission and successful Sales／Fulfillment commands without `inventory.operation`.
- Focused Inventory and permission-convention unit checks passed; repository ESLint, traceability structure, module boundary and `git diff --check` passed. The local full server suite passed on rerun with public CI-only test fixtures and localhost test sockets. Its first correctly configured run hit an unrelated nondeterministic Supplier crypto test: the test “flips” the first auth-tag byte by setting it to zero, which leaves a legitimately zero byte unchanged; no Supplier code was changed.
- `HD-062`／`APR-065` separately approved one isolated MySQL 26.7.0 developer check. The guarded `0055`～`0061` migration test passed 1/1 in `erp_inventory_task023_20260929_0843`, verifying both permission rows and idempotent rerun alongside existing Reservation／Allocation DDL. The exact schema was dropped and confirmed absent; the socket-only server stopped (PID `84678` and socket gone), and `/private/tmp/erp-inventory-task023-mysql-2670.1hnRxU` was removed and confirmed absent. Only disposable synthetic data was deleted.
- TASK-023 is not yet marked DONE: complete integration/review evidence and the P2 candidate gate remain open. These are IMPLEMENT-stage checks, not formal `TC-004`／`TC-005`, CI, independent code approval, push, PR or merge.

## TASK-024 local developer progress

- Local commit `e415898` adds the Reservation list/detail and Allocation panel. The detail separates original, consumed, released and outstanding quantities; uncovered stock has a written next step. Candidate order and ATP are read from the server, not recomputed by the UI. FEFO deviation without permission cannot submit; an allowed sequence deviation requires a reason. A conflict keeps the entered quantities while reloading candidates for explicit recheck.
- `HD-063`: Sam approved the interim source-link fallback because no Sales Order or Fulfillment frontend destination exists. The UI displays and copies module, document type, document ID, line ID and event ID; it does not render a broken deep link. Direct Inventory allocation uses `INVENTORY / MANUAL_ALLOCATION` source identity, not a forged Sales or Fulfillment source.
- Playwright against the running client with an isolated mocked API passed 7/7 technical browser cases: keyboard detail, source copy, success/conflict, authorized and denied FEFO deviation (including 375px), invalid/empty/error states and candidate pagination. Browser console/network had only the two deliberately mocked 409/503 responses. Client unit suite passed 687/687; production build and scoped ESLint passed. These checks do not prove a real API/database end-to-end flow or formal acceptance.
- TASK-024 remains pending review and the P2 candidate gate. TASK-025 guarded real MySQL/API checks are recorded below; formal Technical Acceptance remains separate.

### TASK-025 guarded developer test cases (not formal TC-004／TC-005)

`HD-064`: Sam approved a new disposable `erp_inventory_task025_*` schema on a socket-only local MySQL 26.7.0 instance, synthetic data, `0055`～`0061` migration execution and exact cleanup. Every case starts `NOT RUN`; API and DB results must be observed separately.

| ID | Priority／requirement risk | Preconditions and data | Steps／input | Expected persisted result and required evidence | Status |
| --- | --- | --- | --- | --- | --- |
| DEV-025-DB-01 | P1／FR-046～048, TC-005; ATP oversell | Empty isolated schema; one Active Warehouse/Bin, SKU with 10 eligible units across two Lots; two MySQL connections | Synchronize concurrent Reservation create 7＋7 with distinct source events | At most one success; loser has stable conflict/insufficient code; Control reserved equals Reservation outstanding SUM and does not exceed eligible 10; Operation/Audit count matches committed effect | PASS — real MySQL 26.7.0, one winner; persisted Control 7, Reservation SUM 7, eligible On Hand 10 |
| DEV-025-DB-02 | P1／FR-054～058, TC-005; lost update | Separate Reservation with 5 units, two Lot Balances and one outstanding Allocation; three connections | Race new Allocation, Issue and Allocation release from the same versions; inspect all relevant rows | Exactly one versioned command commits; no negative or over-allocated Balance; Reservation/Allocation/Control/Movement and Audit reconcile; losers have stable conflict codes | PASS — corrected fixture, one winner; persisted quantity/version, operation and Audit assertions passed |
| DEV-025-DB-03 | P1／FR-056～061, TC-005; wrong Lot | Eligible earlier/later Lots, one expired and one short-life Lot, Quarantined Balance and Inactive Bin; actor with/without override | Query ordered candidates; attempt normal and later-Lot allocation, then change Lot expiry, status and Bin; retry with/without override reason and permission | FEFO order is deterministic; unauthorized override, expired/short-life, unavailable status and Inactive Bin create no stock/Allocation effect; authorized eligible override records reason/Audit and preserves invariants | PASS — normal FEFO and authorized later-Lot success, actual role-permission grant/revocation, override reason and unchanged rejection snapshots observed |
| DEV-025-API-01 | P1／SEC-007, TC-004/005; privilege or resource bypass | Real local API bound to the disposable schema, three actors with distinct current permissions and inventory IDs | Call direct Inventory routes and provider-backed commands, revoke the caller permission between attempts, and use a cross-owner child ID | Direct HTTP and internal contracts enforce their distinct fixed permissions; revoked/stale claims and cross-owner IDs fail without state change or sensitive disclosure; response code, Audit and DB rows are evidence | PASS — real HTTP 200/403, Sales/Fulfillment provider commits, fixed source identities, stale Sales/Inventory permission rejection, cross-owner Allocation rejection, unchanged Operation/Audit counts and held quantity |

The first guarded run passed DEV-025-DB-01/03 and the four earlier TASK-022 regressions, but DEV-025-DB-02 failed because its new fixture accidentally reserved only 2 instead of the specified 5 units. The synthetic schema was dropped and recreated with the same exact name; the corrected rerun passed all 8/8 subtests, failed 0, skipped 0. This was a test-data defect, not evidence of a product failure. Attempts to start the narrow real API without earlier framework migrations failed closed on missing `fr_token_versions` and missing non-Inventory permission seeds; no product files or shared schemas were changed. The private server was then stopped (PID `87457` and socket absent), retaining only its isolated datadir/schema until `HD-065` was answered.

`HD-065`／`APR-067`: Sam then approved rebuilding only that same disposable schema with framework SQL and existing migrations `0001`～`0061` via `server/scripts/migrate.js`, excluding `init.sql` because it hardcodes `erp_dev` and creates users outside the disposable schema. MySQL `26.7.0`, socket-only (`@@skip_networking=1`) and the exact target schema were observed before reset. The safe runner applied all 64 files and its rerun skipped all 64. A narrow Inventory HTTP server started against the migrated schema. Guarded `inventoryTask025Api.integration.test.js` passed 1/1 on a real ephemeral local HTTP listener and the same MySQL schema; scoped ESLint and 23 adjacent Inventory unit tests passed. Its first run failed only because the new assertion expected the wrong cross-owner error code (`ALLOCATION_STATE_CONFLICT` is the actual documented code); after correcting that assertion, the test passed. The test uses synthetic actors, roles, Item/SKU, Warehouse/Bin, Lot and Balance. Neither CI nor a shared/production database was used. These are developer checks, not formal `TC-004`／`TC-005`, independent review or business acceptance.

After the final passing run, only `erp_inventory_task025_20260929_0915` was dropped and confirmed absent. The same private socket-only MySQL server was shut down; its socket and PID file were absent, then only `/private/tmp/erp-inventory-task025-mysql-2670.YCHhzW` was removed and confirmed absent. The disposable synthetic rows and private runtime files are not recoverable; no shared or production data was touched.

A broader `npm test --workspace server` attempt in the restricted shell did not pass because unrelated suites require Supplier Bank key-ring configuration and local listener permission (`listen EPERM`). It was rerun with process-only synthetic Bank test keys and localhost-listener permission, without persistent configuration or database access, and exited `0` with the dot reporter. Focused Inventory 23/23 unit tests and guarded real HTTP/MySQL 1/1 also passed. This is a local developer run, not CI or formal acceptance.

### P2 integration rebaseline required before main merge

At the initial `git fetch --prune origin` observation, `origin/main` was `0f20c00f443f7ee5bf929d60cedb3f587b8357d3` and had 18 commits not on the P2 branch. It owned `0061_create_supplier_import_jobs.js` and `0062_create_supplier_import_rows.js`, while P2 still owned `0061_create_inventory_reservations.js`. This was a migration-number policy collision even though the filenames did not produce a Git path conflict. The approved design §4.23 required reapproval; no merge/rebase, renumber, schema execution or P2 publication occurred before `HD-066`／`HD-067`／`HD-068` were answered.

Sam selected HD-066 option B on 2026-09-30. The approved DESIGN and PLAN now reserve Inventory `0063`～`0066` and replace the three nonexistent P2 cycle paths with actual unit, guarded DB/API and Playwright files. The guarded DB cases require their distinct test-owned schemas, flags and separate runtime authorization; a skipped case is not PASS. This is documentation approval, not new product or test execution evidence. The guarded API test proves successful Sales Reservation and Fulfillment Allocation, but only denies direct Issue without `inventory.view`; a positive Sales→Reserve→FEFO candidates→Allocate→Issue HTTP/DB trace required by P2-GATE has not yet been observed. Complete P2-GATE coverage, coverage thresholds, security audit, CI and Sam's independent P2 code review therefore remain open.

`HD-067`／`APR-068`～`APR-069`：Sam於2026-09-30批准精確DESIGN `f58d1223371a6e53fe78c34403e3172f7ab497a38a1ff0b6994095c0e920f7df`及PLAN `b86a59d33a73f5649aaff4ad0e8c086b29049b3d45965d47e024dc2638d4335b`，並作為獨立人類評審記錄`REV-043`；未提供逐項評審意見。`PLAN_READY`本機一致性檢查通過，但不代表P2實作、DB重測、CI或Phase merge已獲授權／通過。

`HD-068`／`APR-070`：Sam批准返回IMPLEMENT，僅在P2分支本機整合已核對的`origin/main` `0f20c00f443f7ee5bf929d60cedb3f587b8357d3`，將未合併Inventory Reservation migration `0061`改名為`0063`，並更新五個整合測試／permission seed測試的引用及真API測試migration總數`64`→`66`。本機`--no-commit` merge無Git衝突；檔名排序顯示Supplier `0061`／`0062`、Inventory `0063`且63支業務migration加3支framework SQL共66個runner entries。改名前權限種子測試因找不到`0063`而按預期失敗；改名後migration／權限測試12/12、Inventory相鄰unit測試37/37、Supplier相鄰unit測試22/22及全倉ESLint通過。五個MySQL gated整合測試可載入但全部按預期SKIP，並非DB PASS；沒有啟動MySQL、CI或remote action。

## Next safe action

Await separate new isolated MySQL authorization for the renumbered `0063` migration and P2 DB/API retests. Then close the positive Sales→Reservation→FEFO→Allocation→Issue gap and execute the complete P2 developer gate before separate CI／publication／review authority. Formal `TC-004`／`TC-005` remain for TEST_AND_VERIFY.
