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
