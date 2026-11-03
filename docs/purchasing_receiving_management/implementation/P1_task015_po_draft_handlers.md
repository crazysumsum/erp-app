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

## HD-016 — handler directories and the document revision

The full suite on the first implementation failed one case that main does not: `server/test/handlerConventions.test.js` "every handler's directory matches its URL prefix". A handler must live in the directory named by the first URL segment after `/api/v1/`. Design §9.3 and the manifest put every Purchasing handler under `handlers/purchasing/`, while §5.2's routes start `/api/v1/purchase-orders/`. The module uses eight prefixes: `purchase-orders`, `purchase-order-approvals`, `purchasing-settings`, `purchasing-audit-logs`, `purchasing-operations`, `purchasing-lookups`, `goods-receipts`, `receiving-lookups`. Boundary checking accepts only manifest paths, so either fix needed a manifest or design edit. Changing or relaxing the convention test was not an option.

Sam's decision, 2026-11-03: "全部按你的建議執行", accepting option A.

- Design §9.3 now places handlers by URL prefix. `handlers/purchasing/` and `handlers/receiving/` keep only shared schemas and service wiring, never a handler class. The manifest adds all eight directories to `source_paths` and `allowed_write_paths` at once, so later tasks need no further manifest edit. URLs are unchanged.
- The same revision folds the decisions previously deferred to "the next document revision", so the baselines move once:
  - HD-006 (OPEN-006 decided: greenfield go-live) into the requirement §0 and §18.3, design §0.2 and §15.2, and `TASK-044`.
  - HD-009 (amounts at the Currency scale) into §2.8.
  - HD-010 (amount overflow code) into §5.7.
  - HD-011 (no Purchasing transaction timeout) into §12.1.
  - HD-012 (charset, composite address FK, defaults, CHECKs) into §4.3–4.6.
  - HD-013 (Business Master impact checker) into §2.4 and §9.2.
  - HD-014 (operation, line and sequence triggers) into §4.3, §4.14 and §4.16.
  - HD-015 (Draft eligibility and provider gaps) into §8.2.
- The capacity scope map (`.github/scripts/sales-import-capacity.mjs`) does not know the new handler directories. Routine CI is unaffected; a post-UAT capacity dispatch over this diff would stop with "Unmapped change". The file is CI wiring outside this module, so it is recorded here as a post-UAT blocker for the CI owner, not changed.

**Records the revision supersedes.** The requirement, design and plan files and the manifest all changed, so both baselines moved: design `08a08a3d` → `bedf5d1b`, plan `d1c00718` → `7cca891a`. Every approval (APR-001–APR-009) and the design review REV-006 is bound to the old baselines and needs Sam's re-confirmation on the new ones. The originals are kept, not rewritten without a new decision. There are no run-evidence files or observations to strand.

**Cross-module.** Supplier's manifest consumes this module's `03_design_spec.md` as `supplier-consumer-contract`, pinned at `366abb1f…`. That pin now differs from the file (`927ddc66…`), so Supplier's harness reports contract drift until the Supplier owner re-pins it. This module may not edit `docs/supplier_management/`.

## CI admission

Pending Sam's decision on the two new files.
