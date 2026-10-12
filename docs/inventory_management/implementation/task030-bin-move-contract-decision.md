# TASK-030 — HD107 Bin Move contract decision

Current status: HD107 A/HD108 exact candidate approval ANSWERED; actual Sam approval adopted DESIGN3df1df58/PLAN64ce9971 and original0064 scope. [Domain increment and HD109 decision](task030-domain-checkpoint.md) supersede the checkpoint below, retained for provenance.

## Historical checkpoint before HD108 approval

Status: HD107 ANSWERED_A. Sam's actual latest active reply `A` selects this direction; [HD108 exact candidate](task030-bin-move-proposal.md) is prepared and awaits independent hash-bound DESIGN/PLAN approval. No canonical or product implementation changes have been applied. The original proposal is preserved below.

Sam's 2026-10-07 actual request to continue the next task authorizes local TASK030 discovery and implementation within the existing approved plan. TASK029 remains DONE after actual Sam review; the next-task request does not settle new public contract/concurrency semantics.

Baseline: HEAD `869ac07abdd3879254c351d857be911d71e68b6b`; source `686578e6e2d8ee67f0e49d6d33080e6d0a31d2c4b230485288fa3ddc1a250338`; DESIGN `de32a25f52faeddc65234963935f44a4e73a6a505f44f52dca2283f5e6913f93`; PLAN `41949846cafde277c6887a7b572e0b3f945425d9a16f1b96517d99ca1674617c`. Existing P3 worktree and uncommitted work are preserved.

## Evidence and material gap

[Requirements FR-MOVE-001–007 / FR-063–069](../01_requirement_spec.md) require same-Warehouse atomic movement, unchanged SKU/Lot/Expiry/Status, free stock/Reserved protection, Counting guards, version and audit. [TASK030 / legacy P3-T05](../05_development_tasks.md) includes service/handler/integration and concurrency verification. [Design §5.4](../03_design_spec.md) fixes `POST /api/v1/inventory/bin-moves`, JWT plus `inventory.view` and `inventory.operation`, but defines neither its payload nor which Balances must carry expected versions. [TC006](../06_technical_test_cases.md) explicitly says “Multi-line same-Warehouse moves”. A single-line-only interpretation would not cover that approved test intent.

Existing Posting/Transfer services, Operation source-tuple uniqueness/replay and sorted Bucket locks can be reused. No Bin Move implementation currently exists. No new schema, permissions, library, generic movement framework or frontend expansion is proposed.

## A — recommended contract

One document with `source`, `warehouseId`, optional `reason`, and 1–100 `lines`. Each line supplies `sourceBalanceId`, `destinationBinId`, positive integer Base-UOM `quantity`, `expectedSourceVersion`, and `expectedDestinationVersion`. An existing destination uses its positive version; explicit `null` means the destination Bucket was expected to be absent, not that the version guard is disabled. Actor comes from authenticated framework context, not request-body claims.

Derive SKU/Lot/Expiry/Status/Base UOM from the source Balance and Item-owned profile; caller cannot replace those dimensions. All Bins must be Active and in the same Warehouse. Lock and revalidate the complete set, combine shared-Bucket outgoing demand, do not use this document's incoming quantity to fund outgoing quantity, and never move allocated stock. Repeated references to one Bucket must agree on expected versions. Preserve Reserved and same-Warehouse eligibility; every required lock or validation failure rolls back the whole transaction.

Use one Operation and movement group, with paired OUT/IN legs per line. Same source and canonical payload return the original immutable result after fresh authorization; changed payload conflicts. Required Balance/Movement/Audit/Operation effects are all-or-none.

Benefit: meets the existing multi-line intent, preserves quantities and explicit optimistic concurrency. Cost: clients must read destination Bucket state; an otherwise safe additive move conflicts if that destination changes concurrently and must be refreshed. Existing absent destinations may still be created atomically.

## B — smaller single-line contract

One move per request; check only the source expected version and add to the destination under its transaction lock. Simpler input and fewer destination refresh conflicts, but no atomic multi-line document; TC006/design scope must be explicitly revised and approved. It is not an automatically permitted simplification of A.

## Default and next gate

Historical default before Sam's reply: no option was selected while HD107 was OPEN. Sam has now selected A; HD108 holds affected source/test writes until actual exact-candidate approval. Old evidence and approvals remain preserved, not relabelled.

Only decision documentation and state were changed. No new tests ran;140 native historical evidence refs remain. Product source, current design/plan and original0064 bytes are unchanged. No commit/push/PR/remote CI/merge, new main adoption, formal TC/UAT, release, capacity waiver or TASK031+ execution occurred.
