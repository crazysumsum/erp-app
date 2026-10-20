# Fulfillment P0 implementation entry

Status: **CONDITIONAL / TASK-001 in progress**. P0 has entered implementation discovery; no product Task is DONE. The schema ownership collision below blocks migration allocation and dependent work. This report supplements, rather than replaces, the approved specifications.

## Execution authority

Sam's direct instruction in this chat on 2026-10-20:「確認 PR #256 的 CI 及審查通過後合併，然後按已批准計劃開始 fulfillment P0 開發。」This authorizes the planning PR merge and entry into IMPLEMENT for PHASE-001 / TASK-001–011 under the existing checkpoints. It does not resolve newly discovered ownership or contract conflicts.

| Baseline | Observed value |
| --- | --- |
| Branch / worktree | `codex/fulfillment-p0-foundation` / `/private/tmp/erp-fulfillment-p0` |
| Default / entry commit | `76223f40480d94a1d3a2ae6e0e7b91292bd98b82` |
| Entry tree | `2d705e39fcb30f3ad6ee485a3a4219b646180e0a` |
| Entry source fingerprint | `aa361a2af16fd72193d829b5fa354e9b4cbd396423eac7264261ecfed86db73c` |
| Approved DESIGN | `feef0869d0d3d1814ce5ab9a08e885ef84c49e578bfbf24269ff106b0aa69ce8` |
| Approved PLAN | `a229fd571382e42dbc0e88c896bd06aeed12bf4e5e3b4622a58bc69197aead38` |

The primary checkout was clean and fast-forwarded to the fetched merged main before creating this isolated worktree. Approved requirement/design/plan/TC/UAT bytes remain unchanged. Developer work uses the harness and minimal incremental changes with TDD; independent review is recorded only where a separate reviewer actually ran.

## PR 256 merge evidence and process deviation

PR [256](https://github.com/crazysumsum/erp-app/pull/256) merged at `2026-10-20T09:17:09Z`, merge SHA `76223f40480d94a1d3a2ae6e0e7b91292bd98b82`. Its parents are `cb70aacc18d5c825f2af990079ef5e1f61996e9f` and published head `f02c73633dbd0066593be0c25a3da35e17edf808`.

Before merge, exact-head [CI run 39397867552](https://github.com/crazysumsum/erp-app/actions/runs/39397867552) completed 13/13 jobs SUCCESS, with zero skipped jobs. Reviewer `/root/fulfillment_independent_review` performed R3 (`SEPARATE_AGENT`) on that exact head: APPROVED, no open CRITICAL/HIGH/MEDIUM. There was no submitted GitHub review; no such approval is claimed. Observed branch protection was absent and rules were empty; normal merge used the exact head check, without an admin bypass.

**Process deviation:** final fetch showed main had advanced from `35af2ab7` to `cb70aacc` through Supplier PR 255, but the coordinator trusted the PR API's stale base snapshot and merged without first integrating the moved target into the topic branch. This violated the target-freshness procedure. It cannot be rewritten as a premerge integration review.

R4 was a genuine **postmerge** content impact review by the same separate agent at merge SHA `76223f4`, result APPROVED, 0 open CRITICAL/HIGH/MEDIUM. Compared with the reviewed head, only three Supplier documents and `server/test/integration/supplierMigrationAcceptance.integration.test.js` changed. Product source, migrations, configuration, packages, CI, client and Fulfillment specification/contracts were unchanged. R4 checked the new test's syntax and isolated scratch-DB/process pattern; it did not execute native MySQL tests.

The merge SHA's own [CI run 39399562600](https://github.com/crazysumsum/erp-app/actions/runs/39399562600) is the corrective runtime gate. At initial entry observation it was IN_PROGRESS. Product writes wait for its actual successful completion; the earlier head's green run is not substituted for it.

## TASK-001 provider inventory

Owners are Sam as ERP Product Owner and the respective provider module maintainers. A source pin or passing unit suite is not provider-owner approval of a new contract.

| Provider / real symbol at entry | Core observation | Fulfillment extension disposition |
| --- | --- | --- |
| Sales: `SalesOrderLifecycleService`, `SalesFulfillmentGuardService.assertAllowed`; order/line/reservation mappings from migrations 0073–0079 | Core PRESENT; fail-closed lifecycle guard PRESENT | **BLOCKED / TASK-004:** `SalesFulfillmentService`, `getOrderForFulfillment`, `lockLinesForFulfillmentInTransaction`, `applyFulfillmentResultInTransaction` absent. Projection, exact sets, decimal-string boundary, Confirm/Reversal and same-transaction rollback still require implementation and owner review. |
| Inventory: `InventoryReservationService.listFulfillmentAllocationCandidatesInTransaction`, `allocateForFulfillmentInTransaction`, `releaseFulfillmentAllocationInTransaction`, `reallocateFulfillmentAllocationInTransaction`; `InventoryPostingService.postFulfillmentIssueInTransaction` | Named single-reservation core PRESENT; permission/source fixed by provider | **BLOCKED / TASK-005:** complete sorted batch contract, exact-set/version/actor proofs and dedicated reversal Reservation restoration remain absent. Existing Number safe-integer inputs do not establish the approved decimal-string wire contract. |
| Customer: `CustomerLookupService` transaction-aware address/contact assertions | Shipping ownership/purpose/version core PRESENT | **BLOCKED / TASK-006:** Fulfillment consumer wiring, common context and same-transaction revalidation proofs still required. |
| Item: `ItemLookupService.getInventoryProfileInTransaction` | Transaction profile core PRESENT; retains serial/tracking/lifecycle facts | **BLOCKED / TASK-006:** Fulfillment sorted batch/submit integration and owner-reviewed decimal-string adapter remain required. Pool-based generic `assertUsable` is not a substitute. |
| Fulfillment lifecycle | No real provider on entry main | **BLOCKED / TASK-011:** minimum real provider, registration and installation probes must accompany the complete P0 artifact; Sales P4 now has overlapping unmerged work below. |

Entry developer check: `node --test --import ./server/test-support/testEnv.js --test-reporter=spec server/test/inventoryProviderContracts.test.js server/test/customerLookupService.test.js server/test/itemLookupService.test.js` — **76 PASS, 0 FAIL, 0 SKIP** on `76223f4`. This is existing-core unit evidence, not Checkpoint 0B or formal TC/UAT acceptance. `npm ci --offline --ignore-scripts` installed the unchanged lockfile successfully; no dependency change was made. Entry `npm run lint` also passed.

## Migration inventory and ownership conflict — HD-008

Entry main contains 85 migration files (84 JavaScript, one SQL), unique numeric prefixes, highest `0087_fix_supplier_sku_refs_sku_foreign_key.js`. No historical migration was edited or executed here. `0088` is next on main but is **not free for independent allocation**: the active Sales P4 branch already contains 0088–0093.

Observed Sales P4 branch `codex/sales-order-phase-4-archive` at `d01162f6159ec40981453d00936fb713296f35a3` in `/Users/sam/.codex/worktrees/sales-p4-archive/erp-app`:

- 0088–0090: Sales Archive batches/tables/Export jobs.
- 0091 `create_fulfillment_archive_prerequisites`, 0092 `create_fulfillment_archive_mirrors`, 0093 `protect_fulfillment_archive_contracts`.
- Committed `server/src/modules/fulfillment/fulfillmentArchiveDatabaseSchema.js` and `fulfillmentArchiveSchema.js`; additional dirty/untracked lifecycle-provider and archive-service work exists. This worktree belongs to another active stream and was inspected read-only.
- Its line constraint currently requires `allocated_base_quantity <= planned_base_quantity`. The approved P0 design §3.3 requires cumulative historical allocation/release accounting under reallocation, so these semantics need explicit reconciliation before reuse. Presence of schema/history also activates Sales' requirement for a real lifecycle provider.

**TASK-001 migration allocation is BLOCKED.** No 0094+ reservation or distributed lock is claimed. The eight logical slices in design §9.3 must be allocated once from fresh main after ownership/merge order is settled. Do not copy, delete or overwrite the other worktree's work or run its schema here to sidestep the conflict.

## Coordinated scope — A adopted

**Adopted A:** keep this approved Fulfillment P0 plan authoritative for Fulfillment active quantities/schema and lifecycle behavior. Coordinate with the existing Sales P4 stream before further overlapping schema/provider writes, retain valid Archive work, and reconcile it to the approved design. Authorize the coordinator to send the concrete conflict and ownership direction to that existing chat. Allocate migrations from fresh main after agreement; preserve Checkpoint 0B, one complete P0 PR and every existing test/review gate. This avoids two implementations but may require Sales P4 rework and waiting at its Archive dependency.

**Rejected alternative B:** wait for Sales P4 to finish and merge, then requalify Fulfillment P0 against its actual schema/provider contracts. This avoids concurrent ownership but delays P0 and may require new design/plan approval if the merged semantics differ.

Sam explicitly selected A in this chat on 2026-10-20 after the above concrete conflict/options were presented. The coordination message was sent to existing `sales_order_management` chat `01a0f0e2-2647-7dc2-a1d4-a7cefa29d0f6`; Sales P4 has acknowledged pausing overlapping schema/provider writes; its concrete handoff/allocation response remains to be observed. This resolves the human ownership direction, not the actual migration allocation or contract proof.

The approved concrete implementation path scope is the existing Fulfillment-owned paths plus the P0-required shared paths: `server/src/modules/authorization/permissionCatalogue.js`, new numbered files in `server/database/migrations/` after allocation, `server/src/framework/configuration/applicationConfiguration.js` for actual startup validation, `server/test/permissionCatalogueConventions.test.js` for new seed discovery, and `client/src/framework/http/errorMessages.js`. Provider additions/edits are confined to the Sales, Inventory, Customer and Item paths already identified in the approved manifest and TASK-004–006; their exact wire contract still requires owner review before implementation. No other module or quality threshold is implicitly changed. Application-configuration wiring and the shared convention test are necessary TASK-002 integration paths missing from the current manifest; record any scope/plan amendment and renewed decision before changing them.

After TASK-001 allocation is resolved, split TASK-002 before writing code: 2A bounded configuration + startup guard; 2B allowlists/errors + public mapping; 2C permission catalogue + idempotent seed/conventions. TASK-003 follows only after TASK-002's full criteria pass. These are execution slices within existing IDs, not additional Phase/Task IDs or relaxed DoD.

## Runtime and next gate

Only FILES checks and synthetic unit data have run. This worktree's dependencies are local and ignored. No database, port, external transaction or persistent service is allocated. Native schema execution requires a separately authorized, owned disposable MySQL 26.7.0 runtime; live Sales quiesce/install/register/probe/resume remains a separate explicit gate. The current report does not claim either authority or runtime evidence.

Next safe action: confirm merge-SHA CI, observe the existing schema stream's coordination response, then finish TASK-001 migration allocation and implement the approved TASK-002 slices. TASK-007–010 remain blocked by Checkpoint 0B. All 45 Tasks remain not DONE; Technical Acceptance, business UAT and release approval remain unexecuted.
