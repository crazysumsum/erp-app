# P2 Confirmation/Recovery direction for next slice review

Status: proposed concrete implementation direction under approved TASK026–029; no PhaseA/B/recovery product code or tests added. This is not admission of a new authorization bypass and does not add CI cases/load.

## Durable reconstruction

Public Confirm remains exactly eventId/version. PhaseA validates a complete Draft, current actor and operation permission, locks operation→Fulfillment→Shipment, binds exact Shipment/originalversion/address/contact/logistics/confirmation intent to the durable hash, then commits SHIPPING plus original event. No Inventory/Sales effects. SHIPPING fields and original actor identity remain frozen. Do not introduce a payload column by assumption: Recovery must reconstruct the original expected version from the one PhaseA version increment and the unchanged SHIPPING row, canonicalize saved DECIMAL weight exactly as HD025, and prove the recomputed hash against the operation. Lease/backoff attempts must not increment Shipment version or change frozen intent.

## Atomic completion

Discover complete saved child/source/CAS intent without taking domain locks; freeze/copy it before awaits. Inventory operation scope/root/child preclaims precede Sales roots. Then lock Sales→Fulfillment/Claims/Allocations→Shipment/Lines→Customer→Item→Inventory anchors in approved order and revalidate every immutable identity, selected child version, actor, quantity and current owner result. Actual same-transaction preparations/receipts remain unforgeable and exact. Issue, Consume, Sales projection, Claims, snapshots, histories and SUCCEEDED commit once.

Classified permanent rejection requires full confirmed rollback before a separate same-event/hash/target/lease fenced failure-recording transaction returns DRAFT and FAILED. Unknown commit/rollback outcome never becomes inferred FAILED; wait on the original operation current lock and observe authoritative outcome. The same MySQL atomic transaction and exact original operation row are the primary commit witness; no secondary event or compensating direct data edit is introduced. Any discrepancy between local status and source outcome fails closed for reconciliation.

## Revoked-original-actor failure-only reconciliation

Actual existing FulfillmentOperationService.takeOver/#complete require fresh original actor and permissions; therefore the ordinary methods cannot finalize failure after original actor revocation. implementation/13 explicitly left this cleanup to P2. Approved design§8.6 requires failed rollback→DRAFT, §8.8 preserves actor/payload, §7.1 requires fresh authorization, §11.6 explicitly requires testing revoked/recovery actor policy and fixed-purpose service identity, §12.2 forbids infinite business retry. Independent review established this is an existing P2 implementation gap, not a blanket new service-actor approval.

Minimal direction: a separate private failure-bookkeeping purpose available only to the trusted Confirmation coordinator/Recovery runtime. Prove fresh original actor inactivity or missing required permission through the authorization directory; dependency errors are not evidence of revocation. Acquire the original operation current X lock and lease fence, then exact target locks; prove original event/hash/target/actor and frozen intent, IN_PROGRESS plus SHIPPING and matching confirmation event, no committed successful Issue/Shipment/Sales effects and no indeterminate transaction. Only atomic FAILED+DRAFT+safe history/audit is permitted. Original actor remains the recorded intent identity. Ordinary claim/takeover/success and every Inventory/Sales posting retain their current fresh permissions; no serviceName string, caller-supplied proof or replacement actor can authorize business effects.

Concrete trusted-runtime provenance, opaque same-transaction proof construction, fence/lease expiry, original-outcome checks and negative native cases must be independently security-reviewed before this path is implemented. If these proofs cannot be established with existing contracts, or the proposal grows into service identity posting Inventory/Sales, stop and seek the necessary human decision. Do not infer that a public endpoint can call this helper merely because its name says private.

## Evidence and current policy

Next reviewed plan must enumerate exact functional tests, crash/lease/unknown-outcome scenarios, scope/owner/privacy negative cases and any capacity sample counts/costs. New regular CI cases/load require actual Sam approval first under CI-P2-DRAFT-001/new project-wide policy. Private minimal functional probes alone do not establish CI or full P2 completion. Original20s,100/50/5000,safety and all coverage gates remain unchanged; genuine capacity/performance failure stops work for user report.
