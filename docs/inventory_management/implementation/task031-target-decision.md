# TASK-031 — Bucket target identification / HD114

## Current disposition — actual Sam A; HD114 ANSWERED

Sam actual latest 「A」 on2026-10-07 selects A, APR153: positive Adjustment complete target dimensions; negative Adjustment existing Balance ID; Status Transfer source Balance ID plus different destination status, server derives the other dimensions. Existing Bucket/source versions are mandatory positive values; positive target/Status destination explicitly declares positive existing version or null expected absent, never an omitted/no-check guard. Direction only, not approval of unseen precise schemas/new-Lot creation or a new DESIGN/PLAN/source baseline. [Next Lot creation decision HD115](task031-lot-decision.md). TASK031 IN_PROGRESS / BLOCKED, source/spec/head/160 native refs unchanged; only reports/state updated.

## Historical discovery — before HD114 answer

Status: DECISION_REQUIRED. HD112 single operation and HD113 Inventory-local trusted strong-auth context selected by actual Sam A / APR151–152. TASK031 IN_PROGRESS, module BLOCKED / resume IMPLEMENTING; TASK026–030 DONE, TASK032–034 PENDING. No TASK031 implementation/tests or runtime effects.

## Evidence and question

Design §5.4 lists Adjustment direction/reason/source/version and Status Transfer same Warehouse/Bin/SKU/Lot with reason/versions, but does not define precise target inputs. FR083–088 require complete Bucket identity, free-quantity/Reservation protection, tracking/Lot/expiry consistency and atomic paired status movements. An existing Balance ID identifies Warehouse/Bin/SKU/Lot/status; a new positive-adjustment Bucket has no ID yet. Choosing input identity now affects public clients, validation and optimistic concurrency, so it cannot be silently inferred.

Actual existing Issue uses balanceId/version. TASK030 Bin Move uses sourceBalanceId, destination Bin and source/expected-destination versions, derives remaining dimensions from the locked source, and distinguishes explicit null expected-absent from omitted/unchecked. Stock query already exposes balanceId and version. These are reusable conventions, not already-approved TASK031 request schemas. Requirements are in `01_requirement_spec.md`, design in `03_design_spec.md`; actual implementations inspected in InventoryPostingService.js and inventoryBinMovePosting.js.

## A — recommended: identify existing targets by ID, new positive targets by dimensions

Positive Adjustment provides Warehouse/Bin/SKU/Lot reference as applicable/status, because it may target an existing or absent Bucket. Negative Adjustment provides existing Balance ID; server derives its immutable dimensions/status, not additional caller selectors. Status Transfer provides source Balance ID plus a different destination status; server derives identical Warehouse/Bin/SKU/Lot for both legs. All still have explicit positive quantity, approved source/reason/strong auth and Base UOM declaration.

Existing affected Buckets require positive expected versions. Positive target and Status destination require explicit expected positive version for existing Bucket or null meaning expected absent; omitted/null-as-bypass rejects. Presence/version is checked by current locking read under existing Warehouse/SKU control before writes, so a concurrent first creator conflicts rather than silently retargeting. Negative/Status source cannot use null. These semantics reuse TASK030 guards without accepting batch commands.

Benefit: existing-target requests do not repeat authoritative dimensions or create multiple competing selectors; Status cannot request unrelated Warehouse/Bin/SKU/Lot. Cost: positive and negative Adjustment have distinct input variants. This decision fixes target model/version-guard direction only; exact field names/schema/response, new-Lot permission/creation/expiry semantics and detailed error behavior still require the precise candidate and actual independent review. No implicit new-Lot creation or Pack UOM policy chosen here.

## B — uniform complete dimensions for every target

All three operations provide complete Warehouse/Bin/SKU/Lot/status dimensions; Status supplies source dimensions plus destination status. Server resolves existing negative/Status source, validates ownership and tracking, and applies the same mandatory positive/explicit-null version guards and stock/reservation/auth protections. Benefit: one target structure for clients. Cost: clients repeat data already held by existing Balance and server needs more dimension/ownership validation; no security weakening is proposed. No simultaneous ID+dimensions dual-selector fallback is added.

## Decision and next safe action

Recommend A: use actual existing IDs where possible, dimensions only where a new target is needed. Until actual Sam choice, hold affected source/canonical contract writes; read/proposal preparation only. Choice is direction, not unseen DESIGN/PLAN/source approval. After choice resolve remaining consequential Lot/reason/result details one at a time, then produce exact candidate for Sam review before implementation. Harness major-impact gate causes this pause; API design skill kept a single authoritative selector per input and explicit absence/version semantics.

HEAD `869ac07abdd3879254c351d857be911d71e68b6b`, source `fe3130fef55c9ec8cc71b2edf872a8a2076b5332581749ee281b211de38f2bc2`, DESIGN `46841dae185fab06e626fca722d1576726702a3d7183fdbb2f23e3459de7f663`, PLAN `8ab85d87051f437b74c6cfb4efc39ba93c8c2dd9e56ca7ea210d7bc5bc705dc8` unchanged. All160 evidence references/failures, original0064, canonical profile/requirements/design/tasks/tests/UAT/ledger/matrix unchanged. Old developer checks are not TASK031 evidence. No new DDL/permission/dependency/shared auth/config/UI/TASK033, runtime/DB execution, staging/commit/push/PR/remoteCI/merge/main adoption/formal acceptance/release/capacity/floor waiver. Actual independent reviewer remains Sam.
