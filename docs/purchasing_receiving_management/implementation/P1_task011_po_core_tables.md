# TASK-011 — Settings, Sequence and PO Core Tables

Built on 2026-11-02 from main `01af6c24`. `TC-003`, `TC-009`. Baselines moved `design 84b5a22e → 08a08a3d`, `plan 61dff2ac → d1c00718` (HD-013 below).

| Migration | Table | Purpose |
| --- | --- | --- |
| `0110_create_purchasing_settings.js` | `purchasing_settings` | Company-wide singleton; `require_po_approval` defaults OFF |
| `0111_create_purchasing_document_sequences.js` | `purchasing_document_sequences` | PO/GR monthly numbering, keyed by document type and month |
| `0112_create_purchase_orders.js` | `purchase_orders` | PO header, 40 columns |
| `0113_create_purchase_order_lines.js` | `purchase_order_lines` | PO lines, 35 columns |

Numbered from `0110`: `0102` is free, but the in-flight sales-archive branch already claims `0105`–`0109`, so taking numbers after it avoids a collision on merge.

Each migration is a single `CREATE TABLE IF NOT EXISTS`. `CREATE TABLE` is atomic DDL in MySQL 8.0, so a table either exists whole or not at all and a rerun is a no-op; the full shape is asserted by the integration test on a clean database. The declarative `createSalesTable` / `inspectSalesTable` helper used by Sales and Fulfillment was not reused: its foreign-key map is keyed by column, so it cannot express a composite FK that shares a column with another FK — exactly the case for both composite FKs here.

## HD-012 — schema decisions

Sam approved the schema proposal on 2026-11-02 ("全部按你的建議執行"). It differs from design §4.3–4.6 in these points, to fold into the design at its next revision:

1. **`purchase_orders.currency_code` is `CHAR(3) CHARACTER SET ascii COLLATE ascii_bin`**, matching `currencies.code`. Written as the design says, plain `CHAR(3)` in `utf8mb4`, the FK cannot be created: mutant M1 below confirms `ER_FK_INCOMPATIBLE_COLUMNS`.
2. **The ordering address uses a composite FK `(ordering_address_id, supplier_id) → supplier_addresses(id, supplier_id)`**, using that table's existing `UNIQUE(id, supplier_id)`. The design's single-column FK could not stop a PO pointing at another Supplier's address. A NULL address is not checked.
3. **`purchase_order_lines.has_outstanding` defaults to 1 and `is_over_received` to 0**; the design gave no default.
4. **Single-row `CHECK`s** (design §4.1 allows them on the MySQL 8.0 baseline):
   - settings: singleton `id = 1`; flag 0/1;
   - sequences: type `PO`/`GR`; month `YYYYMM` with month 01–12; `next_value` 1–1,000,000 (1,000,000 marks the month exhausted);
   - header: `po_number = CONCAT('PO-', document_year_month, '-', LPAD(sequence_no, 6, '0'))`; `sequence_no` 1–999,999; the seven §3.2 statuses; Currency places 0–4; amounts ≥ 0; flags 0/1;
   - lines: line number 1–100; tracking `none`/`batch`/`batch_expiry`; factor 1–1,000,000; quantities > 0; price and amount ≥ 0; `gross_received = net_received + reversed`; flags 0/1.

Code columns (`po_number`, `document_year_month`, `status`, `document_type`, `` `year_month` ``, `tracking_policy_snapshot`) use `ascii_bin`, as Fulfillment does. Under the table default `utf8mb4_unicode_ci` comparisons ignore case, so `'draft'` would pass `CHECK (status IN ('DRAFT', …))` and the checks would be weaker than proposed. Mutants M4 and M14 confirm the difference.

Deliberately left to services: a zero price requires a reason (a Draft may be saved before it is filled in); JSON snapshot size limits (§11.1 assigns them to a service guard); delivery date not before order date; total equals subtotal (stops holding once tax arrives).

`year_month` is a MySQL reserved word (an `INTERVAL` unit). It keeps the approved name, and every statement that uses it must quote it with backticks.

## APR-007 — migration scope

`server/database/migrations/**` is an approval-required path for this module. `APR-007` is the SCOPE approval for the four files, given with the schema proposal. Boundary negative control: without `APR-007` each of the four files is reported `SCOPE_APPROVAL_REQUIRED`; with it, `LOCAL_CHECKS_PASS`.

## Impact on other modules

- Purely additive. The only data written is the one default row in the new `purchasing_settings`.
- Creating tables with foreign keys takes a short metadata lock on each parent (`suppliers`, `currencies`, `item_skus`, …); with empty child tables it is brief, but a long transaction holding a parent would make the DDL wait.
- Hard-delete paths that the new `RESTRICT` FKs can block — Item SKU/UOM/SKU-UOM, warehouses, Suppliers — all translate `ER_ROW_IS_REFERENCED` into an "in use" domain error (`ItemAdminService`, `ItemCatalogService`, `InventoryMasterService`, `SupplierAdminService`), so a referenced row yields "in use", not a 500. Supplier addresses, Supplier–SKU relations, Currencies and Payment Terms are never hard-deleted.
- No test truncates or drops these parent tables (a parent referenced by any FK cannot be truncated even when the child is empty); the only hits are SQL-injection probe strings. No shared test enumerates every table or every foreign key.

## HD-013 — Business Master and Supplier MIG-006

Comparing the full routine suite on this branch with unmodified `origin/main`, both on CI-equivalent settings, found exactly two failures that exist only on the branch. Both are real consequences of creating `purchase_orders`:

1. **Business Master would block Currency and Payment Term changes after deployment.** `businessMasterFactory.js` gives every not-yet-adopted consumer a placeholder checker that reports `NOT_INSTALLED` while the consumer's table is absent and `UNKNOWN` once it exists; `UNKNOWN` fails closed with `IMPACT_CHECK_UNAVAILABLE` ("無法完成影響檢查，操作已被阻止"). Its comment says the owning module must replace it with a real checker. Neither Purchasing's design nor its plan scheduled one.
2. **Supplier `TC-006 (MIG-006)` failed.** It models adding Supplier to an existing deployment by applying every non-Supplier migration first; `0112` cannot create its FK to `suppliers` that early (`ER_FK_CANNOT_OPEN_PARENT`). Purchasing's dependency on Supplier is a design requirement; the test's premise that no other module needs Supplier tables stopped holding.

**Sam chose on 2026-11-02 to fix both here, with the Supplier test changed by me**:

- `PurchasingBusinessMasterImpactChecker` (Purchasing module), modelled on Sales': counts POs referencing a Currency or Payment Term; `DRAFT`, `PENDING_APPROVAL`, `CONFIRMED`, `PARTIALLY_RECEIVED` are open use; `FULLY_RECEIVED`, `CLOSED`, `CANCELLED` are historical; an unclassified status, a malformed count or an invalid subject fails closed; `NOT_INSTALLED` while the table is absent; the watermark changes whenever a referencing PO's status, count, version, `updated_at` or max ID changes. A test ties the two status lists to `0112`'s `chk_po_status`, so a status added to the schema but not classified turns it red.
- `businessMasterFactory.js` registers it (2 lines), as for Customer and Sales.
- `server/test/business-master/http.integration.test.js`: the purchasing checker's expected status becomes `READY`, the same one-line change made when Customer and Sales adopted their checkers.
- `supplierMigrationAcceptance.integration.test.js`: MIG-006's "existing deployment" excludes migrations that need Supplier tables, computed transitively from `REFERENCES` and `CREATE TABLE` in the migration sources. A deployment without Supplier cannot contain Purchasing, and later Purchasing tables that reference only `purchase_orders` are excluded without another edit.

Rejected alternatives: asking the Business Master and Supplier owners to change first (slower, and the checker is Purchasing's responsibility), and postponing `purchase_orders` (only moves the problem to the next task).

## APR-008 — shared files

The three files above outside Purchasing's write paths — `businessMasterFactory.js` and the two tests — were added to `approval_required_paths`; `APR-008` is their SCOPE approval. That moved the baselines, so `APR-001`–`APR-007` were re-confirmed.

## REV-006 — review of the scope change

`method: HUMAN`, author the TASK-011 implementation agent, reviewer Sam. It covers the one change between `84b5a22e` and `08a08a3d`: the three `approval_required_paths` entries.

## Verification

Private MySQL 26.7.0 in the scratchpad, `--skip-log-bin` (migration `0057` creates triggers).

- **Forward migrate** from main's schema (through `0104`): the four migrations apply.
- **Clean migrate** of an empty database: 105 migrations apply; a second run applies 0.
- `purchasingMigrations.integration.test.js`: **7/7** on both databases, 141 ms. Every `CHECK` violation is asserted by constraint name, so a row stopped by a different check does not count. After a run the database is unchanged: no PO, line, sequence or probe master rows, and the settings row identical.
- **Mutation sweep 15/15 RED** on a separate database, each mutant rebuilding the four tables from a mutated migration, between a GREEN baseline and a GREEN restore, with a skipped mutant counted as a failure (one did skip on a quoting mistake and was rerun with a correct anchor): currency left `utf8mb4` (migration refused); address FK and UOM FK made single-column; `po_number` CHECK, receipt-identity CHECK and month CHECK removed; status and tracking made case-insensitive; a line default flipped; the settings seed made to overwrite; the sequence ceiling raised; PO delete cascading to lines; the buyer FK restricting user deletion; `line_amount` narrowed; the seventh status dropped.

Three defects in my own test were found by running it, none in the migrations:

- The settings case restored the singleton from a `t.after` hook. node:test runs after-hooks in registration order, so the connection was already closed and **the restore never ran**, leaving the scratch row at `require_po_approval = 1`. On a developer's `erp_dev` that would have silently changed their setting. The restore now runs in `finally` inside the test body and is itself asserted.
- `sequence_no` 1,000,000 was meant to trip the sequence range check, but `LPAD(…, 6)` truncates it, so the `po_number` check fired first. The case now uses 0, which only the range check rejects.
- Two statuses with nine-letter names got the same derived sequence number.

- **Full routine suite with MySQL**, capacity cases excluded with CI's own skip pattern and settings (admin user, `FULFILLMENT_LIFECYCLE_ENABLED`, socket, Sales capacity-step flags): this branch 4,404 tests, 86 failures; unmodified `origin/main` on its own database, 86 failures; **0 failures only on the branch**. All 86 are `Fulfillment native tests require their owned disposable runtime`, an environment requirement CI meets. A first run without CI's admin user and flags produced 456 failures, almost all environmental; that run was not used as evidence.
- **Mutation sweep for HD-013, 8/8 RED**: `DRAFT` reclassified; an unclassified status counted instead of failing; the key interpolated into SQL; the watermark ignoring version; `PARTIALLY_RECEIVED` unclassified; lowercase Currency accepted; the checker unregistered from Business Master; MIG-006 applying Supplier dependents early.
- **Not yet exercised**: MIG-006's transitive exclusion. No migration yet references only `purchase_orders` without also referencing a Supplier table directly; the GR tables of later tasks will be the first, and should be checked against MIG-006 when they land.

## CI admission

Sam approved the case list with the schema proposal on 2026-11-02: the seven cases in `server/test/integration/purchasingMigrations.integration.test.js`; a few rows each inside a rolled-back transaction; no concurrency; one repetition; all pass. They run in the existing MySQL integration jobs on every PR and push to main; measured 141 ms locally for the file, no new job. Locally they skip without `DB_INTEGRATION_TESTS=1`. No capacity runs: since #318 PR CI is functional only.

**One consolidated receipt.** The gate counts a receipt only when every blob it pins matches the tree, and allows each changed path to be covered by one receipt only. The module manifest is a pinned support input, and this task changed it, so `purchasing-task010.json` stopped covering its four inputs, and a second receipt pinning the manifest would be ambiguous. `purchasing-task011.json` therefore pins all nine current inputs — the five of this task (two new test files, the Business Master and Supplier cases changed, and the manifest) plus TASK-010's four at the byte-identical blobs Sam approved — and `purchasing-task010.json` is removed (its digest `40efa97a…` can be withdrawn from `CI_TEST_ADMISSION_DIGESTS`). Consequence for later tasks: every manifest change requires re-issuing one receipt that covers all of the module's test inputs, unless the admission policy stops treating the manifest as a test input.

**Digest publication — owner exception, 2026-11-02.** Sam instructed: "我作為project owner 批準你幫我發digest" — a project-owner exception to `AGENTS.md`'s rule that a feature agent does not publish its own receipt's digest, for `purchasing-task011.json` only. The variable was read immediately before writing and appended to: the five existing values (`2c5660d2…`, `40efa97a…`, `920dae9c…`, `abf2c153…`, `c1c852ae…`) were preserved and `e40f1bbe98a16f4602056b6f0f2d608a31f55b7a4cd3be1c5aa0977d905372eb` added, nothing else. With the real variable the gate then passed: `Test admission passed … 16 reviewed inputs; 0 capacity references`. The superseded `40efa97a…` was left in place; withdrawing it is Sam's call.
