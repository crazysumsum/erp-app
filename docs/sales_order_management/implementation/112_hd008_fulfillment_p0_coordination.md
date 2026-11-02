# HD-008 — Sales P4 / Fulfillment P0 ownership coordination

Status: HD008 ownership and actual HD009 A1 prerequisite contribution approved; Sales acknowledges the single numbered handoff below. Overlapping owner source remains preserved for P0 adaptation; no new product/Phase acceptance or live migration is claimed.

## Actual authority and observed baseline

On 2026-10-20 Sales read the actual direct Sam userMessage in `fulfillment and shipping` chat `01a15862-9933-7e50-8e10-4015cf35d078`: **A：協調 Sales P4，依已批准 P0 規則繼續（建議）**. The question expressly selected the approved Fulfillment P0 as active schema/quantity/lifecycle authority, retained reusable Sales Archive work, and required unique ownership and migration order before further overlapping writes. The coordinator was authorized to send that direction to this Sales chat. Sales has not inferred separate outbound messaging authority from receiving it.

Observed origin/main: `76223f40480d94a1d3a2ae6e0e7b91292bd98b82`, including merged planning PR256. It is not yet integrated into this P4 branch: both streams changed Fulfillment canonical documents/state and require provenance-preserving reconciliation. The prior integrated main is35af2ab7 through11c88e0a; no blind merge occurred.

P0 worktree `/private/tmp/erp-fulfillment-p0`, branch `codex/fulfillment-p0-foundation`; observed P0 state revision17, IMPLEMENT/PHASE001/TASK001. Approved P0 DESIGN `feef0869d0d3d1814ce5ab9a08e885ef84c49e578bfbf24269ff106b0aa69ce8`, PLAN `a229fd571382e42dbc0e88c896bd06aeed12bf4e5e3b4622a58bc69197aead38`. Owner source is its Design3.3 and implementation/00_implementation_readiness.md HD008; no writes were made to that worktree.

Prior DEC029 remains genuine historical dual-owner approval of proposal107 SHA83cffc9f and the narrow Sales-governed contribution; it is not rewritten or treated as authority to overrule the newer P0 quantity rules or allocate duplicate migrations. Historical R4 Sales DESIGN ef5e7624/PLAN b791cec4 and owner contribution history are preserved. Current affected qualification requires reconciliation/retest.

## Preserved implementation and evidence

- `d01162f6159ec40981453d00936fb713296f35a3`: real12 Active/12 Archive schemas, nativeFKs/constraints/triggers/routing and tests. Native focused95PASS/0FAIL/0SKIP and actual separate R2 d1da5560 were against the then-approved specification. They do **not** prove the newer P0 cumulative allocation/full-short-picked-line semantics.
- `fdd93a50`: recoverable WIP OpenMatter prototype, its adapter,18 unit and21 native cases (39PASS/0FAIL/0SKIP). It has real RequestContext/MySqlDatabaseService executor binding, actual application default service discovery, full blocked Sales cancellation rollback, six OPEN reasons, schema/version UNKNOWN, current RR reads, competing Sales-root locks and22 captured real-query EXPLAIN assertions. Direct-service application fixture supplies an empty HTTP handler registry so unrelated Supplier bank handlers do not require crypto configuration; this is not HTTP/UI acceptance. No independent source review has signed TASK066.
- Hash model `fulfillmentArchiveSchema.js` and its18 tests support cumulative integer quantities without a planned-quantity clamp. The filename `fulfillmentArchiveParticipant.test.js` currently contains hash tests only; **no real participant class exists yet**.
- Private immutable handoff copy: `phase4-private/hd008-p0-handoff-20261020/receipt.json`, SHA `9f3bef53f239447751f76edb729412eef3d56a45c900cbe5829a2152f2694a73`;13 explicit source/test/migration files and the original tracked WIP patch. Original failures, R1/R2 reviews, state proposals and native logs remain retained. No credentials/raw evidence were committed or exported.

## Semantic deltas that must be fixed by the active owner

1. Current `chk_ful_line_quantity` includes `allocated_base_quantity <= planned_base_quantity`; P0 permits cumulative historical allocated/released amounts above planned after reallocation. Removing that clamp also requires independently preserving `picked <= planned`, `short <= planned`, shipped membership `{0,picked}` and reversed membership `{0,shipped}`. Parent-state and allocation SUM equalities need native integration under the fixed parent lock; there is no invented Line release column.
2. OpenMatter prototype currently treats a SHIPPED Line with picked=0, and a REVERSED Line with shipped=0, as inconsistent. New P0 explicitly permits a fully short-picked Line within an aggregate whose total picked is positive. Its CLOSED/inconsistency rules must use the new parent-state and cumulative release equations; existing39PASS cannot qualify these rules.
3. Owner P0 must have one actual `fulfillmentOpenMatter` service registration, not duplicate auto-discovered adapters. Prototype `FulfillmentOpenMatterRuntimeService.js` is reusable scaffolding only until the owner accepts its semantics, source path and dependency/version contract.
4. The prototype hard-codes the withdrawn0091–0093 migration identities. P0 must replace this check with the actual agreed version/schema installation probe; old prototype version PASS is not evidence for new0091–0099.
5. Contract10 exact Archive ABI was approved by DEC029 but is not present in PR256's planning baseline. P0 owner must explicitly reconcile rather than silently overwrite its provenance, guards, null-EXPORT routing, full12 mirror/hash manifest and same-transaction participant requirements. Sales Archive remains fail-closed until that real contract/provider is ready.

## Migration inventory and installation facts

| Number | Existing Sales branch file | Current ownership / status |
| --- | --- | --- |
|0088|create_sales_archive_batches.js|Sales-owned batch and permanent order manifests; unpublished P4 contribution; owner mirrors reference this table.|
|0089|create_sales_archive_tables.js|Sales-owned six full original-ID mirrors; unpublished P4.|
|0090|create_sales_export_jobs.js|Sales-owned Export persistence; unchanged original0087 body SHA8923fbd0, renumbered to resolve already merged Supplier0087. Old logical0087 ledger/data compatibility actually tested.|
|0091|create_fulfillment_archive_prerequisites.js|Existing unmerged owner contribution; do not independently reuse this prefix until handoff/forward order agreed.|
|0092|create_fulfillment_archive_mirrors.js|Existing unmerged owner contribution; same restriction.|
|0093|protect_fulfillment_archive_contracts.js|Existing unmerged owner contribution; same restriction.|

Fresh origin/main highest applied-source prefix remains0087. This report **does not allocate0094+**, reserve a distributed number lease, or ask another agent to copy unreviewed tables into a live schema. Existing0091–0093 have executed only in self-created per-case UUID databases, which the fixtures clean; they are not deployed/applied on production/shared/oldP4 or the persistent new core/focused schemas. Thus their unpublished split/names may be reconciled without changing a deployed migration; preserve all historical evidence and never relabel old0091 results as a newly numbered migration PASS.

The new owned socket-only MySQL26.7 instance remains available with nice10 and only synthetic data. Persistent core/focused had91 framework+through0090 ledger records at the confirmed preparation receipt; no P0 runtime access/credentials or SQL grant is transferred by this document. Live deployment/cutover and full owner business-writer activation remain separately unauthorized.

## Historical proposed handoff — resolved by the actual HD009 agreement below

1. Fulfillment P0 becomes sole final writer/reviewer for active schema, quantity/operation invariants and minimum lifecycle provider. It may adapt the preserved source/tests only after its approved Checkpoint0B and exact compatibility review; it must not count this Sales95PASS as completing its own45 tasks/Checkpoints.
2. Sales retains its six-table copy/hash/coordinator and participant/consumer adaptation work. The real participant continues as an explicitly named Fulfillment-owned contribution, with one accepted ABI and fixed transaction authority; no fabricated CLOSED or bearer actor payload.
3. Resolve a real predecessor issue before allocating numbers: P0 TASK010 includes owner Archive mirrors, whose FK references **Sales0088 batch/manifest tables absent from main**. A strict 'P0 first, complete P4 later' sequence otherwise leaves a cycle. The smallest candidate is to accept only the required Sales0088 batch/manifest foundation as a named Sales-owned contribution in the complete P0 PR, with its actual native acceptance/owner review and explicit scope/trace/merge-policy disposition; keep unrelated0089/0090 and full P4 delivery in Sales. This is a proposal, **not approval to split the existing P4 merge group or cherry-pick it now**. If existing HD008 scope/merge authority does not cover that exact prerequisite contribution, present this concrete supplement to Sam once, retaining all original Gates. An alternative is a genuinely joint complete P0+P4 candidate, but it requires a separately reviewed feasible Gate/baseline design before it can be offered as executable: the installed fingerprint excludes only the selected module documents, so changing either other canonical state can invalidate the other qualification, and a stacked P0 branch is not the approved DEFAULT main-only path. No existing dual-Gate adapter or baseline exception is assumed. It is larger and keeps coupled delivery.
4. After that decision/agreement, choose the exact complete forward migration inventory once from fresh main; map existing0088–0093 source identities/content to final ownership and order, including P0's eight logical slices. Do not execute or publish a duplicate number. Reconcile both authoritative document/state histories with an actual separate review; neither stream overwrites the other's state or rewrites old approvals/hashes.
5. Requalify cumulative allocation/reallocation, zero-picked Line states, real FK/constraint/immutable guards, normal/partial/rerun migrations, minimum lifecycle release/block/UNKNOWN, all original39+6 Sales suites, P0 requirements, current candidate CI and actual reviews. Observe unchanged required Gates before each authorized merge. No current P4 merge readiness is claimed.

Until unique assignment/contract/forward order is recorded, overlapping schema/provider edits and merges are paused. Safe work is read-only compatibility review, preserved handoff evidence and Sales-only independent preparation. This document is available for the authorized coordinator to read; no other worktree has been changed.

## Concrete Sales-side assignment clarification

Sales accepts the HD008 ownership direction: **0091–0093 are paused and will exit the final Sales P4 PR as independent owner-schema installers**. Fulfillment P0 is the single final author of the adjusted active/schema/protection/mirror and minimum lifecycle artifact. These three existing commits/files are preserved references for review/reuse, not a second install path and not approved P0 implementations. No second set of CREATE TABLE migrations may coexist to let both streams proceed. Exact replacement numbering remains unallocated until the coordinator records one complete inventory.

**0088–0090 remain Sales-owned identities.** 0089 and0090 remain in the later complete Sales P4 delivery. 0088 contains the predecessor batch/manifest schema actually required by owner mirror FKs; it is not silently donated, duplicated under another migration, deleted, or declared merged. Its narrow contribution/merge-policy disposition is the concrete remaining sequencing question described above. Until resolved, the coordinator can inventory/review/reconcile non-persistence foundation work but cannot claim its full TASK001 migration allocation or TASK010/Fulfillment P0 Gate has been satisfied.

Reusable paths: canonical12-column/hash module; schema/index/FK/trigger model and23 native cases as a changeable reference; real socket-only fixture and actual transaction/RequestContext test support; OpenMatter service/adapter/unit/native cases as a prototype requiring new cumulative/short-pick rules and owner review. The genuine archive participant is still to be implemented; no source file or PASS is being handed off for a nonexistent participant. Nothing grants P0 access to this private MySQL or transfers credentials.


## HD009 coordination observation

The authorized coordinator has now presented the precise predecessor supplement as **HD009** in the Fulfillment chat, with A1 (Sales-owned0088 two-table foundation as a named contribution in the complete P0 PR; all remaining P4 work and full Gates retained) versus a separately designed joint candidate. Sales read that actual current attention item using the app thread status. It was pending at that observation; the direct answer was subsequently verified below, so no duplicate question is required. Exact source file SHA is recorded below for owner review. HD008 alone does not approve this new delivery grouping, and the independent coordination review agrees.

`server/database/migrations/0088_create_sales_archive_batches.js` SHA256 `b6eeecb12fd08e3f4a6129c8448b1c9346c4f55ca73bda458653b93d7a410946`. Sales keeps data ownership and review responsibility; P0 may not silently extend the approved0088 identity/content or infer Sales P4 completion.


## Actual HD009 A1 approval and Sales acknowledgement

Sales independently read actual direct Sam userMessage `01a158a7-0436-7711-b27b-8e0784bb4b0f`, replying to `call_7195f5d208b1467bb2c40c5bd6d7e4f0`: **A1：批准兩表基礎切片納入完整 P0 PR（建議）**. Decision-time owner proposal SHA `babf2e13ff29f7f108b0473e8bafc8a44d571ab17143857eb38eeefdc60dcd95`; actual independent R7 is retained by the coordinator. Separate Sales impact review `a0d5da18` and actual-approval addendum `ecfb6c8f` preserve the earlier need-for-supplement reasoning and bind the later direct answer. HD008/HD009 are adopted; no further human decision is currently pending for this exact ownership/two-table delivery supplement.

**Sales ACKNOWLEDGES this one forward inventory** after fresh main76223f4, local-branch and registered-worktree inventory. The old Sales0091–0093 entries are withdrawn future installers, retained only as immutable Git/private evidence references. Fulfillment P0 is the sole coordinator/writer for the following replacement prefixes; Sales will not create another0091–0099 file. This is observed coordination, not an acquired distributed number lock or assurance about unseen/future external work. Recheck fresh main before actual file creation and merge.

| Prefix | Final contribution / carrier |
| --- | --- |
|0088|Exact Sales-owned batch/order-manifest foundation SHA b6eeecb1…; carrier complete Fulfillment P0 PR under actual HD009 A1. Sales reviews; never implies P4 completion.|
|0089|Sales six Archive mirrors; remains complete Sales P4.|
|0090|Sales Export persistence; remains complete Sales P4; legacy0087 identity/body evidence retained.|
|0091|P0 permission seed.|
|0092|P0 sequences and durable operation persistence.|
|0093|P0 Fulfillment headers/lines/claims/history.|
|0094|P0 Inventory sequence extension; actual Inventory owner review and compatibility required.|
|0095|P0 allocation projection and cross-module FKs.|
|0096|P0 Shipment schema.|
|0097|P0 Issue/Reversal schema.|
|0098|P0 Audit/Export schema.|
|0099|P0 full Archive mirrors/guards.|

The approved eight logical P0 slices split permissions and operations into physical0091/0092; no business/quality boundary is weakened. The P0 normal runner will first have0088 and0091–0099 with0089/0090 intentionally absent; later Sales integrates actual P0 main and adds0089/0090 using the existing missing-name ledger mechanism. Both this order and upgrade over a preexisting private through0090 schema require actual native acceptance; no old PASS is relabeled.

Sales owner focused check executed after the handoff on its own approved isolated runtime: `salesArchiveMigrations.integration.test.js` **13PASS/0FAIL/0SKIP**, including real batch/manifest uniqueness/check/FK/rerun and Sales mirror regressions. This is current acceptance of unchanged0088 plus related Sales persistence only, not P0 Checkpoint0B or candidate CI. Private `hd009-sales-foundation-native-r1.log` and `hd009-observed-migration-inventory.json` (SHA fe62ca8a…) retain actual outputs. No P0 runtime/schema or another worktree was modified.

P0 can now reconcile its exact scope/contract/trace/bindings from actual A1 and complete TASK001, then follow its approved TASK002/003/providers/Checkpoint0B before schema execution. It must provide its own native/CI/review evidence. Sales remains responsible for matching its canonical plan/history to the actual P0 predecessor and completing original057–063/067–068/all45 suites/currentCI/fullP4Gate after the owner artifact is available. Existing R4 qualification and39/95 local results remain historical components, not new P0 correctness claims.


## Current execution boundary after agreement

Ownership, the exact0088 two-table contribution and the numbered inventory are now agreed. Earlier pending/proposal text is preserved history, superseded by the actual HD009 section. Sales has no further permission question for that agreement. The remaining dependency is real P0 implementation/Checkpoint0B/native qualification/fullCI/review/merge, followed by P4 adaptation and its full Gate. Sales does not continue competing owner schema/provider writes, treat elapsed time as a provider, or merge its prototype in advance.


## Exact Sales owner source acceptance completed

Actual independent source handoff review `hd009-sales0088-owner-contribution-review-r1.json`, SHA `850b37632bc75e9dd68173bb718266d00f9ce20d1e69b3ef6ffd66fe64b41d6b`, APPROVED, zero required findings. It independently verified exact0088 b6eeecb1, both main0070/0083 helper byte identities, constraints/indexes/FK/inspection/rerun and the observed inventory agreement. The13-case current Sales native result comprises **2 direct foundation cases plus11 related Sales persistence cases**; its source imports0089 and cannot be copied as a P0-only qualification run.

Sales accepts source transfer of only the exact two-table0088 contribution under HD009A1. The remaining item is delivery, not another permission request: P0 was actually observed at revision22/TASK002, no numbered new file yet at that observation, and must finish its own approved foundation. Sales current affected064/065/066 qualification waits that actual owner artifact; all historical DONE/reviews/evidence remain preserved, and new bindings/retests follow actual P0 integration. No product task or Phase Gate is closed by this handoff review.
