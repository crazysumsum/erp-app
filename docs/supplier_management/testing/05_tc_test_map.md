# TASK-051 step 1 — Technical case to test map

**Purpose:** T51 requires every suite runner to emit canonical case IDs (`TC-nnn`, `UAT-nnn`), and a gate fails on a missing, duplicate or skipped ID. This map shows, for each technical case, which existing tests are candidates to carry its ID, and where no test exists.

**Baseline:** main `d9714a34` for the map; the PR is based on `fcfb1721` (ledger-only change since), 2026-10-14.

**Method:** test titles only. A candidate is matched on its title, not on its body. Before an ID is put on a test title, the test is read and must actually assert the case's Expected Result. A COVERED row here is a candidate, not a verdict.

## Findings that block the gate regardless of tagging

1. The three server suites in `00_project_profile.json` run `node --test server/test/supplier-management[/bank|/security]`. Those directories do not exist. Node 26 also does not expand a directory argument: `node --test <dir>` runs the directory as a file and fails. The argv must change, and the profile is part of the plan baseline.
2. Five runners the profile names do not exist: `client/test/supplier-management.vitest.config.js` and `server/scripts/runSupplier{Performance,Resilience,Recovery,Release}Acceptance.js`.
3. `supplierImport.integration.test.js:187` names two IDs, `(TC-090, TC-096)`. The harness JUnit adapter refuses a title with more than one ID, so the whole suite result would be rejected.
4. Business Master's own tests use `TC-001`…`TC-020` in their titles for Business Master cases. They must stay outside every Supplier suite's file set, or they would be read as Supplier cases.

## Changes made in step 1 (HD-103 1A)

- Findings 1 and 3 are fixed. The three server suites now run from `server` with `--test-concurrency=1` and glob the existing files: `test/supplier*.test.js` and `test/integration/supplier*.integration.test.js`; Bank uses `supplierBank*` only. The double tag is now `(TC-090)`.
- Six cases moved suite. TC-013, TC-015, TC-029 and TC-075 go to `supplier-client-ui` (Vitest), because their only tests are client tests. TC-085 and TC-101 go to `supplier-performance`, because their Expected Result is a load measurement; TC-101 does have a partial server test (10,000 rows within the job timeout), which stays in the server suite untagged. Both target suites have no runner yet, so these six IDs cannot pass any gate until step 2 adds them: they fail closed. `min_tests` equals the required case count in each suite.
- The server suites, `supplier-phase-001-server` included, also pass `DB_ADMIN_USER`, `DB_ADMIN_PASSWORD`, `MYSQL_BIN` and the four `CUSTOMER_BANK_*` keys. `run_check` passes only listed keys: without the admin keys the Bank restore test hung, and without the Customer keys configuration refused to load. `run_check --suite supplier-bank-security --stage DEVELOPER --execute` then passed all 15 required cases (`evidence/20261014T082013-b336a4b827af`).
- After review (REV-091 on PR #226): `supplier-phase-001-server` also runs from `server` with `--test-concurrency=1`; from the repository root its integration files ran in parallel on one database and hung. The four operations suites get the `CUSTOMER_BANK_*` keys. `min_tests` floors sit near the real counts (620, 620, 135), so a glob that silently shrank would fail. `supplierBankRestore.integration` now asserts the admin keys before it opens a connection: a connection opened before the failed assert had no `t.after` yet and kept the process alive until the runner's timeout.
- Checked on erp_t51 (fresh migration, throwaway MySQL): the server glob runs 626 tests, all pass, none skipped, no duplicate JUnit names; the harness JUnit adapter parses the file once the double tag is gone.

## Summary (before the suite moves)

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

## Step 2a — IDs on server and security tests

Each carrier below was read: its assertions, not only its title, cover the case's main Expected Result. A case can have several carriers; the harness takes the worst result among them. A test carries one ID only. Smaller clauses a carrier does not assert are left to the step 2b tests where they matter.

Checked on erp_t51 with only the profile's env keys: 626 tests, all pass, none skipped; the harness JUnit adapter parses the report. supplier-bank-security has 15 of 15 required IDs, supplier-server-integration 66 of 89, supplier-security 7 of 10.

| TC | Case | Carriers |
| --- | --- | --- |
| TC-004 | MIG-004 | `supplierPermissionsMigration` — 0028 seeds all six Supplier permissions; `supplierPermissionsMigration` — 0028 converges when it is run more than once |
| TC-007 | MIG-007 | `supplierSkuRelations.integration` — TASK-038 (MIG-007): without the Item SKU/UOM tables; `supplierSkuRelations.integration` — TASK-038: a rerun accepts the real tables but refuses a hand-made one |
| TC-008 | LIST-001 | `supplierQueryHandlers` — list applies bounded paging, escaped search |
| TC-016 | LIST-009 | `supplierSkuLookup.integration` — TASK-040 (HD-094 1A): over HTTP the for-SKU lookup |
| TC-018 | CORE-002 | `supplierLifecycleService` — activate and reactivate revalidate activation data; `supplierAdminService` — create Supplier revalidates actor and Business Master |
| TC-019 | CORE-003 | `supplierAdminService` — creating with activate under approval ON lands in pending_approval; `supplierApproval.integration` — a Supplier created with activate can actually be approved |
| TC-020 | CORE-004 | `supplierNormalization` — Supplier Code keeps the trimmed display value; `supplierAdminService` — change Supplier Code maps the database uniqueness race |
| TC-021 | CORE-005 | `supplierDuplicateCandidates` — candidate ranking is exact first, thresholded, stable and capped; `supplierAdminService` — duplicate names remain warnings and do not block creation |
| TC-022 | CORE-006 | `supplierValidation` — Supplier activation requires only Code, Name, an Active Currency; `supplierValidation` — missing optional data produces bounded warnings |
| TC-023 | CORE-007 | `supplierValidation` — unknown write fields are rejected instead of silently persisted; `supplierCreateHandlers` — Supplier create route is idempotent, permission protected |
| TC-025 | CORE-009 | `supplierAdminService` — update Supplier locks and revalidates actor/catalog |
| TC-026 | CORE-010 | `supplierAdminService` — change Supplier Code requires an unreferenced Supplier; `supplierManagement.integration` — Supplier root update and controlled Code correction |
| TC-027 | CORE-011 | `supplierAdminService` — update Supplier rejects stale version before catalog |
| TC-028 | CORE-012 | `supplierManagement.integration` — Supplier create atomically persists root, grams and audit; `supplierLifecycleService` — audit failure rolls a lifecycle state change back |
| TC-030 | STATE-001 | `supplierManagement.integration` — Supplier core lookup keeps history visible |
| TC-032 | STATE-003 | `supplierLifecycleService` — block and unblock follow the exact state matrix; `supplierLifecycleHandlers` — block and unblock require both view and approval |
| TC-033 | STATE-004 | `supplierLifecycleService` — archive returns named open-flow blockers |
| TC-035 | STATE-006 | `supplierLifecycleService` — delete permits only an unreferenced never-active Draft; `supplierSkuRelations.integration` — TASK-038: a Supplier with a SKU relation cannot be permanently deleted |
| TC-037 | STATE-008 | `supplierLifecycleService` — same-target lifecycle replay returns current state; `supplierManagement.integration` — Supplier lifecycle is atomic, idempotent at the target state |
| TC-039 | STATE-010 | `supplierLookupService` — purchase marks non-Active Suppliers unusable; `supplierLookupService` — findManyByIds de-duplicates stable IDs |
| TC-040 | PARTY-001 | `supplierAddressService` — create switches each requested primary and writes address, purposes and audit |
| TC-041 | PARTY-002 | `supplierContactService` — create normalizes contact fields, switches the requested primary |
| TC-042 | PARTY-003 | `supplierParty.integration` — Address ownership, primary switching, concurrency; `supplierParty.integration` — Contact ownership, primary switching, concurrency |
| TC-043 | PARTY-004 | `supplierAddressService` — address deactivate clears primary flags; `supplierContactService` — contact deactivate clears primary flags; `supplierIdentifierService` — delete rejects referenced identifiers |
| TC-044 | PARTY-005 | `supplierParty.integration` — Identifier normalization, global uniqueness; `supplierIdentifierService` — create normalizes identifier type, country |
| TC-045 | PARTY-006 | `supplierAddressService` — address update rejects a child id; `supplierContactService` — contact update rejects a child id |
| TC-046 | PARTY-007 | `supplierValidation` — activation issues can be projected separately; `supplierValidation` — bank completeness is only evaluated once |
| TC-047 | PARTY-008 | `supplierContactService` — create rejects malformed optional email and phone; `supplierIdentifierService` — create rejects oversized notes; `supplierNormalization` — normalizers reject blank, overlong and control-character input |
| TC-049 | APR-001 | `supplierSettingsService` — reading settings returns the typed singleton; `supplierCoreMigrations.integration` — 0036 seeds the settings singleton once |
| TC-050 | APR-002 | `supplierSettingsHandlers` — both settings routes require supplier.settings |
| TC-051 | APR-003 | `supplierSettingsService` — updating locks id=1, checks the version and audits; `supplierSettingsService` — a stale version is a conflict and writes nothing; `supplierSettingsService` — an unknown setting field is rejected rather than stored |
| TC-052 | APR-004 | `supplierApprovalService` — an approver must be named, must be someone else; `supplierApproval.integration` — the database refuses a second pending request |
| TC-053 | APR-005 | `supplierApprovalHandlers` — the eligible approver projection is exactly id, username and displayName; `supplierApprovalHandlers` — the eligible approver lookup is capped; `supplierApprovalService` — the snapshot carries the minimum activation data and masks identifiers |
| TC-054 | APR-006 | `supplierApproval.integration` — approving runs against real MySQL |
| TC-055 | APR-007 | `supplierApprovalService` — rejecting returns the Supplier to draft and keeps the reason; `supplierApprovalService` — rejecting without a reason is refused |
| TC-056 | APR-008 | `supplierApprovalService` — only the requester may withdraw; `supplierApproval.integration` — withdrawing through another Supplier's route |
| TC-057 | APR-009 | `supplierAdminService` — a significant edit while pending invalidates the request; `supplierApprovalService` — a Supplier changed since submission cannot be approved |
| TC-058 | APR-010 | `supplierSettings.integration` — turning the approval policy off does not decide |
| TC-059 | APR-011 | `supplierApproval.integration` — the queue scopes resolve against real MySQL joins; `supplierApproval.integration` — the queue counts and pages the same filtered set; `supplierApprovalService` — reassigning changes the approver without touching the Supplier |
| TC-060 | APR-012 | `supplierApproval.integration` — two concurrent approves produce one transition |
| TC-061 | APR-013 | `supplierApproval.integration` — a decision made after the approver's permission is revoked; `supplierApproval.integration` — a disabled user can neither receive a reassignment nor decide |
| TC-078 | SKU-001 | `supplierSkuLookup.integration` — TASK-040 (SKU-001, SKU-002, AC-028–030): every Active Supplier stays |
| TC-079 | SKU-002 | `supplierSkuLookup.integration` — TASK-040 (SKU-002, REV-087 M-2): ties inside the head; `supplierSkuLookup.integration` — TASK-040 (HD-095 B): the two-part read pages exactly; `supplierSkuLookup.integration` — TASK-040 (HD-094 2A): among exact matches a stopped relation |
| TC-080 | SKU-003 | `supplierSkuLookup.integration` — TASK-040 (SKU-003, BR-024, BR-032) |
| TC-081 | SKU-004 | `supplierSkuRelations.integration` — TASK-038 (SKU-004): create and update keep MOQ |
| TC-082 | SKU-005 | `supplierSkuRelations.integration` — TASK-038: one relation per Supplier and SKU, one SKU per Supplier Item Code |
| TC-083 | SKU-006 | `supplierSkuRelations.integration` — TASK-038 (SKU-006): recordSupply is idempotent |
| TC-084 | SKU-007 | `supplierRelationHandlers` — TASK-038 (SKU-007, FR-SKU-006) |
| TC-086 | IMP-001 | `supplierCsvSchema` — the template is UTF-8 with a BOM, CRLF |
| TC-087 | IMP-002 | `supplierCsvSchema` — RFC 4180: quoted commas, doubled quotes; `supplierImportResultHandlers` — the result CSV has a BOM, one header and one record per row |
| TC-088 | IMP-003 | `supplierImport.integration` — TASK-043 IMP-003: upload stores the file under a server-made name; `supplierCsvSchema` — malformed, non-UTF-8, empty, oversized and over-long files are rejected |
| TC-090 | IMP-005 | `supplierImportHandlers` — the summary projects every public field; `supplierImport.integration` — TASK-044: detail pages the rows by row number |
| TC-091 | IMP-006 | `supplierImport.integration` — TASK-045: a draft import writes each valid row |
| TC-092 | IMP-007 | `supplierImport.integration` — TASK-045 (HD-048 4): a failure after the real Supplier write |
| TC-094 | IMP-009 | `supplierImport.integration` — TASK-045 fault injection: a worker killed before or after |
| TC-095 | IMP-010 | `supplierImport.integration` — TASK-045: two workers never apply a row twice; `supplierImportExecution.integration` — TASK-042: a row applied before a crash is not applied again |
| TC-096 | IMP-011 | `supplierImportPrecheck` — upsert matches by supplierId first and cross-checks the code; `supplierImport.integration` — TASK-045: execution re-checks what precheck saw |
| TC-097 | IMP-012 | `supplierImport.integration` — TASK-045 (AC-013, BR-012): activation follows the policy snapshotted |
| TC-098 | IMP-013 | `supplierImport.integration` — TASK-044 (HD-058 2A/3A): cancel ends the job; `supplierImportService` — job counts are rebuilt from row statuses |
| TC-099 | IMP-014 | `supplierCsvSchema` — a Bank column rejects the whole file |
| TC-100 | IMP-015 | `supplierImport.integration` — TASK-044 IMP-015: only the uploader lists; `supplierImportRetention.integration` — TASK-048: executed jobs past 365 days |
| TC-102 | IMP-017 | `supplierExport.integration` — TASK-047 (HD-067 2A): the export is the list's rows; `supplierExport.integration` — TASK-047 (BR-028, SEC-012); `supplierExport.integration` — TASK-047 (HD-067 1A): password, permission |
| TC-104 | AUD-002 | `supplierAuditLogService` — audit writer rejects unknown actions, unknown detail keys and Bank-sensitive fields; `supplierBankService` — create encrypts, indexes and audits, and no plaintext reaches the audit entry |
| TC-105 | AUD-003 | `supplierBankService` — a reveal whose audit fails returns no account at all; `supplierExportService` — a failed audit means no file; `supplierAudit.integration` — Supplier audit follows its caller transaction |
| TC-108 | AUD-006 | `supplierAuditHandlers` — Supplier audit query API is read-only |
| TC-111 | AUTH-001 | `supplierSkuRelations.integration` — TASK-038 (REV-085 M1, M2): over HTTP, authorization; `supplierSkuRelations.integration` — TASK-039 (HD-098): over HTTP the SKU picker |
| TC-113 | AUTH-003 | `supplierLookupService` — requires its minimal dependencies and exposes a versioned downstream contract; `supplierLookupService` — findById uses a bounded read transaction |
| TC-114 | AUTH-004 | `supplierBank.integration` — no Bank route reaches another Supplier's row; `supplierImport.integration` — TASK-044 (REV-069 L-1): another user's cancel answers 404 |
| TC-115 | AUTH-005 | `supplierImport.integration` — TASK-044: a manager whose permission was withdrawn; `supplierBankService` — every write re-checks the permission |
| TC-116 | AUTH-006 | `supplierLifecycleHandlers` — high-risk auth and reason requirements match; `supplierBankHandlers` — every write demands all three permissions and a device password; `supplierApprovalHandlers` — approve, reject and reassign re-confirm the password |
| TC-118 | AUTH-008 | `supplierBankHandlers` — reveal sets the one cache header; `supplierBankHandlers` — no response schema can utter an account number |
| TC-120 | AUTH-010 | `supplierBankService` — a create that loses the race is a 409; `supplierImportExecution.integration` — TASK-042: a failure that is not a domain error |

### Not tagged: tests to write in step 2b

| TC | Case | Why not |
| --- | --- | --- |
| TC-001 | MIG-001 | no Supplier test asserts the absence of a Currency/Payment Term shadow schema; providers resolve only against a fake DB |
| TC-002 | MIG-002 | reruns converge, but a half-applied schema is refused, not converged; needs investigation against the design |
| TC-003 | MIG-003 | one-pending is DB-enforced; no barrier race across primary/default/pending in one place |
| TC-005 | MIG-005 | config validation only; no server start per bad config |
| TC-006 | MIG-006 | upgrade from main and rollback rehearsal (T51 rehearsal) |
| TC-009 | LIST-002 | no per-field hit, case/trim or no-duplicate-row test |
| TC-010 | LIST-003 | filter combinations and boundaries not tested |
| TC-011 | LIST-004 | no cross-page stability test on MySQL |
| TC-012 | LIST-005 | the escaped LIKE is asserted on SQL text only; no illegal-sort 400 or literal-wildcard result on MySQL |
| TC-014 | LIST-007 | non-Active not-purchasable hint |
| TC-017 | CORE-001 | no test asserts a Draft create with version 1, children and audit in one transaction |
| TC-024 | CORE-008 | no concurrent same-key create on MySQL |
| TC-031 | STATE-002 | no test reactivates an incomplete Supplier and expects 422 with the status kept |
| TC-034 | STATE-005 | no test lists archived Suppliers by explicit filter and then restores one |
| TC-036 | STATE-007 | no two-connection ordering swap |
| TC-038 | STATE-009 | no barrier-synchronised concurrent transitions |
| TC-048 | PARTY-009 | no detail child cap or server-paged child list test |
| TC-093 | IMP-008 | no barrier-synchronised same-key submit |
| TC-103 | AUD-001 | requestId and IP are not asserted per action |
| TC-106 | AUD-004 | over-limit detail: whole-transaction failure and alert not asserted |
| TC-107 | AUD-005 | ordering and total across pages not asserted |
| TC-109 | AUD-007 | audit kept after target/actor deletion not asserted |
| TC-110 | AUD-008 | time formats and requestId join not asserted |
| TC-112 | AUTH-002 | no single route-by-role matrix |
| TC-117 | AUTH-007 | 415, positive-integer IDs and strict booleans per API class |
| TC-119 | AUTH-009 | script rendering and prototype pollution |

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
| TC-089 | IMP-004 | `supplierImport.integration` (precheck writes nothing) | COVERED | The same test carries TC-090 now; TC-089 needs its own carrier |
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
