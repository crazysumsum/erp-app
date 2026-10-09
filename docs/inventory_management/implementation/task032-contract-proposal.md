# HD128 — TASK032 exact Reversal contract / scope candidate

Current disposition (HD128): actual Sam A / HUMAN REV095 / APR171–173 adopted exact DESIGN `6db8d2b49512bda19f6b2b17c54e9882be75795c3c610ca92ca143860edd127d` / PLAN `237d98e617f0a0f4612934118be2d589652b4eb70968291ad511fec6bb758658` / patch `86d8588c398166eb6243b604f75d17c87d3bf8771313acea2a616a82c8fa47e4`, including original-Lot expiry compensation policy; [adoption record](task032-candidate-adoption.md). TASK032 IN_PROGRESS / IMPLEMENTING;16 new developer scenarios NOT_RUN, final Sam source review pending. No product/test/runtime change at adoption; source/HEAD/shared pins and205 native reports unchanged, older checks not rebound to new PLAN. Only reviewed TASK032 owned implementation/local checks may proceed, no publication/main integration/TASK033+/formal/capacity waiver. Previous candidate-pending statements below are retained historical context.

Status: **PROPOSED_NOT_APPLIED**. Actual Sam HD127 `A` / APR170 selects current confirmed Bucket versions and preparing this candidate only. TASK031 remains locally DONE; TASK032 PENDING. Canonical specs and product/test source remain unchanged; independent Sam candidate review is required before adoption or implementation.

## Exact review baseline

| Binding | SHA-256 |
| --- | --- |
| Proposed DESIGN | `6db8d2b49512bda19f6b2b17c54e9882be75795c3c610ca92ca143860edd127d` |
| Proposed PLAN | `237d98e617f0a0f4612934118be2d589652b4eb70968291ad511fec6bb758658` |
| Four-file patch | `86d8588c398166eb6243b604f75d17c87d3bf8771313acea2a616a82c8fa47e4` |

Observed worktree HEAD `869ac07abdd3879254c351d857be911d71e68b6b` / source `894fb4eea4259c375705fdaea945a2a2fadc64736a9bbc335f47e35b5789e42e`. [Exact patch](task032-contract-proposal.patch) and [file hashes / precise scope / unchanged pins](task032-contract-proposal.json). Review is against this candidate, not active PLAN or unseen future source. The patch changes only manifest provided-contract version/pin, design route row/new §5.4.3, legacy P3-T07 / TASK032 plan and TC007's16 new planned REV032 scenario rows. Requirements/profile/UAT/typed ledger/matrix, Item contract and module/table ownership remain byte-identical; existing17 ADJ031 rows remain unchanged.

## Context, minimum approach and material changes

Existing §3.8 requires complete inverse groups and current invariants, but lacks a precise request, current-version/replay or owned high-risk proof contract. Reuse the existing Posting owner, HTTP preparation/store hooks, trusted context/final guard, scalar Operation result and Audit action. Add one owned Reversal helper and fixed third consumer; no generic movement engine, new store, summary format, lookup endpoint, permission, migration, dependency or shared auth abstraction.

- Request: canonical safe decimal path id; empty query; existing source, auth-only password, reasonText and1–200 unique numeric {balanceId,expectedVersion} guards. Complete current Bucket set is server-derived from original immutable group dimensions; missing/extra/duplicate/stale guards reject, no historical-version substitution or missing Bucket recreation. Original Base quantities are reversed, not recomputed through current Pack factors.
- Security/replay: fixed movement.reverse / MOVEMENT_REVERSE bound to path/actor/device/source/intent. Existing seven-day credential-free preparation and current ordered guard apply to HTTP/domain replay after waits; replay returns original scalar result without rechecking already-changed stock. Current stock versions govern only a new posting. Fresh auth still governs every replay.
- Group/transaction: validate complete original Operation summary, allfive allowed types and paired counts/conservation, max200 legs; reverse everyleg once in deterministic reverseID order. Stock/control/current group reads precede final current security guard and exact NULL-actor Operation binding, then inverse legs/stock/required Audit/completion atomically. Existing unique links and control locks protect different-source concurrent reversal. No original ledger/workflow updates or automatic retry.
- Current rules: aggregate OUT cannot exceed existingfree or be funded by futureIN; no increased uncovered Reserved, no Allocation/Reservation resurrection; active locations/current tracked usable nonserial profile/Counting exclusion/identity/quantity and version limits remain. All failures have zero business effects.

## Explicit policy needing your approval — expired historical IN restoration

The exact candidate proposes **restoring an existing original Lot to its original Bucket/Status even if now expired or below minimum receipt life**, rather than treating this compensation as a new Receipt/positive Adjustment. This never creates or retargets Lot, changes dates, grants an expiry override, or makes expired AVAILABLE stock sale-eligible. Current eligible coverage still protects Reserved, and allocated/free/counting/active/tracking rules still apply. Receipt/positive Adjustment expiry/minlife hard rejection stays unchanged; no-Lot FIFO uses existing perleg0→positive/currentlocaldate, positive→positive/preserve, zero/NULL policy.

Benefit: an old Issue can be physically corrected after expiry without inventing history or reopening consumed workflow. Cost/risk: expired AVAILABLE inventory can reappear as non-saleable stock requiring normal handling; callers must not interpret On Hand as Sale eligibility. Alternative: reject every expired/low-life historical IN, which blocks these corrections and requires amending this exact patch before implementation. **HD127 A did not approve this policy.** Recommendation: approve original-bucket compensation with current Sale/Reserved protections; no silent fallback if you require stricter rejection.

## Scope and developer verification after approval

Eleven owned source/test paths are enumerated in JSON, including onlyone new helper. Eight already-approved shared framework/test paths, existing root lock and0064 scope/synthetic-migration use need new-PLAN **byte-identical/no-write rebind**, not permission to alter them. Existing Operation/Audit services, actor FKs, other writers and Item remain unchanged. No new allowed module/table ownership.

Three thin increments: strict route/schema/context/replay; atomic complete group inverse with current locks/versions/rules; then all16 named REV032 native cases plus TC004 concurrency and impact regression. New rows are all NOT_RUN. Require original profile's runner/parsers/minimums, strict functional zero-skip, full server/Inventory/client/lint/build, existing global92/83/90 and all34 per-file coverage floors, real owned MySQL26.7.0 migrations/Movement/API and deterministic once-only/revocation/rollback barriers. Real revocation writers must COMMIT before releasing business waits, not merely attempt an update. Existing17 ADJ031 and Receipt/Issue/BinMove/Transfer/security/ordinary contracts and real Transfer Playwright are regression checks, not TASK033 completion.

After local evidence, independent actual Sam exact-source review is still required for TASK032 DONE. Formal TC007/UAT are NOT_RUN; four capacity checks remain NOT_EXECUTED. TASK033/034/full-P3/CI/PR/integration/release do not become complete by this candidate or developer checks.

## Observed validation / provenance

Author Codex /root performed docs-only SELF_REVIEW, not independent approval. Candidate structured traceability, unchanged matrix/profile/consumed contract,17 unchanged ADJ031 rows,16 NOT_RUN REV032 rows, provided-design pin and exact four-file replay on a second fresh copy PASS. Both exact temporary docs-only copies were cleaned. MySQL [locking-read semantics](https://dev.mysql.com/doc/refman/26.7/en/innodb-locking-reads.html) and [FK/duplicate lock behavior](https://dev.mysql.com/doc/refman/26.7/en/innodb-locks-set.html) support current-after-wait reads and retaining final actor binding; no DB execution was performed here.

All205 indexed native reports retain original bytes/source/PLAN, including19 current TASK031 developer PASS results; none is rebound to proposed PLAN or used as Reversal proof. Active source/spec/HEAD/pins remain unchanged, no runtime exists or test was executed this turn. Main advanced independently; no fetch/integration/publication authority is inferred.

## Decision Required — HD128

**Option A / recommendation:** after independent review, approve this exact four-file candidate/baselines, including the explicit historical-Lot restoration policy, fixed third proof consumer, minimum owned paths and byte-identical shared/lock/0064 scope rebind. This authorizes canonical adoption/reconciliation followed by TASK032-only local red→green implementation and mandatory native developer checks with owned synthetic resources/precise cleanup. It is not acceptance of unseen future implementation.

**Option B:** request changes (in particular stricter expired-IN rejection if required); canonical/source changes stay held and the amended candidate returns for review. Benefit: business boundary matches your chosen policy; cost: TASK032 remains pending until that exact baseline is approved.

**Default action:** hold adoption, product/test edits and runtime execution pending actual response. Neither option authorizes staging/commit/push/PR/remoteCI/merge/main integration, TASK033+, shared/Item/auth/admin/DDL/permission/dependency changes, relaxed floors/parsers/skips or formal/business/capacity acceptance. No Sam review record or source approval is fabricated.
