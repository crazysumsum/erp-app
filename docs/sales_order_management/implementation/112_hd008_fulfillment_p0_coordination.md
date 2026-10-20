# HD-008 — Sales P4 / Fulfillment P0 ownership coordination

Status: overlap preserved and paused; ownership direction confirmed, concrete migration/contract handoff not yet agreed. This is a coordination proposal, not a migration reservation, new acceptance result or merge exception.

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
4. Contract10 exact Archive ABI was approved by DEC029 but is not present in PR256's planning baseline. P0 owner must explicitly reconcile rather than silently overwrite its provenance, guards, null-EXPORT routing, full12 mirror/hash manifest and same-transaction participant requirements. Sales Archive remains fail-closed until that real contract/provider is ready.

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

## Proposed handoff and merge order — requires concrete owner agreement

1. Fulfillment P0 becomes sole final writer/reviewer for active schema, quantity/operation invariants and minimum lifecycle provider. It may adapt the preserved source/tests only after its approved Checkpoint0B and exact compatibility review; it must not count this Sales95PASS as completing its own45 tasks/Checkpoints.
2. Sales retains its six-table copy/hash/coordinator and participant/consumer adaptation work. The real participant continues as an explicitly named Fulfillment-owned contribution, with one accepted ABI and fixed transaction authority; no fabricated CLOSED or bearer actor payload.
3. Resolve a real predecessor issue before allocating numbers: P0 TASK010 includes owner Archive mirrors, whose FK references **Sales0088 batch/manifest tables absent from main**. A strict 'P0 first, complete P4 later' sequence otherwise leaves a cycle. The smallest candidate is to accept only the required Sales0088 batch/manifest foundation as a named Sales-owned contribution in the complete P0 PR, with its actual native acceptance/owner review and explicit scope/trace/merge-policy disposition; keep unrelated0089/0090 and full P4 delivery in Sales. This is a proposal, **not approval to split the existing P4 merge group or cherry-pick it now**. If existing HD008 scope/merge authority does not cover that exact prerequisite contribution, present this concrete supplement to Sam once, retaining all original Gates. An alternative is a genuinely joint complete P0+P4 candidate satisfying both complete Gates; it is larger and keeps coupled delivery.
4. After that decision/agreement, choose the exact complete forward migration inventory once from fresh main; map existing0088–0093 source identities/content to final ownership and order, including P0's eight logical slices. Do not execute or publish a duplicate number. Reconcile both authoritative document/state histories with an actual separate review; neither stream overwrites the other's state or rewrites old approvals/hashes.
5. Requalify cumulative allocation/reallocation, zero-picked Line states, real FK/constraint/immutable guards, normal/partial/rerun migrations, minimum lifecycle release/block/UNKNOWN, all original39+6 Sales suites, P0 requirements, current candidate CI and actual reviews. Observe unchanged required Gates before each authorized merge. No current P4 merge readiness is claimed.

Until unique assignment/contract/forward order is recorded, overlapping schema/provider edits and merges are paused. Safe work is read-only compatibility review, preserved handoff evidence and Sales-only independent preparation. This document is available for the authorized coordinator to read; no other worktree has been changed.

## Concrete Sales-side assignment clarification

Sales accepts the HD008 ownership direction: **0091–0093 are paused and will exit the final Sales P4 PR as independent owner-schema installers**. Fulfillment P0 is the single final author of the adjusted active/schema/protection/mirror and minimum lifecycle artifact. These three existing commits/files are preserved references for review/reuse, not a second install path and not approved P0 implementations. No second set of CREATE TABLE migrations may coexist to let both streams proceed. Exact replacement numbering remains unallocated until the coordinator records one complete inventory.

**0088–0090 remain Sales-owned identities.** 0089 and0090 remain in the later complete Sales P4 delivery. 0088 contains the predecessor batch/manifest schema actually required by owner mirror FKs; it is not silently donated, duplicated under another migration, deleted, or declared merged. Its narrow contribution/merge-policy disposition is the concrete remaining sequencing question described above. Until resolved, the coordinator can inventory/review/reconcile non-persistence foundation work but cannot claim its full TASK001 migration allocation or TASK010/Fulfillment P0 Gate has been satisfied.

Reusable paths: canonical12-column/hash module; schema/index/FK/trigger model and23 native cases as a changeable reference; real socket-only fixture and actual transaction/RequestContext test support; OpenMatter service/adapter/unit/native cases as a prototype requiring new cumulative/short-pick rules and owner review. The genuine archive participant is still to be implemented; no source file or PASS is being handed off for a nonexistent participant. Nothing grants P0 access to this private MySQL or transfers credentials.
