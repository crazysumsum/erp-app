# TASK-030 — HD108 exact Bin Move DESIGN / PLAN review

Current status: ADOPTED by actual Sam 「批准」 on2026-10-07, HUMAN REV085/APR138–142; exact five-file patch and unchanged0064 scope reconciled, adopted PLAN_READY passed. [Current domain increment and HD109 blocker](task030-domain-checkpoint.md). Original proposal/frozen identities below are historical, not current implementation proof.

## Historical proposal before HD108 approval

Status: PROPOSED_NOT_APPLIED. Sam's actual `A` answers HD107 and selects the multi-line/source-destination-version direction. It is not approval of this subsequently prepared exact candidate or a future implementation review.

## Review scope

[Exact five-file patch](task030-bin-move-proposal.patch) updates Design §5.4.1 / DES005, legacy P3-T05 / TASK030, TC006's eight NOT_RUN scenario groups, related UAT057/059 and the manifest's provided Design contract pin. [Metadata](task030-bin-move-proposal.json) records every before/after file SHA256. Canonical files have not been changed and no second canonical specification is introduced.

The API remains `POST /api/v1/inventory/bin-moves`, JWT plus inventory.view/operation. Body is `{source,warehouseId,reason?,lines}` with 1–100 lines, each `{sourceBalanceId,destinationBinId,quantity,expectedSourceVersion,expectedDestinationVersion}`. Positive safe-integer IDs/versions and Base-UOM quantities only; destination version must be positive for an existing Bucket or explicit null for an expected absent Bucket. Server derives SKU/Lot/Expiry/Status/Base UOM and authenticated actor; dimensions cannot be supplied as overrides.

Whole-document starting versions are checked under existing sorted locks. Shared-Bucket gross OUT cannot exceed original free stock or use incoming stock to fund outgoing stock; references must agree on versions and sums cannot overflow. Every line has paired BIN_MOVE legs under one Operation/group; Balance/Movement/Audit/completion failures roll back all lines and new zero Buckets. Domain replay requires fresh authorization and returns the original scalar result; changed payload, including line order, conflicts. Result is the existing success envelope with `{status:"POSTED",operationId,movementGroupId,lineCount}`.

The candidate clarifies conservation rather than adding a Reservation prerequisite: a legal same-Warehouse move does not change Reserved/Allocation or eligible stock and does not increase existing uncoveredReserved. Natural expiry's already-uncovered quantity is not automatically fixed or used to block an otherwise conserving move. Existing FIFO/expiry/Item qualification policies remain in force. Concurrent destination changes require refresh even when addition would otherwise be safe.

No new schema, permission, dependency, Item source, auth framework, generic movement engine or TASK033 frontend is proposed. Existing commands, minimum discovery/zero-skip,34 coverage floors, CI/review, capacity and future full-P3 gates are unchanged. The eight planned scenario groups cover conservation, strict input, ownership/locks, shared stock, Reserved/expiry, replay/auth, races and rollback; they are plans, not execution evidence. Stocktake signal injection must be labelled and cannot prove the future P4 persistent workflow.

## Exact candidate

- Frozen HEAD: `869ac07abdd3879254c351d857be911d71e68b6b`
- Source unchanged: `686578e6e2d8ee67f0e49d6d33080e6d0a31d2c4b230485288fa3ddc1a250338`
- Active DESIGN: `de32a25f52faeddc65234963935f44a4e73a6a505f44f52dca2283f5e6913f93`
- Active PLAN: `41949846cafde277c6887a7b572e0b3f945425d9a16f1b96517d99ca1674617c`
- Candidate DESIGN: `3df1df58f07bf46a6cbf0ef5135941cb70293822f8043fdca496d9fc1a36cf2c`
- Candidate PLAN: `64ce9971e8f4e9a6170f1c792be23ce7836e3719717985cbd282c335c6bd38f8`
- Patch SHA256: `c8f7b48740b138d0d72dbd673a0f9e5979df1788da82fc14167beaf862c1ec74`

The unchanged existing `server/database/migrations/0064_create_inventory_transfers.js` SHA256 is `07653bb700a40b026e8bb46b538e0e31b112d6c20010af45b4cc71a6ff7ac143`. Request current-PLAN reconfirmation of that existing path's scope and its existing isolated developer migration usage; no DDL edit, new migration, shared/production database or broader data authority is requested. This prevents treating its old-PLAN scope approval as a new-PLAN grant.

## Validation and actual review

Candidate traceability STRUCTURE_PASS with0 issues; generated matrix byte-identical; all five file SHA256 values match a patch replay in a separate fresh owned temporary copy. Requirements/profile/ledger/matrix and consumed Item contract are unchanged; the provided contract pin matches the candidate Design bytes. Active observed state and source remain unchanged. An auxiliary attempt to check candidate boundary with the active repo root was refused by Context's worktree identity guard; it wrote nothing and is not a PASS result. Full observed boundary/PLAN_READY must be rechecked after actual adoption.

Codex SELF_REVIEW checked correctness, minimum existing-service reuse, ownership/auth, double-version/null semantics, shared-stock conservation, scalar replay and rollback obligations, bounded input and honest NOT_RUN coverage. No blocking proposal finding identified; this is not independent Sam review or a product test.140 native evidence refs and original failures are retained and will not be relabelled to this new PLAN. No API/DB/UI/product tests or CI ran in this proposal step. TASK030 remains IN_PROGRESS, P3 incomplete; formal TC/UAT, business/release and capacity results are unchanged.

## Decision Required — HD108

Sam reviews the exact patch and independently approves this candidate DESIGN/PLAN, unchanged0064 scope rebind and local TASK030 implementation/developer verification; or requests specific amendments. Recommend approval because it implements the selected A using existing ownership, transactions and commands without lowering the bar. Default: do not apply canonical changes or implement the new contract before actual approval.

Approval would allow only this five-file application, baseline reconciliation/local gates and TASK030 service/handler/tests with owned local synthetic resources and precise cleanup. It does not authorize commit/push/PR/remoteCI/merge/new-main adoption, TASK031+ work, a future source/head's independent approval, formal TC/UAT/business/release acceptance or a capacity waiver. Publication remains a separate current-candidate gate.
