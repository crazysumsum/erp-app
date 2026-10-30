# TASK030 — Shipment inquiry and document slice

Status: implementation preparation under the approved P2 plan; no completion/CI/capacity claim. HD026 affects failure/Recovery/Confirm, not this read model. Proposal75 B admits the exact two inquiry/document functional cases and two-line small fixtures; no new case/job/load is requested.

## Read contracts

- Preserve the existing Draft command response. Expand only GET Shipment detail to the approved full read model: basic Shipment fields, immutable parent IDs/numbers, selected logistics/child references, complete≤100 Lines, current address/Contact selection for Draft, confirmed address/Contact snapshots for historical states, bounded≤100 Issue/history pages, original confirmation event and server allowedActions. Never merge multiple child sets with a Cartesian join. Read history/current snapshots without updating business timestamps.
- GET `/api/v1/shipments` follows the specified q/SO/Customer/Warehouse/status[]/Shipment-date/carrier/tracking/sort/direction/page/pageSize filters. q resolves exact Shipment or indexed SO number; Tracking is exact. No free-text full-history fuzzy scan, unlisted arbitrary sort or custom SQL. Strict scalar IDs/booleans, calendar date bounds, status arrays with no duplicates, pageSize≤100, stable same-direction ID tie break. Use existing server pagination conventions; do not invent a lower record cap or omit matching rows silently.
- GET `/api/v1/shipments/:id/delivery-note` returns one complete common immutable snapshot projection for Delivery Note and Packing List presentation. Preserve all≤100 Lines including zero quantity and every≤5000 Issue bucket, exact quantity/owner reconciliation and stable line/bucket order. Only SHIPPED or clearly watermarked historical REVERSED facts are printable; DRAFT/SHIPPING/REVERSING/CANCELLED refuse an effective delivery document. The generated safe filename uses validated system Shipment number, not addresses/carrier/tracking.
- Every read needs fresh view permission. Commands remain independently fresh view+operation; allowedActions only advertises implemented P2 actions (Draft update/cancel/confirm, confirmed document print), never P3 Reverse. A pending/current state must not advertise another new Confirmation. Draft display may use the parent Fulfillment's retained SKU/customer snapshots while confirmed detail/document uses actual confirmation snapshots.

## Consistency, privacy and audit

List/detail use a fresh consistent read transaction as existing Fulfillment inquiry does, with explicit fresh authorization and strict DTO projections. No Customer banking/commercial price/tax/cost data is selected. Document retrieval uses the existing Sales-parent→Fulfillment→Shipment shared-lock pattern and complete child reads, then a technical PRINT audit and final fresh view check in the same RC transaction. No business timestamp, version, Inventory or Sales quantity is changed by a read/print.

Use handler strict request/response envelopes, fixed private/no-store success headers and no-store error defaults under the already approved framework policy. Raw strings are data only; actual Vue templates use escaped interpolation and A4 print CSS with a visible historical-state warning. No v-html or user-supplied filename.

## Two admitted functional cases

1. SHIPMENT-INQUIRY-DOCUMENT: one SO, two SKU Lines, two Balance buckets; original5+2 reserved,3+2 picked. One real internal Confirmation, exact list filters/parent navigation/bounded detail/immutable common document projection. At most8 reads as approved. No timing distribution or large load.
2. SHIPMENT-DOCUMENT-SAFETY: a separate fixture at the same small scale; refusal before Confirmation, then one real Confirmation, safe literal XSS snapshots/filename/privacy/no-store/fresh permission and unchanged business facts/timestamps on print. At most4 document/detail reads as approved; no extra business attempts.

Use existing native/HTTP fixture helpers and real app startup. The helper belongs in an already discovered helper file, not a new empty auto-discovered testcase. Source/native fixture/strict schemas and exact test discovery require independent review before execution. The actual browser/A4 result belongs to TASK033 and its separately admitted real Playwright flows, not these API cases. Full5000 document/capacity proof remains a held later gate; no performance claim follows from these small cases.
