# TASK-029 UI increment — HD105 decision history

Current resolution: Sam answered A on 2026-10-07 (HD105 ANSWERED / APR134). The bounded shared query correction, Transfer UI guards and current-source developer checks pass. Sam subsequently replied 「已審閱，批准 TASK-029」 (HD106 ANSWERED / HUMAN REV083 / APR135); TASK029 is DONE locally on unchanged source686578e6. See [verified implementation / actual Sam review](task029-hd105-ui-verified.md). The proposal and failed evidence below are historical, not the current blocker; no future-source review or publication authority is inferred.

## Outcome and baseline

Transfer client/list/detail, per-line explicit SKU/Lot Draft selection, full Dispatch confirmation and full Receive UI are implemented locally using existing Quasar/FormPanel/DataTable patterns. TASK029 remains IN_PROGRESS; overall BLOCKED pending the bounded dependency correction below. This is not UI completion, independent product approval or P3 acceptance.

Head `869ac07abdd3879254c351d857be911d71e68b6b`; current source `9d699d20b826fa6b81276d7259508f5719ab21ed710a951a096d7224f96bd475`; DESIGN `de32a25f52faeddc65234963935f44a4e73a6a505f44f52dca2283f5e6913f93`; PLAN `41949846cafde277c6887a7b572e0b3f945425d9a16f1b96517d99ca1674617c`. Original0064 SHA256 `07653bb700a40b026e8bb46b538e0e31b112d6c20010af45b4cc71a6ff7ac143` remains unchanged. Module whole-branch boundary has zero issues; the decision is about existing lock-query behavior and Phase compatibility, not a claimed boundary-tool failure.

## Verification: no false PASS

Direct current-source client service/component checks: 25 PASS; production client build exit0. These are direct development diagnostics, not substituted native gate reports. Existing Node experimental localStorage/jsdom scrollTo warnings and build chunk-size warning remain visible; no threshold or warning configuration changed.

Three native real-API Playwright attempts each discovered8 tests, 0PASS/8FAIL/0SKIP/0NOT_RUN:

- [af452d8e65](../evidence/task029-inventory-p3-browser-af452d8e65/run.json): synthetic Lot insert used nonexistent updated_at; corrected fixture only.
- [bb23562839](../evidence/task029-inventory-p3-browser-bb23562839/run.json): synthetic Lot insert omitted required sku_code_snapshot; corrected fixture only, no DDL change.
- [a289022d39](../evidence/task029-inventory-p3-browser-a289022d39/run.json): actual browser reached Draft and explicit SKU selection, but existing GET warehouse bins returned unexpected500; no source Bin option could be selected. Node Fetch diagnostic helper also incorrectly called status as a method; corrected to the standard status property after retaining this failed run. Duplicate table-cell wrapping introduced in this increment was removed. These corrections have not been promoted to a browser PASS.

Each native attempt is bound to its actual pre-correction source, never relabelled as current-source evidence. Reports, native XML, logs, screenshots and redacted failure traces remain indexed; 123 native refs retained. The inherited runner limitations text still says API/unit-only/nextUI in these historical runs; actual command, suite ID, native test leaves and browser artifacts show real-API Playwright execution. Those text labels are adapter limitations, not an assertion of UI PASS.

All three fresh socket-only MySQL26.7.0 instances applied the existing70 migration entries in owned synthetic schemas. The observed migration ledger has no inventory_stocktakes or inventory_bin_locks migration. Every attempt precisely removed its schema/app account/daemon/socket/owned root and released its API lease/caffeinate; Vite5205 absence verified. Only synthetic test data was removed and is not recoverable; evidence and unmerged worktree were retained.

## Evidence and root-cause hypothesis

The real browser failure captures unexpected500 at `/api/v1/inventory/warehouses/1/bins` and an empty source Bin selector ([screenshot](../evidence/task029-inventory-p3-browser-a289022d39/playwright-artifacts/inventory-warehouse-operat-58310-eceive-conserves-real-stock-technical/test-failed-1.png)). `InventoryMasterService.listBins` unconditionally references inventory_bin_locks in its locked projection; that table is planned only for P4/TASK035. The existing `InventoryLockService` and `InventoryPickSequenceService` already permit a pre-P4 schema only when both stocktake tables are absent, and fail closed on partial schema. This strongly identifies the missing future table as the dependency cause; a newly authorized real-DB focused retest must confirm the correction rather than claiming an unobserved SQL cause from the generic500 response.

All callers of this shared list path were inspected: ListBinsHandler serves Warehouse UI, Transfer Draft source Bin selection and Transfer Receive destination Bin selection. Fixing the shared query is preferred to client fallbacks, mocks or a fabricated inventory_bin_locks table. Other Master detail/lifecycle queries also reference future-phase tables; they are outside this bounded list-query proposal, must not be silently changed or described as fixed.

## HD105 decision

Context: current approval is TASK029 Transfer API/lookup/UI. Changing existing P1 lock-status query semantics to work before P4 affects compatibility and the lock boundary, so the affected source correction has not been applied despite the path being inside module scope.

A (recommended): approve a bounded local correction of `InventoryMasterService.listBins` and its Inventory tests, using the established pre-P4 absence rule. Attempt the normal lock query first. Only ER_NO_SUCH_TABLE plus an information_schema check proving BOTH inventory_stocktakes and inventory_bin_locks absent permits retry with locked=false. ALL/UNLOCKED return the unchanged owner/status/search/sort/page-filtered Bin projection; LOCKED returns an empty list. If either table exists, or another SQL/permission/schema error occurs, propagate failure; never ignore an active lock or partial migration. Preserve API shape, JWT/permissions, all write-side lock/owner/version/stock checks, migrations, profile/discovery/thresholds and Phase order. Add regression tests for absent/both-present/partial/error cases and verify the real Bin API plus existing actual Transfer Playwright flows, then rerun applicable current-source developer checks. This shared read fix also serves the existing Warehouse list; it does not claim other Master lifecycle/detail repairs or authorize P4 work.

B: defer the existing query correction, preserve UI work and failed evidence; TASK029 stays blocked because both source and destination Bin selection depend on this API. Waiting for P4 would conflict with the approved P3-before-P4 dependency order; no completion or bypass is inferred.

Default: wait for actual Sam decision. No change to this existing service, no fake Bin data, no extra DDL or disabling locks/authentication. A is implementation authority only; future source still requires actual independent Sam review. No commit/push/PR/remoteCI/merge/new-main/laterTasks/formalTC/UAT/release/capacity waiver. Four capacity cases remain NOT_EXECUTED at their applicable gates.
