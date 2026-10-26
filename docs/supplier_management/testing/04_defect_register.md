# Supplier Management — defect register (DEF-023 onward)

Narratives for defects whose typed records live in `00_harness_state.json`. The ledger schema has no
description field, so the text that earlier checkpoints wrote into a `summary` field (rejected by the
schema) was moved here verbatim at revision 239. Status is authoritative in the ledger, not here.

## DEF-023 — LOW

The request log's only protection against a bank plaintext is the field-name blacklist redactedFields, while bodyCaptureErrorStatus 500 forces a full body capture on any 5xx into a file kept 30 days. Today the API contract happens to name the field accountNumber, which is on the list. A plaintext arriving under another name, nested, or in a URL is not covered. Demonstrated by removing accountNumber from the list, which turns TC-074 red on the request_log channel. Flagged for SUP-CAP-05, whose CSV import will accept account numbers under column names the blacklist has never seen. REPORT_ONLY: no product change made.

**Reassessed at TASK-043 (HD-036 §3, HD-042).** The CSV import does not reach this risk: multipart bodies are logged as `[FILE_TRANSFER]` even on a 5xx (now pinned in `requestLogger.test.js`), a Bank column fails the file before any row is stored, and row errors never carry cell values. The integration test finds an IBAN sent under an `IBAN` column in no row, job, audit or log. The risk on JSON routes is unchanged; DEF-023 stays open and accepted.

**Correction after REV-064 H-1.** The paragraph above missed the system log: a stray quote made csv-parse throw an error whose message held the cell text, and the scheduler logged it. Fixed in T43 (every parse error fails the file; the worker hands the scheduler a code only), with an integration test that puts an IBAN in `notes` behind a stray quote and finds it in no log. Since HD-053 a Bank column is refused at upload. REV-065 M-1 found that a leading blank line let such a file past that check (the two parsers disagreed); since HD-054 the upload reads the header exactly as precheck does and refuses any header problem, so a Bank-column file is never stored.

## DEF-024 — LOW

ER_LOCK_DEADLOCK from InnoDB reaches the caller unchanged rather than being retried. Normal for an application to delegate the retry, but it is documented nowhere an operator would look, and bank_operations.md does not exist. Observed when TC-077's fixture ran concurrently with the existing deliberate-contention tests. REPORT_ONLY: no product change made; the harness retries only its own fixture seed, never an assertion.

## DEF-025 — MEDIUM

A node_modules symlink pointing at one developer's absolute path was committed and reached main. .gitignore's node_modules/ entry has a trailing slash and matches directories only, so a symlink of that name was not ignored and git add -A staged it. Two harms: any clone with dependencies installed could no longer git pull (fatal: cannot rmdir 'node_modules': Directory not empty), and the repository carried a machine-specific absolute path. CI could not see it structurally - a runner checks out fresh and runs npm ci, so it never has an existing directory to replace. Fixed by git rm --cached plus a second, slashless .gitignore entry. CORRECTION recorded at the next checkpoint: the harm was understated. The failed pull did not merely refuse to update - before it aborted with 'cannot rmdir', git deleted ignored files it treated as expendable, removing 258 of the 422 top-level packages from the main checkout's node_modules (dotenv and the whole eslint toolchain among them). The directory's mtime matched the failed pull to the second. A clone that attempted a pull between PR #149 and PR #151 was left unable to run lint or tests. Repaired with npm ci in the main checkout after confirming it was clean and that nothing was running from it; afterwards 399 of 422 were present and every one of the 23 absent was an optional platform-specific binary for another OS or CPU, with this machine's darwin-arm64 binding installed; lint exited 0 and the Bank server and client suites passed there.
## DEF-026 — MEDIUM

A reveal of a row whose encryption key is missing from the ring and a reveal of a tampered row both
returned `422 BANK_ACCOUNT_UNREADABLE`. The design makes the first `503 BANK_KEY_UNAVAILABLE` (§6, §8.3)
and the second a generic `500` with a critical alert (§8.3, §12). Fixed on `claude/supplier-def-026-027`:
two errors, two error-level log events (`supplier.bank.key_unavailable`, `supplier.bank.integrity_failed`),
neither carrying the account or the key id. Retest in `02_technical_test_report.md` §2c.

## DEF-027 — HIGH

A row whose lookup key is missing from the ring cannot have its blind index recomputed, so the duplicate
check never matched it and the same Supplier could add the same account again; startup did not notice.
Fixed per HD-037 option (b): create and account-changing update for that Supplier return `503
BANK_KEY_UNAVAILABLE` with an error log (`supplier.bank.duplicate_check_unavailable`); other Suppliers are
unaffected; deactivated rows count, as they do in the unique index. Re-entering the account repairs a row
only when it is active and the Supplier's only such row; when the key material is lost, the lookup
reindex accepts `--from-lost` (HD-038, REV-057 M-2). A new eager service,
`SupplierBankKeyCheckService`, logs `supplier.bank.keys_outside_ring` (kind and row count, no key id) at
startup and never refuses to start. The equivalent Customer-module gap is outside this module and was
not taken up, on the Product Owner's instruction.

## DEF-028 — LOW

Design §5.8 masks short accounts with `*`; the projection used `•`. Fixed per HD-037 by changing the code
rather than the design (a design edit would move the DESIGN hash and strand 36 reviews): every mask now
uses `*`. Client unit-test fixtures still carry the old character as mock strings; they do not depend on
the server.

## DEF-029 — HIGH

`fk_supplier_sku_refs_sku` (`supplier_sku_refs.sku_id` → `item_skus.id`) is not enforced for child INSERT or UPDATE on MySQL 26.7.0, the version CI and the target use. A relation row with a `sku_id` that does not exist is accepted; deleting a referenced SKU is still refused.

Found while writing the SKU-005 carrier (TC-082). Reproduced in the MySQL CLI and in a scratch schema: InnoDB serves the key with the first index that starts with `sku_id`, here `idx_supplier_sku_refs_sku_status_supplied (sku_id, relationship_status, last_supplied_at)`. When that index carries a nullable column, the child-side check is skipped. A plain key, or one served by `(sku_id, relationship_status)`, is enforced.

What fixes it, verified on a populated table: drop the foreign key and that index, add `KEY (sku_id)`, then re-add the composite index and the foreign key. It survives `FLUSH TABLES`. The re-add fails if orphan rows exist. Adding the single-column index after the composite one, or only dropping and re-adding the key, does not fix it.

The service checks the SKU before inserting, so today only direct writes are exposed.

A scan of all 250 foreign keys found the same fault on `item_skus.item_id` and `item_media.item_id`, which belong to Item. Decision: HD-113.

Fix, per HD-113 A, with the procedure changed after REV-100 H-1 (HD-114): migration
`0087_fix_supplier_sku_refs_sku_foreign_key.js` stops and lists orphan rows if there are any. Otherwise one
`ALGORITHM=INPLACE, LOCK=NONE` statement adds `idx_supplier_sku_refs_sku (sku_id)`, then drops and re-adds the
composite index, so the single-column index comes first. The foreign key is never dropped: deletes stay refused
throughout, and writes are never blocked by a table rebuild. Orphan rows are checked again afterwards, and so is
which index serves the key; a UNIQUE index starting with `sku_id` would sort first and is reported. A connection
with `foreign_key_checks=0` is refused. A rerun only checks. A manual `down` drops the single-column index, which
is the 0081 definition again. `supplierSkuForeignKeyMigration.integration.test.js` exercises it on a copy of the
table, with the 0081 definition as a control; the TC-082 carrier's direct orphan insert is now refused. The Item
finding is handed over in `item_handoff_foreign_keys.md`; for `item_skus` the same procedure does not work
(REV-100 M-2), and the document says what does.

## DEF-030 — LOW

`SUPPLIER_DUPLICATE_NAME_THRESHOLD` has no effect. `config/supplier.js` reads it, `normalizeSupplierConfig` validates
it, and design §12.1 lists it, but no `SupplierAdminService` is given a checker built from it: every construction site
uses the class default, 0.85. Setting the variable to another value changes nothing in UI create or update.

Found by REV-101 (M-1) while reviewing the HD-057 A similar-name report. The report uses the same default checker as
UI create, so the two agree. A test pins this, and it will turn red when this defect is fixed, so the report follows
the setting.

Not fixed here. Wiring the setting changes UI behaviour for any non-default value, which is outside HD-057.

## DEF-031 — MEDIUM

When two requests add the same identifier to two different Suppliers at the same moment, one of them can get
`500 INTERNAL_SERVER_ERROR` instead of `409 SUPPLIER_IDENTIFIER_TAKEN`.

The duplicate check takes a shared lock on `uq_supplier_identifier_value`. When both inserts are waiting for their
insert-intention lock, InnoDB detects a deadlock and rolls one of them back (seen in `SHOW ENGINE INNODB STATUS`).
`SupplierIdentifierService` maps only `ER_DUP_ENTRY`, and nothing retries a deadlock, so the rollback surfaces as a
500. The identifier is still unique and no data is wrong; only the response is.

Found by REV-103 (M-2) in raw SQL, and reproduced over HTTP: 1 of 150 deliberate simultaneous rounds returned 500. The
same probe on Supplier create (a reused code) gave 150 of 150 clean 201/409 pairs. Address, contact, Bank and
approval writes lock the Supplier row first, so two of them for the same Supplier cannot reach the unique key
together. Decision: HD-115.

Fix, per HD-115 A:

- **What changed.** Four writes now run their whole transaction again, once, when it fails with `ER_LOCK_DEADLOCK`: identifier create, identifier update, Supplier create, and Supplier Code change. The helper is `retryOnceOnDeadlock` in `supplierErrors.js`, following the retry in `SupplierRelationService`.
- **Why the retry answers 409.** The retry either sees the winner's committed row or queues behind it, so it hits the unique key and returns the normal 409. If the winner rolled back instead, the retry succeeds.
- **Logging.** Each retry logs `supplier.write.deadlock_retried` with the operation and request ID, so deadlocks stay visible.
- **Coverage beyond HD-115.** Supplier create turned out to be affected too: the forced test returns 500 on every run without the fix. REV-104 found Supplier Code change exposed in the same way (M-1). It is fixed under the same rule. CSV import already maps a deadlock to `SUPPLIER_IMPORT_ROW_BUSY`.
- **The test.** `supplierDeadlockRetry.integration.test.js` forces the deadlock deterministically:
  - A third transaction inserts the same value and does not commit.
  - Once performance_schema shows both requests queued behind it, it rolls back.
  - The test checks that InnoDB's latest deadlock happened after the test started and on the expected unique index.
  - The two responses must be 201/200 and 409, and the retry must be logged.
  - The two requests come from two different users. Requests from one user queue on that user's row first.

## DEF-032 — LOW

Found by REV-107 M-1 (TC-013, LIST-006). The shared `client/src/framework/ui/DataTable.vue` replaces Quasar's no-data slot with a fixed 「冇資料」 and ignores the slot's `message`, which Quasar sets to the loading label while loading. On a failed read it empties the rows, so 「冇資料」 also appears under the error banner. A sighted user therefore sees "no data" while the Supplier list is loading, when it is empty, and when the read failed. Only `aria-busy` and the error banner tell the states apart, against FR-LIST-010. The component is shared framework code outside the Supplier module, used by every list page, so the fix needs its own decision. REPORT_ONLY: no product change made. The TC-013 test asserts what is distinguishable today and the map marks TC-013 PARTIAL.

**Fixed under HD-118 A (APPROVAL-HD-118-SCOPE).** `DataTable` now owns the `#no-data` slot. While loading it says 「載入中…」. In server mode (`fetch`), after a failed read it shows nothing there and leaves the message to the error banner, and only a successful empty read shows the empty-state text, whether it is the default 「冇資料」 or the page's own slot. The text is the app's own rather than Quasar's `loadingLabel`, because no Quasar language pack is installed and that label would read "Loading...". This also changes the pages of other modules that pass their own `#no-data` (Sales import, orders and quotations): their empty text no longer appears while loading or under an error. Tests: `DataTable.test.js` (both slot kinds, server and client mode), the TC-013 list test, and a Playwright test in `supplier-list-filters.spec.js`. The original component turns all of them red.

Known limitation (REV-108 L-2): in client mode (`rows` and `loading` props) DataTable has no error input. A page that catches its own read failure and leaves its rows empty, such as `UomsPage`, still shows 「冇資料」 beside its own error notice. The Supplier list uses server mode and is not affected. Fixing those pages belongs to their owners.

## DEF-033 — MEDIUM

Found while preparing the TC-131 (OPS-004) runner. On a freshly migrated scratch schema, the server starts and `/api/v1/health` answers `ok` when a non-core Supplier table (`supplier_contacts`), a column (`suppliers.website`) or the `supplier_settings` singleton row is missing. Startup checks only that `suppliers`, `supplier_addresses` and `supplier_address_purposes` exist. A missing Supplier permission (framework permission catalogue) and a missing Bank key ring (configuration validation) are already refused. Design §14.1 step 4 requires the startup self-check to cover schema, permissions, the settings singleton and the key ring. Fix approved as HD-121 A.

**Fixed under HD-121 A.** A new eager service, `supplierSchemaCheck`, runs at startup. It checks every Supplier table against its own migration contract (`inspect*Schema`). Every inspector requires the full column set; how much more it checks varies: most also check types, NULL, collation, indexes and foreign keys, but the contacts and settings inspectors compare column names only (REV-110 L-1). It also checks the 0080 list indexes and that 0087's `(sku_id)` index serves the SKU foreign key (REV-110 M-2), and requires the `supplier_settings` row `id = 1`. Anything missing or not matching refuses startup with a message that names the table, index or row (a missing column is reported against its table, because the inspector compares the column count first) and says nothing was changed. Health is never reached, because the server does not listen. Database errors other than a contract mismatch are rethrown as they are. Tests: `supplierStartupSelfCheck.integration.test.js` (CI) and TC-131 in the resilience runner remove a table, a column, a 0080 index, the 0087 index, the settings row and a permission on a freshly migrated schema. Each expects refusal and an unchanged database, restores the original definition, and expects a clean start. Control: making the check a no-op lets a schema without `supplier_contacts` start, and the test fails.

## DEF-034 — LOW

The first run of the performance runner (2026-10-22, TC-101) found a 10,000-row import, run alongside a 50-user load on 100k seeded Suppliers, that applied 9,999 rows. One row ended not applied. The job's counts stayed consistent, so the row was reported as failed rather than lost silently, but every row in that file is a valid create. The cause is unknown: that first runner version deleted the tools' reports. The next three runs applied 10,000 of 10,000, and T50's earlier runs did too. The runner now keeps the tools' reports. While the import runs, it also polls for failed rows and records their stored errors (`evidence.importFailedRows`), because the import tool deletes its job and rows when it finishes. A recurrence will therefore show the reason. REPORT_ONLY: no product change.

## DEF-035 — MEDIUM

Found while preparing the UAT browser tests (HD-124 A). Design §7.2 lists seven Supplier pages, including `SupplierAuditPage.vue` (`/suppliers/audit`, menu 「變更紀錄」, audit filter and masked detail). It also gives the detail page an Audit tab, `SupplierAuditTimeline.vue`. Neither exists. No task in `05_development_tasks.md` covers them: T09 built only the audit service and `GET /api/v1/supplier-audit/logs`. UAT accepts only user-observable evidence, and at least ten cases read the Audit page (UAT-001, 006, 009, 012, 020, 026, 030, 041, 043 and 055). Fix approved as HD-125 A, without changing the plan.

**Fixed under HD-125 A.**
- **What was built:**
  - `SupplierAuditPage.vue` (`/suppliers/audit`, menu 「變更紀錄」, `supplier.view`).
  - A shared `SupplierAuditTimeline.vue`, which is also used by a new 「變更紀錄」 tab on the detail page.
  - Both read the existing `GET /api/v1/supplier-audit/logs`.
- **What the page does:**
  - Filters by Hong Kong day bounds, actor, target, action and target type. A reversed range is shown as an error and not queried; a half-typed date is not queried either.
  - Any filter change starts again from page 1. Filters and paging are kept in the URL, so a refresh or a shared link restores them.
  - Shows time in Hong Kong time, the action, the target, the request ID in full, the reason, and before → after for each field.
  - The detail is shown as the server masked it. A notes digest is shown as a length (「notes：0 字 → 10 字」), never the hash, and a list the server summarised is shown as a count and a sample.
  - The tab asks only for its Supplier.
- **Review:** REV-113 (`implementation/116_rev_113_independent_review.md`); every finding fixed as recommended.
- **Tests:**
  - `audit.test.js` and `supplierAudit.test.js`. A 13-mutant sweep covering the review's surviving mutants turns every one red.
  - Two Playwright tests in `supplier-audit.spec.js` (network mocked).
  - A real-backend browser check (local, not CI): a viewer saw the request ID on screen, no account plaintext, inert markup, the notes length, and the filters restored after a reload.
  - UAT (UAT-001, 055 and others) will exercise the page against a real backend under HD-124 A.

## DEF-036 — HIGH

Found during the DEF-035 real-backend check. The Supplier create and edit forms (`SupplierBasicForm.vue`, `SupplierPaymentDefaults.vue`) and the list filters (`SuppliersPage.vue`) load currencies and payment terms from `GET /api/v1/business-master/currencies` and `/payment-terms`. Both endpoints require `business_master.view` (`VIEW_POLICY` in `server/src/handlers/business-master/businessMasterSchemas.js`). Design §6 (the endpoint table) says they should accept `supplier.view` or the matching consumer permission.

- **Measured** (local, erp_t51): a user with `supplier.view` and `supplier.mgmt`, the UAT CLERK role, gets 403 on both lists. With `business_master.view` added, both return 200.
- **Effect:** a CLERK cannot choose a default currency, so cannot create a Supplier in the UI. This blocks UAT-001 and every UAT case that starts from a new Supplier.
- **Owner:** the endpoints belong to Business Master, which is not Supplier code. **Decision required (HD-126).**

**Fixed under HD-126 A.**
- **What was built:** two Supplier-owned lookups, `GET /api/v1/supplier-lookups/currencies` and `/payment-terms`.
  - Permission: `supplier.view` only, `jwt`, no password. Request and response schemas are closed.
  - They read through the shared Business Master provider, so they return only Active values and only the provider's projection (no audit fields, timestamps or description).
  - They run the Business Master readiness check first. When Business Master is not ready the answer is `503 BUSINESS_MASTER_NOT_READY`, never an empty list.
  - At most the first 100 Active values, the same as the forms asked for before.
- **Client:** the create form (`SupplierBasicForm.vue`) and the payment defaults on the detail editor (`SupplierPaymentDefaults.vue`) use them.
- **Not changed:**
  - Business Master's own lists still require `business_master.view`, and still refuse a CLERK (pinned by an integration test).
  - The Supplier list filters (`SuppliersPage.vue`) still use the Business Master lists and stay hidden without `business_master.view`. They need Inactive values to filter older Suppliers, which the new lookups do not return.
- **Design §6:** the endpoint table still names the Business Master routes. This is an approved deviation recorded here and in HD-126; the design text is not edited, because that would move the design baseline (REV-114 L-2).
- **Review:** REV-114 (`implementation/117_rev_114_independent_review.md`); findings fixed as recommended.
- **Tests:**
  - Handler unit tests (permission, closed schemas, readiness before listing, real readiness wiring).
  - An integration test: a CLERK gets Active values only, and the Business Master lists still answer 403.
  - The route contract in `supplierSecurityAcceptance`.
  - Client unit tests for the service and the edit-form options.
  - A real-backend browser check: a CLERK created a Draft Supplier in HKD through the UI, with no call to `/api/v1/business-master/*`.

## DEF-037 — MEDIUM

Found while writing the UAT PHASE-001 browser tests (HD-124 A). FR-PARTY-001 (Must) says addresses and contacts can be added, edited, deactivated **and ordered**, and UAT-048 asks the user to change the order and see it saved. Design §5.5 and §5.6 have no ordering column, and neither the server nor the UI can order them: lists are sorted by status, name and id. The requirement reached neither the design nor the plan.

- **Effect:** UAT-048 fails at its ordering step. Every other step of UAT-048 passes.
- **Decision:** HD-129 A, fix it. This adds a `sort_order` column to `supplier_addresses` and `supplier_contacts`, an API to change the order, and move-up and move-down controls in the UI. The migration needs its own explanation and approval before it is written. The design text changes too, which moves the design baseline.

**Fixed under HD-129 A. The migration was approved as HD-136.**
- **Schema:** migration `0103_add_supplier_party_sort_order` adds `sort_order INT NOT NULL DEFAULT 0` to both tables.
  - Each Supplier's current display order is filled in: addresses by status then id; contacts by status, name, then id.
  - It is numbered 0103 because an in-flight sales-archive branch already uses 0101 and 0102.
  - The 0032 and 0033 inspectors accept the new column; their `up()` is unchanged. The startup self-check requires the column through 0103's own inspector.
- **Server:**
  - New rows go last.
  - `POST .../addresses/:addressId/move` and `.../contacts/:contactId/move` take `{ direction: up|down, version }`. They swap with the adjacent **active** row under the Supplier lock and are audited as `supplier.address.reorder` / `supplier.contact.reorder`. The first row cannot move up and the last cannot move down (409 `SUPPLIER_PARTY_MOVE_NOT_POSSIBLE`).
  - Lists order by status, sort_order, id.
  - The ordering address that the Purchasing provider returns does not include `sortOrder`.
- **UI:** 上移 and 下移 on each active address and contact.
- **Design:** §5.5, §5.6 and §6 are updated. The design baseline moved (29a0615a → 171cf540) and the bound approvals were re-affirmed as `-HD129` copies. Purchasing pins the Supplier design hash, so its owner has to refresh that pin.
- **Tests:**
  - Integration: move up and down, the ends, skipping inactive rows, version conflict, other Suppliers' rows untouched, the 0103 backfill order and its rerun.
  - The migration convergence and adding-Supplier cases (TC-002, TC-006) and Audit coverage (TC-103).
  - Panel vitest.
  - UAT-048 now passes on the real backend.
- **REV-118 follow-ups:**
  - Locking reads, so two creates at the same time cannot share an order.
  - Tied rows are renumbered before a move.
  - Only the moved row's version changes; the neighbour is recorded in the Audit metadata.
  - A startup case refuses a deployment without 0103.
  - The manual rollback is written in 0103's header.
  - The list reloads after a refused move.

## DEF-038 — MEDIUM

Found by UAT-031. The Supplier detail shows the default payment term as its internal ID (for example 「付款條件 2」), whether or not the term is Active, because the page prints `defaultPaymentTermId`. The edit form shows the same ID when the Supplier's term has since been deactivated, because the Active-only options cannot label it. UAT-031 expects an old inactive value to stay readable. Currencies are not affected, because their code is the identifier.

- **Effect:** UAT-031 fails at its last step. Every step before it passes, including the check that Supplier Settings has no catalogue write controls.
- **Decision:** HD-130 A. The Supplier detail response gains `defaultPaymentTerm { id, code, name, status }`, read through the provider's history so an Inactive term is included. The UI shows 「code — name」 and marks an inactive term. The response only gains a field, so existing callers are not affected.

**Fixed under HD-130 A.**
- **Server:** `getSupplier`, which every detail path uses (GET, update, code change, lifecycle actions), adds `defaultPaymentTerm` from `getPaymentTermHistory`. The response schema allows an object or null and is closed. Create returns no such field and shows no term.
- **Client:**
  - The overview shows 「code — name」, adds 「（已停用）」 for an Inactive term, and shows 「未設定」 without a term.
  - The editor shows a term that is missing from the Active options as an extra option. That option is marked and disabled only when the server says the term is Inactive, so an Active term that is still loading, failed to load, or is not on the first page is never called inactive (REV-116 M-1).
- **Review:** REV-116 (`implementation/119_rev_116_independent_review.md`). Its findings are fixed, except two raised as their own defects: DEF-040 and DEF-041.
- **Tests:** an integration test (Active, then deactivated, then none) and vitest cases (inactive, Active, loading or failed options, unnamed term). UAT-031 now passes, and checks the 「（已停用）」 mark.

## DEF-039 — LOW

Found by REV-115 (M-2) on UAT-003. AC-003 says 「允許使用者確認合理原因後繼續」, and UAT-003 asks the user to 「確認原因」 and lists Audit as evidence. The create page offers only 「確認並繼續」, with no reason. The create Audit records neither that a duplicate warning was shown nor which candidates were overridden. Design §4 never had a reason either: the requirement did not reach the design, the same pattern as DEF-037.

- **Wording is ambiguous:** AC-003 can also mean "the user confirms there is a valid reason", which the current button does.
- **Effect:** UAT-003 now fails at its Audit step. Every earlier step passes.
- **Decision required (HD-132):** the Product Owner interprets AC-003, or asks for a reason field and an Audit record.

**Fixed under HD-132 B.** AC-003 is read as a plain confirmation, so the user gives no reason.
- **Create Audit:** a create that follows a similar-name warning records the warned candidates' Supplier codes in its Audit, as `warnings.duplicateCandidates`. `warnings` was already on the Audit detail allow-list. A create without candidates records nothing.
- **Import:** imports do not run the similar-name check (HD-052, HD-075), so they record nothing.
- **Size:** the candidate list is capped at 10, so the Audit detail stays within its size limit.
- **Tests:** an integration test with a near-match name (not an exact match), and UAT-003, which now passes.

## DEF-040 — MEDIUM

Found by REV-116 (M-2), the same class as DEF-038. Two more screens print the payment term's internal ID:
- The Supplier list column 付款條件 renders `defaultPaymentTermId`.
- The approval diff row 預設付款條款 renders the raw ID.

DEF-038 covered only the detail page and the edit form, and UAT-031 does not cover these two screens. The list would need one batched read by ID, not one provider read per row. **Decision required (HD-133).**

**Fixed under HD-133 A, with one deviation (REV-117 M-1, HD-135).**
- **What changed:**
  - List items gain `defaultPaymentTerm`; the approval detail gains `paymentTerms`. Both are `{ id, code, name, status }` read through the Business Master provider.
  - The list column and the approval difference show 「code — name」 and mark an inactive term.
  - The detail page uses the same label helper and schema.
- **Deviation from HD-133 A:**
  - The decision says one batched read per page. The provider has no read by IDs, and Business Master is not this module's code.
  - So a page reads the first 100 Active terms once (one list read), then one history read for each term that is not in that list (Inactive, or beyond the first 100).
  - The read count is pinned by a unit test.
  - REV-117 measured: 0.35 ms for a page with 3 Active terms, 8.9 ms median and 28 ms worst for a page of 100 distinct Inactive terms (local).
  - The performance fixture (TC-101) uses only Active terms, so it measures only the cheap path.
  - Raised as HD-135.

## DEF-041 — LOW

Found by REV-116 (I-1). A Supplier whose payment term has since been deactivated cannot be saved, even when the user changes only another field.
- **Effect:** the update re-checks the term with `purpose: "new_assignment"` and answers `409 PAYMENT_TERM_NOT_ACTIVE` 「付款條款目前不可用」. Activating such a Supplier is refused the same way.
- **What the user sees:** the general edit banner shows the message, but the term field itself is not marked. The user has to clear the term or pick an Active one first.
- **Requirement:** FR-EDIT-003 asks for statuses to be re-checked on edit, so the refusal may be intended, and the missing field hint is the defect. **Decision required (HD-134).**

**Fixed under HD-134 A.**
- **Behaviour:** the refusal stays. On the Supplier editor, a 409 `PAYMENT_TERM_NOT_ACTIVE` now marks the payment-term field with 「付款條款已停用，請改選或清除」. Clearing the term and saving again succeeds (REV-117 real-browser check).
- **Not changed:** the create page and activation still show only the generic message. HD-134 A named only the editor.

## DEF-042 — HIGH

Found while writing the UAT PHASE-002 browser tests (UAT-014). With approval on, an existing Draft cannot be submitted from the Supplier detail page.
- **What the user sees:** the detail page's 「啟用」 dialog sends only the version. It even says 「完成後狀態：啟用」.
- **What the server answers:** `400 APPROVER_REQUIRED` 「目前設定需要指定審批人」. The Supplier stays Draft.
- **Where the selector is:** only on the create page (`SupplierApprovalPanel`). Design §7.4 says the Create／Detail editor shows the approver selector when approval is on.
- **Effect:** a Supplier that was rejected, withdrawn, or whose request was invalidated by an edit cannot be resubmitted in the UI. Nor can any Draft created while approval was off. This blocks UAT-014 (「需重新提交」) and UAT-052 (resubmission).
- **Measured:** local, real backend, CLERK, approval on. **Decision required (HD-138).**

**Fixed under HD-138 A.** With approval on, the detail page's 「啟用」 dialog now shows the same approver selector and note as the create page. It reads 「提交審批」 and 「完成後狀態：待審批」, cannot be confirmed without an approver, and sends `approverUserId`. With approval off nothing changes.
- Client only.
- Tests: component tests (approval on and off). On the real backend, UAT-014 resubmits through it.

## DEF-043 — MEDIUM

Found by UAT-052. Only the requester can withdraw a Pending request, and the 「撤回」 button exists only on the approvals page (`/suppliers/approvals`).
- **Why the requester cannot reach it:** that page requires `supplier.view` and `supplier.approval`. A CLERK (`supplier.view` and `supplier.mgmt`) who submitted is sent to /403.
- **The API is not the problem:** `POST /api/v1/suppliers/:id/approval/withdraw` needs only `supplier.mgmt`. The requester simply has no screen to call it from.
- **Effect:** UAT-052 fails at its first step. **Decision required (HD-138).**

**Fixed under HD-138 A, extended by the Product Owner's 'DEF-043 A'.** A client-only fix was not possible, because nothing a CLERK can read returns the request ID and version.
- **Server:** the Supplier detail response gains `pendingApproval { requestId, version, requestedAt, requester, assignedApprover }` while the Supplier is `pending_approval`, and `null` otherwise. The field is additive and readable with `supplier.view`.
  - It is on the responses that go through `getSupplier`: GET detail, update, code change and the status actions. The create response does not carry it.
- **Detail page:** it shows 「待 X 審批（Y 提交）」. Only the requester gets 「撤回審批」, which calls the existing withdraw API; the server still checks that the caller is the requester.
- **Tests:** an integration test (fields, withdraw from those values, then `null`) and a component test (shown to the requester only). On the real backend, UAT-052 runs end to end: withdraw, resubmit, reassign with a reason, the old approver blocked, the new approver approves.

## HD-116 A: dispositions (2026-10-21)

Fixed in this change:

- **DEF-003.** Supplier completeness reads the default currency through the Business Master provider (`getCurrencyHistory`) instead of querying `currencies`. The query handler now builds a real provider, and a unit test pins that no raw `currencies` query remains. `getCurrencyHistory` does not check Business Master readiness, so when Business Master is NOT_READY the completeness check still reports `CURRENCY_NOT_ACTIVE` rather than 503. A readiness gate on this read path is not part of this fix (REV-106 L-1).
- **DEF-005.** Address text fields are limited to their column lengths, counted in characters, and refuse C0/C1 control characters (newlines included), like contacts and identifiers.
  - **Error.** `400 SUPPLIER_ADDRESS_INVALID` with `details.field`, and a message that names the field and the reason, for example 「備註不可包含換行或其他控制字元」 (REV-106 M-2). The UI shows that message.
  - **Paths.** HTTP already limited length. The CSV import already refused these values earlier, with its own row errors (REV-106 L-2, verified), so the new check is the service's own guard. Its field names are now mapped to the CSV columns in case it is ever reached.
  - **Existing rows** are not changed. But an existing address that contains a control character can no longer be saved until that field is corrected, even when the user edits another field. The message names the field.
  - **Release note.** Before release, count the affected rows: `SELECT COUNT(*) FROM supplier_addresses WHERE CONCAT_WS('', label, address_line1, address_line2, address_line3, city, state_region, postal_code, phone, notes) REGEXP '[[:cntrl:]]'`. Any clean-up of those rows is a data change that needs its own explanation and approval.
  - **Test change.** The HD-112 audit test that sent control characters in an address now expects this refusal.
- **DEF-006.** Identifier update and delete check `affectedRows` and answer `VERSION_CONFLICT` when no row matched.
- **DEF-010.** `BANK_ACCOUNT_MISSING` follows the sibling convention: an absent flag means missing. Bank is deployed, so the create response, the detail and the completeness check all evaluate it. Detail and completeness test for an active bank account, using the same definition as the list's `missingBank` filter. CORE-006 lists Bank among the warning-only data.
- **DEF-024.** Online Bank API writes (create, update, set default, deactivate) now retry once on `ER_LOCK_DEADLOCK`, like DEF-031. REV-106 M-1 showed that two *different* Suppliers can deadlock when each adds its first default account at the same moment: both take a gap lock on the same empty range before inserting. The test forces exactly that. Both creates succeed, the retry is logged, and without the retry one of them fails. `bank_operations.md` §6.3 explains this to operators.
- **DEF-030.** `SUPPLIER_DUPLICATE_NAME_THRESHOLD` now reaches every handler that runs the similar-name check, and the offline similar-name report reads it too, with the server's validation. The import worker is wired as well, but imports do not run the similar-name check (`findDuplicates: false`), so the setting has no effect there (REV-106 L-4).

Deferred to release, handed to their owners, or accepted: see `defect_handoffs.md`.
