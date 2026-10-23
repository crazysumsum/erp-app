# HD-016 — P1 pending-create Claim identity contract

Status: ADOPTED A by actual Sam instruction on 2026-10-23. Implementation and validation in progress; no completion claimed.

## Observed baseline and defect

P1 worktree `/private/tmp/erp-fulfillment-p1`, branch `codex/fulfillment-p1-queue-picking`, base `fd32762f4fa17a5e77aaa7118a9ded2d3ac81e9e`. DES `3cf1162c3cd78421101639d5cf0f077a1434bd534d1df779ea22e6a85f83ce62`; PLAN `4cc3628347eb79f3afc1308180d546c49f2cb0c7f95a6480591c1e06abedd288`.

`SalesFulfillmentService.normalizeSalesFulfillmentIntent` requires a positive persisted `claimId` on every CLAIM member. Approved DES §2.3 creates new Fulfillment/Lines/Claims only AFTER Sales locks and capacity validation. The existing `FulfillmentLockService.lockClaimCapacityInTransaction` requires an existing DRAFT and complete existing line IDs. Thus TASK-013 cannot use the delivered contract for CREATE without fabricating identities or reversing the approved lock order. Neither is allowed. Independent entry reviewer `/root/fulfillment_independent_review` reproduced this by inspecting the exact implementation and approved design, disposition 0C/1H/2M.

## Option A — explicit pending-create variant (recommended)

Add a strict CLAIM-only top-level `claimMode: "PENDING_CREATE"` variant, whose reservation members use explicit `claimId: null`. All members must be pending; mixed pending/persisted identities fail closed. The existing CLAIM shape without claimMode remains byte-for-byte normalized/hash compatible, with strictly positive claimId. SHIPMENT_CONFIRMED and SHIPMENT_REVERSED retain their exact required fields, positive claim IDs, hashes, receipts and replay checks. No temporary ID, mapping-ID-as-Claim-ID, client-selectable persisted ID or shipment relaxation.

The Sales owner validates the same fresh actor/permissions, current SO eligibility, expected SO/line versions, unique complete selected line membership, reservation-to-line mapping ownership, last-sync Inventory version and quantities. A pending intent is only a read/lock/capacity protocol; it is never accepted as a shipment/apply receipt.

Add a separate CREATE capacity path in the Fulfillment owner. Within the existing trusted READ COMMITTED business transaction: claim domain operation first; lock Sales roots/lines/mappings; lock all existing Fulfillment roots/lines/Claims in sorted order; lock/revalidate Item profiles and actual Inventory reservation source/current counters in the existing owner order; verify existing active Claims plus desired new Claims do not exceed actual outstanding. Only then insert the new header, lines and real Claims, immutable history, complete audit and operation result atomically. Existing DRAFT updates continue through the existing persisted-root contract. No Inventory allocation/post follows this Claim-only read path.

In particular do not INSERT a new Warehouse-referencing Fulfillment header before the owner Warehouse lock: that would acquire an FK shared lock and invite concurrent CREATE shared-to-exclusive conversion deadlocks. Newly inserted private projection rows occur after all shared owner locks/capacity proofs; the held Sales root serializes same-SO membership. Recheck exact cardinality, FK ownership and cumulative quantity invariants before commit. Number reservation remains the approved preceding short transaction with legitimate gaps.

Exact potential shared scope: `server/src/modules/sales/SalesFulfillmentService.js`, its focused provider tests; `server/src/modules/fulfillment/FulfillmentLockService.js`, new P1 service/handler/tests already planned; Fulfillment canonical design/provider contract and affected typed manifest pins. Any Sales-owned canonical contract update is limited to this new variant and requires actual Sales owner coordination/review, authorized as part of this option. No new schema/migration, global isolation change, Inventory write API or business eligibility change.

## Option B — separate Sales pre-create locking API

Retain the old CLAIM interface completely and add a distinct Sales-owned pre-create capacity-lock API/DTO, with the same lock/CAS/actor proof and Fulfillment pending-capacity path. This avoids a variant on the old method but adds a second owner interface, integration and maintenance burden. It requires owner review and the same native correctness/concurrency validation. No claim identity fabrication or early persistence is allowed under either option.

## Required evidence after actual approval

RED contract probe for pending input against current implementation; old valid intent baseline; exact malformed/mixed/unknown-field/duplicate/source/CAS tests. Native MySQL concurrent same-SO and same-Warehouse CREATE, active claim overcapacity, stale source/version, Serial rejection, current outstanding mismatch, late write/audit failure full rollback and replay tests. Unchanged persisted CLAIM, Shipment/Reverse and provider regression; full original P0/P1 developer/coverage/security/build/browser/capacity/CI gates. Keep all records and the original 20-second transaction limit. Full-route latency remains subject to original P1 NFR, not inferred from the provider timeout.

## Decision and authority

Await actual human selection. Proposed default only if approved: A. This is a new delivered provider identity/sequencing mismatch, not a repeat request for P1 development or draft PR authority. Harness instruction: “Major impact means ask a human before choosing.” Source: `/Users/sam/.agents/skills/software-engineering-harness/SKILL.md`. TASK-013 dependent writes are blocked; TASK-012 bounded coherent Queue reads and pure tests may proceed.

## Actual adoption — 2026-10-23

Actual direct human instruction: 「批准 HD-016 方案 A，繼續按已批准計劃完成 fulfillment P1；待所有 TASK、獨立覆核、完整驗證及當前候選 CI 通過後建立 draft PR。」 This adopts exactly A above and authorizes the named Sales provider/contract coordination and tests, while retaining all original gates and draft-only scope. Original proposal before this adoption was independently APPROVED FOR HUMAN DECISION 0C/H/M at SHA256 `597fbf5763db4731cbd85266775d434fb1f94aaef93bdf2e779977f5c406084d`. Old decision/proposal history remains; this is the actual human answer, not inferred from the earlier “繼續”. Sales owner has been notified and reserved the provider file for this contribution; actual owner implementation review remains required. No new OperationService routing or Sales P4 migration is adopted here.
