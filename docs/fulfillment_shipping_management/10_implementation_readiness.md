# Fulfillment implementation readiness requalification

## Current disposition after independent review

`PLANNED / PLAN_READY` — HD-006 A and HD-007 A adopted; independent R2 review PASS, 0 open CRITICAL/HIGH/MEDIUM; design/plan decisions and unchanged NFR-023 UAT N/A renewed under the explicit user authority below. This is planning readiness, with all 45 product Tasks still PENDING; implementation, migration, deployment, merge, Technical Acceptance and business UAT have not occurred.

The final integrated source is main `35af2ab7010d8a42cdbc3ca55d23c9c9ce95856c`, reviewed at integrated HEAD `46b390e772f08a759d0f383096c87eef347a3f1f`, source fingerprint `46f38a6759a89848336a2e42c4b267e9f00c76b39d9a7767021ec5ba245ba9a9`. Latest Customer changes add nonlocking precheck/version2.2 and readonly catalog locks; its shipping assertion bodies are unchanged. Current source pins were rechecked; provider-owner exact wire/adaptor scope remains an implementation checkpoint.

- Approved DESIGN: `feef0869d0d3d1814ce5ab9a08e885ef84c49e578bfbf24269ff106b0aa69ce8`
- Approved PLAN: `a229fd571382e42dbc0e88c896bd06aeed12bf4e5e3b4622a58bc69197aead38`
- Independent reviewer: `/root/fulfillment_independent_review`, method `SEPARATE_AGENT`, actual R1→R2 findings and closure in `04_design_review.md`.
- Latest provider unit check: 76 PASS / 0 FAIL / 0 SKIP, after latest-main integration. The earlier 75-case observation below is historical; neither run is formal Fulfillment TC/UAT execution.
- NFR-023 retains its exact reason and TC-010 mandatory/blocking coverage; only its renewal reference changes to `APR-008-UATNA-20261020`. No additional exemption or technical PASS is created.

The following sections preserve earlier observations/decisions and the initial publication rejection as history. Current user authorization supersedes the earlier missing-egress-authority condition. Draft PR publication is complete: [#256](https://github.com/crazysumsum/erp-app/pull/256) was created as draft, head branch `codex/fulfillment-readiness-alignment`, targeting main. Merge and IMPLEMENT remain separate.

## Historical readiness observations

## Outcome and authority

`DECISIONS_ADOPTED / BLOCKED` — HD-006/HD-007 A+A adopted; documentation preparation only, `REVIEW_AND_ALIGN`, observed on 2026-10-20 (Asia/Hong_Kong). The user requested the readiness review and then instructed「按建議進行」; the subsequent direct user reply「A＋A」adopts the two presented recommendations. It does not authorize entry into implementation or GitHub publication. No product source, migration, shared config, other module, deployed service or database is changed.

Fetched `origin/main` and observed local main equal to `64bee2e00dfae71131c7cfa54049cac0941d6f85`, then created branch `codex/fulfillment-readiness-alignment` in `/private/tmp/erp-fulfillment-readiness`. Recovery is that immutable commit. All observations below apply to it, not to unmerged neighboring worktrees. Source fingerprint: `70eed2ff3e806da18ce44c0711712425806ffde3dbfaf3412457cf3e39fc4143`.

The 2026-09-14 inventory, gap analysis and approvals remain historical. Their claims that Sales/Inventory/Customer do not exist and no browser CI runs are superseded here. All 45 implementation Tasks remain PENDING; 12 Fulfillment technical specifications and 120 UAT cases remain unexecuted. The 145 requirements, 14 designs and four Phase identities are unchanged.

## Provider contract delta and ownership

Paths are repository-relative; method presence is not semantic or integration acceptance.

| Boundary | Observed implementation | Remaining work / responsible boundary | Required proof |
| --- | --- | --- | --- |
| Sales projection and result | `server/src/modules/sales/SalesFulfillmentGuardService.js::assertAllowed` protects lifecycle; Sales core and reservation mappings exist. No `SalesFulfillmentService`, `getOrderForFulfillment`, `lockLinesForFulfillmentInTransaction` or `applyFulfillmentResultInTransaction` exists in source. | TASK-004, Sales provider owner: additive §6.1 projection, order/line/mapping locks, exact result validation, Confirm Reserved→Fulfilled and Reversal Fulfilled→original Reservation, unchanged Cancelled quantity and SO recalculation. Fulfillment owns consumer tests. | Same-transaction rollback and lock-order tests; missing/duplicate/foreign lines and stale versions fail closed; owner review. |
| Inventory candidates | `InventoryReservationService::listFulfillmentAllocationCandidatesInTransaction` takes `{actor,query}`, one reservation, pagination, safe-integer requested quantity and provider-owned time. | TASK-005, Inventory provider owner: reconcile multi-line query, owner/claim context, bounded complete recommendation sequence and asOf/version policy with §6.2; do not relabel a paginated one-reservation result as complete batch acceptance. | Mixed-expiry FEFO/FIFO, multi-reservation owner/exact-set and changing candidate/version tests. |
| Allocation / release / Issue | `InventoryReservationService::allocateForFulfillmentInTransaction`, `releaseFulfillmentAllocationInTransaction`, `reallocateFulfillmentAllocationInTransaction`; `InventoryPostingService::postFulfillmentIssueInTransaction`. Payloads group allocations under a single reservation. Existing named providers fix permission/source and reject caller-supplied authorization or module. | TASK-005: additive reviewed batch facade/contract, sorted complete lock set and all-or-nothing multi-line operation in caller transaction. Preserve existing entry points for other consumers. No caller-invented permissions or raw Inventory writes. | Two-reservation/multi-line late failure rolls back all effects; exact picked/allocation set, source idempotency, revoked actor, expected versions and concurrent Issue proofs. |
| Wire representation | §6 requires decimal-string IDs/quantities and a common context; existing Inventory `inventoryPositiveInteger` accepts Number safe integers and provider inputs whitelist `{actor,source,correlationId,payload}`. | TASK-004/005/006: provider owners must approve the exact serialization/validation boundary before coding. Canonical wire remains decimal string; reject unsafe/out-of-range/fractional values before conversion. No arbitrary Number coercion or removal of strict-field checks. | Consumer schema fixtures, malformed/unsafe/fractional input rejection and trusted source/actor mapping. Re-pinning bytes below is not owner approval. |
| Dedicated reversal | Inventory has generic `inventoryReversalPosting.js` / `reverseMovementInTransaction`; no `reverseFulfillmentIssueAndRestoreReservationBatchInTransaction` exists. Generic reversal is not proof of reservation restoration. | TASK-005, Inventory owner: original Shipment Issue/source ownership, original bucket movement, same Reservation outstanding restoration; original Allocation stays Consumed. No generic HTTP exposure or retargeting. | Original-bin unavailable/counting, stale/reversed movement, duplicate event, partial batch failure, reservation restoration and once-only reversal under concurrency. |
| Customer shipping | `CustomerLookupService::listAddresses/listContacts` and `assertAddressUsableInTransaction/assertContactUsableInTransaction` exist; assertions scope parent, active shipping purpose and expected child version. | TASK-006: reuse these methods; preserve returned Customer lifecycle facts and validate the chosen Fulfillment policy. Add actual Fulfillment consumer coverage, including optional contact. | Owner/purpose/version/inactive races, safe snapshots, caller transaction; existing unit tests are partial evidence only. |
| Item eligibility | `ItemLookupService::getInventoryProfileInTransaction` returns Base UOM/tracking/minimum sale life in caller transaction. Generic `assertUsable` uses the pool and is not a transaction-aware submit assertion; transaction profile preserves serial facts for consumer rejection. | TASK-006: bind the transaction profile to Fulfillment submit validation at Create/Allocation/Confirm; batch strategy and lock order require provider-owner review. No new generic purpose or duplicate Item lifecycle rules. | Serial, archived/nontracked, changed Base UOM/life policy and same-transaction revalidation at all three submit points. |
| Permissions | `fulfillment.operation` and `inventory.fefo.override` already exist in catalogue. `fulfillment.view`/`fulfillment.reverse` do not. | TASK-002: only add missing permissions and seed/convention coverage with no automatic grants. Existing seed/migrations remain immutable. | Catalogue/seed equality, fresh permissions and independent view/operation/reverse roles. |
| Sales installation lifecycle | Guard returns distinct `NOT_REQUIRED` only when no Fulfillment/Shipment schema/history/provider exists; schema/history presence without real provider fails closed. | Before any live schema activation, Sales and Fulfillment owners must adopt an exact cutover/runbook and provider registration scope. Existing DEC-021 notes are not blanket rollout authority. | Quiesce release writers; migrations; real `fulfillmentOpenMatter` on all nodes; lock proof; resume. No negative cache or dropping tables to re-enable uninstalled mode. |

## HD-006 — P0 sequencing candidate

Decision required: the old entry gate required the very extensions that TASK-004–006 were meant to implement. The concrete candidate is already in `05_development_tasks.md` §1.4, TASK-001, TASK-007 and the PHASE-001 entry definition; the typed ledger makes TASK-007 depend on TASK-004/005/006.

- **A — Recommended:** retain the same four Phases and single P0 PR. Require merged provider cores at entry; TASK-001 inventories extension gaps; TASK-002/003 do permissions/pure rules; provider owners complete TASK-004–006; Checkpoint 0B blocks TASK-007–010 until every contract proof passes. This resolves the circular start without weakening the P0 exit gate. It requires explicit current-plan SCOPE approval for shared/upstream paths before implementation and exact cutover authority before any live schema activation.
- **B — Preserve the old all-contracts-before-P0 gate:** upstream owners deliver and merge missing contracts in separate scoped PRs first; revise TASK-004–006 to consumer integration only before starting P0. This preserves strict upstream-before-consumer delivery, but changes PR sequencing and requires a further plan revision.

Sam adopted A through the direct reply「A＋A」; B is retained as the unselected alternative. Neither option authorizes source changes, migrations, deployment, messaging other chats, merging this planning PR or bypassing owner/CI/review gates.

## HD-007 — Database compatibility candidate

Historical HD-001 approved MySQL 8.0. Current `.github/workflows/ci.yml` pins `mysql:26.7.0` and checks the exact server version. This observation does not prove Fulfillment compatibility on either version.

- **A — Recommended:** approve 26.7.0 as Fulfillment's development/test support baseline, matching the shared Inventory/Sales runtime and current CI. Candidate target statements are already marked HD-007/PROPOSED in design §0/§4.1, plan §1.2/§1.4/PHASE-001 and TC-001/TC-009 prerequisites. Preserve service/trigger/enforced-CHECK protections, same schema/transaction semantics, capacity/coverage and all acceptance cases. No production upgrade or claimed 8.0 support is included.
- **B — Retain 8.0:** revert only this candidate's target-version edits, then supply a separate verified 8.0 runtime/CI path and prove upstream/migration compatibility on it. This keeps historical platform support but adds validation cost and may expose current upstream incompatibilities; 26.7 runs never count as 8.0 evidence.

Sam adopted A through the direct reply「A＋A」; B is retained as the unselected alternative. Following that decision, execute true MySQL migration, FK/trigger, concurrency/rollback and recovery proofs in the authorized implementation stage.

## Historical candidate hashes and review disposition

The candidate uses observed hashes for one provided and six consumed contract sources, all labeled `REVIEW_PENDING` / `NOT_APPROVED_NOT_IMPLEMENTED`; this repairs stale references without declaring compatibility. Previous approvals/reviews remain immutable historical records, not rebound signatures.

- DESIGN: `683abcc2192073c57df58023bd876f03904e868d27181a3cd1d438df1c452e27`
- PLAN: `234867a700205bacd60800173655bfbc391de18dfa241d07477dd20bd8415a96`
- Proposed adoption includes renewing unchanged `NFR-023` UAT N/A against the adopted plan; TC-010 contract-version/compatibility coverage stays mandatory and blocking. No new UAT exemption is added.
- Review method: `SELF_REVIEW` by Codex, the document author, with changes requested until HD-006/HD-007, provider-owner scope/contract review and current independent review are satisfied. No independent review or human approval has been manufactured.
- If A+A is adopted unchanged, record the actual user decision against these exact hashes; if edited, compute and present the new baseline. Actual IMPLEMENT authorization and isolated runtime allocation remain separate.

## Validation and remaining entry checklist

At the observed source baseline, Node v26.6.0 ran the existing reviewed read-only provider unit command in this isolated worktree:

```text
node --test --import ./server/test-support/testEnv.js --test-reporter=spec \
  server/test/inventoryProviderContracts.test.js \
  server/test/customerLookupService.test.js server/test/itemLookupService.test.js
75 tests; 75 passed; 0 failed; 0 skipped; 0 cancelled; 0 todo.
```

These use injected test executors and do not prove real MySQL, Fulfillment consumer integration or formal TC/UAT execution. No UI or product code changed; no browser/build/full regression result is claimed. Historical other-suite failures are not asserted as current failures.

- Traceability: `STRUCTURE_PASS`; matrix regenerated deterministically. 145 requirements / 14 designs / 4 Phases / 45 Tasks / 12 TC / 120 UAT retained.
- Contract pins: all seven match observed files; not semantic adoption.
- Approval-aware traceability: BLOCKED on stale NFR-023 N/A approval until renewed.
- PLAN_READY: HD-006/HD-007 are now answered A+A; current DESIGN/PLAN approval, NFR-023 renewal and independent review remain blocking; resolving hashes is not readiness.
- Boundary / whitespace / local links: checked before the planning commit; scope limited to this documentation directory.
- Migration inventory: 84 JavaScript files, highest prefix 0087, no duplicate numeric prefix at the observed baseline. No sequence reserved; re-inventory on actual implementation start.
- Browser: root Playwright pin and CI job exist. Current CI runs `e2e:mocked` for other modules; Fulfillment suite/profile/CI coverage remains a PHASE-002 delivery obligation, not a reason to claim no browser tooling exists.
- External freshness: fetched main before branch creation; re-fetch and inspect target changes before future merge. Publication is blocked pending explicit user egress approval; no remote branch or PR was created, and no merge authorization is implied.

Next safe action: HD-006/HD-007 are answered; obtain independent baseline review; resolve any exact provider contract/scope and installation choices; record current DESIGN/PLAN/NFR-023 decisions; only then assess PLAN_READY and request/record the intended IMPLEMENT scope. Business acceptance and release sign-off remain open by design.

## Publication disposition

Local planning commit `1811e2fc` preserves the substantive candidate; the following local metadata commit records this disposition. Automatic approval review rejected `git push -u origin codex/fulfillment-readiness-alignment` before execution: the user authorized local preparation but had not specifically authorized egress of potentially sensitive internal readiness documentation to `https://github.com/crazysumsum/erp-app`. No alternate connector or indirect push was used. No remote branch, pull request or merge was created by this work. The intended draft PR remains PLANNED pending explicit user permission to publish these exact documents to that repository.

Local worktree/branch are intentionally retained for review. Before any authorized retry, inspect actual remote state and fetch main; do not replay an unknown external action. Publishing permission alone does not decide HD-006/HD-007 or authorize product implementation.

## Decision adoption — 2026-10-20

Actual source: Sam's direct reply「A＋A」in this Codex chat, following the two-row decision summary and linked candidate report. HD-006 option A and HD-007 option A are ANSWERED/ADOPTED. The presented candidate was DESIGN `683abcc2192073c57df58023bd876f03904e868d27181a3cd1d438df1c452e27`, PLAN `234867a700205bacd60800173655bfbc391de18dfa241d07477dd20bd8415a96`.

P0 now requires existing provider cores at entry, TASK-004–006 completion and Checkpoint 0B before persistence/schema; all original exit gates and source ownership remain. The development/test platform target is MySQL 26.7.0; enforced CHECK/service/trigger protections, existing requirements and all acceptance criteria remain. 8.0 support or a production database upgrade is not adopted.

Only decision-status wording and the resulting provided-source pin changed after the presented candidate. Codex computed the resulting hashes under that scoped decision; Sam is not claimed to have separately inspected these derived hashes. This is a scoped decision approval, not a fabricated full DESIGN/PLAN approval, independent review, UAT N/A renewal or IMPLEMENT authorization. Historical approvals and reviews remain unchanged.

- Derived DESIGN: `329d29496802aa2d6405a3aabb743a4b80ab8182748e82824a8bb688811965dc`
- Derived PLAN: `83a958c6bab1eff0ab81ae6cb73c508f016aaecbe6defd39ab87c9c403e0824c`

Remaining gates: actual independent current-baseline review, full DESIGN/PLAN approval and renewal of unchanged NFR-023 UAT N/A; provider-owner exact contract/shared-path decisions before relevant implementation; explicit IMPLEMENT scope and isolated runtime. A+A does not address the separate publication-permission request. The previous automatic push rejection remains effective; do not retry or switch connector without explicit GitHub egress permission.

## Human planning approval and publication authority

Actual user authority in this chat on 2026-10-20:「安排獨立覆核，完成設計／計劃審批及 NFR-023 豁免更新；授權將 fulfillment 文件推送到 crazysumsum/erp-app 並建立 draft PR。」This explicitly authorizes completing the previously presented planning approval and existing NFR-023 renewal after actual independent review, and sending the fulfillment documentation to that named GitHub repository to create a draft PR.

Codex performed only consistency remedies against existing approved requirements: state-conditioned quantity equations and legal zero-picked lines; P0 delivery of the minimum lifecycle guard before live installation/resume with safe rollback; full Phase B rollback then fenced terminal failure; and consistent lock ordering. These did not add business scope, lower acceptance criteria, authorize shared-path product writes or accept a new material trade-off. The independent reviewer actually rechecked the resulting exact DESIGN/PLAN hashes and resolved all R1 findings.

Records APR-006-DESIGN-20261020 and APR-007-PLAN-20261020 bind the completed planning approval to the exact hashes above. APR-008-UATNA-20261020 binds only NFR-023's unchanged business-UAT applicability decision to that PLAN; TC-010 remains required. The human authority is the actual instruction, not the agent-authored JSON; Sam is not claimed to have separately inspected the mechanically derived hashes or personally performed the separate agent review. Original approvals/reviews and the initial failed publication attempt are retained.

Publication scope is the changes under `docs/fulfillment_shipping_management/**` only, to `crazysumsum/erp-app`, branch `codex/fulfillment-readiness-alignment`, draft PR targeting main. No credentials, environment files, raw browser traces, raw database extracts or other module's new changes are included in this branch's PR diff. No reviewer requests/comments/messages to others or merge are included. The old rejected push is not silently retried: a new explicit-authority publication action is journalled and remote state inspected first.

Before actual implementation, confirm fresh main, named P0 owner and exact shared-file/provider scope, allocate the isolated MySQL26.7 runtime and migration sequence, and record IMPLEMENT authorization. Provider extensions and native/browser/capacity/CI evidence must then satisfy their existing delivery gates. Before live schema activation, require the exact owner-approved Sales quiesce/install/register/probe/resume runbook. Planning approval is not formal system acceptance or release approval.

## Confirmed publication receipts

The explicitly authorized new-branch push succeeded at `bae225bb6172433f93b9627fd53dea8adb8582ae`; remote was `https://github.com/crazysumsum/erp-app.git`, with no force push or merge. GitHub connector PR creation returned HTTP403 `Resource not accessible by integration`; that failure is retained separately. The same user-authorized request then used existing local GitHub authentication, with credentials confined to process memory and never logged or persisted, and checked for an existing PR before creation.

Actual GitHub REST response confirmed draft PR [#256](https://github.com/crazysumsum/erp-app/pull/256), `draft=true`, source `codex/fulfillment-readiness-alignment`, target main and initial head `bae225bb6172433f93b9627fd53dea8adb8582ae`. The PR was attached to this Codex chat. This receipt-only follow-up updates the same authorized documentation branch and does not alter any approved specification hash. The final remote head is verified separately rather than embedding a self-referential commit hash in its own contents.

Final local results: approval-aware traceability STRUCTURE_PASS; PLAN_READY LOCAL_CHECKS_PASS; module-boundary, whitespace, local-link, seven contract-source pins, stable ID/count and unchanged mandatory/blocking/NFR-023 reason checks passed. The integrated provider unit observation is 76/76 PASS with zero skips. CI may run automatically after push; no design-stage CI result is invented or awaited.

Retain the branch and worktree while the draft PR is open. No product Task is DONE, no schema migration or live effect was executed, no UAT/business/release acceptance was granted, and no PR merge was performed. Next: review the published planning PR, then separately select/authorize the intended IMPLEMENT scope and exact shared/provider/runtime/cutover gates.
