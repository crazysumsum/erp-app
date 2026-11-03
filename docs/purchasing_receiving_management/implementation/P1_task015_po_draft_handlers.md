# TASK-015 — PO Draft Create/Update Handlers

Built on 2026-11-03 from main `611fd638`. No schema change, manifest edit or new dependency; baselines unchanged (design `08a08a3d`, plan `d1c00718`). Design §5.1–5.2, §9.3, §10.4; FR-PO-001～020, AC-006～010; `TC-003`.

| Route | Handler | Contract |
| --- | --- | --- |
| `POST /api/v1/purchase-orders/create` | `CreatePurchaseOrderHandler` (`createPurchaseOrder`) | jwt, `purchasing.mgmt`, idempotency enabled, 201. |
| `POST /api/v1/purchase-orders/:id/update` | `UpdatePurchaseOrderHandler` (`updatePurchaseOrder`) | jwt, `purchasing.mgmt`, idempotency enabled, `id` from the path, `version` required, 200. |

Both return `{id, number, status: "DRAFT", version, warnings, replayed}`, where `warnings` carries the HD-015 1B codes. `purchasingSchemas.js` holds the strict create and update schemas (`additionalProperties: false` at every level), the write policy, and `purchaseOrderCommand()` and `purchaseOrderService()`, which the two handlers share.

## Choices within the design

- **The body is validated in the handler, not by the framework**, as Sales does: the route declares `body: {}` and `purchaseOrderCommand()` compiles the strict schema with `coerceTypes: false`. Quantities and prices must stay the client's strings, and a failure is §5.7's `PURCHASING_INPUT_INVALID` rather than the framework's `REQUEST_VALIDATION_FAILED`. The error carries only the first failing path, such as `lines.0.unitPrice`, never the value. The service's `draftProjection()` still validates everything again.
- **`Idempotency-Key` must equal `eventId` character for character** (§5.1, §2.7). A missing header is the framework's `IDEMPOTENCY_KEY_REQUIRED`; a different value is `PURCHASING_INPUT_INVALID` on `eventId`, and the service is not called. The eventId pattern accepts lowercase only, matching the service and the Inventory provider.
- **Schema-shape refusals are not REJECTED audits.** They never reach the service; only refusals the service decides (eligibility, version, state, permission freshness, event conflict) are audited, as TASK-014 does.
- **Real provider wiring.** Each handler builds `PurchaseOrderService` from the `mysqldatabase` and `time` services, `services.config.purchasing` (normalized again, so an unsupported setting still fails), `BusinessMasterProvider`, and a `SupplierLookupService` with the Business Master lookup provider. Items are read inside the service on the transaction connection (HD-015 4).

## Verification

- `server/test/purchasing/purchaseOrderHandlers.test.js`: 7 cases, no database. Covers metadata, the provider and config wiring, the arguments the service receives, update's version and path ID, `Idempotency-Key` versus `eventId`, unknown and client-computed fields, and non-coerced types with field paths.
- `server/test/integration/purchasingPurchaseOrderApi.integration.test.js`: 2 cases through the real application, HTTP, JWT, framework idempotency and MySQL. Create returns 201. The same key with the same body replays the stored response; with another body it is `IDEMPOTENCY_CONFLICT`; a mismatched key, a missing key and a client total are refused. Update returns 200, and a stale version is 409 with only `currentVersion`. `purchasing.view` alone is 403 and no token is 401. HTTP writes commit, so the cases delete their POs and masters afterwards. Their operation and audit rows, and the current month's `purchasing_document_sequences` row, remain (those tables refuse DELETE). They use HKD and no Payment Term (TC-001).
- Mutation sweep, 19 mutants over the three handler files: all RED. The first pass's one survivor was an incomplete mutant that relaxed only half the eventId pattern; the full uppercase mutant is RED.

## CI admission

Pending Sam's decision on the two new files.
