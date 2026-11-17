# Purchasing approval package, 2026-11-09 (for the PM to put to Sam once)

**Status:** documents only. Nothing here was run: no test, lint, build, validator, DB, browser, CI, push, digest or DDL.

The product source is fixed and accepted:
- **TASK-024 client:** source `092c86dd`, TL r5 SOURCE ACCEPT, 0 Required. The branch head is `ca2e4dcd` on `claude/purchasing-task024-client`.
- **TASK-025 safety fixes:** `2cb6fe60`, accepted. This branch is `claude/purchasing-task025`.

There is **no UI runtime PASS**.

Each part below can be chosen separately. Every part runs once on a private local setup, stops and reports at the first failure, and is never retried.

**Choice A, schema authoring**, is independent of every functional or admission choice. Approving the A1 schema content does not approve any verification, and approving a verification does not approve the schema.

**Not in this round:**
- the reader-wired success paths;
- approve versus cancel concurrency;
- close versus confirm concurrency.

## A. Schema authoring (Sam's sign-off, per `/Users/sam/.claude/CLAUDE.md` §8 and the manifest's `approval_required_paths`)

### A1. TASK-045 `goods_receipts` header migration source (P04 corrected text)

**Content:**
- The complete §4.9 header.
- The owner FKs:
  - `purchase_order_id` to PO, with RESTRICT;
  - composite `(purchase_order_id, supplier_id)` to `purchase_orders(id, supplier_id)`;
  - the actor FKs, with SET NULL.
- The UNIQUE keys `gr_number`, `(document_year_month, sequence_no)`, `uq_gr_id_po` and `confirm_event_id`.
- The 5 §4.9 indexes.

**CHECKs**, using the original enum, flag, version, number and conservation rules, following 0112:

| Constraint | Rule |
| --- | --- |
| `chk_gr_status` | `status IN ('DRAFT','CONFIRMED','PARTIALLY_REVERSED','REVERSED','CANCELLED')` |
| `chk_gr_flags` | the three flags `IN (0,1)` and `version >= 1` |
| `chk_gr_number` | `gr_number = CONCAT('GR-', document_year_month, '-', LPAD(sequence_no, 6, '0'))` |
| `chk_gr_month` | `document_year_month REGEXP '^[0-9]{4}(0[1-9]\|1[0-2])$'` (a real YYYYMM) |
| `chk_gr_sequence` | `sequence_no BETWEEN 1 AND 999999`, which stops 0, or 1000000 being truncated by LPAD |
| `chk_gr_quantity` | `total_reversed_base_quantity <= total_received_base_quantity` |
| `chk_gr_confirmation` | `(status IN ('DRAFT','CANCELLED') AND confirmed_at IS NULL AND confirm_event_id IS NULL) OR (status IN ('CONFIRMED','PARTIALLY_REVERSED','REVERSED') AND confirmed_at IS NOT NULL AND confirm_event_id IS NOT NULL)` |

`confirmed_by` is deliberately excluded. The user FK is SET NULL, and a NULL there is not missing evidence. No actor becomes non-null and no new state is added.

**§4.16 trigger.** Once a header has historically been confirmed (`OLD.confirmed_at IS NOT NULL`, which covers CONFIRMED, PARTIALLY_REVERSED and REVERSED), a BEFORE UPDATE trigger refuses any change to these:
- `purchase_order_id` and `supplier_id`;
- `business_receipt_date`, `supplier_delivery_note` and `notes`;
- `confirmed_at`, `confirmed_by` (except the FK's own SET NULL) and `confirm_event_id`;
- `inventory_result_summary`;
- `gr_number`, `document_year_month` and `sequence_no`.

It also refuses moving the status back to DRAFT or CANCELLED. Only the reversal status and the quantity projections may change.

A BEFORE DELETE trigger refuses deleting a historically confirmed header.

Each trigger signals its own `SQLSTATE '45000'` message, which G5 checks.

A FK SET NULL action does not fire triggers in MySQL. That is why `confirmed_by` becoming NULL after a user delete is allowed, as 0115 and 0118 already note.

**Ever-confirmed predicate:** `confirmed_at IS NOT NULL`, consistent with `confirm_event_id` and the status, as `chk_gr_confirmation` guarantees.

**Migration number:** decided at the real baseline. 0119 is only the next free number after `origin/main` `b28a7d88`.

**Cost:** unknown.

## B. Planning metadata (PM choice; not schema sign-off)

`P3_task045_planning.patch` holds the exact edits. It is **not applied** to the canonical files, because the existing baseline-bound approval records must not change silently. sha256 `25c9da17e145864e2f0346f64a01db3ec2baf4a8bf5f930efd2fb3ce753901c9`, and `git apply --check` succeeds.

**`05_development_tasks.md`:**
- a new block "Task P2-T06：建立 TASK-027 早期完整 goods_receipts header";
- P2-T04 depends on P2-T06;
- P3-T01 depends on P2-T06, which delivers the header; P3-T01 keeps lines, details and the rest;
- §10 says 45 tasks;
- the 10.1 map gains `TASK-045 | P2-T06`;
- the PHASE-003 gate says 6 tasks;
- a new TASK-045 entity block;
- the dependencies of the TASK-025 and TASK-027 entity blocks change.

**`08_traceability.json`:**
- new `TASK-045`: PHASE-003, FR-052, DES-005, depending on TASK-011 and TASK-022, with tests TC-004 and TC-009;
- PHASE-003 `task_ids` gains TASK-045;
- TASK-025 depends on TASK-022, TASK-023 and TASK-045;
- TASK-027 depends on TASK-045, and stays in PHASE-004;
- the TC-004 and TC-009 `task_ids` gain TASK-045.

**`08_traceability_matrix.md`:** the FR-052 row's Task column becomes `TASK-025, TASK-045`.

**`00_harness_state.json`:** `"TASK-045": "PENDING"`.

**Kept:** every old ID, the rest of TASK-027, all PHASE-004 gates and UAT. No harness script changes, and nothing is marked DONE.

**Unverified:** TC-009's `requirement_ids` does not contain FR-052, and the validator may require either adding it or dropping TC-009 from TASK-045. No validator was run.

## C. Functional verification and admission

Each option is chosen separately. The trigger and concurrency contradiction (§F) applies to every routine case.

### C1. TASK-024 client routine cases (P03 workload)

**Version:** the bytes at `092c86dd`, plus the test edits below.

**Frequency:** every admitted PR, every push to main, and weekly on Monday 10:17 Hong Kong time, in the existing client job, with Vitest's default file workers.

**Cost:** unknown. The original 121 cases took 1.67 s locally at `64ca24c8`. That is history, not a promise.

**Workload:**

| Group | File | New registrations | Variants | Mock calls |
| --- | --- | --- | --- | --- |
| ① six non-final errors | `services/purchasing.test.js` | 6 (`it.each`) | 6 | 18 `send` |
| H1 helper | `services/purchasing.test.js` | 1 | 1 | 3 `run`: 1 real `send` held in flight; the 2nd `run` on the same key is refused locally (in flight); the original then settles as TIMEOUT; the 3rd `run`, with another `meta.action`, is refused locally (action mismatch). That is 1 send. |
| C1–C7, C11 a/b, C12, C13, C14, C17 a/b | `pages/purchasing/purchasingApprovals.test.js` | 14 | 14 | as listed per case in `P2_task024_client.md` |
| C8 a/b, C9, C10, C15, C16 a/b, C18 | `pages/purchasing/purchasingPurchaseOrderEditor.test.js` | 8 | 8 | as listed per case |
| Changed existing cases | `services/purchasing.test.js` | 0 (the 5-variant `it.each` and "明確結果" get an API rename; "reset" is replaced 1 for 1) | — | unchanged |

- **New registrations:** 29 (6 + 1 + 22). C1 to C18 give 22 UI variants.
- **Existing registrations:** 121, measured at `64ca24c8`. Per file: form 30, navigation 10, approvals 4, measured. The other four files (editor, pages, print, services) total 77; their split was not recorded, so it is **unknown** until the run reports it.
- **Expected total:** 150. All original assertions are kept, and none is skipped.

**Receipt:** a new client receipt re-pins all 17 inputs with the new blobs. `4569e9a0…` is not used, and it does not join the administrator's batch for the two earlier digests.

**Private local alternative:** none that would prove the same rules. Browser validation (C3) does not exercise the race and lifecycle cases.

### C2. TASK-024 regression run (③)

One local run on the new bytes:

```
cd client && npm test -- test/components/purchasing/purchasingPurchaseOrderForm.test.js test/pages/purchasing/purchasingPurchaseOrderEditor.test.js test/pages/purchasing/purchasingPurchaseOrderPages.test.js test/pages/purchasing/purchasingNavigationErrors.test.js test/pages/purchasing/purchasingPurchaseOrderPrint.test.js test/services/purchasing.test.js test/pages/purchasing/purchasingApprovals.test.js
```

Then:
- `cd client && npx vite build`
- `npx eslint client/src/pages/purchasing client/src/components/purchasing client/src/composables/purchasing client/src/services/purchasing.js`
- `node .github/scripts/test-admission.mjs --static-only`

Notes:
- It uses the supported entrypoint with the default workers. It is not single-worker, because the entrypoint refuses options.
- **Cost:** unknown.
- This build's `dist` is the artifact C3 reuses. It is not built a second time.

### C3. Playwright on the real app (P01 and P02)

One local batch.

**Prerequisite:** C2 must pass, so that the `dist` artifact exists.

**Cost:** unknown. The time limits are 15 minutes to prepare, 25 to run and 10 to clean up, and exceeding one stops the batch.

**P01, fixture and requests.** Executed by SQL as `root` over the own socket, in this order:

1. **Ownership:**
   - `test ! -e /private/tmp/m024c` must be true, otherwise stop.
   - `lsof -iTCP:33619 -iTCP:3000 -iTCP:4173 -sTCP:LISTEN` must be empty, otherwise stop. Nothing is killed.
2. **The validator before the DB:**
   - `cd server && node --input-type=module -e 'const m = await import("./src/framework/configuration/applicationConfiguration.js"); m.validateApplicationConfiguration(); console.log("CONFIG_OK")'`
   - The full server env is the 18 `ci.yml` runtime variables (`DB_HOST=127.0.0.1`, `DB_PORT=33619`, the other values verbatim) plus `CLIENT_URL=http://127.0.0.1:4173`.
   - It must print `CONFIG_OK`. The server later starts with this same env.
3. **Own DB:**
   - `mysqld --initialize-insecure --datadir=/private/tmp/m024c`
   - `mysqld --daemonize --skip-log-bin --datadir=/private/tmp/m024c --port=33619 --bind-address=127.0.0.1 --socket=/private/tmp/m024c/s.sock --pid-file=/private/tmp/m024c/mysqld.pid`
   - Record the PID from the pid-file, and the socket, port and root (`root`, no password, socket only).
   - Create the `ci.yml` database and user.
   - `cd server && npm run migrate`
4. **Migration seeds, read back and not inserted:**
   - `permissions` for `purchasing.view`, `purchasing.mgmt`, `purchasing.approval` and `purchasing.settings` (0100);
   - `device.mgmt` (0004 and 0005);
   - `currencies` HKD, with 2 decimals, ACTIVE (0027);
   - `purchasing_settings` id 1 with `require_po_approval = 0` (0110).

   Each `SELECT` must return exactly 1 row.
5. **Users first:** `createUser.js` four times, each with a run-generated password on stdin, never echoed:
   - `pw-bootstrap`, the first account, which automatically gets `system-admin`;
   - `pw-u1`, `pw-u2` and `pw-u3`, with no `--role`.

   Then `UPDATE users SET status = 'disabled' WHERE username = 'pw-bootstrap'`, with affectedRows 1. The bootstrap account never logs in.
6. **3 minimal roles:**
   - `INSERT INTO roles (name, created_at) VALUES ('pw-maker', NOW_MS), ('pw-approver', NOW_MS), ('pw-settings', NOW_MS)`, with affectedRows 3.
7. **5 role permissions:** `INSERT INTO role_permissions (role_id, permission_id) SELECT r.id, p.id FROM roles r JOIN permissions p ON …`, one statement per role:
   - pw-maker: `purchasing.view` and `purchasing.mgmt`, affectedRows 2;
   - pw-approver: `purchasing.view` and `purchasing.approval`, affectedRows 2;
   - pw-settings: `purchasing.settings`, affectedRows 1.
8. **3 user roles**, once the users exist: `INSERT INTO user_roles (user_id, role_id) SELECT u.id, r.id …` for pw-u1 with pw-maker, pw-u2 with pw-approver and pw-u3 with pw-settings, each affectedRows 1.
9. **Master data**, minimal SQL following the integration recipe in `purchasingPurchaseOrders.integration.test.js` `masters()`. NOW_MS is a fixed epoch. Each insert has affectedRows 1, and each ID is then selected by its unique code.
   - `suppliers`: `PW-SUP-1` / `pw-sup-1`, `PW Supplier` / `pw supplier`, `default_currency_code = 'HKD'`, `default_payment_term_id = NULL`, `status = 'active'`.
   - `items`: `PW Item`, `active`.
   - `item_uoms`: `PWEA`, `EA`, `active`.
   - `item_skus`: `PW-SKU-1`, `PW SKU`, `active`, `tracking_policy = 'none'`, `purchasable = 1`, `inventory_tracked = 1`, `min_receipt_life_days = NULL`.
   - `item_sku_uoms`: that SKU with `PWEA`, `to_base_factor = 1`, `is_base = 1`.

   No payment term, warehouse or address: they are optional on a PO. No UI request is sent for master data.
10. **Readback of minimal permissions:**
    - `SELECT u.username, u.status, GROUP_CONCAT(DISTINCT p.name ORDER BY p.name) FROM users u LEFT JOIN user_roles ur ON … LEFT JOIN role_permissions rp ON … LEFT JOIN permissions p ON … GROUP BY u.id` must return exactly 4 rows:
      - pw-bootstrap: `disabled`, whatever `system-admin` holds;
      - pw-u1: `active`, `purchasing.mgmt,purchasing.view`;
      - pw-u2: `active`, `purchasing.approval,purchasing.view`;
      - pw-u3: `active`, `purchasing.settings`.
    - `SELECT COUNT(*) FROM users` must be 4.
    - No other account or permission is added.
11. **Server and preview:**
    - `cd server && node src/index.js`, with the step 2 env. Record `$!`.
    - `cd client && npm run preview`, serving the C2 `dist` on 127.0.0.1:4173. Record `$!`.
    - `dist` was built once in C2 with `VITE_API_BASE_URL=http://127.0.0.1:3000`.
12. **Devices:**
    - Each user's first signed login, `POST /api/v1/user/login`, returns `DEVICE_PENDING_APPROVAL` with no token. That is 3 times.
    - For each user, `SELECT id FROM user_devices WHERE user_id = ? AND status = 'pending'` must return exactly 1 row.
    - `cd server && node scripts/approveDevice.js <id>` runs `UPDATE … SET status = 'approved' … WHERE id = ? AND status = 'pending'`, with affectedRows 1. That is 3 times.
    - Read back `status = 'approved'`.
    - Each user logs in again. In total that is **6 logins and 3 approvals**.

**The 13 named business POSTs:**

| # | User | Request | Expected |
| --- | --- | --- | --- |
| #0a | U1 | create PO-A, 1 line | **201** |
| #0b | U1 | create PO-B, 1 line | **201** |
| #1 | U3 | settings, wrong password | 403 |
| #2 | U3 | settings, approval on | 200 |
| #3 | U1 | submit PO-A with U2 | 200 |
| #4 | U1 | submit PO-B with U2 | 200 |
| #5 | U1 | PO-B approval withdraw | 200 |
| #6 | U1 | PO-B resubmit | 200 |
| #7 | U2 | PO-A approve, wrong password | 403 |
| #8 | U2 | PO-A approve: a real 200, then abort | — |
| #9 | U2 | PO-A retry, wrong password | 403 |
| #10 | U2 | PO-A retry | **200 replay**; a 409 fails the run |
| #11 | U2 | PO-B reject with reason | 200 |

**P02, the hard-counter specification.** It lives in one inline script.

**Counting point:**
- There is one counting point: `context.route("**/*", handler)` on the single browser context. All three users run in that context, one after another, with logout between them.
- The identity is `request` object identity, tracked in a `WeakSet`, so a request is counted only once.
- Each request is counted **before** it is forwarded. The categories are:
  - static;
  - API GET;
  - login POST;
  - refresh POST;
  - named business POST, matched by method, path and order;
  - other.
- If a category or the total would go over its limit, `route.abort("blockedbyclient")` is called without forwarding, and the batch stops.

**Request #8:** the handler calls `await route.fetch()`. That one physical HTTP request is counted once. Only when it returns a real 200 does the handler call `route.abort("failed")`. Any other status stops the batch.

**OPTIONS preflights:**
- Whether Chromium exposes CORS preflights to `route` is **unknown**.
- If they are exposed, they are counted pre-send like any other request.
- If they are not, they are counted after the fact from the server's request log for the run window, and an overflow fails the batch. Blocking a preflight before it is sent would then need a same-origin setup, which is a product or config change and is not proposed. **PM to accept or reject this.**

**Limits:**

| Category | Limit |
| --- | --- |
| Total | 150 |
| API GET | 40 |
| Named business POST | 13 |
| Login POST | 6 |
| Refresh POST | 4 |
| OPTIONS | 35 |
| Static | 50 |

The sum, 148, is within 150. The 13 business POSTs and the category limits are the budget delta.

**Expected non-2xx and failure events**, listed by endpoint. Nothing else is expected:
- 3 × `POST /api/v1/user/login` giving `DEVICE_PENDING_APPROVAL`;
- 3 × 403 `PASSWORD_INVALID`, on #1, #7 and #9;
- 2 × 201, on #0a and #0b;
- 1 transport failure, `requestfailed` for #8.

The console allowlist holds only Chromium's resource-failure lines for exactly those URLs and statuses. Any other console error, `requestfailed`, 5xx or unlisted status fails the batch.

**Checks:** the focus order through reason, password, approve and reject, and the h1 and h2 headings.

**Cleanup, only what this run owns:**
1. `kill` the recorded server and preview PIDs.
2. `mysqladmin --socket=/private/tmp/m024c/s.sock -uroot shutdown`.
3. Wait for the recorded mysqld PID to exit.
4. `rm -rf /private/tmp/m024c`.
5. Check with `lsof` again. If a listener remains that this run did not start, report it and do not kill it.
6. Close the browser and report the release time.

### C4. TASK-025 routine cases, reachable now (P03 for 025)

**Version:** `2cb6fe60`.

**Frequency:** the same as C1, in the server jobs.

**Cost:** unknown. The 2026-11-06 run of three Purchasing integration files with 23 cases took 12.5 s; that is not a promise.

**Unit file** `server/test/purchasing/purchaseOrderLifecycleService.test.js`: **22 registrations**, using a fake `tx`, fake approvals and fake `receiptFacts`.

| Case | Registrations |
| --- | --- |
| U1 | 8 (`it.each`) |
| U2 | 1 |
| U3 | 1 |
| U4 | 5 |
| U5 | 3 |
| U6 | 1 |
| U7 | 3 |

The fake calls per case are in `P2_task025_lifecycle.md`. There is no DB.

**New integration file** `server/test/integration/purchasingLifecycle.integration.test.js`: **4 registrations**, I1 to I4 in their "now" form.

- **Totals:** 6 POs, 9 lines, 12 business POSTs and 3 GETs.
- **Setup** (none of it is free):
  - the own DB, migrated once by `npm run migrate`;
  - per-file fixtures following `purchasingApprovalCommands.integration.test.js`: users, roles, `role_permissions` and `user_roles` per actor (maker, viewer), signed test JWTs from `JWT_SECRET`, supplier, item, UOM, SKU, SKU-UOM and the HKD seed;
  - the app's own database pool, one per file;
  - `DB_INTEGRATION_TESTS=1`.
- **Cleanup:** the file's own rows are rolled back or left in the private DB, and the DB is dropped after the batch.

**Regression files, run in full:**
- `purchasingInquiry.integration.test.js`: 8 registrations. One assertion changes, at lines 265 to 266.
- `purchasingApprovalCommands.integration.test.js`: 9 registrations, unchanged.

Their setup and cost are their own and **unknown**.

**Command:**

```
cd server && npm test -- test/purchasing/purchaseOrderLifecycleService.test.js test/integration/purchasingLifecycle.integration.test.js test/integration/purchasingInquiry.integration.test.js test/integration/purchasingApprovalCommands.integration.test.js
```

It runs with the full `ci.yml` server env plus `DB_INTEGRATION_TESTS=1`, on the C3-style own DB with the same ownership and cleanup rules, but with no browser.

**Receipt:** a new receipt that re-pins all 21 inputs of `purchasing-task024-backend.json`.

### C5. TASK-045 header verification (only after A1 is approved and the source is written)

**Setup:**
- One own mysqld, as in C3, with two schemas:
  - `S_clean` migrated from empty to the header migration;
  - `S_fwd` migrated to the migration just before it, then the header migration alone.
- Each schema goes through create, migrate, use and drop. That is 2 schema lifecycles and 3 migrate invocations.
- G2 to G6 use `S_clean`.
- Every case works in its own transaction and rolls back, except G6's user delete, whose rows are removed at the end of the case.
- Fixed actor: user `pw-gr`. Supplier `GR-SUP` with a 1-line PO `PO-G`. Inserts go through the normal schema, and nothing is disabled.
- **Deadline:** 10 minutes, then stop.

| # | Good seeds | Bad statements | Asserted |
| --- | --- | --- | --- |
| G1 | 0 | 0 | 2 selects, one per schema, from `information_schema.COLUMNS`, matching §4.9 exactly |
| G2 | 0 | 0 | 3 selects on names, columns, RESTRICT and SET NULL |
| G3 | 1 DRAFT GR | 2: an insert with the wrong supplier (expects the composite-FK error), and deleting `PO-G` (expects the RESTRICT error) | the error codes |
| G4 | 1 CONFIRMED GR, the **legal duplicate baseline** | 8: bad status; flag 2; version 0; `gr_number` mismatch; month 202613; sequence 0; reversed greater than received; duplicate `confirm_event_id` | each named constraint, or the duplicate-key error |
| G5 | 1 CONFIRMED GR on `PO-G`, plus a second legal PO `PO-G2` with the same supplier, so FKs stay valid | 10: updates of `purchase_order_id` to `PO-G2`, `business_receipt_date`, `supplier_delivery_note`, `notes`, `confirmed_at`, `confirm_event_id`, `inventory_result_summary` and `gr_number`; status back to DRAFT; DELETE | each must fail with the **specific trigger message**, not a FK or CHECK error. 1 allowed update: PARTIALLY_REVERSED with a quantity projection. |
| G6 | 6 POs: none; DRAFT; CANCELLED; CONFIRMED; REVERSED; CONFIRMED by the extra user `pw-gr-deleted`, who is then deleted (SET NULL) | 0 | 6 reader calls, each under `SELECT … FOR UPDATE` on the PO: false, false, false, true, true, true |

That is 6 MySQL registrations.

**Separate unit file** for the reader's contradiction branch, `server/test/purchasing/goodsReceiptFacts.test.js`, with fake rows. It has **4 registrations**:
- CONFIRMED with no `confirmed_at`;
- DRAFT with a `confirm_event_id`;
- an unknown status;
- a read that throws.

Each is refused, not answered false. These are not inside the 6 MySQL cases.

**Cost:** unknown.

## D. Deferred, not part of this round

| Item | Owner and condition |
| --- | --- |
| TASK-025 I1-after and I2-after, the success paths | after TASK-045 and the reader are wired |
| I4-after, approve versus cancel concurrency | needs Sam's separate approval |
| Close versus confirm concurrency | TASK-032 |

## E. Evidence that is not reused

- The earlier 121/121, 68/68, build and lint apply only to their commits.
- The 8 + 3 private mutants and the intermediate failures are kept under `scratchpad/evidence-2026-11-09/`, with `SHA256SUMS`. They had no approval, and they are not re-run or retroactively claimed.

## F. Trigger and concurrency contradiction, stated once

- **Approved proposals said:** "every PR".
- **CI actually runs:** admitted PR dispatch, every push to main, and weekly on Monday 10:17 Hong Kong time, with Vitest's default file workers.
- **The existing receipts say:** "every PR and push to main" and "concurrency 1", meaning within a case.
- **Recommendation:** keep the existing triggers and workers, and have Sam approve that full trigger explicitly. Neither the workflow nor any wording has been changed.

## Sam's decision

2026-11-09, in the Purchasing chat: "A、B、C1、C2、C4 全部批准，C3、C5 暫緩".

| Part | Decision | What it covers |
| --- | --- | --- |
| A | Approved | Writing the TASK-045 `goods_receipts` header migration source exactly as A1 describes. Running it is not part of A: its functional verification is C5, which is deferred. The source therefore lives on its own branch, so that C4's `npm run migrate` does not apply it. |
| B | Approved | The planning patch applied as it is, sha256 `25c9da17…`. After applying it, `validate_traceability.py` (also with `--check-approvals`) gives STRUCTURE_PASS and `validate_module_boundary.py` gives LOCAL_CHECKS_PASS. |
| C1 | Approved | The 29 new client registrations and 3 changed existing cases, and a new client receipt. |
| C2 | Approved | One run of the literal 7-file command, plus build, lint and static admission. Stop at the first failure, with no retry. |
| C4 | Approved | The 22 unit and 4 integration TASK-025 registrations, the inquiry assertion change, the two regression files, and a new receipt. The DB run still waits for the PM's exclusive MySQL slot. |
| C3 | Deferred | Playwright. |
| C5 | Deferred | Header verification, and the reader's contradiction unit file. |

This decision does not authorize the agent to publish any digest. The trusted administrator does that.
