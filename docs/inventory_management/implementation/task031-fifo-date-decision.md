# TASK-031 — first-receipt/FIFO date for new Adjustment Lot / HD119

## Current disposition — actual Sam A; HD119 ANSWERED

Actual latest Sam 「A」 selects A, APR158: a Lot first created by positive Adjustment gets the server submission APP_TIME_ZONE local date, documented as first system-recognized Adjustment IN, not proof of an earlier physical Receipt. No caller first-receipt/backdating field; existing Lot date and original replay result stay unchanged. Approved no-Lot anchor and FIFO/FEFO/life/status/Reservation rules unchanged. Direction/proposal preparation only, not unseen DESIGN/PLAN/source approval. Exact contract discovery found [HTTP replay/fingerprint gap HD120](task031-http-replay-decision.md); no source/canonical writes before that choice and independent candidate review. Source/spec/head/160 refs unchanged, TASK031 IN_PROGRESS / BLOCKED.

## Historical discovery — before HD119 answer

Status: DECISION_REQUIRED. HD118 actual Sam A / APR157 sets OTHER >=10 non-whitespace Unicode code points with500-byte ceiling. HD115 already permits controlled new-Lot creation in positive Adjustment; it did not settle the date. TASK031 IN_PROGRESS / BLOCKED, resume IMPLEMENTING; TASK026–030 DONE locally, TASK032–034 PENDING.

## Evidence and business impact

Design §4.5 defines nonnull Lot first_receipt_date as first formal Receipt/Opening APP_TIME_ZONE date, but a new Lot introduced by approved Adjustment may have neither event. §3.5 and actual InventoryPickSequenceService use this date as the main no-expiry-Lot FIFO key and a FEFO tie-breaker. Receipt #resolveLot inserts its server currentDate, preserving an existing row via unique SKU+normalized Lot, and does not accept a client first-receipt date. Choosing an Adjustment date therefore affects allocation priority and data meaning, not merely formatting.

## A — recommended: first system posting date, no backdating input

For a Lot first created by positive Adjustment, set first_receipt_date to the server's submission APP_TIME_ZONE local date, determined at the guarded posting point after blocking locks. Document that this special case is first system-recognized IN through Adjustment, not evidence of a historical physical Receipt; keep movement_type ADJUSTMENT and source/reason provenance. No new caller date field, schema/table, chronological layer or extra permission. Existing Lot date never changes for quantity correction, new location/status Bucket, concurrent resolve-to-existing, negative removal or Status Transfer. Replay retains the original result/date, never resets to retry day.

Benefit: minimal extension of the existing server-owned date pattern, caller cannot change FIFO priority through a fabricated date. Cost: physically older stock discovered today does not automatically move ahead of recorded older no-expiry Lots; existing explicitly authorized FIFO deviation with reason remains available, no new bypass granted. Precise date/provenance result/Audit fields and guards require exact candidate review, not claimed implemented.

## B — allow declared historical first-receipt date for a new Lot

Positive Adjustment may provide an actual historical arrival date for a newly introduced Lot, validated as an existing supported DATE not in the future, bound to the normalized business payload/source and required correction explanation, recorded with its declared provenance in immutable evidence. Missing date can use server date; an existing Lot cannot be backfilled/reordered. High-risk auth/inventory.adjust remains; no new approval workflow is presumed. Date syntax/range checks cannot prove that the claimed historical event is true; human business review remains responsible.

Benefit: permits FIFO reflecting genuinely older discovered stock. Cost: a new public input and trusted-business assertion can alter picking priority; provenance/forgery/replay/concurrent-new-Lot consistency and exact Audit projection require broader review/tests. Existing Receipt/Opening and other Lot dates are not rewritten, and no historical Receipt event is fabricated. Explicit accepted date/absent-field semantics must be defined in the candidate if selected.

## Unchanged anchor semantics / next safe action

Neither option changes no-Lot fifo_anchor_date: zero->positive sets server current posting local date, positive->positive keeps it, resulting zero clears it, following already-approved §3.5. Neither changes FEFO expiry priority, life/status/Reservation rules or historical Lot identity. HD119 concerns newly created Lot's date only, not a client-controlled per-Bucket FIFO date or retrospective ledger edit.

Recommend A, the narrow server-owned policy. Harness major-impact gate holds affected canonical/source writes until actual Sam choice. API design skill exposed the optional historical input's downstream effect rather than adding it speculatively. After choice assemble the exact contract/test/scope candidate and present remaining material gaps if found; actual independent Sam baseline approval still precedes implementation, not supplied by direction choices alone.

HEAD `869ac07abdd3879254c351d857be911d71e68b6b`, source `fe3130fef55c9ec8cc71b2edf872a8a2076b5332581749ee281b211de38f2bc2`, DESIGN `46841dae185fab06e626fca722d1576726702a3d7183fdbb2f23e3459de7f663`, PLAN `8ab85d87051f437b74c6cfb4efc39ba93c8c2dd9e56ca7ea210d7bc5bc705dc8`, original0064 and160 refs/failure history unchanged. No TASK031 tests executed; only reports/state updated, no canonical/product/test/shared-auth/UI changes, runtime/DB/DDL/permission/dependency, staging/commit/push/PR/remoteCI/merge/main adoption, TASK032+ or formal/release/capacity/floor waiver.
