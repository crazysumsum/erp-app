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
