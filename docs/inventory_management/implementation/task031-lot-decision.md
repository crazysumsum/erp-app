# TASK-031 — new Lot during positive Adjustment / HD115

## Current disposition — actual Sam A; HD115 ANSWERED

Actual latest Sam 「A」 selects controlled new-Lot creation for genuine positive corrections, APR154. Resolve/create by normalized SKU/Lot in the same Adjustment/Balance/Movement/Operation/Audit transaction; policy-required lot/date input, exact existing immutable-date consistency, no null backfill or Lot edit, concurrent conflicts revalidated and no partial effects. Negative/Status remain existing-source operations without new Lot identity. This does not grant Receipt override or settle expiry/FIFO-date/precise-schema details; direction and proposal preparation only, not independent approval of a new candidate. [Next positive expiry decision HD116](task031-expiry-decision.md). Source/spec/head/160 native refs unchanged; TASK031 IN_PROGRESS / BLOCKED, no product/test/runtime/publication changes.

## Historical discovery — before HD115 answer

Status: DECISION_REQUIRED. HD112–114 actual Sam A / APR151–153 select single operations, Inventory-local trusted strong auth and differentiated target identities. TASK031 IN_PROGRESS / BLOCKED, resume IMPLEMENTING; TASK026–030 DONE locally, TASK032–034 PENDING.

## Evidence and material gap

FR083–085 (legacy FR-ADJUST-002–004) require complete target, Tracking Policy/Lot consistency/Bin/expiry rules and forbid Adjustment becoming the default Receipt bypass. Positive target dimensions allow an absent Bucket (HD114), but absent Bucket and absent Lot are different: an existing Lot may simply have no balance at this location/status. No canonical text explicitly settles whether positive Adjustment can create the SKU/Lot identity itself.

Design §3.2: none forbids Lot/Expiry/Manufacture; batch requires Lot with optional expiry; batch_expiry requires Lot+expiry; serial rejects. Lot identity cannot be ordinarily edited. §4.5 rejects expiry/manufacture differences and null backfills for an existing Lot. Actual Receipt #resolveLot creates/re-reads by unique SKU+normalized Lot under the existing lock protocol, sets a first-receipt date and checks exact immutable consistency. Existing validateInventoryLotInput/assertInventoryLotConsistency can be reused, not a new master-data service. This inspection does not authorize exposing the private Receipt writer or using RECEIPT movements for Adjustment.

## A — recommended: allow controlled new-Lot creation in positive Adjustment

A real authorized positive correction may provide a previously unknown lot number and policy-required dates. Server resolves existing normalized SKU/Lot or creates that Lot in the same posting transaction as Balance/ADJUSTMENT Movement/Operation/Audit. Existing Lot immutable dates must match exactly; no null backfill, mutation or replacement. Concurrent same-Lot creation must resolve the unique identity and revalidate supplied dates; inconsistent candidates reject without partial effects. Negative Adjustment and Status Transfer remain existing-source-ID operations and never create/alter Lot identity.

Benefit: a genuinely discovered unrecorded batch can be corrected without inventing a Receipt event or a standalone Lot CRUD route. Cost: this high-risk correction can introduce Lot master data, so provenance/reason/strong auth and atomic rollback must cover that effect. It is not the normal Receipt workflow and gains no receiving-expiry override. No new permission/table/dependency is needed. Exact public Lot fields, FIFO first-receipt-date semantics and positive Adjustment receipt-life/expired handling remain precise candidate decisions, not silently chosen by A; inherited tracking/immutability and existing Status expired-sale exclusion cannot be weakened.

## B — existing Lots only

Positive Adjustment for batch/batch_expiry must reference a Lot already created through an authorized existing workflow. It may create a new Bucket for that Lot, but rejects unknown Lot identity. Benefit: smaller write scope; Adjustment cannot create master data. Cost: a legitimate discovered previously unrecorded batch cannot be recorded by this Adjustment endpoint alone; it remains blocked until a genuine authorized process establishes the Lot. Do not fabricate a Receipt just to work around that restriction. No speculative Lot CRUD route is included. none policy still supports a new no-Lot Bucket in either option.

## Decision / next safe action

Recommend A for legitimate positive corrections with existing tracking/immutable rules and all-or-nothing provenance. Until actual Sam choice, Harness major-impact gate holds affected canonical/source writes. API skill separated new Bucket from new Lot instead of implicitly treating HD114 as approval of both. Resolve remaining consequential expiry/reason details one at a time, then obtain exact candidate independent Sam review before implementation. No TASK031 developer or formal checks were run; earlier PASS is not TASK031 proof.

HEAD `869ac07abdd3879254c351d857be911d71e68b6b`, source `fe3130fef55c9ec8cc71b2edf872a8a2076b5332581749ee281b211de38f2bc2`, DESIGN `46841dae185fab06e626fca722d1576726702a3d7183fdbb2f23e3459de7f663`, PLAN `8ab85d87051f437b74c6cfb4efc39ba93c8c2dd9e56ca7ea210d7bc5bc705dc8`, all160 native refs/failure history and original0064 remain unchanged. No new canonical baselines, product/test/shared-auth/UI writes, DB/runtime, staging/commit/push/PR/remoteCI/merge/main adoption, TASK032+ or formal acceptance/release/capacity/floor waiver.
