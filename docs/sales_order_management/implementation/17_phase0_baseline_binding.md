# Decision Required — finalized Phase 0 baseline binding

DEC013 implementation/runtime adoption has been carried out. This packet requests only current-baseline DESIGN/PLAN/shared-path and unchanged NFR014/015 N/A disposition; existing commit/push/PR/merge and isolated SQL authorization is retained. No additional product scope, later Phase, formal waiver or partial-Phase merge is requested.

- DESIGN: `9cb5c5b2c618ba4f67f82a5d20a4796175dfa539fd17e375f75fb641ebf25a2b`
- PLAN: `e24686d1a20c78a25f5a1e84c0373b4909642988a741f6cf75b1dd131c727a40`

The actual17 developer-suite commands have been exercised with437 successful tests andzero skips, plus lint/build/audit PASS; retained environment/empty-schema andCI failures are documented in16_phase0_execution_checkpoint.md. A stdlib supporting-suite report adapter preserves original197 provider results without asserting their case IDs as Sales cases. Formal60 cases, all coverage/memory floors, independentreview andcompletePHASE001 merge gate are unchanged. Original machine-readable Harness execution will occur after this approval because run_check correctly requires PLAN_READY; no diagnostic logs are being imported as fabricated run metadata. Exact-headCI remains required.

## Unchanged N/A disposition

NFR014/NFR015 remain applicable to objective technical disaster-recovery verification. Only business-user UAT applicability remains N/A: timed restore/reconciliation evidence cannot be replaced by a user-observable case. Neither requirement nor its technical verification is waived. The prospective APR-PHASE0-UATNA-20261002 pointer exists without an approval record until the actual human answer.

## Shared scope already implemented and reviewable

Approve these exact current-baseline changed shared paths, with their previously authorized purpose, and retain all prior historical approvals:

- docs/customer_management/00_module_manifest.json
- docs/customer_management/03_design_spec.md
- docs/inventory_management/00_module_manifest.json
- docs/inventory_management/03_design_spec.md
- docs/items_management/00_module_manifest.json
- docs/items_management/03_design_spec.md
- server/config/api.js
- server/database/migrations/0067_seed_sales_permissions.js
- server/database/migrations/0068_create_sales_document_sequences.js
- server/database/migrations/0069_create_sales_operation_requests.js
- server/src/framework/configuration/applicationConfiguration.js
- server/src/framework/middleware/apiDispatcher.js
- server/src/framework/upload/cleanupUploadedFiles.js
- server/src/framework/upload/normalizeUploadConfig.js
- server/src/framework/upload/uploadConcurrencyGate.js
- server/src/framework/upload/uploadMiddleware.js
- server/src/modules/authorization/permissionCatalogue.js
- server/src/modules/customer/CustomerLookupService.js
- server/src/modules/inventory/InventoryOperationService.js
- server/src/modules/inventory/InventoryReservationService.js
- server/src/modules/inventory/inventoryConstants.js
- server/src/modules/item/ItemAdminService.js
- server/src/modules/item/ItemLookupService.js
- server/src/services/filetype/FileTypeService.js
- server/src/services/filetype/builtInFileTypes.js
- server/test/apiDispatcher.test.js
- server/test/applicationFactory.test.js
- server/test/configuration.test.js
- server/test/customerLookupService.test.js
- server/test/fileTransfer.test.js
- server/test/fileTransferFailureModes.test.js
- server/test/integration/inventoryTask025Api.integration.test.js
- server/test/integration/itemConcurrency.integration.test.js
- server/test/integration/itemLookup.integration.test.js
- server/test/integration/itemUpdate.integration.test.js
- server/test/integration/migrations.integration.test.js
- server/test/integration/passwordChange.integration.test.js
- server/test/integration/roleManagement.integration.test.js
- server/test/integration/userManagement.integration.test.js
- server/test/inventoryOperationService.test.js
- server/test/itemLookupService.test.js
- server/test/permissionCatalogueConventions.test.js
- server/test/uploadLimits.test.js

Option A (recommended): approve this finalized binding, then run registered developer checks in fresh disposable namespaces and merge PR174 only once thecompletePHASE001 gate/current-headCI pass.
Option B: preserve this concrete candidate as draft with approval-blocked gate.

Policy source: software-engineering-harness/references/19-state-and-recovery.md requires a new baseline-bound decision rather than rewriting old approval hashes; this is the final binding step expressly retained in DEC013 proposal step6.

## Actual final human decision

Sam answered「核准」in the current Codex chat directly to this final binding request. DEC014 is ANSWERED. New DESIGN/PLAN/shared-scope/UAT_NA records bind the exact hashes above; all historical approval records are retained. No new scope or formal waiver is inferred.
