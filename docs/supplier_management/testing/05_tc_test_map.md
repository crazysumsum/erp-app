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

Generated from the test titles. Each carrier's assertions, not only its title, cover the case's **main** Expected Result: the stated outcome, and any real-database or concurrency condition its Steps require. A case can have several carriers; the harness takes the worst result. Smaller clauses a carrier does not assert are listed under Notes and are accepted as partial. Review REV-092 removed 26 tags that did not meet this bar.

Coverage: supplier-bank-security 15/15, supplier-server-integration 89/89, supplier-security 10/10.

| TC | Carriers (file:line — title) | Notes |
| --- | --- | --- |
| TC-001 | `integration/supplierMigrationAcceptance.integration.test.js:146` — the runner deploys every migration on an empty database and skips them all on a second run, Supplier creates no Currency or Payment Term schema of its own, and the server starts with both Supplier providers ready | Schema is checked as the Supplier table list and the Business Master foreign keys, not a full design diff. The startup self-check is the eager SupplierCoreProvider (startup fails unless READY) plus /api/v1/health; the provider startup log is not inspected. |
| TC-002 | `integration/supplierMigrationAcceptance.integration.test.js:218` — every Supplier migration stopped before any one of its writes converges on rerun to the same schema and data as a clean run, a rerun of a finished one changes no row and runs no DDL, and rerunning all of them over business data changes nothing | Half-applied means stopped before any one write (design §797): 31 stopped runs, 16 of them after at least one write. A second runner run is in TC-001; rerunning all 15 over business rows is here. Refusing a hand-divergent table is covered by the per-migration tests, not this carrier. |
| TC-003 | `integration/supplierConstraintRaces.integration.test.js:147` — two transactions creating the same Supplier Code, one of them archived: the database lets exactly one through<br>`integration/supplierConstraintRaces.integration.test.js:158` — two Suppliers taking the same identifier at once: exactly one keeps it<br>`integration/supplierConstraintRaces.integration.test.js:189` — two addresses made primary for the same purpose at once: exactly one is primary<br>`integration/supplierConstraintRaces.integration.test.js:192` — two contacts made primary for the same purpose at once: exactly one is primary<br>`integration/supplierConstraintRaces.integration.test.js:195` — two Bank accounts made default at once: exactly one active default<br>`integration/supplierConstraintRaces.integration.test.js:213` — two activation requests for one Supplier at once: exactly one is pending | Races are on the database itself, over two connections. With a forced overlap the second transaction always fails with ER_DUP_ENTRY. On a simultaneous start the loser is occasionally rolled back as a deadlock instead, and there is never a second winner. Over HTTP, address, contact, Bank and approval writes lock the Supplier row first. Two simultaneous identical identifiers on different Suppliers returned 500 once in 150 rounds (DEF-031); Supplier create did not, in 150 rounds. |
| TC-004 | `integration/supplierMigrationAcceptance.integration.test.js:289` — the six Supplier permissions and their system-admin grants exist once, approval starts OFF, Supplier seeds no Currency or Payment Term, and reruns keep it that way | The provider startup log is not inspected. |
| TC-005 | `integration/supplierMigrationAcceptance.integration.test.js:340` — each bad Supplier security or limit setting stops the server before it ever listens, including no Bank keys at all once the Bank table is deployed, and the error names the setting without its value | With the Bank table deployed, no keys at all is refused too (design §1700). |
| TC-006 | `integration/supplierMigrationAcceptance.integration.test.js:384` — adding Supplier to an existing deployment changes no existing table or row, writes only Supplier tables and its permission seed, drops nothing it does not own, and the server starts on the upgraded schema | Partly automated. The CI carrier covers adding Supplier to a deployment without it: no existing table or row changes, only Supplier tables and its permission seed are written, and nothing is dropped except 0087's reorder. The rest is accepted from a manual record, not CI: the upgrade from a previous release with data, backup and restore, the server rollback reading Supplier data, and the old login and other features (only /health). See testing/t51_rehearsal/README.md. |
| TC-007 | `integration/supplierSkuRelations.integration.test.js:108` — TASK-038 (MIG-007): without the Item SKU/UOM tables the migration refuses and creates nothing<br>`integration/supplierSkuRelations.integration.test.js:239` — TASK-038: a rerun accepts the real tables but refuses a hand-made one whose foreign keys differ |  |
| TC-008 | `integration/supplierListAcceptance.integration.test.js:176` — the list pages 20 by default and at most 100, refuses other bounds, and hides Archived unless asked |  |
| TC-009 | `integration/supplierListAcceptance.integration.test.js:203` — every searchable field matches in full and in part, Code and Name ignore case and edge spaces, with no duplicate rows |  |
| TC-010 | `integration/supplierListAcceptance.integration.test.js:246` — filters return only their intersection, with missing contact, address and Bank and both date ranges exact at the edges |  |
| TC-011 | `integration/supplierListAcceptance.integration.test.js:295` — each allowed sort orders the set, ties fall back to ID in the same direction, and pages neither skip nor repeat |  |
| TC-012 | `integration/supplierListAcceptance.integration.test.js:333` — LIKE wildcards are searched literally, an unknown sort is 400, and nothing in the database moves |  |
| TC-014 | `integration/supplierAuditAcceptance.integration.test.js:603` — detail returns the general data, children, payment term and masked Bank for every status, computes no transactions, and the provider marks every non-Active Supplier not purchasable | no downstream summaries exist yet (Purchasing is not built); the UI hint is carried by client detail.test for the suspended status only |
| TC-016 | `integration/supplierSkuLookup.integration.test.js:197` — TASK-040 (HD-094 1A): over HTTP the for-SKU lookup needs a fresh supplier.view and returns no Bank data | carrier mostly checks auth; reasons and searchability are carried by TC-078/079 |
| TC-017 | `integration/supplierCoreAcceptance.integration.test.js:59` — create makes a Draft at version 1 with its audit and name index, readable at once, and a refused create leaves nothing | create takes no children (its schema has none; children use their own routes); atomicity is not asserted here: the duplicate is refused by the pre-insert check before any write; rollback after an audit failure is carried by TC-028 |
| TC-018 | `supplierAdminService.test.js:77` — create Supplier revalidates actor and Business Master inside one transaction and atomically writes root, grams and audit<br>`supplierLifecycleService.test.js:94` — activate and reactivate revalidate activation data and write one atomic audit |  |
| TC-019 | `integration/supplierApproval.integration.test.js:343` — a Supplier created with activate can actually be approved<br>`supplierAdminService.test.js:95` — creating with activate under approval ON lands in pending_approval, not active | assigned approver, returned Code and next step not asserted |
| TC-020 | `integration/supplierCoreAcceptance.integration.test.js:83` — Codes are kept exactly as typed, invalid ones are 400, and a normalised duplicate is 409 in every state and in a two-connection race, with nothing half-written |  |
| TC-021 | `supplierAdminService.test.js:89` — duplicate names remain warnings and do not block creation<br>`supplierDuplicateCandidates.test.js:25` — candidate ranking is exact first, thresholded, stable and capped at ten warnings |  |
| TC-022 | `supplierValidation.test.js:18` — Supplier activation requires only Code, Name, an Active Currency and an allowed source state<br>`supplierValidation.test.js:32` — missing optional data produces bounded warnings and never activation issues |  |
| TC-023 | `supplierCreateHandlers.test.js:6` — Supplier create route is idempotent, permission protected and accepts only the minimum root fields<br>`supplierValidation.test.js:65` — unknown write fields are rejected instead of silently persisted |  |
| TC-024 | `integration/supplierCoreAcceptance.integration.test.js:133` — one Idempotency-Key makes one Supplier whether repeated or raced; a different payload under it is refused; a new key follows the Code rule | a concurrent request under the same key may answer IDEMPOTENCY_IN_PROGRESS; a later replay returns the one result |
| TC-025 | `supplierAdminService.test.js:175` — update Supplier locks and revalidates actor/catalog, replaces name grams and writes audit in one transaction |  |
| TC-026 | `integration/supplierManagement.integration.test.js:165` — Supplier root update and controlled Code correction enforce CAS, global uniqueness and reference guard<br>`supplierAdminService.test.js:209` — change Supplier Code requires an unreferenced Supplier and writes a reasoned audit |  |
| TC-027 | `integration/supplierCoreAcceptance.integration.test.js:161` — a stale version is 409 VERSION_CONFLICT; of two concurrent saves exactly one wins and its fields are stored whole |  |
| TC-028 | `integration/supplierManagement.integration.test.js:88` — Supplier create atomically persists root, grams and audit while duplicate codes and audit failure leave no partial data<br>`supplierLifecycleService.test.js:207` — audit failure rolls a lifecycle state change back as one transaction |  |
| TC-030 | `integration/supplierManagement.integration.test.js:365` — Supplier core lookup keeps history visible and revalidates purchase eligibility in the caller transaction |  |
| TC-031 | `integration/supplierCoreAcceptance.integration.test.js:188` — reactivate makes a complete Supplier Active even without optional data, and refuses an incomplete one with 422 while it stays Suspended |  |
| TC-032 | `supplierLifecycleHandlers.test.js:41` — block and unblock require both view and approval with device-password auth<br>`supplierLifecycleService.test.js:169` — block and unblock follow the exact state matrix and unblock only to Suspended |  |
| TC-033 | `supplierLifecycleService.test.js:180` — archive returns named open-flow blockers and restore only returns Suspended |  |
| TC-034 | `integration/supplierCoreAcceptance.integration.test.js:204` — an archived Supplier is hidden by default, found by explicit filter, restores to Suspended, and stays unusable for new purchases | the UI's include-archived filter is carried by the client list tests (HD-107) |
| TC-035 | `integration/supplierSkuRelations.integration.test.js:232` — TASK-038: a Supplier with a SKU relation cannot be permanently deleted<br>`supplierLifecycleService.test.js:194` — delete permits only an unreferenced never-active Draft and retains a reasoned audit |  |
| TC-036 | `integration/supplierCoreAcceptance.integration.test.js:229` — a purchase transaction's FOR UPDATE serialises a concurrent status change in either order, a stale screen is re-checked, and an unknown status fails the impact check closed | both orders run with the lock held; the purchase transaction is the provider's assertUsableInTransaction, as Purchasing has no document transaction yet (HD-094) |
| TC-037 | `integration/supplierManagement.integration.test.js:276` — Supplier lifecycle is atomic, idempotent at the target state and preserves delete audit<br>`supplierLifecycleService.test.js:105` — same-target lifecycle replay returns current state without version increment or duplicate audit |  |
| TC-038 | `integration/supplierCoreAcceptance.integration.test.js:324` — concurrent transitions on one version produce one legal sequence: one 200, one 409, one audit and a matching final state |  |
| TC-039 | `supplierLookupService.test.js:82` — purchase marks non-Active Suppliers unusable while history keeps every non-deleted status visible |  |
| TC-040 | `supplierAddressService.test.js:44` — create switches each requested primary and writes address, purposes and audit in one transaction |  |
| TC-041 | `supplierContactService.test.js:64` — create normalizes contact fields, switches the requested primary and audits atomically |  |
| TC-042 | `integration/supplierParty.integration.test.js:54` — Address ownership, primary switching, concurrency and deactivation are enforced by service and MySQL<br>`integration/supplierParty.integration.test.js:121` — Contact ownership, primary switching, concurrency and deactivation are enforced by service and MySQL |  |
| TC-043 | `supplierAddressService.test.js:64` — address deactivate clears primary flags and preserves purpose mappings<br>`supplierContactService.test.js:99` — contact deactivate clears primary flags and preserves purpose mappings<br>`supplierIdentifierService.test.js:110` — delete rejects referenced identifiers and audits an allowed versioned deletion |  |
| TC-044 | `integration/supplierParty.integration.test.js:191` — Identifier normalization, global uniqueness, ownership and deletion are enforced by service and MySQL<br>`supplierIdentifierService.test.js:57` — create normalizes identifier type, country and separator-insensitive key before auditing |  |
| TC-045 | `integration/supplierCoreAcceptance.integration.test.js:346` — another Supplier's route cannot read, update, deactivate or delete a child, answers as for a missing one, and changes nothing | address, contact and identifier; Bank ownership is TC-114 |
| TC-046 | `integration/supplierCoreAcceptance.integration.test.js:391` — a Draft with only the three minimum fields gets warnings but no issues, and activates | the UI's non-blocking label is carried by client detail.test |
| TC-047 | `supplierContactService.test.js:79` — create rejects malformed optional email and phone values<br>`supplierIdentifierService.test.js:86` — create rejects oversized notes at the domain boundary |  |
| TC-048 | `integration/supplierListAcceptance.integration.test.js:356` — detail carries at most 100 contacts and addresses; the dedicated lists page the rest exactly |  |
| TC-049 | `integration/supplierCoreMigrations.integration.test.js:151` — 0036 seeds the settings singleton once and a rerun neither duplicates nor resets it<br>`supplierSettingsService.test.js:59` — reading settings returns the typed singleton with its version |  |
| TC-050 | `supplierSettingsHandlers.test.js:9` — both settings routes require supplier.settings and nothing weaker |  |
| TC-051 | `supplierSettingsService.test.js:66` — updating locks id=1, checks the version and audits before/after with the reason<br>`supplierSettingsService.test.js:98` — a stale version is a conflict and writes nothing<br>`supplierSettingsService.test.js:118` — an unknown setting field is rejected rather than stored |  |
| TC-052 | `integration/supplierApproval.integration.test.js:149` — the database refuses a second pending request for one Supplier<br>`supplierApprovalService.test.js:69` — an approver must be named, must be someone else, must be active and must hold the permission now |  |
| TC-053 | `supplierApprovalHandlers.test.js:118` — the eligible approver projection is exactly id, username and displayName<br>`supplierApprovalHandlers.test.js:125` — the eligible approver lookup is capped and can exclude the requester<br>`supplierApprovalService.test.js:97` — the snapshot carries the minimum activation data and masks identifiers |  |
| TC-054 | `integration/supplierApproval.integration.test.js:114` — approving runs against real MySQL: every column exists and the row really moves | decided_by not asserted; audit read with LIMIT 1 |
| TC-055 | `supplierApprovalService.test.js:143` — rejecting returns the Supplier to draft and keeps the reason<br>`supplierApprovalService.test.js:152` — rejecting without a reason is refused before anything is locked | 5–500 reason bounds and request status Rejected not asserted |
| TC-056 | `integration/supplierApproval.integration.test.js:904` — withdrawing through another Supplier's route is refused and changes nothing<br>`supplierApprovalService.test.js:184` — only the requester may withdraw |  |
| TC-057 | `supplierAdminService.test.js:255` — a significant edit while pending invalidates the request and returns the Supplier to draft<br>`supplierApprovalService.test.js:195` — a Supplier changed since submission cannot be approved on the old request |  |
| TC-058 | `integration/supplierSettings.integration.test.js:254` — turning the approval policy off does not decide an already pending request | audit stubbed; a new submission after OFF not checked |
| TC-059 | `integration/supplierApproval.integration.test.js:451` — the queue scopes resolve against real MySQL joins<br>`integration/supplierApproval.integration.test.js:480` — the queue counts and pages the same filtered set<br>`supplierApprovalService.test.js:244` — reassigning changes the approver without touching the Supplier | refusing the requester and audit before/after not asserted |
| TC-060 | `integration/supplierApproval.integration.test.js:639` — two concurrent approves produce one transition and exactly one decision audit |  |
| TC-061 | `integration/supplierApproval.integration.test.js:784` — a decision made after the approver's permission is revoked fails at both guards<br>`integration/supplierApproval.integration.test.js:836` — a disabled user can neither receive a reassignment nor decide |  |
| TC-062 | `integration/supplierBankAcceptance.integration.test.js:175` — every role that may list Bank rows sees only masks, short accounts fully masked, no crypto metadata |  |
| TC-063 | `integration/supplierBankAcceptance.integration.test.js:216` — reveal needs bank.view and the current password, is audited, and is not cacheable |  |
| TC-064 | `integration/supplierBankAcceptance.integration.test.js:261` — only view + bank.view + bank.mgmt, with device and password, may write; everyone else changes nothing |  |
| TC-065 | `integration/supplierBankDeviceWrites.integration.test.js:56` — every Bank write refuses a missing or wrong password, a missing or revoked device, a moved signature and a replayed nonce |  |
| TC-066 | `integration/supplierBank.integration.test.js:149` — create really writes every column, and the encrypted ones are binary of the right width<br>`integration/supplierBank.integration.test.js:173` — the plaintext account appears in no column of the Bank table or the audit log |  |
| TC-067 | `integration/supplierBank.integration.test.js:371` — a row moved to another Supplier cannot be revealed, because the AAD is bound to the owner<br>`supplierBankCrypto.test.js:45` — a round trip returns the account, and records the key ID that produced it<br>`supplierBankCrypto.test.js:60` — every row gets its own IV, so the same account never encrypts to the same bytes<br>`supplierBankCrypto.test.js:72` — moving a row to another Supplier makes it undecryptable<br>`supplierBankCrypto.test.js:85` — swapping the crypto context of two rows under one Supplier also fails<br>`supplierBankCrypto.test.js:116` — tampering with the ciphertext or the tag fails verification |  |
| TC-068 | `integration/supplierBankAcceptance.integration.test.js:335` — a row whose encryption key is not in the ring is never revealed<br>`integration/supplierBankAcceptance.integration.test.js:346` — the refusal is 503 BANK_KEY_UNAVAILABLE, as design 6 and 8.3 specify<br>`integration/supplierBankAcceptance.integration.test.js:357` — a duplicate check that cannot read an existing row's lookup key fails closed<br>`integration/supplierBankAcceptance.integration.test.js:390` — re-entering the account on the only unreadable row repairs it; a second one still blocks<br>`integration/supplierBankAcceptance.integration.test.js:410` — a deactivated row on a lookup key outside the ring still blocks, as the unique index would<br>`integration/supplierBankAcceptance.integration.test.js:424` — a Supplier locked by a lost lookup key is recovered by the --from-lost reindex (HD-038)<br>`supplierBankService.test.js:219` — a Supplier with a row on a lookup key outside the ring cannot add or change an account |  |
| TC-069 | `integration/supplierBank.integration.test.js:229` — the database refuses a second active default even if the service is bypassed<br>`integration/supplierBank.integration.test.js:258` — switching the default clears the old one, and deactivating frees the slot<br>`integration/supplierBank.integration.test.js:290` — two concurrent default switches leave exactly one default |  |
| TC-070 | `integration/supplierBank.integration.test.js:322` — the same account twice under one Supplier is refused by the database as well as the service<br>`integration/supplierBank.integration.test.js:400` — a real ER_DUP_ENTRY from the driver becomes a 409, not a 500 carrying the blind index<br>`supplierBankCrypto.test.js:218` — formatting differences in the same account collide, so a duplicate cannot hide behind a space<br>`supplierBankService.test.js:174` — a same-Supplier duplicate is blocked and a cross-Supplier one is only a warning |  |
| TC-071 | `integration/supplierBankAcceptance.integration.test.js:478` — an update that keeps the account keeps every encrypted byte; one that changes it replaces them all |  |
| TC-072 | `integration/supplierBankAcceptance.integration.test.js:512` — deactivation clears the default and keeps the row; there is no route that deletes one |  |
| TC-073 | `integration/supplierBankAcceptance.integration.test.js:550` — when the audit cannot be written, no Bank write lands and no reveal returns an account |  |
| TC-074 | `integration/supplierBank.integration.test.js:788` — after success and failure flows, no channel on this baseline carries the account |  |
| TC-076 | `integration/supplierBankRotation.integration.test.js:141` — encryption rotation re-encrypts real rows and leaves them decryptable and un-reindexed<br>`integration/supplierBankRotation.integration.test.js:186` — lookup rotation rewrites index and key id together, and the unique constraint holds<br>`integration/supplierBankRotation.integration.test.js:222` — a duplicate is still refused while the ring is half rotated<br>`integration/supplierBankRotation.integration.test.js:266` — an interrupted rotation resumes and finishes on real rows |  |
| TC-077 | `integration/supplierBankRestore.integration.test.js:135` — a restored backup reveals with its key ring, and fails closed without it |  |
| TC-078 | `integration/supplierSkuLookup.integration.test.js:120` — TASK-040 (SKU-001, SKU-002, AC-028–030): every Active Supplier stays, relations only rank, stopped and inactive never rank up |  |
| TC-079 | `integration/supplierSkuLookup.integration.test.js:220` — TASK-040 (HD-095 B): the two-part read pages exactly like one LEFT JOIN sorted by the design §8.7 order<br>`integration/supplierSkuLookup.integration.test.js:247` — TASK-040 (HD-094 2A): among exact matches a stopped relation still does not rank by history, and other SKUs' relations never leak in<br>`integration/supplierSkuLookup.integration.test.js:272` — TASK-040 (SKU-002, REV-087 M-2): ties inside the head fall back to name, then ID |  |
| TC-080 | `integration/supplierSkuLookup.integration.test.js:152` — TASK-040 (SKU-003, BR-024, BR-032): a preferred mark never makes a suspended Supplier or an unpurchasable SKU usable |  |
| TC-081 | `integration/supplierSkuRelations.integration.test.js:122` — TASK-038 (SKU-004): create and update keep MOQ, lead time and status in bounds, with one audit each and no price |  |
| TC-082 | `integration/supplierConcurrencyAcceptance.integration.test.js:47` — concurrent creates keep one relation per Supplier and SKU and one Supplier item code per Supplier, and the database itself refuses duplicates and a UOM of another SKU, keyed by IDs only |  |
| TC-083 | `integration/supplierSkuRelations.integration.test.js:189` — TASK-038 (SKU-006): recordSupply is idempotent, never makes a relation preferred and fails closed without a source verifier |  |
| TC-084 | `supplierRelationHandlers.test.js:19` — TASK-038 (SKU-007, FR-SKU-006): no request or response carries a price, and unknown fields are refused |  |
| TC-086 | `supplierCsvSchema.test.js:33` — the template is UTF-8 with a BOM, CRLF, the v1 columns, a description row that says Bank is not accepted, and an example |  |
| TC-087 | `supplierCsvSchema.test.js:72` — RFC 4180: quoted commas, doubled quotes, CRLF or LF, with or without BOM, Chinese text and leading zeros<br>`supplierImportResultHandlers.test.js:47` — the result CSV has a BOM, one header and one record per row, joins issues and guards every cell |  |
| TC-088 | `integration/supplierImport.integration.test.js:160` — TASK-043 IMP-003: upload stores the file under a server-made name, 0600, inside the root, and records the job<br>`supplierCsvSchema.test.js:128` — malformed, non-UTF-8, empty, oversized and over-long files are rejected with their own code |  |
| TC-089 | `integration/supplierImport.integration.test.js:187` — TASK-043 IMP-004/005/011 (TC-089): precheck classifies each row and writes nothing to Supplier tables |  |
| TC-090 | `integration/supplierImport.integration.test.js:607` — TASK-044: detail pages the rows by row number, filters by status, and serves none before precheck finishes<br>`supplierImportHandlers.test.js:91` — the summary projects every public field and says whether the files are gone |  |
| TC-091 | `integration/supplierImport.integration.test.js:1528` — TASK-049 (SUP-CAP-05): one mixed file end to end — counts agree everywhere, and nothing leaks | Partial: the mixed rows carry no Address, Contact or Identifier, and no per-row audit is checked; row atomicity is carried by TC-092 and TC-094 |
| TC-092 | `integration/supplierImport.integration.test.js:1083` — TASK-045 (HD-048 4): a failure after the real Supplier write leaves no Supplier, child, name gram or audit behind |  |
| TC-093 | `integration/supplierConcurrencyAcceptance.integration.test.js:132` — one key makes one job whether repeated or raced, a different file under it is refused, a double confirm queues once, and the same file under a second key is refused at precheck once the first has run |  |
| TC-094 | `integration/supplierImport.integration.test.js:1141` — TASK-045 fault injection: a worker killed before or after a row's commit leaves both or neither, and the next worker finishes once |  |
| TC-095 | `integration/supplierImport.integration.test.js:1171` — TASK-045: two workers never apply a row twice — one claim wins, and a worker that lost its lease writes nothing<br>`integration/supplierImportExecution.integration.test.js:301` — TASK-042: a row applied before a crash is not applied again, and the job resumes after the lease expires |  |
| TC-096 | `integration/supplierImport.integration.test.js:1050` — TASK-045: execution re-checks what precheck saw — a Code or Identifier taken since, an archived target, a moved version, a retired currency<br>`supplierImportPrecheck.test.js:154` — upsert matches by supplierId first and cross-checks the code; code alone also matches (IMP-011) |  |
| TC-097 | `integration/supplierImport.integration.test.js:976` — TASK-045 (AC-013, BR-012): activation follows the policy snapshotted at confirm; with approval it opens a request that already lists the new identifier |  |
| TC-098 | `integration/supplierImport.integration.test.js:677` — TASK-044 (HD-058 2A/3A): cancel ends the job, deletes the source, keeps the rows and is replay-safe<br>`supplierImportService.test.js:32` — job counts are rebuilt from row statuses, with invalid rows still pending until they are skipped |  |
| TC-099 | `integration/supplierImport.integration.test.js:264` — TASK-043 IMP-014 (TC-099): a Bank column is refused at upload and its value reaches no row, job, file, audit or log<br>`supplierCsvSchema.test.js:94` — a Bank column rejects the whole file: no row is produced and the value appears nowhere in the result |  |
| TC-100 | `integration/supplierImport.integration.test.js:572` — TASK-044 IMP-015: only the uploader lists, reads and cancels a job; the job API tells no one else it exists<br>`integration/supplierImportRetention.integration.test.js:105` — TASK-048: executed jobs past 365 days lose their files and answer 410; the job, its rows and audit stay |  |
| TC-102 | `integration/supplierExport.integration.test.js:131` — TASK-047 (HD-067 2A): the export is the list's rows in the list's order, under the import template v1 header<br>`integration/supplierExport.integration.test.js:188` — TASK-047 (BR-028, SEC-012): no Bank data and no live formula in the file; awkward text survives the round trip<br>`integration/supplierExport.integration.test.js:225` — TASK-047 (HD-067 1A): password, permission and the 10,000-row cap |  |
| TC-103 | `integration/supplierAuditAcceptance.integration.test.js:88` — every state-changing or sensitive Supplier action writes exactly its audit rows, with actor, target, Code, before/after, reason, requestId and IP | names per HD-111 A (design → written): address/contact/identifier/bank.* → supplier.address/contact/identifier/bank.*; supplier.settings.update → setting.update; supplier_sku_ref.* → supplier_sku.*; supplier.import → import.upload/precheck/confirm/cancel. The background precheck has no requestId; import.expire and supplier_sku.supply are not exercised, nor the rows written while an import executes. The IP check accepts any loopback form. Supplier, address, contact and identifier updates audit only changed fields, notes as { changed, length, sha256 } (HD-112 A); Bank updates record changed-flags and the masked number, not field values |
| TC-104 | `supplierAuditLogService.test.js:35` — audit writer rejects unknown actions, unknown detail keys and Bank-sensitive fields<br>`supplierBankService.test.js:152` — create encrypts, indexes and audits, and no plaintext reaches the audit entry |  |
| TC-105 | `integration/supplierAudit.integration.test.js:13` — Supplier audit follows its caller transaction and committed rows remain queryable<br>`supplierBankService.test.js:380` — a reveal whose audit fails returns no account at all<br>`supplierExportService.test.js:55` — the audit names the actor, the filters and the count, and a failed audit means no file |  |
| TC-106 | `integration/supplierAuditAcceptance.integration.test.js:331` — detail up to 8192 bytes is stored whole, a larger list is summarised to count/sample/truncated, and anything still too large fails the whole transaction with an alert | the alert is a system-log error event; no external alerting exists. Notes are audited as length and SHA-256 (HD-112 A), so two 2000-character multi-byte notes update cleanly |
| TC-107 | `integration/supplierAuditAcceptance.integration.test.js:463` — audit search returns only matching rows, newest first with a stable id tie-break, with exact totals and edges, and Bank detail stays masked | the Code filter is the target-label search |
| TC-108 | `integration/supplierAuditAcceptance.integration.test.js:516` — there is no way to change or delete audit: only a GET route exists, guessed write routes are refused, the service has no write method, and no source writes it | the database user can UPDATE and DELETE; immutability rests on the API and the code, not on grants |
| TC-109 | `integration/supplierAuditAcceptance.integration.test.js:547` — audit survives the deletion of its Supplier and of its actor, keeping the target IDs and the actor's username |  |
| TC-110 | `integration/supplierAuditAcceptance.integration.test.js:576` — times are epoch milliseconds in the DB and the API, and one requestId joins the response, the request log and the audit row | Supplier CSVs carry no time columns, so the ISO 8601 offset clause has nothing to check; the UI time zone is carried by client list.test; no controllable clock is used |
| TC-111 | `integration/supplierSecurityAcceptance.integration.test.js:153` — every registered Supplier route refuses an anonymous or forged caller, writes nothing, and answers alike for existing and missing IDs | Supplier pages: client pageGuards.test checks every page declares permissions and none is public |
| TC-112 | `integration/supplierSecurityAcceptance.integration.test.js:171` — the route-by-role matrix grants exactly the specified permission combinations | allowed combinations are checked at the route policy with missing IDs, so they stop at 400/404; the service's fresh DB check is carried by TC-115; U-SYS Bank masking, audit and alert are not asserted (TC-116 covers its re-authentication) |
| TC-113 | `integration/supplierSecurityAcceptance.integration.test.js:197` — a Purchasing caller gets only the minimal provider projection and no Supplier admin, reveal or Settings access | Purchasing has no permission yet (HD-094 1A), so U-PO holds an unrelated one; there is no Finance Bank provider (design §8.4 defers it) |
| TC-114 | `integration/supplierBank.integration.test.js:645` — no Bank route reaches another Supplier's row, and the refusal changes nothing<br>`integration/supplierImport.integration.test.js:784` — TASK-044 (REV-069 L-1): another user's cancel answers 404 at once, without waiting on a job someone holds |  |
| TC-115 | `integration/supplierImport.integration.test.js:738` — TASK-044: a manager whose permission was withdrawn after the token was issued is refused at once<br>`supplierBankService.test.js:334` — every write re-checks the permission, so a revoked token cannot keep writing |  |
| TC-116 | `integration/supplierSecurityAcceptance.integration.test.js:218` — authType is fixed in metadata as specified, and a weaker credential or a payload cannot lower it |  |
| TC-117 | `integration/supplierSecurityAcceptance.integration.test.js:258` — every API class refuses malformed, mistyped, out-of-range or extra input with a stable 400 and writes nothing; IDs are positive integers and booleans are strict | a wrong content type is read as an empty body and answered 400, not 415 |
| TC-118 | `integration/supplierSecurityAcceptance.integration.test.js:340` — only the reveal response carries the plaintext, under no-store; other projections carry no internal keys; export and reveal leave a low-sensitivity audit | Cache-Control is no-store without private (accepted deviation, 2026-09-21); the masked projection for U-SYS is scanned, its alerting is not |
| TC-119 | `integration/supplierSecurityAcceptance.integration.test.js:424` — script and HTML are stored and returned as plain text, control characters are refused, and prototype keys neither pollute nor pass | CSV import of markup and log safety are not asserted; client rendering is covered by list.test |
| TC-120 | `integration/supplierSecurityAcceptance.integration.test.js:467` — each error class answers with its stable HTTP status and code, and never SQL, constraint names, secrets or another Supplier's data | per-type child 404 codes (HD-110 A); Currency and Payment Term codes as REV-064 I-2; the 403 code is the framework's |

### Not tagged: tests to write in step 2b

| TC | Case | Why not |
| --- | --- | --- |

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
| TC-013 | LIST-006 | moved to `supplier-client-ui` | — | See that section |
| TC-014 | LIST-007 | `client detail.test`; `supplierQueryHandlers` (detail) | PARTIAL | Non-Active "not purchasable" hint |
| TC-015 | LIST-008 | moved to `supplier-client-ui` | — | See that section |
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
| TC-029 | CORE-013 | moved to `supplier-client-ui` | — | See that section |
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
| TC-085 | SKU-008 | `runSupplierPerformanceAcceptance.js` (supplier-performance suite): for-SKU worst case (`--only=forSku`, 50 users) at 100k, every for-SKU operation p95 < 2 s and error rate ≤ 1%; the hot SKU's total equals the active Supplier count; every top statement's plan visible (12 of 12), no base-table full scan | COVERED | Machine-dependent: a run while another session's benchmark loaded the machine failed p95; the worst case has little headroom (overall p95 1,546 ms) |
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
| TC-101 | IMP-016 | `runSupplierPerformanceAcceptance.js` (supplier-performance suite): a 10,000-row import started inside a 50-user load's measured window (from the window the load tool reports) and finished inside it; precheck plus execution ≤ 10 min, every row applied exactly once with consistent counts, online p95 < 2 s, DB connections and worker RSS bounded; rows not applied are recorded by the import tool; `supplierImport.integration` (10,000 rows within the timeout) | PARTIAL | One run applied 9,999 of 10,000 rows (DEF-034, cause unknown); the import is all creates, not the create/update/invalid mix |
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

## supplier-client-ui (11)

Runner: `npm test --workspace client -- --config test/supplier-management.vitest.config.js` (HD-117 A). It runs the 21 Supplier page and service test files in jsdom; each test title carries at most one TC ID. Local run after REV-107: 168 passed, 0 failed, 0 skipped; after DEF-035 (audit page and tab, 2026-10-22): 176 passed; after REV-113 (2026-10-23): 182 passed; after DEF-036 (REV-114): 184 passed; after DEF-038 (REV-116): 189 passed; after DEF-039..041 (REV-117): 193 passed; after DEF-037 (REV-118): 196 passed; after DEF-042/043 (REV-119): 203 passed; every required ID PASS through the harness JUnit adapter. Keyboard, focus, viewport, browser back and visual checks need a real browser and are left to the Playwright specs and UAT.

Left out on purpose: `client/test/framework/routing/authorizationRefresh.test.js`. Its `同 SupplierBankPanel 夾埋` block checks that Bank plaintext is cleared and that losing `supplier.view` sends the user to 403, but the file is a framework routing test and the rest of it is not Supplier's. It runs in the main client suite. The profile's `min_tests` is 11 while 203 tests run, so a shrunken file list is caught only through the required IDs; raising the floor changes the profile and needs its own decision (REV-107 I-2).

| TC | Case | Tagged tests | Status | Gap |
| --- | --- | --- | --- | --- |
| TC-013 | LIST-006 | `list.test` (loading, empty and failed reads by text and `aria-busy`, retry); `coreFlow.test` (view-only projection to detail) | PARTIAL | The no-permission state and the U-BANK-R / U-NONE projections are not tested here. The loading, empty and failed texts are distinct since DEF-032 (also checked in a real browser by `supplier-list-filters.spec`) |
| TC-015 | LIST-008 | `list.test` (restore from URL, HD-107 filters, malformed values dropped) | PARTIAL | Back/forward and refresh in a real browser; no assertion that the URL holds no sensitive value |
| TC-029 | CORE-013 | `editor.test` (dirty editor prompts before leaving) | PARTIAL | The "stay" choice (asserted in `detail.test`, tagged TC-123); saving the new Supplier value; existing purchase snapshots unchanged, which needs the purchasing module |
| TC-075 | BANK-014 | `bank.test` (nine reveal and clearing tests, including the write dialog and the create form) | COVERED | |
| TC-121 | UI-001 | `pageGuards.test`; `list.test` (menu entry); `create.test` (direct URL); `settings.test`; `approvals.test`; `audit.test` (變更紀錄 menu entry) | PARTIAL | Tests check page metadata only. Menu order is not asserted; the 403 redirect is asserted only in `authorizationRefresh.test.js`, outside this suite |
| TC-122 | UI-002 | `create.test` (draft with three fields, approver on and off) | PARTIAL | Error focus on summary or first field |
| TC-123 | UI-003 | `create.test` and `editor.test` (dirty prompt on route leave and on closing the tab); `editor.test` (draft kept on 409); `detail.test` (refusing to discard keeps the page) | PARTIAL | Browser back, and two real sessions (the 409 is mocked) |
| TC-124 | UI-004 | `lifecycle.test` (state-valid actions, Block, conflict, activation, archive and delete dialogs with Code, end state, kept history and password rule) | PARTIAL | Keyboard completion; status icon beside the text; suspend wording is not asserted |
| TC-125 | UI-005 | `approvals.test` (snapshot diff, stale refused, password, reason, reassign); Bank side is TC-075 | COVERED | |
| TC-126 | UI-006 | `import.test` (refresh reopens the job, error rows not written, approver rule, stopped job and expired result, row filter) | COVERED | |
| TC-127 | UI-007 | `list.test` (Hong Kong time, date-range error); `contact.test` (accessible validation) | PARTIAL | Tokens and no inline brand hex (could be checked statically, not done); keyboard and focus on every page; widths |

## Performance, resilience, recovery, release (9)

| TC | Case | Evidence or tests | Status | Gap |
| --- | --- | --- | --- | --- |
| TC-128 | OPS-001 | `runSupplierPerformanceAcceptance.js` (supplier-performance suite): 100k Suppliers, 50 users, every general operation p95 < 2 s and error rate ≤ 1%, DB threads within one pool plus 3 and RSS ≤ 1 GiB; a fresh app instance still answers after all runs; T50 `performance_report.md` | PARTIAL | Production-like MySQL (NOT_RUN by design); no ramp-up (all 50 users start together after the warm-up); CPU saturation is recorded, not judged |
| TC-129 | OPS-002 | `runSupplierPerformanceAcceptance.js` (supplier-performance suite): the similar-name search uses the 3,000-candidate cap (HD-084/HD-087, which replaced OPS-002's "≤ 50 candidates"), is at least 5 times faster than without it and within 2 points of its recall; duplicate check p95 < 2 s; every top statement's plan visible (12 of 12) and no base-table full scan outside the text search (a scan by HD-088); a search that matches two identifiers per Supplier totals the distinct Suppliers, not the joined rows; `supplierDuplicateCandidates.integration`; `supplierListIndexes.integration` | PARTIAL | The short-spike workload is not run |
| TC-130 | OPS-003 | `runSupplierResilienceAcceptance.js`: Bank key outside the ring (reveal 503 `BANK_KEY_UNAVAILABLE`, detail, masked list and lookup still work, no account leaks, recovers); default currency inactive (create refused 409 `CURRENCY_NOT_ACTIVE`, reads and lookup still work, recovers; a business-rule rejection, not the `BUSINESS_MASTER_NOT_READY` dependency path); an in-flight request whose MySQL connection is killed (clean 500 with a code within milliseconds, thread gone, recovers); a locked Supplier row (suspend fails with a generic 500 after the 20 s transaction timeout and writes nothing later; lookup answers meanwhile; retry succeeds); a suspended Supplier never appears in lookup | PARTIAL | Network-layer faults in the deployed environment (NOT_RUN by design); the `BUSINESS_MASTER_NOT_READY` path and purchase submit are not exercised; lock contention answers a generic 500, not a specific code |
| TC-131 | OPS-004 | `runSupplierResilienceAcceptance.js` and `supplierStartupSelfCheck.integration`: on a freshly migrated schema, startup refuses a missing table, column, 0080 list index, 0087 SKU index serving its foreign key, settings row, permission or Bank key ring, changes nothing, and starts after the original definition is restored (DEF-033 fixed) | COVERED | Checked in-process, not by spawning `src/index.js` (its catch path exits 1 and logs `application.startup_failed`) |
| TC-132 | OPS-005 | `runSupplierResilienceAcceptance.js`: success, 404, 409 and integrity 500 each leave a request log line with route, status and duration; the metrics job reports a 25-hour approval and a stalled import and writes both alerts; key and integrity errors are error level; no account number or password in any log file; `supplierObservability` (unit, integration) | PARTIAL | Alert delivery to on-call (NOT_RUN by design). Not asserted: lookup metrics (`supplier.lookup.slow` is not implemented, `performance_report.md`), import lease-recovery and purge-failure events, Bank reveal and change counts, duplicate-conflict counts |
| TC-133 | OPS-006 | `runSupplierRecoveryAcceptance.js`: core, address, contact, identifier, Bank (real encryption), settings, a pending approval, an import job with its file, and audit seeded over HTTP (SKU relations and supply events are not); `mysqldump`, isolated restore; all-table CHECKSUM, table/trigger/routine/event definitions, job rows tied to their files by SHA-256, transaction marker; smoke and reveal on the restored copy; missing key `BANK_KEY_UNAVAILABLE` and wrong key `BANK_ACCOUNT_INTEGRITY_FAILED` | PARTIAL | Production RTO ≤ 4 h and RPO ≤ 15 min drill (NOT_RUN by design, HD-119 A) |
| TC-134 | OPS-007 | `runSupplierReleaseAcceptance.js`: stop-claim, a worker dying after an update row, a restarted app (second app in the same process) that waits for the live lease and takes over after expiry (set in the database), the update applied exactly once, completed job not rerun | PARTIAL | Production rollback timeline (NOT_RUN by design) |
| TC-135 | OPS-008 | `runSupplierReleaseAcceptance.js`: fresh schema from migrations (every migration file applied, rerun no-op, schema digest recorded but no release baseline to compare it with), six permissions and system-admin, settings default OFF, every Supplier route guarded by supplier.* permissions, separated-role smoke (Draft, direct activation, approval, suspend, block, purchase lookup, masked Bank, no plaintext in any stored byte, reveal, audit) | PARTIAL | Staged deployment in §14 order and break-glass accounts (NOT_RUN by design); client menu is TC-121 |
| TC-136 | OPS-009 | — (runner reports NOT_RUN) | NONE | The release gate is the harness verify_gate over CI and suite evidence plus the Product Owner's GO |

Recovery and release runners (HD-117 A, HD-119 A). Each TC has a local test and a separate NOT_RUN test for the production-only part, so `supplier-recovery` and `supplier-release-operations` report BLOCKED. Rerunning cannot change that: they close only through a risk approval, or a profile change once production evidence exists. The release suite also has two executable tests against `min_tests` 3.

Local run on 2026-10-21 against MySQL 26.7.0 with admin credentials: every local check PASS. Eleven mutants each fail the intended check: worker ignores stop; claim ignores a live lease; lookup shows suspended and blocked Suppliers; an audit route guarded by a non-Supplier permission; a restore that loses a row; import files not restored; a restored job that loses its source file; a dump without triggers; the missing-key check given the real key; an identity cipher; a takeover that redoes the update row.

The runners need an account that may create databases, restore triggers with a definer and run migrations (`DB_ADMIN_USER`/`DB_ADMIN_PASSWORD`, falling back to `DB_USER`), and `mysqldump`/`mysql` on `PATH` or in `MYSQL_BIN`. The harness passes a suite only its profile `env_keys`. Since HD-123 A the four runner suites list `DB_ADMIN_USER`, `DB_ADMIN_PASSWORD` (redacted) and `MYSQL_BIN`, and the recovery suite probes `mysqldump`. Run on 2026-10-22 with the harness's own environment construction, all four report BLOCKED rather than FAIL: every local test passed, the only gap was the designed NOT_RUN parts, and no secret appeared in the logs. `run_check` itself refuses these formal stages outside TEST_AND_VERIFY, so the run used a scratch driver that repeats `harness_runner.run_suite` after its preflight: the same env allow-list plus `env_keys`, tool probes, process, redaction, report parsing, status rules, and a check that plan, source and HEAD did not change. Without `DB_ADMIN_USER` the runners now report every case NOT_RUN (BLOCKED) instead of failing, and they use the admin user and password only as a pair (REV-112 L-2). `MYSQL_BIN`, when set, must point at the same `mysqldump` as the one on `PATH`, because the profile's probe checks `PATH` while the runner calls `$MYSQL_BIN/mysqldump` (REV-112 L-1). They clean up their own fixtures, found by a run tag, even after a failure.

Resilience runner (HD-117 A, HD-121 A). All three cases run on a freshly migrated `${DB_NAME}_rh_*` schema, dropped afterwards. TC-131 has no production-only part and can PASS; TC-130 and TC-132 each add a NOT_RUN test, so `supplier-resilience` reports BLOCKED. Local run on 2026-10-22: every local check PASS. Eight mutants each fail the intended check: schema check a no-op; the 0080/0087 index checks a no-op; missing key reported as integrity failure; lookup shows suspended Suppliers; key and integrity errors logged as warn; approval alert threshold doubled; reveal logs the plaintext; the reset check given `DO` instead of `KILL` (the request then fails only at the timeout, after about 10 s instead of 1 ms). An interrupted run (SIGTERM) drops its schema and temporary directory before exiting 130.

Performance runner (HD-117 A). It runs on a freshly migrated `${DB_NAME}_rh_*` schema seeded with the T50 100k data (about 1 minute), and uses the T50 tools for about 12 minutes of load. The tools' full reports are kept next to the output in `supplier-performance-details/`. TC-128 adds a NOT_RUN test for the production-like environment, so `supplier-performance` reports BLOCKED. The verdicts are a pure module (`supplierPerformanceVerdicts.js`); its unit test breaks each condition of each of the 19 checks in turn (45 cases) and expects that check to fail.

The figures depend on the machine. On 2026-10-22 seven runs were made:
1. The first applied 9,999 of 10,000 import rows (DEF-034) and found the performance_schema digest table full, so no plans were visible.
2. The second ran while another session's inventory benchmark was loading the machine (load average about 11): exact Code p95 was 1,154 ms, update 2,617 ms, and the for-SKU worst case was over 2 s.
3. The third started on a quiet machine: every check PASS, exact Code p95 248 ms.
4. The fourth was stopped with SIGTERM because it was running superseded code. It left nothing behind.
5. The fifth passed every check. Replayed later through the REV-111 verdicts, it fails the plan checks of TC-085 and TC-129: the MySQL's 1,024-character statement samples hid the plans of the three most expensive statements.
6. The sixth failed at the seed because of the runner's own missing-report rule, which was then corrected.
7. The seventh, with the HD-122 tools and the MySQL restarted with 16,384-character statement texts, passed every check with every plan visible (12 of 12 in both runs). The only base-table scans were the HD-088 text searches. Overall p95 under mixed load was 231 ms; the for-SKU worst case was 1,546 ms. The import ran from 1 s after the measured window opened to 37 s before it closed, and applied every row once.

Run it on an otherwise idle machine, with room in `performance_schema`'s digest table, and with `performance_schema_max_sql_text_length`, `performance_schema_max_digest_length` and `max_digest_length` large enough for the longest statements (16,384 here; MySQL's default 1,024 hides their plans). The runner fails rather than reporting "no full scan" when no plans are visible, including any top statement whose plan could not be seen but which ran without an index (REV-111 H-1).

## UAT (52)

Runner (HD-124 A): `npx playwright test --config client/e2e/supplier-management/playwright.uat.config.js`.
- **Environment:** a real server and real MySQL, with no network mock.
  - `uat/uatServer.mjs` creates `${DB_NAME}_rh_uat…` with the admin credentials, migrates it, seeds the 07 §2 roles with random passwords, and starts the server on :3021. Vite runs on :5216.
  - `globalTeardown` drops the database.
- **Logins:** each role keeps a persistent browser profile and logs in once per run, because the login throttle allows 20 attempts per IP in 10 minutes. New devices are approved in the database, as in Item UAT. Artifacts and profiles are written outside the evidence directory, because traces record typed passwords.
- **Missing `DB_NAME` or `DB_ADMIN_USER`:** the config throws, so no report is written and the harness records BLOCKED.
- **Test names:** each test title carries one UAT ID.
- **The technical specs** (`playwright.config.js`) still mock the network and are not UAT evidence.

PHASE-001 (`uat/uat-phase-001.spec.js`, 25 cases). Local developer run on 2026-10-23, which is not a formal UAT execution:

| Result | Cases |
| --- | --- |
| Pass | UAT-001, 002, 003, 004, 006, 007, 008, 009, 017, 018, 019, 020, 021, 022, 023, 031, 042, 048, 049, 054 |
| Fail on a recorded defect | None. UAT-031 passes since DEF-038, UAT-003 since DEF-039, UAT-048 since DEF-037. |
| `test.fixme`, waiting on downstream modules (HD-124 A, HD-131 A) | UAT-005; the Supplier steps of UAT-016, 024, 050 and 051 run first. |

PHASE-002 (`uat/uat-phase-002.spec.js`, 9 cases): approval and Supplier settings. Local developer run on 2026-10-26, which is not a formal UAT execution:
- **Result:** all 9 pass: UAT-010, 011, 012, 013, 014, 015, 040, 041 and 052. The full UAT config gives 29 passed and the 5 PHASE-001 `test.fixme` cases skipped.
- **UAT-014 and DEF-044:** before PR #283, UAT-014 failed at the invalidation warning (DEF-044, found by REV-120). It passes on main after that fix.
- **Where the rejection reason shows:** UAT-013 reads it in the detail's 變更紀錄 (Audit) tab, the only place it is shown.
- **Known limit:** a requester who also holds `supplier.approval` would be needed to prove that the approver list leaves out the requester. The 07 §2 roles have no such user. The server still refuses self-approval, which UAT-011 checks (`APPROVER_MUST_DIFFER`).
- **Approval policy setup:** the policy is a global setting. The cases set it in the database as a precondition and turn it off after each test, so PHASE-001 is unaffected. UAT-015 and UAT-041 change it through the Settings page, because that change is what they verify.
- **Defects found here:** writing these cases found DEF-042 (no way to submit an existing Draft from the detail) and DEF-043 (the requester could not withdraw), fixed in PR #282. REV-120 found DEF-044 (no invalidation warning or notice), fixed in PR #283.

PHASE-003 (`uat/uat-phase-003.spec.js`, 7 cases): bank data. Local developer run on 2026-10-26, which is not a formal UAT execution:
- **Result:** 5 pass (UAT-025, 026, 027, 028 and 030). 2 are `test.fixme` after their Supplier steps pass. The full UAT config gives 34 passed and 7 skipped.
- **Defects found here, fixed in PR #286:**
  - UAT-028 failed at the default-switch wording: the dialog showed the literal `**同時被取消**` (DEF-046).
  - UAT-030 failed at its alert step (DEF-047). Earlier it had been counted as a pass without that evidence, which REV-123 R2 corrected.
- **`test.fixme`:**
  - UAT-029: the Buyer step needs Purchasing.
  - UAT-053: refusing to retire a referenced account needs a downstream payment reference.
- **UAT-030 alert step:**
  - The step asks for a warn-level or higher system log event naming the Supplier. Since PR #286 that is `supplier.bank.privileged_use`, which carries ids only. Denied attempts are read from the logs, not counted as a metric (HD-143 A).
  - A wrong password is refused for both reveal and write, and the row is unchanged after the refused write (REV-123 R3).
- **No plaintext:**
  - Fictional account numbers are generated per test.
  - Every case checks that no full number appears in the Audit rows or in the server log bytes written during the test.
  - As a control, the check first waits for the test's last bank request id (`X-Request-Id`) in the request log. It looks in the request log only, because a refused request also writes its id to the system log (REV-123 R1).
  - The server's stdout is not scanned.
- **No plaintext in evidence (07 §2, REV-123 R4):**
  - Trace, failure screenshots and the failure aria snapshot (`error-context.md`) are off.
  - Plaintext is compared as booleans. While a number is on screen or in an input, only `expect.poll` is used, because a failed locator matcher attaches the page.
  - Every evidence screenshot first checks that no account number is on the page.
- **Refusal prompt:** UAT-025's refusal is the server's 403. A VIEWER has no reveal control, so there is no on-screen prompt to show.
- **Deactivated accounts:**
  - The masked list shows active accounts only, and nothing in the design or requirements asks for more.
  - In `SupplierBankPanel.vue`, the 「已停用」 badge and the edit control for inactive rows never render, because `list({ includeInactive })` is never passed. That is dead code; it is noted here and left alone.
  - UAT-053 checks that the row is kept as `inactive` and audited.
- **30-second clear:** UAT-026 pauses Playwright's clock right after the reveal. The number is still shown at 29 s and is gone at 30 s; a 31 s deadline fails the case.
- **Leaving the page:** the step proves only that the user sees the number cleared. The panel unmounts, so the step cannot tell which of its clear triggers fired.
- **Database checks:** some checks read the database because the screen cannot show what they need: no plaintext in Audit detail, exactly one active default, and the kept inactive row. They are technical supplements, and each is marked in the spec.

Phase 004 and the cross-phase cases are not written yet. UAT-054 is the only case that intercepts a request in the browser: a slow response and a 503 cannot be produced safely on a real server.
