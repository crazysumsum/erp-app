# TASK-051 step 1 — Technical case to test map

**Purpose:** T51 requires every suite runner to emit canonical case IDs (`TC-nnn`, `UAT-nnn`), and a gate fails on a missing, duplicate or skipped ID. This map shows, for each technical case, which existing tests are candidates to carry its ID, and where no test exists.

**Baseline:** main `d9714a34`, 2026-10-14.

**Method:** test titles only. A candidate is matched on its title, not on its body. Before an ID is put on a test title, the test is read and must actually assert the case's Expected Result. A COVERED row here is a candidate, not a verdict.

## Findings that block the gate regardless of tagging

1. The three server suites in `00_project_profile.json` run `node --test server/test/supplier-management[/bank|/security]`. Those directories do not exist. Node 26 also does not expand a directory argument: `node --test <dir>` runs the directory as a file and fails. The argv must change, and the profile is part of the plan baseline.
2. Five runners the profile names do not exist: `client/test/supplier-management.vitest.config.js` and `server/scripts/runSupplier{Performance,Resilience,Recovery,Release}Acceptance.js`.
3. `supplierImport.integration.test.js:187` names two IDs, `(TC-090, TC-096)`. The harness JUnit adapter refuses a title with more than one ID, so the whole suite result would be rejected.
4. Business Master's own tests use `TC-001`…`TC-020` in their titles for Business Master cases. They must stay outside every Supplier suite's file set, or they would be read as Supplier cases.

## Summary

| Suite | Cases | COVERED (candidate) | PARTIAL | NONE |
| --- | --- | --- | --- | --- |
| supplier-server-integration | 94 | 73 | 15 | 6 |
| supplier-bank-security | 16 | 16 (already tagged) | 0 | 0 |
| supplier-security | 10 | 7 | 3 | 0 |
| supplier-client-ui | 7 | 4 | 2 | 1 |
| supplier-performance | 2 | 2 (T50 evidence; runner missing) | 0 | 0 |
| supplier-resilience | 3 | 1 | 1 | 1 |
| supplier-recovery | 1 | 0 | 1 | 0 |
| supplier-release-operations | 3 | 0 | 0 | 3 |
| **Total** | **136** | **103** | **22** | **11** |

PARTIAL means existing tests cover part of the Expected Result. The gap column says which part.

## supplier-server-integration (94)

| TC | Case | Candidate tests | Status | Gap |
| --- | --- | --- | --- | --- |
| TC-001 | MIG-001 | `supplierCoreMigrations.integration`; `supplierProviderServices` (container resolves both providers); `providerContract` (no shadow catalog) | COVERED | |
| TC-002 | MIG-002 | `supplierCoreMigrations.integration` (rerun converges); `supplierPermissionsMigration` | PARTIAL | Half-applied state is rejected, not shown to converge |
| TC-003 | MIG-003 | `supplierApproval.integration` (second pending refused); `supplierBank.integration` (two defaults); `supplierParty.integration` | COVERED | |
| TC-004 | MIG-004 | `supplierPermissionsMigration`; `migrations.integration` 0028; `supplierCoreMigrations.integration` 0036 | COVERED | |
| TC-005 | MIG-005 | `supplierConfig`; `supplierImportConfig` | PARTIAL | Config validation only; no test starts the server with each bad config |
| TC-006 | MIG-006 | — | NONE | Upgrade from main and rollback rehearsal: T51 work |
| TC-007 | MIG-007 | `supplierSkuRelations.integration` (MIG-007; UOM belongs to SKU) | COVERED | |
| TC-008 | LIST-001 | `supplierQueryHandlers` (bounded paging, archived excluded) | COVERED | |
| TC-009 | LIST-002 | `supplierQueryHandlers` (escaped search) | PARTIAL | No per-field hit, case/trim or no-duplicate-row test |
| TC-010 | LIST-003 | — | NONE | Filter combinations, missing primary/address/bank, updated range |
| TC-011 | LIST-004 | `supplierQueryHandlers` (allowlisted stable sort) | PARTIAL | No cross-page stability test on MySQL |
| TC-012 | LIST-005 | `supplierQueryHandlers` | COVERED | |
| TC-013 | LIST-006 | `client list.test`; `coreFlow.test` | PARTIAL | Empty, loading and error states not distinguished in a test |
| TC-014 | LIST-007 | `client detail.test`; `supplierQueryHandlers` (detail) | PARTIAL | Non-Active "not purchasable" hint |
| TC-015 | LIST-008 | `client list.test` (URL restore, shareable) | COVERED | |
| TC-016 | LIST-009 | `supplierSkuLookup.integration` | COVERED | API side; no Purchasing UI exists |
| TC-017 | CORE-001 | `supplierManagement.integration` (create atomic) | COVERED | |
| TC-018 | CORE-002 | `supplierLifecycleService` (activate, one audit); `supplierAdminService` | COVERED | |
| TC-019 | CORE-003 | `supplierAdminService` (approval ON → pending); `supplierApproval.integration` | COVERED | |
| TC-020 | CORE-004 | `supplierManagement.integration` (duplicate codes); `supplierNormalization` | COVERED | |
| TC-021 | CORE-005 | `supplierDuplicateCandidates` (unit and integration) | COVERED | |
| TC-022 | CORE-006 | `supplierValidation` | COVERED | |
| TC-023 | CORE-007 | `supplierValidation` (unknown fields); `supplierCreateHandlers` (closed schema) | COVERED | |
| TC-024 | CORE-008 | `supplierCreateHandlers` (idempotent route) | PARTIAL | No concurrent same-key POST on MySQL |
| TC-025 | CORE-009 | `supplierAdminService` (update) | COVERED | |
| TC-026 | CORE-010 | `supplierManagement.integration` (Code correction); `supplierAdminService` | COVERED | |
| TC-027 | CORE-011 | `supplierAdminService` (stale version); `supplierManagement.integration` (CAS) | COVERED | |
| TC-028 | CORE-012 | `supplierManagement.integration` (audit failure leaves nothing) | COVERED | |
| TC-029 | CORE-013 | `client create.test`, `editor.test` (dirty prompt) | PARTIAL | "Existing transaction snapshot unchanged": no transaction module consumes Supplier yet |
| TC-030 | STATE-001 | `supplierManagement.integration` (lookup history); `supplierLookupService` | COVERED | |
| TC-031 | STATE-002 | `supplierLifecycleService` (reactivate) | COVERED | |
| TC-032 | STATE-003 | `supplierLifecycleHandlers`; `supplierLifecycleService` (block matrix) | COVERED | |
| TC-033 | STATE-004 | `supplierLifecycleService` (archive blockers) | COVERED | |
| TC-034 | STATE-005 | `supplierLifecycleService` (restore → Suspended); `supplierQueryHandlers` | COVERED | |
| TC-035 | STATE-006 | `supplierLifecycleService` (delete); `supplierStateMachine`; `supplierSkuRelations.integration` | COVERED | |
| TC-036 | STATE-007 | `supplierManagement.integration` (purchase revalidation; impact fail closed) | PARTIAL | No two-connection ordering swap |
| TC-037 | STATE-008 | `supplierLifecycleService` (same-target replay) | COVERED | |
| TC-038 | STATE-009 | `supplierManagement.integration` (lifecycle atomic) | PARTIAL | No barrier-synchronised concurrent transitions |
| TC-039 | STATE-010 | `supplierLookupService` | COVERED | |
| TC-040 | PARTY-001 | `supplierAddressService`; `supplierParty.integration`; `client address.test` | COVERED | |
| TC-041 | PARTY-002 | `supplierContactService`; `supplierParty.integration`; `client contact.test` | COVERED | |
| TC-042 | PARTY-003 | `supplierParty.integration` | COVERED | |
| TC-043 | PARTY-004 | `supplierAddressService`, `supplierContactService` (deactivate); `supplierIdentifierService` (referenced delete) | COVERED | |
| TC-044 | PARTY-005 | `supplierParty.integration` (Identifier); `supplierIdentifierService` | COVERED | |
| TC-045 | PARTY-006 | Address, Contact and Identifier services (foreign child id) | COVERED | |
| TC-046 | PARTY-007 | `supplierValidation` (warnings never block) | COVERED | |
| TC-047 | PARTY-008 | `supplierContactService`; `supplierIdentifierService`; `supplierNormalization` | COVERED | |
| TC-048 | PARTY-009 | — | NONE | Detail child cap and server-paged child lists |
| TC-049 | APR-001 | `supplierSettingsService`; `supplierCoreMigrations.integration` 0036 | COVERED | |
| TC-050 | APR-002 | `supplierSettingsHandlers` | COVERED | |
| TC-051 | APR-003 | `supplierSettingsService` | COVERED | |
| TC-052 | APR-004 | `supplierApprovalService` (approver rules); `supplierApproval.integration` | COVERED | |
| TC-053 | APR-005 | `supplierApprovalHandlers` (projection, cap); `supplierApprovalService` (masked snapshot) | COVERED | |
| TC-054 | APR-006 | `supplierApproval.integration` (approve) | COVERED | |
| TC-055 | APR-007 | `supplierApprovalService` (reject) | COVERED | |
| TC-056 | APR-008 | `supplierApprovalService` (withdraw); `supplierApproval.integration` | COVERED | |
| TC-057 | APR-009 | `supplierAdminService` (significant edit invalidates) | COVERED | |
| TC-058 | APR-010 | `supplierSettings.integration` (not retroactive) | COVERED | |
| TC-059 | APR-011 | `supplierApproval.integration` (queue); `supplierApprovalService` (reassign) | COVERED | |
| TC-060 | APR-012 | `supplierApproval.integration` (two concurrent approves) | COVERED | |
| TC-061 | APR-013 | `supplierApproval.integration` (revoked approver) | COVERED | |
| TC-078 | SKU-001 | `supplierSkuLookup.integration` | COVERED | |
| TC-079 | SKU-002 | `supplierSkuLookup.integration` (order, ties) | COVERED | |
| TC-080 | SKU-003 | `supplierSkuLookup.integration` (SKU-003) | COVERED | |
| TC-081 | SKU-004 | `supplierSkuRelations.integration` (SKU-004) | COVERED | |
| TC-082 | SKU-005 | `supplierSkuRelations.integration` (uniqueness, UOM owner) | COVERED | |
| TC-083 | SKU-006 | `supplierSkuRelations.integration` (SKU-006) | COVERED | |
| TC-084 | SKU-007 | `supplierRelationHandlers` (SKU-007, no price) | COVERED | |
| TC-085 | SKU-008 | — | NONE | Load result exists as T50 evidence, not as a test in this suite |
| TC-086 | IMP-001 | `supplierCsvSchema` (template); `supplierImport.integration` (already tagged TC-086) | COVERED | |
| TC-087 | IMP-002 | `supplierCsvSchema` (RFC 4180, leading zeros) | COVERED | |
| TC-088 | IMP-003 | `supplierImport.integration` (IMP-003); `supplierImportConfig` | COVERED | |
| TC-089 | IMP-004 | `supplierImport.integration` (precheck writes nothing) | COVERED | |
| TC-090 | IMP-005 | same test, currently double-tagged | COVERED | Split the double tag (finding 3) |
| TC-091 | IMP-006 | `supplierImport.integration` (draft import writes valid rows) | COVERED | |
| TC-092 | IMP-007 | `supplierImport.integration` (HD-048 4) | COVERED | |
| TC-093 | IMP-008 | `supplierImportUploadHandlers` (idempotent); `supplierImport.integration` (replay over HTTP) | PARTIAL | No barrier-synchronised same-key submit |
| TC-094 | IMP-009 | `supplierImport.integration` (fault injection) | COVERED | |
| TC-095 | IMP-010 | `supplierImport.integration` (two workers); `supplierImportExecution.integration` | COVERED | |
| TC-096 | IMP-011 | `supplierImportPrecheck` (IMP-011); `supplierImport.integration` | COVERED | |
| TC-097 | IMP-012 | `supplierImport.integration` (policy snapshotted at confirm) | COVERED | |
| TC-098 | IMP-013 | `supplierImport.integration` (cancel); `supplierImportService` (counts rebuilt) | COVERED | |
| TC-099 | IMP-014 | `supplierImport.integration` (already tagged) | COVERED | |
| TC-100 | IMP-015 | `supplierImport.integration` (IMP-015); `supplierImportRetention.integration` (410) | COVERED | |
| TC-101 | IMP-016 | `supplierImport.integration` (10,000 rows within timeout) | PARTIAL | List p95 during import is T50 evidence, not a test |
| TC-102 | IMP-017 | `supplierExport.integration` | COVERED | |
| TC-103 | AUD-001 | `supplierAuditLogService`; service tests | PARTIAL | requestId and IP on each action |
| TC-104 | AUD-002 | `supplierBank.integration` (no plaintext in audit); `supplierAuditLogService` | COVERED | |
| TC-105 | AUD-003 | `supplierLifecycleService` (audit failure rolls back); `supplierBankService` | COVERED | |
| TC-106 | AUD-004 | `supplierAuditLogService` (bounded detail); `supplierApprovalService` (snapshot bound) | PARTIAL | Over-limit whole-transaction failure and alert |
| TC-107 | AUD-005 | `supplierAuditHandlers`; `supplierAuditLogService` | PARTIAL | Ordering and total across pages |
| TC-108 | AUD-006 | `supplierAuditHandlers` (read-only) | COVERED | |
| TC-109 | AUD-007 | — | NONE | Audit kept after target/actor deletion |
| TC-110 | AUD-008 | — | NONE | Epoch ms, UI timezone, CSV ISO 8601, requestId join |

## supplier-bank-security (16)

TC-062 … TC-077 already carry their IDs in `supplierBank*.integration`, `supplierBankCrypto`, `supplierBankService` and `client bank.test` / `supplier-bank.spec`. Only the runner argv is missing (finding 1).

## supplier-security (10)

| TC | Case | Candidate tests | Status | Gap |
| --- | --- | --- | --- | --- |
| TC-111 | AUTH-001 | handler permission tests; client route guards | COVERED | |
| TC-112 | AUTH-002 | handler tests per area; 0028 migration | PARTIAL | No single route-by-role matrix |
| TC-113 | AUTH-003 | `supplierLookupService` (minimal projection) | COVERED | |
| TC-114 | AUTH-004 | `supplierBank.integration` (other Supplier's row); child ownership; import job 404 | COVERED | |
| TC-115 | AUTH-005 | `supplierImport.integration` (withdrawn permission); `supplierBankService` | COVERED | |
| TC-116 | AUTH-006 | lifecycle, Bank and approval handler auth-level tests | COVERED | |
| TC-117 | AUTH-007 | closed schemas; import malformed input | PARTIAL | 415, positive-integer IDs and strict booleans per API class |
| TC-118 | AUTH-008 | `supplierBankHandlers` (no-store, closed responses) | COVERED | |
| TC-119 | AUTH-009 | `supplierNormalization` (control characters) | PARTIAL | Script rendering and prototype pollution |
| TC-120 | AUTH-010 | Code race non-disclosure; Bank 409; import fixed error pair | COVERED | |

## supplier-client-ui (7)

| TC | Case | Candidate tests | Status | Gap |
| --- | --- | --- | --- | --- |
| TC-121 | UI-001 | `list.test` (menu entry); `create.test` (direct URL guard) | COVERED | |
| TC-122 | UI-002 | `create.test` | PARTIAL | Error focus on summary or first field |
| TC-123 | UI-003 | `editor.test` (dirty prompt, draft kept on 409) | COVERED | |
| TC-124 | UI-004 | settings and approvals e2e (keyboard) | PARTIAL | Status text + icon, wording across pages |
| TC-125 | UI-005 | `bank.test`; `approvals.test` (stale) | COVERED | |
| TC-126 | UI-006 | `import.test`; `supplier-imports.spec` | COVERED | |
| TC-127 | UI-007 | — | NONE | Tokens, no inline brand hex, keyboard and focus on every page |

## Performance, resilience, recovery, release (9)

| TC | Case | Evidence or tests | Status | Gap |
| --- | --- | --- | --- | --- |
| TC-128 | OPS-001 | T50 benchmark, `performance_report.md` | COVERED | Runner missing |
| TC-129 | OPS-002 | `supplierDuplicateCandidates.integration`; `supplierListIndexes.integration`; T50 | COVERED | Runner missing |
| TC-130 | OPS-003 | — | NONE | Dependency timeout, reset and 503 |
| TC-131 | OPS-004 | `businessMasterSupplierContract` (fails closed when not READY) | PARTIAL | Health not ready, then recovers after repair |
| TC-132 | OPS-005 | `supplierObservability` (unit, integration) | COVERED | Runner missing |
| TC-133 | OPS-006 | `supplierBankRestore.integration` (Bank only) | PARTIAL | Full restore, reconciliation, RTO/RPO: T51 work |
| TC-134 | OPS-007 | — | NONE | Rollback rehearsal: T51 work |
| TC-135 | OPS-008 | — | NONE | Deployment-order smoke: T51 work |
| TC-136 | OPS-009 | — | NONE | Full regression summary: T51 release evidence |

## UAT (52)

Not mapped yet. 42 Playwright tests exist across seven specs, none tagged with a UAT ID.
