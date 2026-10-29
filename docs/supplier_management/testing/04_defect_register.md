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

The first run of the performance runner (2026-10-22, TC-101) found a 10,000-row import, run alongside a 50-user load on 100k seeded Suppliers, that applied 9,999 rows. One row ended not applied. The job's counts stayed consistent, so the row was reported as failed rather than lost silently, but every row in that file is a valid create. The cause is unknown: that first runner version deleted the tools' reports. The next three runs applied 10,000 of 10,000, and T50's earlier runs did too. The runner now keeps the tools' full reports in `supplier-performance-details/` next to its own output. The import tool deletes its job and rows when it finishes, so before that it records up to 20 not-applied rows with their stored errors (`report.notApplied`, HD-122 A), and the runner copies them into its evidence (`evidence.import.notApplied`). A recurrence will therefore show the reason. Both runs on 2026-10-27 also applied 10,000 of 10,000. (Corrected 2026-10-27, REV-128 R4: this paragraph used to name `evidence.importFailedRows`, a poll that was removed in `6f413337`.) **2026-10-28, after the DEF-048 fix:** the two re-test imports at `f62651d8` also applied 10,000 of 10,000. PR #298 removed the create-path name-gram DELETE, which is the hypothesised route by which an import create could lose a deadlock. If the hypothesis holds, DEF-034 cannot recur by that route. The hypothesis is unproven, so DEF-034 stays OPEN. **Earlier on 2026-10-28:** both formal runs, code-identical to `a98e50e7`, applied 10,000 of 10,000. The REGRESSION run's online creates hit 500s under the import (DEF-048). The captured deadlock is in the name grams, and the online side lost it. If the import side lost such a deadlock, it would leave one row not applied, so this is a weak hypothesis for DEF-034, still unproven. REPORT_ONLY: no product change.

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

## DEF-044 — MEDIUM

Found by REV-120 (H-2) on UAT-014. Design §7.4 says 「Pending 進行 approval-significant 修改前提示原申請會失效」, and UAT-014's Required Evidence includes 「失效提示」. The UI shows neither:
- **Before the save:** editing a Pending Supplier gives no warning.
- **After the save:** the save shows only 「…的一般資料已更新」, while the Supplier silently returns to Draft. The server already returns `approvalInvalidated: true`, but the client never reads it.
- **Significant fields:** Code, name, display name, currency and payment term (`APPROVAL_SIGNIFICANT_COLUMNS`), and identifier changes.
- **Effect:** UAT-014 now fails at its warning step. **Decision required (HD-139).**

**Fixed under HD-139 A (client only).** No server, schema or API change: the server already returned `approvalInvalidated`.
- **Before the edit:** while the Supplier is `pending_approval`, the general editor, the Supplier Code dialog and the identifier create, edit and delete dialogs show 「此供應商正在審批中，修改 Code、名稱、顯示名稱、幣別、付款條件或識別資料會令原申請失效」.
- **After the save:** when the response carries `approvalInvalidated: true`, a yellow notice that stays until 關閉 is pressed says 「…。原審批申請已失效，供應商回到草稿，需要重新提交審批」 (REV-121 L-2; it was first a five-second success toast). A save that invalidated nothing keeps the plain success message.
- **Server flag (REV-121 I-2):** `updateSupplier` and `changeSupplierCode` now report `approvalInvalidated` from what `invalidateForSignificantChange` returns, as the identifier service already did, so the notice never claims an invalidation that did not happen.
- **Tests:** component tests in `editor.test.js`, `identifier.test.js` and `detail.test.js` fail on main's components and pass on the fix; they cover create, edit and delete of identifiers (REV-121 L-1). REV-121 ran 13 mutants; its two survivors (identifier edit notice, identifier edit warning) are now killed. On the real backend UAT PHASE-002 passes 9 of 9, UAT-014 included.

## DEF-045 — MEDIUM

Found by REV-121 (I-1); pre-existing, not caused by DEF-044's fix. A CSV import update row for a Pending Supplier that changes the name, display name, currency or payment term goes through `updateSupplierInTransaction`, which invalidates the request and returns the Supplier to Draft (`applySupplierImportRow.js:57` discards the `approvalInvalidated` it returns).
- **Design conflict:** §4.5 says significant edits invalidate a Pending request, while the import section says 「Update row 不藉匯入修改 Supplier Code、Bank 或狀態」.
- **Effect:** neither the preview nor the row results say the request was invalidated or the status changed.
- **Decision required (HD-140).**

**Fixed under HD-140 A.** Precheck now refuses such a row:
- **Error:** an update row for a `pending_approval` Supplier that would change the name, display name, currency or payment term gets one `SUPPLIER_IMPORT_PENDING_APPROVAL` error per changed column. The error is shown in the import page's row results, and the row is skipped at execution, so an import never changes a Supplier's status.
- **What still passes:** the whole row is refused, not just the significant columns. A row that changes no significant field still updates, and so does one that fills significant columns with their current values (for example an exported file re-imported). Each error message names its column, because the result CSV carries no field name (REV-122 I-3).
- **Shared comparison:** the check uses the comparison `updateSupplier` already uses, now exported as `changedApprovalFields`.
- **Timing:** a Supplier that becomes Pending after precheck has a new version, so its row fails at execution on the expected version instead.
- **What this supersedes:** REV-064 I-4 had made such rows invalidate the request. That was a review recommendation, not a human decision, and HD-140 A replaces it. The integration test that asserted the old behaviour now asserts the refusal.
- **Tests:** unit tests in `supplierImportPrecheck.test.js` and the import integration test fail on main's processor. Four mutants are killed:
  - a SELECT without `supplier_name` or without `display_name` (caught only on real MySQL; the `display_name` mutant survived REV-122 until the integration row re-sent the current display name);
  - the guard turned off;
  - only the first changed column reported;
  - the payment-term column misnamed.

## DEF-046 — LOW

Found by UAT-028. Design §7.5 asks that the default-switch wording state that the old default is cancelled. The confirmation in `SupplierBankPanel.vue` writes 「原本嘅預設銀行帳戶會**同時被取消**」 inside a Vue template, and Vue does not render Markdown. The user therefore sees the literal asterisks.
- **Effect:** UAT-028 fails at the wording step. The switch itself works: exactly one active default remains, and the change is audited.
- **Decision required (HD-141).**

**Fixed under HD-141 A.**
- **Fix:** the phrase is rendered as `<strong>同時被取消</strong>`.
- **Test:** the component test in `bank.test.js` now asserts the full sentence, no `**`, and the emphasised phrase. Before the fix it accepted either 「原本嘅預設」 or 「取消」, which is how the asterisks got through.
- **Result:** on the real backend, UAT-028 passes.

## DEF-047 — MEDIUM

Found while writing UAT-030. SEC-014 and design §4 (system-admin) say that a `system-admin` bank reveal or write still goes through the same re-authentication, audit **and alert** controls. UAT-030 asks for alert evidence.
- **Design §12.4** lists bank reveal and change counts and unauthorized attempts as metrics, with critical alerts for integrity or key errors. Only the integrity and key-error logs exist (`supplier.bank.integrity_failed` and `supplier.bank.key_unavailable`). `supplierMetrics.js` reports approvals and imports only.
- **Effect:** no alert or metric signals a break-glass bank reveal or change. The Audit row records it. The request log records each bank route and status code, without the actor, so §12.4's counts could be derived from it, but nothing derives them. UAT-030 fails at its alert step; its other steps pass.
- **Decision required (HD-142).**

**Fixed under HD-142 A, except the denied count (HD-143).**
- **Log event:** every committed bank reveal, create, update, default switch or deactivation by an actor holding `system-admin` writes a warn-level `supplier.bank.privileged_use` system log event.
  - Its context is `action`, `supplierId`, `bankAccountId`, `actorUserId` and `requestId`, and nothing else.
  - The role check uses the roles that `authorize` has just read from the database, not the token's claim.
  - Nothing is reported for an operation that fails, including at COMMIT. An operation retried after a deadlock reports once.
  - This event is the authoritative record and the one to page on.
- **Metrics (a summary only):** each `supplier.metrics` line gains a `bank` section with `bucketStart`, `windowMs`, `reveals`, `changes` and `privilegedUses`.
  - Each run reports the last whole five-minute bucket, aligned to the epoch and read from the Audit log. Any privileged use in the bucket raises `supplier.alert.bank_privileged_use` at warn level.
  - The job's cluster scope is a mutex, not once per interval. With N instances, each reports the same bucket, up to N times; deduplicate on `bucketStart`. A bucket can go unreported across a restart (REV-124 R2).
  - System-admin is judged by the role the actor holds now. A role revoked later under-counts, a role granted later over-counts, and a deleted user (`actor_user_id` set to NULL) drops out. The per-event log has none of these biases.
- **Denied attempts are not counted.** HD-142 A included a denied count, but nothing durable records a denial: denials roll back, and most are refused by the route policy before the service runs. Today each denied bank request appears in two places:
  - the request log, as a 403 on a bank route, without the actor;
  - the system log, as `http.request_failed`, whose `error.code` separates `AUTHORIZATION_DENIED` (route policy) and `BANK_PERMISSION_LOST` (service) from a wrong re-authentication password (`PASSWORD_INVALID`).
  
  The narrowing is put to the Product Owner as HD-143 (REV-124 R1).
- **Tests:**
  - Unit tests cover each of the five operations by a system-admin and by an ordinary role, a statement failure, a COMMIT that fails once or always, the alert, and the job's log lines.
  - An integration test on real MySQL pins both bucket edges, the counted actions, and a non-admin role versus `system-admin`.
  - Mutants killed: no report on update or on reveal; everyone reported; the report moved inside the transaction (create, update, reveal); no alert; the role join inverted or reduced to "any role"; the window widened; either bucket edge moved.
  - On the real backend, UAT-030 passes, including its alert step.

## DEF-048 — MEDIUM (closed 2026-10-28)

Found by the formal run in TEST_AND_VERIFY (HD-151 A). The run was `supplier-performance` at REGRESSION, on commit `7bbf547d` (code-identical to the mode entry commit `a98e50e7`), with evidence `evidence/20261028T032858-19847f4da7f2`.

- **What failed:** TC-101 (NFR-001 while a 10,000-row import runs alongside 50 online users). It failed two checks:
  - **Online Supplier create:** HTTP 500 for 6 of 291 requests (error rate 2.06%, limit 1%; p99 2,532 ms, max 3,982 ms). Every other operation passed.
  - **`import.inside_measured_window`:** the import ended at 03:40:24.195Z, after the load window closed at 03:40:21.338Z. The import took 114,558 ms (precheck plus execute 121,375 ms), against 66,267 ms (72,572 ms) at TECHNICAL. With zero 500s, TC-101 would still have failed (REV-131 R1).
  - The import itself applied 10,000 of 10,000, with an empty `notApplied` list.
- **Not every time:**
  - The TECHNICAL run 17 minutes earlier passed. Same code and data volume; online create had 0 errors, and overall p95 was 267 ms.
  - TC-101 also passed in both developer runs on 2026-10-27.
  - **The host was not quiescent** (REV-131 O3):
    - load average rose from 4.1 to 11.9 during the REGRESSION run, against 3.1 to 8.4 during TECHNICAL;
    - another module's mysqld (Sales capacity runtime, started 08:51 HKT) ran on the same host;
    - the slower import widens the window in which online creates and import rows overlap.
- **Mechanism (captured, not yet tied to each 500):**
  - The deadlock: InnoDB's latest detected deadlock, kept in `def048_innodb_deadlock_2026-10-28.txt`. It occurred at 11:40:20 HKT (03:40:20Z), inside this run's import, in this run's schema `erp_t51_rh_51c55efa`.
    - Two transactions were inserting `supplier_name_grams` rows for adjacent new Suppliers (ids 110468 and 110469).
    - Each held an X lock on the supremum of that table's PRIMARY index. Each waited for its own insert-intention lock, which the other's supremum lock blocked.
  - Where the supremum lock comes from: `replaceSupplierNameGrams` (`supplierDuplicateCandidates.js:30-31`) first runs `DELETE FROM supplier_name_grams WHERE supplier_id = ?`. For a Supplier that has just been created, that id is past the end of the index. Under REPEATABLE READ, the DELETE then takes a next-key lock on the supremum, so two such creates at once deadlock in exactly the recorded shape.
  - Who won and who lost:
    - Transaction (1), with 10,451 row locks, is very likely the import's row transaction. `processNextRow` reads the next row with `FOR UPDATE` over the job's rows (`SupplierImportService.js:652-658`). That is inference: thread ids cannot be mapped.
    - InnoDB rolled back the light transaction (2), which fits an online create.
  - Online create retries once on `ER_LOCK_DEADLOCK` (DEF-031, `SupplierAdminService.js:306`); losing twice propagates as a 500.
  - The longest 500 took 3.98 s; `innodb_lock_wait_timeout` is 50 s, so the 500s are not lock-wait timeouts.
- **Not proven:** the benchmark deletes its temporary directory, server logs included (`benchmarkSupplierManagement.js:344`). So the 500s' own errors and the `supplier.write.deadlock_retried` warnings are lost, and no 500 is tied to a particular deadlock. This is the same evidence loss that left DEF-034's cause unknown. The diagnosis under HD-152 A keeps those logs.
- **Link to DEF-034 (weak hypothesis):** the import treats `ER_LOCK_DEADLOCK` as busy and leaves that row not applied (`SupplierImportService.js:161`). If the import side lost this deadlock, the result would be DEF-034's 9,999 of 10,000. InnoDB rolls back the lighter transaction, though, and late in an import that is rarely the import's, so this explains DEF-034 only if it happened early in the import. Not proven.
- **Diagnosis under HD-152 A (2026-10-28, 03:51–04:02Z): the deadlock mechanism is proven; the 500 is tied to it by accounting.**
  - **Setup:**
    - A throwaway worktree at `a98e50e7`, with one uncommitted change, `benchmark-keep-logs.diff`: the benchmark keeps its temporary directory, server logs included. The worktree has been removed.
    - `innodb_print_all_deadlocks=ON` on the throwaway mysqld from 03:58:28Z. `lock_deadlocks` read 256 then and 274 after the run. (276 later: REV-132's two deliberate deadlocks.)
  - **Files** in `def048_diagnosis_2026-10-28/`, with local paths masked:
    - `innodb-deadlocks.txt`: the error log from the first deadlock print on, without the redo-log warnings. This MySQL 26.7 instance prints no header, timestamp or victim line for each deadlock.
    - `app-load.log` and `app-load-during-import.log`: retry warnings and errors.
    - `perf-1.stdout`: the runner's report, including the import window.
    - `run.sh`.
  - **Every deadlock is the name-gram one.** All 18 are on the supremum of `supplier_name_grams` PRIMARY, each between two `INSERT INTO supplier_name_grams` for new Supplier ids. The ids are usually adjacent; a retry uses up an id, as in #5 (103660 and 103662).
  - **When they happened.** All 18 fell in the load-during-import phase, warm-up included. The import ran from 04:00:35.847Z to 04:01:53.018Z. Deadlock #1 came 3.2 s before it, and #17 and #18 came 24–28 s after; one more retry, 142 ms after the import ended, is borderline. Those 3 are InnoDB's direct proof that the deadlock happens with no import running.
  - **Who was involved**, classified by connection, not by lock count (REV-132 R2):
    - **12 paired the import row transaction with an online create.** The import is MySQL thread 23736, and its gram hashes have their own prefixes.
    - **6 paired two online creates:** #1, #4, #5, #11, #17 and #18.
    - The import's per-row lock count grows across the run (65 → 1,440 → … → 10,618), so a lock-count threshold misclassifies early rows.
    - Separately, the mixed load phase with no import logged 2 `supplier.write.deadlock_retried`, at 03:53Z, before the print was on and before the 256 reading.
  - **The 500 is a second deadlock.**
    - **The accounting:** the import never lost (10,000 applied, 0 failed), and every one of the 36 transactions is a new-id INSERT. The app logged 17 `supplier.write.deadlock_retried` and one 500, so 18 = 17 first losses + 1 second loss.
    - **The failing request** was `d70e765c`. It started at 12:01:02.986 HKT, retried after a deadlock at .005, and failed again at .007 in `replaceSupplierNameGrams`'s INSERT (`supplierDuplicateCandidates.js:36`), which matches "insert intention waiting".
    - **InnoDB shows the same request losing twice:**
      - deadlocks #4 and #5 share the surviving transaction 4431558;
      - in #5, the same thread 23733 returns with id 103662, after its first id, 103661, was rolled back.
      
      Both of its deadlocks were online vs online.
    - The app log does not carry the MySQL error code, so "second deadlock" rests on this accounting.
    - The handler line's `"responseCode":200` is `res.statusCode` before the error handler runs. The 500 is shown by the runner's errorRate (1 of 9,883) and by `DATABASE_OPERATION_FAILED` mapping to 500.
  - **The import never lost** in this run, so the DEF-034 link stays unproven.
  - **This run passed TC-101,** with 1 error, within the 1% limit. The defect shows as a failure only when several creates lose twice, as in the REGRESSION run. A TC-101 pass alone therefore cannot show a fix.
  - **Isolated reproduction (REV-132)**, on a copy of the real table DDL in a throwaway schema, since dropped:
    - DELETE-then-INSERT for new ids 101 and 102: deadlock 1213, with the same lock picture as above.
    - Plain INSERTs, in both orders: no wait and no deadlock, because insert-intention locks do not conflict with each other.
    - A plain create against a rename of the newest Supplier: no deadlock.
    - An update against an update on adjacent existing ids: still a deadlock, through a gap lock. That is the residual risk on the update path, which the existing retry covers.
  - **Open observation, not proven (REV-132 O3).** The import row transaction's lock count grows linearly with the rows applied. That fits `processNextRow`'s `… status IN ('valid','warning') ORDER BY row_number LIMIT 1 FOR UPDATE` (`SupplierImportService.js:652-658`) locking the applied rows it scans, which would be O(n²) over an import. It would explain why the import is never the victim, and it may bear on TC-101's `import.inside_measured_window` failure. An EXPLAIN on a throwaway database would settle it.
  - **Fix options** are put to the Product Owner as HD-153.

- **Before HD-153 (REPORT_ONLY):** no product change in TEST_AND_VERIFY. The route was HD-152 (A: diagnose first); the remediation route is put to the Product Owner next. The severity, MEDIUM, is proposed: the 500s roll back with no data loss, and the user can retry.

**CLOSED 2026-10-28 after the formal re-test.**
- The fix merged as PR #298 (`f62651d8`).
- **Targeted re-test.** At TECHNICAL and REGRESSION (evidence `20261028T065924-ff2600591596`, `20261028T071628-f0de8491fc9a`), TC-101 passed with:
  - 0 deadlocks in both loads, with deadlock detection and printing ON;
  - online error rate 0 during the import;
  - the import inside the window: precheck plus execute 78.1 s and 83.7 s (execute alone 71.8 s and 77.4 s).
- **The online server's kept warnings** hold no `deadlock_retried`. The import runs in its own worker process and keeps no warnings file, but the deadlock counter covers both processes.
- **Impact regression.** `createSupplierInTransaction` serves online and import create, so the regression is the Supplier server suite, which includes the new discriminating integration test. It passed 732 of 732 at both stages (`20261028T065312-10bcf7528c57`, `20261028T071029-834b3ecdfd95`), and `supplier-security` did too (`20261028T065601-39b9b1210994`, `20261028T071313-13f3281c06c6`).
- **CI.** PR #298 run 40645193058 on head `106ef26c`: all 13 checks success.
- See `07_technical_acceptance_report.md`.

**Fixed under HD-153 A (REMEDIATE_AND_RETEST).**
- **Fix:** the create path (`SupplierAdminService.createSupplierInTransaction`, used by online create and by import create) calls `replaceSupplierNameGrams(…, { isNew: true })`, which skips the `DELETE` for a Supplier made in the same transaction. The update path keeps its `DELETE` and the existing deadlock retry. Update against update on adjacent ids can still deadlock, rarely (REV-132).
- **Tests:**
  - **Integration:** two open transactions each create a new Supplier and write its grams, and the second must not wait.
    - A control in the same file, the old DELETE-first behaviour, must time out on lock wait.
    - Before the fix the new case failed (`ER_LOCK_WAIT_TIMEOUT`) and the control passed; after the fix both pass.
  - **Unit:** create passes `{ isNew: true }`, and update passes nothing. Removing `isNew` from the call site turns the test red.
- **The re-test can now fail on the defect:**
  - The performance runner reads InnoDB's `lock_deadlocks` before and after the mixed load and the load during the import. It fails TC-128 (`db.no_deadlocks_mixed_load`) and TC-101 (`db.no_deadlocks_during_import`) on any deadlock.
  - The counter covers the whole instance, so the runner needs its own mysqld, and it refuses to run if the metric is disabled.
  - **It also refuses to start unless `innodb_deadlock_detect` and `innodb_print_all_deadlocks` are both ON** (REV-133 R1).
    - With detection off, the counter stays at 0 and the checks would pass without measuring anything.
    - With printing off, a FAIL could not be traced to name-gram deadlocks.
    - The runner records both settings and the absolute counter values in its evidence.
    - Checked on the throwaway mysqld: with printing OFF, the runner failed every case in under a second, before creating its schema; the setting was then turned back ON.
  - The warnings file keeps at most 200 lines plus a count, with the repository path replaced by `$REPO`. This was added after the developer runs below, and the formal runs will be its first use.
  - The benchmark now keeps the server's warn and error lines next to its report (`<report>.warnings.log`).
- **Developer runs** on the throwaway mysqld, 2026-10-28:
  - Lint passed, and the Supplier server suite passed 732 of 732.
  - With the fix, the performance runner found 0 deadlocks in the mixed load and 0 during the import; every local case passed. The import took 82.8 s, inside the window.
  - With the fix reverted in place (backed up, then restored and compared): 7 and 19 deadlocks, and 26 `deadlock_retried` warnings in the kept log. TC-101 and TC-128 **failed, only on the new deadlock checks**: the error rate was 0, because the retries hid the deadlocks. So without the new checks, the defect would have passed.

## DEF-049 — LOW

Found by diagnosis in TEST_AND_VERIFY, REPORT_ONLY, on 2026-10-29 at `ef5a61a4`. It follows up REV-132 O3, the observation in DEF-048 that the import's per-row lock count grows across the run (65 → 1,440 → … → 10,618).

- **What happens:** each import row transaction locks every row of the job that has already been applied.
  - `processNextRow` picks the next row with `WHERE job_id = ? AND status IN ('valid', 'warning') ORDER BY row_number LIMIT 1 FOR UPDATE` (`SupplierImportService.js:653-658`).
  - The optimizer reads that through PRIMARY `(job_id, row_number)` and filters on `status`. Before it finds the first pending row, it reads every row already applied.
  - Under REPEATABLE READ, `FOR UPDATE` locks every row it reads, matching or not, until commit.
  - So the transaction for row k+1 holds about k+1 record locks and reads about 2k index entries. Over a whole import that is O(n²) reads.
- **Measured** on the throwaway mysqld 3450 (MySQL 26.7.0), with files in `def049_diagnosis_2026-10-29/`:
  - **Setup:** a scratch schema `erp_t51_mig_lockdiag` with the exact `0062` table, minus the foreign key to the jobs table.
    - It held one job of 10,000 rows, 10% of them `warning`.
    - For each k, rows 1..k were set to `applied`, `ANALYZE TABLE` was run, and then the exact query was run in a transaction.
    - Record locks were counted from `performance_schema.data_locks`, and rows read from the `Handler_read_*` counters.
    - The schema was dropped afterwards.
  - **Locks follow k:** 1, 2, 102, 1,011, 5,056 and 9,100 at k = 0, 1, 100, 1,000, 5,000 and 9,000, with the PRIMARY plan at every one of them (`out.txt`). This matches the 10,618 seen near the end of the DEF-048 import.
  - **The plan changes only at the very end:** at k = 9,999 the optimizer switches to `idx_supplier_import_row_status`.
  - **Cost:** one pick takes 0.21 ms at k = 0 and 2.26 ms at k = 9,000 (200 runs each, `time-out.txt`), which is about 0.23 µs per applied row.
    - Summed over a 10,000-row import, the extra cost is about 11 s. The TC-101 re-test measured 71.8 s and 77.4 s for the execute step.
    - At the configurable ceiling of `import.maxRows` (50,000; the default is 10,000), the extra cost would be about 4.75 minutes. This is an extrapolation from the same per-row cost, not a measurement.
- **What it does not do:**
  - It does not cause blocking or deadlocks between transactions.
    - Every path that writes a job's rows (cancel, expire, revoke, row failure, staging) first takes that job's row `FOR UPDATE`, so they are already serialised behind the row transaction (`SupplierImportService.js:328, 416, 465, 519, 548, 601, 650, 695, 776, 856`).
    - The extra locks are on rows that only the same job's own work touches.
    - Reads of results are non-locking.
  - It does not lose data or produce wrong counts.
  - So DEF-049 is cost (CPU, index reads, lock memory: 654 lock structs, 74 KB heap in the DEF-048 print), not correctness.
  - It is also not the cause of DEF-048: there the deadlock was on the name grams, not on `supplier_import_rows`.
- **Candidates that do not fix it:**
  - **`FORCE INDEX (idx_supplier_import_row_status)` on the current `IN` query:** this is worse.
    - The two `status` ranges are not ordered by `row_number` together, so it sorts every pending row.
    - It locks all of them: 20,017 locks at k = 0.
  - **An equality on one status without the hint:** the optimizer still chooses PRIMARY until k = 9,000 (`eq-valid` in `out.txt`).
- **Candidate that does fix it:** one equality query per pending status, with `FORCE INDEX (idx_supplier_import_row_status)`, taking the lower `row_number` of the two.
  - The index is ordered by `row_number` within `(job_id, status)`, so `LIMIT 1` stops at once.
  - Each query held 1–3 locks and read 4–6 entries at every k (`out2.txt`).
  - This is a measurement of the queries, not a product change: no product code was changed.
- **Decision required (HD-154):** fix now or accept. See the ledger.

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
