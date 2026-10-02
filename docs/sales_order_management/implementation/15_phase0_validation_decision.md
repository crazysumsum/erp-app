# Decision Required — Phase 0 executable validation contract

Product candidate: PR174 after the reviewed correction based on71e0680d297f1e81efb3a4f84bbe7e3c364f5419; corrected source fingerprint 30bec8594508baa546c74520de13a3937656c496abe0fee3cd213d5f1515c5fb. Final committed SHA/CI are published in the PR body. TASK009–011 provider/schema code and independently reviewed corrections are implemented. Existing commit/push/PR/merge authorization remains valid subject to the complete Phase gate. No later Sales UI, worker or recovery implementation is requested.

## Context

The approved profile currently makes the full 60-case formal Sales specification a DEVELOPER requirement at Phase0. TC011 onwards need later-phase product code that is not authorized. Its repository-wide JUnit parser can also confuse the same bare TC identifier used by another module. Ordinary CI has 14 pre-existing upstream opt-in release/performance skips; that success cannot be recorded as the profile's zero-skip Sales execution result. No local MySQL execution has been authorized or performed, and the generic local runner currently has no approved database/runtime binding or registered run evidence.

## Option A — recommended

Authorize a narrow Phase0 validation-contract reconciliation, preserving all current product behavior and merge boundary:

1. Preserve sales-technical and all60 mandatory technical/regression cases for formal TEST_AND_VERIFY. No formal case is removed, marked N/A or relabelled PASS.
2. Add a developer-only Phase001 execution contract covering the actual foundation assertions for TC001–010, with explicit file/test-name attribution rather than repository-wide bare-ID matching. Scope: module manifest/profile/Phase-ledger/test-plan annotations, a minimal test-report adapter if required, and evidence/state. The assertion mapping is already reviewable in implementation/14_foundation_schema_checkpoint.md.
3. Keep lint, client build, security audit, all five current-head repository CI jobs, existing global/per-file coverage floors, independent review and zero skipped required Sales foundation cases. Retain all ten identified Inventory native integration/HTTP regressions as developer checks, executed in their separately required disposable schemas/sockets. Only the four identified large-scale upstream release/performance cases in the appendix are deferred from this Phase developer requirement; their original obligations remain pending. A new skipped case requires investigation and cannot replace an existing case in a quota. No blanket max_skipped increase.
4. Authorize only a disposable, dedicated local MySQL26.7.0 instance under a fresh /private/tmp/sales-phase0-<UUID> directory, its own schema/socket/localhost port and synthetic user/data/keys. Apply reviewed migrations and run the selected native Sales/Item compatibility tests and ten Inventory native regressions against their required separate disposable schemas/socket bindings. No shared/local existing database or production connection, DROP/reset of pre-existing data, or production credentials. Existing ephemeral CI MySQL remains the current-candidate repository gate.
5. Execute native provider snapshots, mapping-ID/writer/reference concurrency, batch reserve/release/replay/acknowledgement-loss/rollback and foundation migration/identity/FK/sequence primitives, plus the existing focused framework/unit/security tests. Register original machine-readable results and actual runtime/command identities; do not manufacture run metadata from narrative PASS claims.
6. Retain original approvals and obtain a current DESIGN/PLAN, shared-path scope and unchanged NFR014/015 N/A disposition for the finalized, independently reviewed contract baseline. Merge PR174 only after the resulting complete Phase0 gate and exact-head mandatory CI pass. Keep the PR draft and worktree until then.

Trade-off: a small amount of test-contract/report wiring and one isolated native test runtime are required. This matches the authorized Phase boundary while preserving later formal verification and all existing quality thresholds.

## Option B

Keep the current executable contract unchanged and retain PR174 as a draft. Product code is preserved, but TASK011/Phase0 exit and merge remain blocked until all60 formal cases and their later product dependencies can actually execute. This does not authorize later Phases.

Default recommendation: Option A. This is a validation-stage/runtime decision, not another provider/architecture selection or a partial-Phase merge exception.

## Policy source

software-engineering-harness/references/08-implement.md prohibits silently changing acceptance criteria or Phase boundaries. references/19-state-and-recovery.md states: “Do not rewrite an old approval's hash to make it look current. Obtain a new decision, retain the old record...” references/20-execution-contracts-and-evidence.md requires actual reviewed commands, isolated runtime authorization, original reports and complete required-case evidence. Existing implementation adoption does not let an agent turn these failures into a passing gate.

## Exact upstream skipped identities

Native regressions retained (not waived): TASK021 Allocation integrity/contention/rollback; TASK007 two-connection lock contention; TASK009 Warehouse/master lifecycle races; TASK008 Warehouse/Bin migration constraints; TASK014 posting/replay/conflict/rollback; TASK020 competing reservations; TASK019 Reservation/Allocation migration constraints; TASK012 stock/immutable movements migrations; TASK022 Allocation transitions/Issue; DEV025API01 real HTTP/provider permissions. Use each source fixture's exact required namespace/socket and opt-in flags; do not enable all flags against one schema.

Only these four release/scale cases are proposed for deferral from the Phase0 DEVELOPER contract (never formal PASS):

- Customer TC064: imports10,000 rows within release budget — server/test/performance/customerImport.performance.test.js.
- Customer TC028:100k query plans and50-user lookup mix — server/test/performance/customerManagement.performance.test.js.
- Inventory TASK018: Core Stock capacity/query-plan/two-connection gate — server/test/performance/inventoryCore.performance.test.js.
- Item TC012/T35:100kSKU/1Mbarcode/1MUOM,50concurrent/importKPI — server/test/performance/itemManagement.performance.test.js.

All paths above were verified in the selected worktree.

Native source files, respectively:

1. server/test/integration/inventoryAllocation.integration.test.js
2. server/test/integration/inventoryLockService.integration.test.js
3. server/test/integration/inventoryMaster.integration.test.js
4. server/test/integration/inventoryMasterMigration.integration.test.js
5. server/test/integration/inventoryPosting.integration.test.js
6. server/test/integration/inventoryReservation.integration.test.js
7. server/test/integration/inventoryReservationMigrations.integration.test.js
8. server/test/integration/inventoryStockMovementMigrations.integration.test.js
9. server/test/integration/inventoryTask022.integration.test.js
10. server/test/integration/inventoryTask025Api.integration.test.js

## Actual decision disposition

Sam answered DEC-013 in the current Codex chat: 「核准 Phase 0 驗證方案及隔離 MySQL（建議）」. Option A is adopted. The proposal's historical context above is retained; local SQL is now authorized and has actually executed in owned disposable instances. Final DESIGN/PLAN/shared-scope and unchanged NFR014/015 N/A binding remains a separate exact-baseline disposition under step6, without rewriting historical approval hashes.
