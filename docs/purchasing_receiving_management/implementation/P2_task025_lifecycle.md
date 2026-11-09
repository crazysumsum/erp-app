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
