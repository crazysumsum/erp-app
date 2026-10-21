# Sales provider source contribution for complete Fulfillment P0

Status: Sales source and developer component verified; **TASK-004 / Checkpoint 0B / P4 joint validation remain incomplete** until the real Inventory provider and consumer are executed. Delivery remains the complete P0 PR first, full P4 afterward. This report does not authorize a partial phase merge or declare CI green.

## Material behavior

`SalesFulfillmentService` implements the three approved methods with fresh actual-context Fulfillment permissions, canonical string IDs/quantities, exact selected Lines (including explicit zero Lines), and caller-bound transactions. Shipment commands preclaim a dedicated existing0069 source journal before Sales root/Line/mapping locks; a private transaction receipt binds the full intent and Inventory request hash. Pure CLAIM locking creates no result journal. Completed replay returns the original result and checks the complete stored codec.

Apply requires the real injected `inventoryFulfillment.verifyFulfillmentBatchReceiptInTransaction` result and exact current Reservation states. It preserves0078 original Sales reserve operation/event identity, validates all locked mapping totals and conservation, updates only the selected quantities/CAS versions, and appends history/audit. Reversal checks the original completed confirmation before Sales locks, preserves Cancelled/Backorder, reopens according to remaining Fulfilled quantities and permits a different fresh reverser when the original confirmer FK was set NULL.

The Sales display projection uses Item's existing **nonlocking owner lookup**. The real locking Item batch belongs after Fulfillment/Shipment roots in the consumer's Phase B; Sales does not take those master locks early. Missing native Inventory verification stays fail-closed. No Fulfillment schema, migration allocation or Inventory rule implementation is added.

## Observed developer verification

- Related Sales unit regression: **85 PASS / 0 FAIL / 0 SKIP**, private `sales-provider-related-unit-r3.log`. Includes the new intent/source/quantity cases, strict legal5000/illegal5001 boundary and existing Sales cases. The existing catalogue test now explicitly verifies Export422 and the new contract503, retaining a strict total41 in this P4 worktree and every per-code metadata assertion.
- Final native suites: **19 PASS / 0 FAIL / 0 SKIP**, private `sales-fulfillment-native-green-r8.log`, socket-only owned MySQL26.7.0 at nice10/serial concurrency. Both exclusive nonce schemas were cleaned by their fixture.
- Native split: **12** cases (parent included) exercise real Item lookup, Sales locking, CLAIM without journal, source-before-Sales transaction behavior, authorization/version/whole-mapping failures, malformed owner DTO rejection and rollback. **7** cases (parent included) explicitly use an **Inventory verifier test double** to isolate Sales SQL apply/audit/history/replay/reversal codec and late-failure atomicity. The latter do **not** prove Inventory source/receipt eligibility or satisfy the real owner/joint Gate.
- Scoped ESLint passed all changed source/test files. Prior missing-module REDs, native r2 transaction-wrapper assertion failure, fixture-refactor failures and the two real malformed-DTO RED-r5 cases remain private and are not erased or rebound as PASS.

R2 independent review (`8143b094…`) required the stable malformed-DTO guards. R3 independently reviewed the exact ten source/test files and closed that finding: `sales-fulfillment-service-r3-reviewer-proof.json`, SHA256 `0a23f0126ecb34c924bfbbd0f9795cc00b83468c9ec0e9c7e614ebd2c387f676`, **APPROVED_SOURCE_AND_SALES_COMPONENT_ONLY**, zero required findings. Original R1 findings and R2 review are retained. The pure quantity component has its separate earlier scoped review (`f3116225…`).

## Exact named P0 handoff

P0 baseline: `b5afe3cab156f60e53648f6d319b9e285a8e2b41`. Private patch `p0-sales-provider-source-contribution-r1.patch`, SHA256 `fc24110e462eae09e3c8ae409c01eefb54793f2a0d01fd470bf19ab47ca310c2`; manifest SHA256 `015b8fe66cfc875ce96d244697a3a171c569362eae9820cfc493e718e4b1de13`. The read-only `git apply --check --whitespace=error` against P0's actual unchanged three inherited files exited0. P0 worktree was not modified.

Seven additions retain exactly the reviewed bytes:

- `server/src/modules/sales/SalesFulfillmentService.js`
- `server/src/modules/sales/salesFulfillmentQuantities.js`
- `server/test/salesFulfillmentService.test.js`
- `server/test/salesFulfillmentQuantities.test.js`
- `server/test/integration/salesFulfillmentService.integration.test.js`
- `server/test/integration/salesFulfillmentTransactionComponent.integration.test.js`
- `server/test/sales/phase4/salesFulfillmentFixtures.js`

Three inherited files require **minimal P0-baseline patches**, never wholesale P4 file copying: `SalesAuditService.js` adds only two fixed actions; `salesErrors.js` adds only the approved contract503; `salesConfig.test.js` adds that assertion and changes P0 total39→40. This worktree's Export code and total41 are intentionally absent from that patch. The native fixture is self-contained on existing main/approved0088 and the existing phase1 currency helper; it imports no unpublished P4 mirror/Export or withdrawn owner fixture.

Consumer-targeted patch review is recorded separately from R3; no old review hash is rewritten. The owner must inspect/apply the exact patch, run local current-baseline checks, then execute real Inventory/Item/Sales consumer/native contracts, concurrency/replay/rollback/lock-order and capacity evidence. Adopt only the named source contribution into the complete P0 candidate. All original P0/P4 requirements, CI, reviews and merge Gates remain mandatory.

Consumer-targeted transplant review completed: `/root/def016_runtime_recovery_review`, zero required findings, proof SHA256 `a72b6c4d17c27a84f01155e0509face8966965c0fcf04c52fc2641d4c1023f89`. It independently reconstructed all ten target files and confirmed the same read-only apply check. It does not replace P0 consumer execution or any Gate.
