# TASK-031 — positive Adjustment expiry/minimum life / HD116

## Current disposition — actual Sam A; HD116 ANSWERED

Actual latest Sam 「A」 selects A, APR155: all positive Adjustment statuses, new/existing Lot/Bucket, reject expired Lot and apply current SKU minimumReceiptLifeDays when applicable to expiry data, no Adjustment override. Current tracking none/optional no-expiry batch stay unchanged; current profile/local date rechecked at submission after blocking locks. Negative removal and existing Status Transfer rules remain, expired AVAILABLE still nonsaleable. This is direction/proposal preparation only, not unseen precise DESIGN/PLAN/source approval. [Next reason-length decision HD117](task031-reason-length-decision.md). TASK031 IN_PROGRESS / BLOCKED; source/spec/head/160 refs unchanged; no product/test/runtime/publication changes.

## Historical discovery — before HD116 answer

Status: DECISION_REQUIRED. Actual Sam A / APR154 resolves HD115 controlled new-Lot creation; HD112–114 directions remain. TASK031 IN_PROGRESS / BLOCKED, resume IMPLEMENTING; TASK026–030 DONE locally, TASK032–034 PENDING.

## Evidence and material gap

FR085 requires positive Adjustment to respect expiry and not become the default Receipt bypass. FR-LOT-007 restricts insufficient Receipt life override to the Receiving-specific evidence/permission and prohibits expired Receipt override. Existing Receipt #minimumLifeEvidence rejects expired Lot and checks current Item minimumReceiptLifeDays; the override is not available to Adjustment. Canonical text does not explicitly decide whether these positive-correction restrictions apply equally to AVAILABLE, QUARANTINED and DAMAGED, or distinguish nonsaleable discovered stock.

Design §3.2 uses APP_TIME_ZONE local date: expiry before today is expired, expiry today is not expired (but may still fail minimum life). Tracking none has no expiry; batch expiry is optional; batch_expiry expiry is mandatory. Do not make expiry mandatory for batch or override current tracking based on this choice. Shared isInventoryLotExpired/meetsMinimumRemainingLife and Item-owned profile already exist; no new configurable threshold or auth capability is required.

## A — recommended conservative positive-IN rule for every status

Every positive Adjustment, whether new/existing Lot or Bucket and regardless of destination status, rejects expired Lot and requires the SKU's current minimumReceiptLifeDays when applicable to expiry data, with no Adjustment expiry override. none and optional no-expiry batch retain current tracking semantics. Verify the current Item profile and local date at submission after blocking locks, not solely a pre-lock/handler snapshot; expiry/threshold failure rolls back all effects including a newly created Lot/Bucket.

Benefit: one rule closely aligned with the existing Receipt guard, no new correction exception or permission. Cost: a genuinely discovered expired or below-minimum-life batch cannot be added through this positive Adjustment even into QUARANTINED/DAMAGED. Do not fabricate a Receipt, silently change its expiry, add quantity via another operation, or call an unimplemented future Stocktake route as a workaround.

## B — separate physical correction from saleable IN

Positive IN to AVAILABLE follows A's unexpired/current minimumReceiptLifeDays/no-override rule. Positive IN to QUARANTINED or DAMAGED may record actually discovered expired or below-receipt-life stock under the existing high-risk correction authority, required source/reason, immutable Lot and atomic Audit. Those statuses remain ineligible for normal Reservation/Allocation/Issue. This is a new explicit correction exception to document/review/test, not use of receiving.expiry.override and not a normal Receipt alternative.

Benefit: records real nonsaleable physical stock without misstating a Receipt or expiry. Cost: status-dependent business semantics and extra bypass/concurrency tests; subsequent Status Transfer eligibility must still obey existing expiry/minimum-sale-life rules. No automatic release, new approval workflow/permission, or forced ban on existing expired Status Transfer is implied.

## Boundaries / next safe action

Both options affect positive Adjustment only. Negative Adjustment may remove expired stock subject to free-quantity/Reservation/version rules; Status Transfer does not change total quantity or Lot identity. FR088 explicitly says expired Lot remains nonsaleable even if its status becomes AVAILABLE, so do not silently forbid that existing transition or apply Receipt-life rules to every Status operation. Lot dates remain immutable; no old-date backfill/reset. Exact FIFO first-receipt-date semantics, reason limits and response/error/schema still need the precise candidate.

Recommend A as the narrower initial rule consistent with the no-default-Receipt-bypass requirement; B is a viable explicitly reviewed business exception if recording nonsaleable discoveries here is required. Harness major-impact gate pauses affected canonical/source writes until actual Sam choice. API design skill separated an IN acceptance policy from unchanged status eligibility. Direction choice is not independent approval of unseen DESIGN/PLAN/source; obtain exact candidate review before implementation.

HEAD `869ac07abdd3879254c351d857be911d71e68b6b`, source `fe3130fef55c9ec8cc71b2edf872a8a2076b5332581749ee281b211de38f2bc2`, DESIGN `46841dae185fab06e626fca722d1576726702a3d7183fdbb2f23e3459de7f663`, PLAN `8ab85d87051f437b74c6cfb4efc39ba93c8c2dd9e56ca7ea210d7bc5bc705dc8` and160 native refs/failures unchanged. No TASK031 tests executed, old PASS is not new proof; no canonical/product/test/shared-auth/UI writes, DB/runtime, new DDL/permission/dependency, commit/push/PR/remoteCI/merge/main adoption, TASK032+ or formal/release/capacity/floor waiver.
