# TASK-017 — Approval OFF PO Submit and Confirm

Built on 2026-11-04 from main `ae54601f`. No schema change, manifest edit or new dependency; baselines unchanged (design `bedf5d1b`, plan `7cca891a`). Design §2.5, §2.6, §3.2, §3.3, §4.16, §5.2, §8.3; FR-SET-004, FR-APPROVAL-001, FR-APPROVAL-008, FR-LIFE-001, FR-PO-018, AC-011; `TC-004`.

`POST /api/v1/purchase-orders/:id/submit` (`SubmitPurchaseOrderHandler`, `submitPurchaseOrder`): jwt, `purchasing.mgmt`, idempotency enabled, body is `{eventId, version}` only, 200. A complete Draft returns `{id, number, status: "CONFIRMED", outcome: "CONFIRMED", version, warnings: [], replayed}`.

The design places this in `PurchaseApprovalService` and a Lifecycle `confirmValidatedDraftInTransaction()` (§8.3), while the task names `PurchaseOrderService.js` and `purchaseOrderStateMachine.js`. This follows the task, because neither of the other services exists yet. TASK-022 and TASK-025 can move the code when they add them.

## HD-018

Sam answered on 2026-11-04: 「全部按建議」, which selected option A on all three points.

1. **Status History (1A).** Confirm writes Audit only. TASK-022 adds the status history write with its table. There is no production data before go-live, so nothing needs backfilling; until then Audit holds the transition.
2. **Changed factor or Currency scale (2A).** Confirm refuses with the new `PO_MASTER_CHANGED` (409) and a field path when the current factor changes the Base quantity, or the Currency's decimal places changed since the Draft was saved. Saving the Draft again recalculates, so the user sees the new numbers before confirming. Name changes are not a conflict: confirm writes the current snapshot. A factor that cannot produce a whole Base quantity stays §5.7's `UOM_CONVERSION_INVALID`.
3. **Item reads (3A).** Non-locking, like Sales confirm, because the provider has no locking read. A SKU stopped at the moment of confirming can still pass; the receipt's SKU exception rule checks it again. Supplier, Currency, Payment Term, warehouse and Buyer reads already lock.

`PO_MASTER_CHANGED` and `PURCHASING_DEPENDENCY_UNAVAILABLE` are in code only. §5.7 already lists the latter; the former folds into the design at its next revision, with no baseline move now.

## Choices within the design

- **Same strictness as create.** The stored editable values go back through `draftProjection` and the create path's master checks with Draft tolerance off. Any of Supplier, SKU, UOM, Currency, Payment Term, Buyer, warehouse or address that is no longer valid refuses the whole document with a field path, and writes a REJECTED audit.
- **Approval ON refuses with `PO_APPROVAL_REQUIRED`.** TASK-023 adds the approval flow, and no API can turn the setting on before then. The check runs after the PO is locked and leaves it unchanged.
- **Lock order follows §2.6.** Event claim, then `purchasing_settings` in share mode, then the PO, then lines. The audit records the policy version the decision used.
- **Lines before header.** Lines are rewritten with their IDs while the header is still DRAFT, because `trg_po_lines_update` freezes them once it leaves (§4.16).
- **`purchaseOrderStateMachine.js` holds the §3.2 table.** Update and submit use it. CLOSED, CANCELLED and FULLY_RECEIVED have no exits yet; Reversal's recalculation is added with that work.
- **`allowedActions` gains `submit`** on a DRAFT for `purchasing.mgmt`.

## TASK-016 defect fixed here

TASK-016 returned `totalAmount`, `subtotalAmount` and `lineAmount` at the stored scale (`2.5000`). HD-009 and §2.8 require the Currency scale (HKD `2.50`, JPY `3`). My tests and response schema had the wrong format as their expected value, so CI could not catch it. No client used these routes yet. `moneyMath.storedAmount()` now converts them and refuses stored values with more decimals than the Currency allows. Cases now cover a zero-decimal Currency.

## Verification

- `server/test/purchasing/purchaseOrderStateMachine.test.js`: 2 new cases, no database.
- `server/test/purchasing/purchasingMoneyMath.test.js`: 1 new case.
- `server/test/purchasing/purchaseOrderHandlers.test.js`: 1 new contract case.
- `server/test/integration/purchasingPurchaseOrders.integration.test.js`: 5 new cases on real MySQL. Four roll back; one commits a Submit and Update race on the PO row lock.
- `server/test/integration/purchasingPurchaseOrderApi.integration.test.js`: 1 new case through the real application and HTTP, plus a cleanup change, because a trigger refuses deleting a confirmed PO's lines.
- `server/test/integration/purchasingInquiry.integration.test.js`: updated for the Currency scale and `submit`, with the zero-decimal assertions added to an existing case.
- Mutation sweep, 30 mutants. The first pass had 4 survivors. 3 were test gaps, now RED. The fourth was an `affectedRows` check that `#lockDraft` makes unreachable, so I removed it from the submit path.

## Deferred

No capacity case was added or run. `TC-004`'s approval and lifecycle parts stay open for TASK-022 to TASK-026.

## CI admission

Sam approved on 2026-11-04: 「全部批准，我作為project owner 批準你幫我發digest」. The scope is 10 new functional cases (2 state machine, 1 money, 1 handler contract, 5 service, 1 HTTP), the corrected amount expectations and `submit` in existing inquiry and API cases, the API cleanup change, the unchanged re-pin of the 13 inputs pinned by receipts that these changes invalidate, and a one-time project-owner authorization for the agent to publish this receipt's digest. Receipt: `.github/test-admissions/purchasing-task017.json`.

Measured locally per file: state machine 0.06 s, money 0.06 s, handler 0.1 s, inquiry 0.22 s, Purchase Order service 0.5 s, API 3.1 s; the new cases add about 1 s. CI is not measured, estimated under 3 s, with no new job and no capacity workload.

The local full suite was 5064 tests: 4518 pass, 100 fail, 446 skipped; coverage 95.85% lines, 87.23% branches, 94.79% functions. All 100 failures are the environment-only Fulfillment/Inventory cases. That full run preceded merging main's #329, which only changed a Fulfillment test fixture and its receipt; the Purchasing and handler files were rerun afterwards, 115 of 115.
