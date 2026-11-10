# TASK-025 PO lifecycle commands (P2-T04)

**Status:** source candidate only, local and not pushed, with no new tests. It is stacked on `claude/purchasing-task024-backend` (`968f480d`), so it cannot open a PR until that backend PR merges. Sam on 2026-11-09: "TASK-025 可以開始".

## Delivered

| Route (`purchasing.mgmt`, `jwt`, idempotent) | Rule |
| --- | --- |
| `POST /api/v1/purchase-orders/:id/confirmation/withdraw` | CONFIRMED with no confirmed receipt goes back to DRAFT. Clears `confirmed_at` and `confirmed_by`. A later submit creates a new status history entry and, with approval on, a new approval; the old approval stays decided. |
| `POST /api/v1/purchase-orders/:id/cancel` | DRAFT, PENDING_APPROVAL, or CONFIRMED with no receipt, goes to CANCELLED. For a pending PO, the approval becomes INVALIDATED in the same transaction. |
| `POST /api/v1/purchase-orders/:id/close-remaining` | PARTIALLY_RECEIVED only. `lineIds` is optional; without it, every line with outstanding quantity is closed. Each line closes `max(ordered - net, 0)`; the client cannot send a quantity. A selected line with nothing outstanding is refused (`PO_STATE_CONFLICT` with `field`), and an unknown line gives 404. The PO becomes CLOSED once no line has outstanding quantity; otherwise it stays PARTIALLY_RECEIVED. Nothing is written to Inventory. |

**Shared behaviour:**
- Every command needs a reason (5 to 500 characters) and the current `version` (FR-LIFE-012).
- Each locks the PO, then the lines by ID.
- Each writes Audit (`purchase_order.confirmation_withdrawn`, `cancelled` or `remaining_closed`) in the same transaction.
- A status history row is written only when the status changes (§8.4). Its actions are `WITHDRAW`, `CANCEL` and `CLOSE`, as the 0118 CHECK allows.

**`allowedActions`** (list and detail, `purchasing.mgmt` only):

| Status | Actions |
| --- | --- |
| DRAFT | `edit`, `submit`, `copy`, `cancel` |
| PENDING_APPROVAL | `copy`, `cancel` |
| CONFIRMED with no receipt | `copy`, `withdrawConfirmation`, `cancel` |
| CONFIRMED with a receipt | `copy` |
| PARTIALLY_RECEIVED | `copy`, `closeRemaining` |
| Terminal statuses | `copy` |

The list now also reads `has_confirmed_receipt` for this.

**No schema change, migration or new error code.** The columns, status history actions and transitions already exist. `errorMessages.js` is unchanged.

**Files:**
- `PurchaseOrderLifecycleService.js` (new);
- `PurchaseOrderService.js`, for routing through the existing freshness, claim and rejected-Audit path;
- `PurchasingAuditService.js`, for three actions;
- `purchasingSchemas.js`;
- `PurchasingInquiryService.js`;
- `handlers/purchase-orders/purchaseOrderLifecycleHandlers.js` (new).

## Fail-closed receipt guard (TL review, relayed by the PM on 2026-11-09)

§8.4 requires two things for withdraw and cancel, both inside the same transaction under the PO lock:
- `has_confirmed_receipt = 0`;
- an authoritative fact that the PO never had a confirmed GR.

The flag alone is not enough. A missing GR table, a read error or an unknown answer must not count as zero, and a full reversal does not erase an earlier confirmation.

`PurchaseOrderLifecycleService` therefore takes a `receiptFacts.everConfirmed(tx, purchaseOrderId)` dependency, called after the PO is locked:
- Anything other than an explicit `false` is refused with `PO_STATE_CONFLICT`.
- The default, `NO_GOODS_RECEIPT_FACTS`, throws `PURCHASING_DEPENDENCY_UNAVAILABLE` (503).
- So, until TASK-027 lands the GR table, **every withdraw and cancel fails closed, Draft and Pending cancels included.** The success paths cannot be accepted until then.
- TASK-032's GR confirm sets the sticky `has_confirmed_receipt` in its own transaction.

Close remaining does not use this guard; it needs PARTIALLY_RECEIVED. No migration or public entry is added. The PM schedules whether the existing GR schema design goes first, and aligns the two traceability sources.

**Open for the TL:** `allowedActions` still offers `withdrawConfirmation` and `cancel`, as a UI hint. The server is the authority, and it refuses them until the GR facts exist.

## Local checks

**At `5b5a6589`, before the fail-closed change:**
- `eslint`: exit 0.
- The existing `server/test/purchasing/*.test.js`: 68 of 68 pass.
- The private `check025.mjs` passed, and its three mutants were killed. Its cancel and withdraw success assertions no longer hold, because those paths now fail closed. That evidence covers the earlier version only.

**After the change:**
- `eslint` on the changed file: exit 0.
- No test, private check or mutant was run.

## Test proposal, not executed (needs Sam's approval via the PM)

**Business risk:** a PO that has received goods could return to Draft or be cancelled, making a received document editable. A cancel could also leave an approvable request, or close-remaining could close the wrong quantity or reopen the PO.

**Gap:** no existing test covers these routes. The existing `allowedActions` assertions pin the old lists.

| # | File | Cases |
| --- | --- | --- |
| 1 | new `server/test/purchasing/purchaseOrderLifecycleService.test.js`, unit, fake transaction | About 7 cases: the private check's rules, with `receiptFacts` injected as `false`, `true`, throwing, and returning `undefined`, plus the default refusing |
| 2 | new `server/test/integration/purchasingLifecycle.integration.test.js`, MySQL | 4 cases, listed below |
| 3 | `purchasingApprovalCommands.integration.test.js` | Update 3 existing `allowedActions` assertions (lines 253, 254 and 267) for `cancel` |
| 4 | `purchasingInquiry.integration.test.js` | Update the existing `allowedActions` assertions (lines 124, 126 and 311, and the detail check at 265 if it shifts) |

The 4 cases in item 2:
Cases a, b and d need the authoritative GR fact. Until TASK-027 they can only prove the fail-closed refusal (503 with nothing written), so their success paths wait for TASK-027.

- **a.** Confirmed zero-receipt withdraw: back to DRAFT, editable again, and a resubmit with approval on creates a new approval. Status history and Audit rows are written.
- **b.** Cancel from DRAFT, PENDING and CONFIRMED, where the pending approval becomes INVALIDATED. Cancel and withdraw are refused once the fixture sets `has_confirmed_receipt = 1` directly, since GR does not exist yet.
- **c.** Close remaining, selected lines and all lines, on a fixture PO set to PARTIALLY_RECEIVED with `gross = net`. It checks:
  - line quantities;
  - CLOSED status;
  - no Inventory rows;
  - `lineIds` errors;
  - a view-only user gets 403;
  - a missing reason gets 400.
- **d.** Approve and cancel sent at once on one pending PO: exactly one wins and the other gets a 409. A replay returns the first result.

**Scale:**
- Concurrency 1, except case 2d, which sends 2 requests at once.
- Fixture data: one PO of 1 to 3 lines per case, in the same small fixtures the existing Purchasing integration tests use. No new fixture files.
- No capacity workload and no timing threshold.

**Trigger:** every PR, in the existing server jobs, like the other Purchasing tests.

**Cost:**
- Unit cases: estimated under 0.1 s.
- Integration cases: estimated 2 to 4 s, from about 0.5 s per case in the TASK-024 run (23 cases in 12.5 s). These are estimates, not measured.
- No new job.

**Receipt:** items 3 and 4 change files pinned by `purchasing-task024-backend.json`. The new receipt must re-pin all 21 of that receipt's files plus the new ones.

**Deferred, with owner:**
- **Close-remaining versus GR confirm concurrency** (design §11, "Confirm vs close"). GR confirm does not exist yet, so this case belongs to TASK-032, Purchasing.
- **The `NOT EXISTS` GR guard and its test** belong to TASK-027 and TASK-032.

**Local MySQL:** items 2 to 4 need one private MySQL slot from the PM:
- run the three integration files once;
- stop at the first unexpected failure;
- no sweep.

**Alternative:** the unit file only, without integration. That leaves the SQL locks, CHECK and trigger interaction, and the approve-versus-cancel race unproven against a real database, so I do not recommend it.

## TL ruling relayed by the PM on 2026-11-09, commit `2cb6fe60`

This supersedes the earlier `allowedActions` table. The fail-closed refusal is a safety fix, not acceptance of the success paths.

**Error classification**, after the PO lock in the same transaction:

| Condition | Result |
| --- | --- |
| `has_confirmed_receipt = 1` | `PO_STATE_CONFLICT` |
| `everConfirmed` returns `true` | `PO_STATE_CONFLICT` |
| `everConfirmed` returns anything other than a boolean, including `undefined` | `PURCHASING_DEPENDENCY_UNAVAILABLE` (503). Never reported as an existing receipt. |
| The reader throws | Rethrown unchanged, and the transaction rolls back. The default reader throws 503. |

Only an explicit `false` lets withdraw or cancel proceed.

**`allowedActions`:**
- `cancel` and `withdrawConfirmation` are not offered, in the list or the detail, until the real reader is wired. Production currently answers 503 for both.
- Unchanged: approval `withdraw`, `copy`, `edit`, `submit`, and `closeRemaining` on PARTIALLY_RECEIVED.
- `has_confirmed_receipt` is back in the detail select only.

**Effect on the existing assertions:**
- The only change is `server/test/integration/purchasingInquiry.integration.test.js` lines 265 to 266. The PARTIALLY_RECEIVED detail read by a mgmt user goes from `e: ["copy"]` to `e: ["copy", "closeRemaining"]`.
- The lines 124, 126 and 311 in that file, and lines 252 to 255 and 267 of `purchasingApprovalCommands.integration.test.js`, stay as they are.
- The earlier proposal said these would change. That is withdrawn.

**Not run after the change:** no lint, test, private check or mutant.

## ④ TASK-025 verification package (needs Sam; none written or run)

**Unit tests:** a new file, `server/test/purchasing/purchaseOrderLifecycleService.test.js`, using a fake `tx` and fake approvals.

| # | Case | Fake calls |
| --- | --- | --- |
| U1 | `derivedStatus` and `lineOutstanding`, a table of 8 rows including a Base quantity above 2^53 | none |
| U2 | Cancel PENDING with reader `false`: approval invalidated once, PO CANCELLED, version + 1, one status history row | 1 PO lock, 1 reader, 1 invalidate, 1 UPDATE, 2 history queries |
| U3 | Withdraw CONFIRMED with reader `false`: DRAFT, `confirmed_at` and `confirmed_by` set to null | 1 lock, 1 reader, 1 UPDATE, 2 history |
| U4 | Classification, `it.each` over 5 variants: flag 1, reader `true`, reader `undefined`, reader throws, default reader. Expected: 409, 409, 503, the thrown error unchanged, 503. Nothing is written in any variant. | 5 locks, 4 reader calls (the flag-1 variant never calls the reader), 0 UPDATE |
| U5 | Guards: VERSION_CONFLICT, WITHDRAW from DRAFT, and CLOSE from CONFIRMED all fail before the reader | 3 locks, 0 reader |
| U6 | Close all on PARTIALLY_RECEIVED: closes `ordered - net` only on the lines with outstanding quantity, ends CLOSED, Audit `lineCount` is 1 | 1 lock, 1 lines lock, 1 line UPDATE, 1 PO UPDATE, 2 history |
| U7 | Close selected lines: a line with nothing outstanding gives 409 with `field`, an unknown id gives 404, and a partial close keeps PARTIALLY_RECEIVED with no history | 3 runs |

**Integration tests:** a new file, `server/test/integration/purchasingLifecycle.integration.test.js`, on MySQL.

The fixture POs are set directly to their state with SQL, keeping the CHECK `gross = net + reversed`. Each case uses one PO with 1 to 3 lines, with the existing users and master data.

| # | Before the real GR reader (can run now) | After the real GR reader and wiring |
| --- | --- | --- |
| I1 | Withdraw on a CONFIRMED PO gives 503, and nothing changes in the PO, history, Audit success rows or operation result | Withdraw succeeds; a resubmit creates a new approval |
| I2 | Cancel from DRAFT, PENDING and CONFIRMED each gives 503, and the pending approval stays PENDING | Each succeeds; the pending approval becomes INVALIDATED; a PO with a confirmed or fully reversed GR gives 409 |
| I3 | Close remaining: selected and all lines, line quantities, CLOSED, no rows in `inventory_*`; `lineIds` gives 404 or 409; view-only gives 403; a missing reason gives 400; `allowedActions` shows `closeRemaining` | the same |
| I4 | A replay with the same eventId returns the first result | Approve and cancel sent at once: one wins and the other gets 409. **This race case needs Sam's separate approval.** |

About 6 to 10 HTTP requests per case.

**Existing assertion:** the one at inquiry lines 265 to 266, listed above.

**Single run:**
```
cd server && npm test -- test/purchasing/purchaseOrderLifecycleService.test.js test/integration/purchasingLifecycle.integration.test.js test/integration/purchasingInquiry.integration.test.js test/integration/purchasingApprovalCommands.integration.test.js
```
- Uses the existing entrypoint, capacity pattern and default concurrency.
- Needs a private MySQL from the PM, with the env rebuilt from the `ci.yml` values, including `FULFILLMENT_LIFECYCLE_ENABLED=true`.
- Stop at the first unexpected failure, without retrying.
- Estimated 30 to 60 s, not measured.
- Cleanup: stop mysqld, delete the datadir, and confirm with `lsof` that the port is free.

**Receipt:** inquiry and approval commands are pinned by `purchasing-task024-backend.json`, so the new receipt must re-pin all 21 of its files plus the new ones.

**Deferred:**
- Close remaining versus GR confirm concurrency, to TASK-032.
- Every "after the GR reader" column above, to the GR reader sub-delivery (see `P3_task027_gr_header_proposal.md`).

TASK-025 cannot be marked DONE before those.

## ④ with fixed numbers (superseding the integration table above)

The TL accepted `2cb6fe60` at source level (relayed by the PM on 2026-11-09). That is not acceptance of TASK-025's success paths.

**The unit cases U1 to U7 stay as listed.**

**Integration cases, by row:**
- **"Now"** is reachable today. The default reader fails closed.
- **"After"** needs the TASK-027 early header milestone and the wired reader. It cannot be reached now.
- Fixture POs use 1 to 3 lines.

| # | Reach | Data | HTTP calls | Assertions |
| --- | --- | --- | --- | --- |
| I1 | Now | 1 CONFIRMED PO, 1 line | 2: POST withdraw, GET detail | 503; the version, status history count, success Audit count and `allowedActions` (`["copy"]`) are unchanged |
| I1 | After | the same | 4: withdraw, GET, update, submit with approval on | 200 DRAFT; a new approval id on submit |
| I2 | Now | 3 POs: DRAFT, PENDING and CONFIRMED, 1 line each | 4: 3 POST cancel, 1 GET | 503 each; the approval stays PENDING; nothing written |
| I2 | After | the same plus 2 POs, one with a CONFIRMED GR and one with a REVERSED GR | 6: 3 cancel 200, 1 GET, 2 cancel 409 | INVALIDATED approval; 409 is never reported as 503 |
| I3 | Now and after | 1 PARTIALLY_RECEIVED PO with 3 lines: line 1 fully received, line 2 partial, line 3 at 0 | 7: GET (`closeRemaining` offered); close `[line2]`, which stays PARTIALLY_RECEIVED; `[line1]` gives 409; `[999]` gives 404; view-only gives 403; no reason gives 400; close all gives CLOSED | line quantities; no `inventory_*` rows; history only on the CLOSED transition |
| I4 | Now | 1 PARTIALLY_RECEIVED PO with 2 lines | 2: close-remaining twice with the same eventId | the second is `replayed: true` with the same result |
| I4 | After, **needs Sam** | 1 PENDING PO, 1 line | 3: approve and cancel sent at once, then GET | exactly one 200 and one 409 |

**Existing assertion:** only `purchasingInquiry.integration.test.js` lines 265 to 266 change, from `e: ["copy"]` to `e: ["copy", "closeRemaining"]`.

**Command, DB and cleanup:** as listed above. The "After" rows run only after the reader exists. TASK-025 is not DONE before them.

## ④ exact (superseding every earlier "about" in this file)

**Unit file** `server/test/purchasing/purchaseOrderLifecycleService.test.js`. Support code: a fake `tx` that returns fixed rows by SQL pattern, a fake `approvals` with `invalidateInTransaction`, and a fake `receiptFacts`.

| # | Variants | Fake calls |
| --- | --- | --- |
| U1 | 8 table rows | none |
| U2 | 1 | lock 1, reader 1, invalidate 1, PO UPDATE 1, history 2 |
| U3 | 1 | lock 1, reader 1, PO UPDATE 1, history 2 |
| U4 | 5 (flag 1, `true`, `undefined`, throws, default) | lock 5, reader 4, UPDATE 0 |
| U5 | 3 (VERSION_CONFLICT, WITHDRAW from DRAFT, CLOSE from CONFIRMED) | lock 3, reader 0 |
| U6 | 1 | PO lock 1, lines lock 1, line UPDATE 1, PO UPDATE 1, history 2 |
| U7 | 3 (zero outstanding gives 409; unknown id gives 404; partial close) | lock 3, lines lock 3, line UPDATE 1, PO UPDATE 1, history 0 |

**Integration, reachable now:** 6 POs, 9 lines, 15 HTTP calls, of which 12 are business POSTs and 3 are read GETs.

| # | POs and lines | Business POSTs | Read GETs |
| --- | --- | --- | --- |
| I1 | 1 PO, 1 line | 1 withdraw | 1 detail |
| I2 | 3 POs, 1 line each | 3 cancel | 1 detail |
| I3 | 1 PO, 3 lines | 6 close-remaining (`[line2]`, `[line1]`, `[999]`, view-only, no reason, all) | 1 detail |
| I4 | 1 PO, 2 lines | 2 close-remaining with the same eventId | 0 |

**Integration, after TASK-045 and the wired reader (not reachable now):**
- I1-after: 1 PO, 1 line. 3 POSTs (withdraw, update, submit) and 1 GET.
- I2-after: 5 POs, 1 line each. 5 POSTs (3 succeed, 2 give 409) and 1 GET.
- I4-after: 1 PO, 1 line. 2 concurrent POSTs and 1 GET. **This needs Sam's separate approval.**

**Existing assertion:** `purchasingInquiry.integration.test.js` lines 265 to 266 change from `e: ["copy"]` to `e: ["copy", "closeRemaining"]`. Nothing else changes, and the original assertions are kept, with none skipped.

## C4 run (Sam's approval of 2026-11-09; the single grant is used): FAILED, stopped and released

- **Candidate:** `418c4e0ba9f039c9808227b807014172889fa563`. `server/src` is identical to `2cb6fe60`. Migrations end at 0118, and `goods_receipts` was absent after migrating.
- **Window:**
  - Started 2026-11-09 12:13:33 +08:00.
  - Private mysqld 26.7.0, PID 39635, on 127.0.0.1:33619, socket `/private/tmp/m025c4/s.sock`, datadir `/private/tmp/m025c4`, started with `--skip-log-bin --mysqlx=OFF`.
  - Released 12:15:26 +08:00: the PID exited, the datadir was removed, `lsof` showed no listener on 33619, and `pgrep mysqld` was empty.
- **Steps:**
  1. Preflight: head, clean tree, migration set, no mysqld, free port, absent datadir. All passed.
  2. `validateApplicationConfiguration()` with the 19-variable env built from `ci.yml`: `CONFIG_OK`.
  3. Initialize, start, and create the `ci.yml` root, `erp_dev` and `erp_user`: exit 0.
  4. `npm run migrate`: exit 0, 111 migrations up to `0118_create_purchase_order_status_history.js`.
  5. The literal four-file `npm test -- …`: **exit 1. Tests 43: 39 passed, 4 failed** (8.53 s).
- **Results:**
  - Passed: the 22 unit registrations, the 8 inquiry registrations (including the changed assertion) and the 9 approval-command registrations.
  - **Failed:** all 4 lifecycle integration registrations, I1 to I4. Every lifecycle POST returned `500 INTERNAL_SERVER_ERROR` instead of 503, 200 or 409. I3 and I4 then hit `undefined.status`.
- **Cause, found by reading the server log and source, not by rerunning:**
  - `PurchasingOperationService.claim` refuses any `commandType` missing from its `COMMANDS` whitelist with `TypeError("Unsupported Purchasing command")`.
  - TASK-025 added `WITHDRAW_CONFIRMATION_PURCHASE_ORDER`, `CANCEL_PURCHASE_ORDER` and `CLOSE_REMAINING_PURCHASE_ORDER` (the `${kind}_PURCHASE_ORDER` in `PurchaseOrderService.#claim`) but did not register them.
  - The TypeError aborts the transaction, so the request ends as a 500.
  - This is a **product defect in the TASK-025 source**, not a test defect. The unit file calls `PurchaseOrderLifecycleService` directly, and the private `check025.mjs` used a fake transaction, so neither exercised `claim`.
- **Evidence:** `/Users/sam/Documents/workspace/purchasing-evidence/c4-2026-11-09/`, with `SHA256SUMS` of 22 entries. It holds the commands' logs, exit files, the mysqld error log, and the server system and request logs.
- No retry and no further run.

## Minimal source fix after the C4 failure (candidate `462a9925`, not run)

**Diff:** `server/src/modules/purchasing/PurchasingOperationService.js` gains 3 lines, mapping `WITHDRAW_CONFIRMATION_PURCHASE_ORDER`, `CANCEL_PURCHASE_ORDER` and `CLOSE_REMAINING_PURCHASE_ORDER` to `"PURCHASE_ORDER"`. The blob goes from `3bea44d0…` to `65fdad29eff247c94ebdbb581c6899deca1f372b`. Nothing else in `server/src` differs from `2cb6fe60`.

**Static checks, done by reading only:**
- These are exactly the names `PurchaseOrderService.#claim` builds, `${kind}_PURCHASE_ORDER` for the three `LIFECYCLE_KINDS`. The route, permission and target contract is unchanged: `sourceDocumentId` is the PO id, as for every other PO command.
- `claim` still refuses unknown types. Its hash, actor, event and replay checks, and `complete`, `safeResult` and `run`, are untouched.
- `safeResult` already accepts the lifecycle summaries `{ id, number, status, version }` with DRAFT, CANCELLED, PARTIALLY_RECEIVED or CLOSED.
- **Schema:** in migration 0114, `command_type` is `VARCHAR(60)` ascii with no CHECK on its values. The longest new name has 30 characters, and `source_document_type 'PURCHASE_ORDER'` is already allowed. No schema change is needed.
- No receipt pins this file, so the TASK-025 receipt draft `8a700390…` is unchanged. No test pins the whitelist.

**Regression reasoning:** the change only adds keys to a frozen lookup. Existing keys and their values are unchanged, so the earlier commands resolve exactly as before. In the failed C4 run, the 22 unit, 8 inquiry and 9 approval-command cases passed, and C2 passed. The module is loaded by every file, so a syntax or import error would show in any rerun. I see no uncovered risk for the old commands that would justify rerunning all 43 cases.

**Proposed re-verification (needs Sam's new batch approval; not run):**
- Exactly the 4 failed cases, once:

  ```
  cd server && npm test -- test/integration/purchasingLifecycle.integration.test.js
  ```

- The same env (19 `ci.yml` variables), the same config validator first, and the same own-mysqld setup, migrate (up to 0118), cleanup and release rules as the first C4 run.
- The same data: 6 POs, 9 lines, 12 POSTs, 3 GETs, 2 actors, 1 app and pool.
- Default workers, and stop at the first failure.
- **Honest limit:** the four cases' assertions after the first lifecycle POST have never been reached, so further failures cannot be ruled out until that run.

## Re-verification run (Sam's approval of 2026-11-09, "批准三行修補及原四案一次"; the grant is used): PASSED, released

- **Candidate:** `40fc298c5ea0acbc6ea22769d6ed308f4d5169e8`. It includes fix `462a9925`, with `PurchasingOperationService.js` blob `65fdad29…`. Migrations end at 0118, and `goods_receipts` was absent after migrating.
- **Window:**
  - Started 13:40:40 +08:00.
  - Private mysqld PID 43335 on 127.0.0.1:33619, socket `/private/tmp/m025c4r/s.sock`, datadir `/private/tmp/m025c4r`.
  - Released 13:42:01 +08:00: the PID exited, the datadir was removed, `lsof` showed no listener on 33619, and `pgrep mysqld` was empty.
- **Steps:**
  1. Preflight passed.
  2. `validateApplicationConfiguration()` with the same 19 variables: `CONFIG_OK`.
  3. Initialize, start, and create the users: exit 0.
  4. `npm run migrate`: exit 0, 111 migrations up to 0118.
  5. `cd server && npm test -- test/integration/purchasingLifecycle.integration.test.js`: **exit 0. Tests 4: 4 passed, 0 failed** (1.25 s). I1 to I4 all passed.
- **HTTP in the test window**, from the server request log: **12 POSTs and 3 GETs**, as approved.
- **Combined with the first C4 run:** 22 unit, 8 inquiry and 9 approval-command cases passed there, plus these 4. All C4 registrations have now passed, on two runs; the earlier failure stays on record.
- **Evidence:** `/Users/sam/Documents/workspace/purchasing-evidence/c4r-2026-11-09/`, with `SHA256SUMS` of 23 entries. It holds the logs, exit files, the env used, the mysqld error log, and the server system and request logs.

## Main integration and re-pin, 2026-11-10

Main `9762fb59` (TASK-024 backend, PR #351) was merged in with no conflicts. The 19 TASK-025 files are byte-identical to `204420a1`. One pin changed: `server/test/purchasing/purchaseOrderApprovalHandlers.test.js` now imports the my-approvals handler from `handlers/purchase-order-approvals/`, the fix Sam approved on 2026-11-10 ("批准修補，恢復採購"). No case, assertion or workload changed. The receipt now has a new digest, which the CI approval administrator must register. The C4 evidence still covers the lifecycle files, which are unchanged.
