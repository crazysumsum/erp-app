# P0 TASK-004 Sales provider contribution — ABI coordination

Status: implementation preparation; not provider readiness, P0 Checkpoint 0B, P4 completion or merge approval evidence.

## Authority and delivery

Sam's direct 2026-10-20 instruction authorizes continued Fulfillment P0 coordination and P4 completion after real dependencies. The P0 owner requested a named Sales-owned additive contribution in the Sales worktree for adoption in the complete P0 PR. HD-008/HD-009 delivery order remains: complete P0 owns the final active schema and minimal lifecycle provider, carries exact Sales 0088; full P4 follows. This contribution introduces no migration or separate early Sales merge. Existing Sales lifecycle fail-closed behavior remains.

Authoritative behavior: P0 `03_design_spec.md` §§2.8, 2.9, 3.6, 6.1; `05_development_tasks.md` TASK-004/005 and Checkpoint 0B. Sales Design Fulfillment boundary and §7.6 already require the same confirm/reverse behavior.

## Observed implementation constraints

- Migration 0069 already supplies globally unique `event_id`, request hash, JSON recovery payload and JSON result summary. Its unrestricted command/target strings permit a dedicated provider source journal without new DDL. The generic `SalesOperationService` serializer only accepts bounded public document summaries, so it cannot serialize this provider result. A dedicated target must also keep internal provider results out of public operation lookup.
- Claim the provider operation before Sales root/line/mapping locks. Inventory operation IDs and new versions exist only after Issue/Restore. Bind the first hash to the complete pre-Inventory intent; persist a separate completed apply hash and the exact original result. Do not claim another operation from apply after Inventory locks, or pretend final Inventory results were known before Issue.
- Migration 0078 makes original Sales reserve `inventory_operation_id`, `source_event_id`, identity and original quantity immutable. Preserve them. Its guards compare the mapping against Inventory's actual consumed/outstanding/status/version, so Inventory must first make the real Issue/Restore and Sales then update the matching projection in the same caller transaction.
- Existing Inventory provides a single-reservation Issue method; the approved sorted batch Issue and dedicated Reversal+Restore contract are not yet implemented. Generic reverse does not restore the approved reservation semantics. No native fixture/fake result can establish that P0 boundary.
- `lockLinesForFulfillmentInTransaction` also serves allocation/claim creation. Pure locking reads must not leave an unapplied `IN_PROGRESS` Sales operation. Shipment-result intent and pure lock-read are separate concrete uses of this method.
- A Shipment can contain a zero-picked Line. Its exact selected line set is not the entire Sales Order line set. Do not impose a positive shipped quantity on each Line or require unrelated SO Lines in the shipment result.
- Base UOM cannot be inferred from `sku_uom_id`, which is the sale UOM mapping. Use the Item owner projection; never raw-read Item tables from Sales or add a second Item business-rule implementation.

## Candidate two-stage wire for owner reconciliation

This section is a proposed concrete ABI, not a frozen public contract. IDs and quantities are canonical decimal strings; versions and timestamps remain explicitly validated safe integers unless the final owner ABI specifies otherwise. Fixed purpose and module/document type are service constants, never caller-selected privilege escalation.

1. `getOrderForFulfillment(orderId, {atMs})` returns only §6.1 fields, with Line version added as required by TASK-004. Use actual request-context authentication (or the explicitly trusted internal adapter), fixed Fulfillment purpose and fresh current actor permissions; no caller-selected permission or service-name bearer. It exposes no prices, notes, contact details or internal operation payloads. Restrict to CONFIRMED/PARTIALLY_FULFILLED and positive outstanding reservation eligibility. No standalone HTTP route.
2. `lockLinesForFulfillmentInTransaction(tx, command)` requires the actual executor bound to request context; fresh trusted actor, fixed purpose, order ID/version and exact selected Line IDs/versions. Lock Sales root, then Line primary keys, then mapping primary keys in numeric order. Build the fresh projection from current locking reads, never a pre-lock REPEATABLE READ snapshot opened by authorization. A pure read/claim scope returns a fresh projection without a journal. A Shipment scope also requires complete immutable source intent (action, event, shipment, order, selected Lines including zeros, quantities, exact reservation set and expected Inventory versions), claims its dedicated journal before Sales locks, and binds its private transaction receipt to that intent. Completed replay returns the original result before repeating Inventory work.
3. `applyFulfillmentResultInTransaction(tx, command)` requires the same transaction and receipt, exact original source intent and the real Inventory batch result. It validates exact Line/reservation sets, ownership, sum quantities, old/new versions, Inventory operation source and original Issue references on reversal. It returns the original `{orderId,status,version,lines:[quantity projections]}` result, stores that result and the final apply hash, and never owns commit/rollback. A caller must propagate any mismatch so all Inventory and Sales changes roll back. Stable code: `SALES_FULFILLMENT_CONTRACT_MISMATCH`.

Confirm moves Reserved to Fulfilled. Reversal moves the same Shipment quantities from Fulfilled back to the same Reservation; Ordered/Backorder/Cancelled and original reserve identities stay unchanged. Recompute COMPLETED/partial on Confirm; reversal reopens COMPLETED/PARTIALLY_FULFILLED/CLOSED to PARTIALLY_FULFILLED or CONFIRMED from remaining quantities. Append history/audit and increment versions without rewriting old Complete/Close events.

## Required owner answers before final source freeze

- Exact Inventory batch member/source/operation receipt fields, expected/new reservation version convention, and original Issue identifiers for dedicated reverse+restore.
- Shipment zero-picked Lines: explicit zero with empty reservation result versus omitted result member; exact-set binding must be identical in both owners.
- Item owner batch profile method and Base UOM/version projection used before Inventory locks.
- Two-stage intent/receipt/result shape and replay route agreed by both consumers; the existing three public method names and business behavior stay as approved.

These are engineering ABI coordination within the approved provider-owner scope; no new human decision is requested. If resolving them changes approved business rules, schema ownership, migration allocation or delivery boundaries, record that separately before implementation.

## Validation boundary

Independent feasibility review: `/root/def016_runtime_recovery_review` examined actual 0069/0078, Sales serializers, existing Inventory methods and the approved P0 design. Private proof `phase4-private/p0-task004-sales-provider-feasibility-r1-reviewer-proof.json`, SHA256 `a2b0b184738bd81dfcb40ac3540df44377123e4396e2e91d488813a23749ba83`. This is feasibility feedback, not approval of unimplemented source. Required completion remains source-frozen independent review, real consumer contract tests, native Issue/Restore, exact-set failure rollback, concurrent replay and lock-order evidence in the complete P0 candidate.
