# TASK-031 — command granularity / HD112

## Current disposition — actual Sam A; HD112 ANSWERED

Sam actual latest 「A」 on2026-10-07 selects one operation per request, APR151: Adjustment changes one complete Bucket; Status Transfer changes one source Bucket to another status with one paired OUT/IN. Separate requests independently commit; no1–100-line batch workflow. Selection authorizes precise contract preparation only, not independent approval of unseen DESIGN/PLAN/product source. [Next high-risk submission decision HD113](task031-reauth-decision.md) concerns trusted strong-auth propagation, not a change to the fixed auth policy. TASK031 IN_PROGRESS / BLOCKED, resume IMPLEMENTING; source/spec/HEAD/160 native refs unchanged, no product/test/runtime/publication changes.

## Historical discovery — before HD112 answer

Status: TASK031 IN_PROGRESS (discovery), module BLOCKED / resume IMPLEMENTING. Actual Sam 「請開始下一步工作」 authorizes TASK031 local work under the approved plan; APR150 records start authority, not a choice of unseen contracts. TASK026–030 DONE locally, TASK032–034 PENDING. Existing isolated P3 worktree is reused; no product/test source, canonical spec, DB/runtime, dependency, CI or publication change occurred.

## Observed baseline and gap

HEAD `869ac07abdd3879254c351d857be911d71e68b6b`; source `fe3130fef55c9ec8cc71b2edf872a8a2076b5332581749ee281b211de38f2bc2`; DESIGN `46841dae185fab06e626fca722d1576726702a3d7183fdbb2f23e3459de7f663`; PLAN `8ab85d87051f437b74c6cfb4efc39ba93c8c2dd9e56ca7ea210d7bc5bc705dc8`. Observed state, scope and traceability pass before the new decision;160 native evidence refs/failures remain unchanged, not TASK031 proof. Shared checkout and accepted/uncommitted P3 work are preserved.

Requirement §FR-ADJUST-002/005 and design §§3.3/5.4/6.2 define positive/negative Adjustment, paired Status Transfer, Reserved/Allocation protection, reason and strong authentication, but no precise request shape, granularity, version/expected-absent fields or immutable replay response. Development TASK031/P3-T06 and TC007 require races, rollback, reason validation and reauth actor/device/action/time; they do not require a multi-line document. Unlike Bin Move, no approved whole-document contract exists for these two APIs. Selecting batch atomicity silently would alter public contract, consistency scope and failure behavior.

Existing `jwt-device-password` verifies live JWT/version, approved actor-bound device, method/path/raw-body/token signature, timestamp/nonce and current password before the handler; handler must strip password before domain/hash/Audit. Existing command context accepts actor/authorization/source/correlationId/payload, with no defined high-risk proof propagation. This must be resolved in the exact contract before product writes; no caller-reported `isHighRisk`, permission or reauth boolean is an acceptable substitute. No new auth flow or weakened policy has been chosen.

## Decision Required — HD112: one operation or batch?

A — recommended: one operation per request. One Adjustment changes one complete Bucket (Warehouse/Bin/SKU/Lot/Status); direction is explicit and quantity positive Base UOM. One Status Transfer moves quantity from one existing Bucket to another status at the same Warehouse/Bin/SKU/Lot; exactly one OUT/IN pair. Each request has its own source intent, Operation, group, reason, expected versions and all-or-nothing transaction. Positive Adjustment can address a previously absent Bucket under an explicit expected-absent guard; exact fields/Lot behavior remain for the reviewed contract. No batch array or new batch workflow.

Benefit: matches stated requirements with the smallest contract, simpler version/replay/reauth/error handling, fewer shared-Bucket cases. Limit: several corrections require several requests, independently committed; not whole-batch atomicity. This is not permission to turn a future multi-line UI action into silent partial success.

B — multi-line document:1–100 lines under one source/Operation/group, all succeed or all roll back. Adds repeated/shared-Bucket version agreement, gross OUT protection before IN, overflow/line-order/replay/concurrency and whole-document confirmation, including combined status changes. Benefit: explicit all-or-nothing bulk correction. Cost: larger public API, security confirmation/transaction/test scope and extra complexity not required by current TASK031 intent.

Recommendation: A unless whole-document bulk correction is an actual requirement. Default until actual Sam choice: stop the affected contract/source path; preserve canonical/source/evidence, no silent choice. Answer selects granularity and authorizes preparing the exact contract only, not independent approval of unseen DESIGN/PLAN or future implementation.

## Next after this decision

Respect Sam's one-question-at-a-time preference: resolve remaining consequential contract details (precise targets/Lot/version/reason detail/high-risk submission context), prepare the smallest exact in-place design/plan/technical/UAT/pin updates that are actually affected, validate trace/pins/hashes and obtain actual Sam baseline/scope review before product changes. Do not re-ask already fixed seven reason categories or `jwt-device-password`/view+adjust policy. Reuse Posting/Operation/Lock/Item/Audit and the approved developer profiles; no new DDL/permissions/dependency/global auth/config, UI/TASK033, test/floor/capacity waiver or publication authority implied.

Harness major-impact gate causes this pause; API-interface/security skills exposed the missing contract and high-risk trust boundary. No implementation or fresh TASK031 tests have run; earlier TASK030 PASS remains source-bound history, formal TC/UAT remain NOT_RUN. No stage/commit/push/PR/remoteCI/merge/main adoption/release occurred.
