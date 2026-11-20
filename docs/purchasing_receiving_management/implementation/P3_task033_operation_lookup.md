# TASK-033 operation lookup and the minimal GR list and detail (2026-11-20)

## Operation lookup (design §2.7, §5.4)

`GET /api/v1/purchasing-operations/by-event/:eventId` only requires an authenticated user. The service rechecks the actor in a transaction, then reads `purchasing_operation_requests` by `event_id` and `actor_user_id`.

It returns `{status: "COMPLETED", resultType, resultId, resultSummary, completedAt}` only when both conditions hold:
- exactly one row matches;
- the actor still holds the original command's permissions (`LOOKUP_PERMISSIONS`, which matches each route's policy and covers all 15 commands).

Every other case returns 404 `PURCHASING_OPERATION_NOT_FOUND`: not found, another user's operation, lapsed permission, or more than one row. This means the endpoint cannot be used to enumerate operations. A command added later without a permission entry also returns 404, so the check fails closed.

**A 404 is not proof of failure until the deadline passes (TL 7543d32f).** Claim and complete commit together, so a transaction that is still running is invisible. Before the client's request timeout plus the server's transaction limit have both passed, a 404 means "not known yet". The client keeps the same eventId and asks again, or retries with the same body. Only a 404 after that deadline means the operation did not take effect. Pages (TASK-034) must never switch to a new eventId on an early 404.

## Minimal GR list and detail (PM 00108ad7)

- `GET /api/v1/goods-receipts`: `page`, `pageSize` (at most 100), `status`, `purchaseOrderId`; newest first.
- `GET /api/v1/goods-receipts/:id`: the header, lines, details with the Inventory movement id, and `allowedActions` (update, cancel and confirm, but only for a DRAFT and a user with `purchasing.view` and `receiving.operation`, read in the transaction).

Both need `purchasing.view`. Reversals, CSV export and risk filters belong to later tasks.

**Front-end contract (TL a0d814cb):**
- The list accepts exactly four query parameters: `page`, `pageSize`, `status` and `purchaseOrderId`. Any other parameter is ignored without an error, so a misspelled name silently returns the unfiltered list.
- Every string field the detail returns is NOT NULL in the database (checked column by column on 2026-11-20). `skuWarningCodes` is the one nullable column, and it is returned as `[]`.

**Receiving lookups (for the GR pages):**
- `GET /api/v1/receiving-lookups/purchase-orders?q=`: CONFIRMED or PARTIALLY_RECEIVED with outstanding quantity; `q` is a prefix match on the PO number or the supplier code or name.
- `GET /api/v1/receiving-lookups/warehouses`: active warehouses.
- `GET /api/v1/receiving-lookups/warehouses/:id/bins`: active bins in that warehouse.

All three need `purchasing.view` and `receiving.operation` and return at most 100 rows. The confirm rechecks everything.

## Tests

Two cases were added to `purchasingGoodsReceiptConfirm.integration.test.js`:
- **C8:** lookup for the actor; 404 for another user, a viewer, a missing event and a permission lapsed after the operation; 400 for a malformed id.
- **List and detail case:** actions before and after confirm, lines and details with movement ids, list filters, a bad status (400) and a missing GR (404).

Removing the permission check or the actor filter each turns C8 red.
