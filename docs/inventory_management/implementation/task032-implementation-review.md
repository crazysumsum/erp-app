# TASK-032 — Movement Reversal implementation review (HD129)

Current disposition (HD129 approved): actual Sam A selected the presented reviewed/approve/local-DONE option; HUMAN REV097 / APR174. TASK032 is DONE locally on exact source `ea5fed017f5eba2fcdfe2adf9bd74521deb6e95d863797892e5a0a9c15c03e43` / unchanged PLAN `237d98e617f0a0f4612934118be2d589652b4eb70968291ad511fec6bb758658` / TASK032-only review patch `0f66a086279906e54ada939b458e783d69ec8e18ee025fb47676343ca4aa3afe`. All19 current-source native developer PASS reports and16 named REV032 scenarios reverified without rerunning or relabelling tests;205 pre-adoption report bytes and253 indexed history refs retained. TASK033/034 remain PENDING. Approval covers only local TASK032 developer DoD, not future source, publication/main integration, formal/UAT/release or capacity/skip/floor waiver. Earlier pending-review content below and the original review JSON remain the presented historical snapshot; this paragraph and Harness state record the actual final disposition.

Status: local developer verification complete; actual independent Sam implementation review is still required. TASK-032 remains IN_PROGRESS. HD128 approved the precise contract and implementation scope, not future source acceptance. No staging, commit, push, PR, remote CI, merge, main integration, TASK-033 implementation or formal acceptance occurred.

Review the [TASK032-only source delta](task032-implementation-review.patch) and [file pins, native reports and scenario mapping](task032-implementation-review.json). The patch contains ten changed paths within the eleven approved owned paths, including one new Inventory-local helper. It is reconstructed against the approved TASK031 file pins, all ten existing before-images verified byte-for-byte; it is not the entire accumulated P3 diff from HEAD. The fake DB helper, eight shared framework/test paths, root lock, existing migrations, Item, Operation and Audit contracts remain unchanged.

HEAD `869ac07abdd3879254c351d857be911d71e68b6b`; exact source `ea5fed017f5eba2fcdfe2adf9bd74521deb6e95d863797892e5a0a9c15c03e43`; patch SHA256 `0f66a086279906e54ada939b458e783d69ec8e18ee025fb47676343ca4aa3afe`. Approved DESIGN `6db8d2b49512bda19f6b2b17c54e9882be75795c3c610ca92ca143860edd127d` / PLAN `237d98e617f0a0f4612934118be2d589652b4eb70968291ad511fec6bb758658` and canonical file bytes are unchanged.

## Material behavior

The third fixed strong-auth endpoint reverses an entire original Receipt, Issue, Bin Move, Status Transfer or Adjustment group, once only. It accepts the original Movement path, reason and complete current Bucket version guards; the server derives original Base quantities, dimensions and inverse legs. It never modifies original ledger rows, revives consumed Reservation/Allocation, recreates missing historical Buckets, converts current Pack quantities or creates/retargets Lots.

Ordered current stock locks precede current original-operation/group/link reads and final locked security checks. Only the new Operation stages a NULL actor before waiting; exact trusted actor binding, all inverse legs, stock versions, required Audit and completion share one transaction. A previously committed reversal takes priority over stale version rejection. The actual named native unique reversal constraint remains the last defence; unrelated duplicates are not hidden. Completed source/HTTP replay returns the original four scalars after fresh security checks without recomputing changed stock or Item.

Current free/Allocated/Reserved, active/Counting/tracking and safe quantity/version constraints apply. Original expired or low-receipt-life Lot restoration is restricted to the original Bucket, preserving dates/creator; expired stock does not become Sale-eligible. Original-group/guard sets are bounded at 200; per-leg FIFO and versions remain deterministic.

## Current-source developer evidence

All nineteen configured DEVELOPER runs are freshly bound to this exact source/PLAN and pass with zero FAIL/SKIP/NOT_RUN. A read-only project adapter revalidates actual nested report directories, original profile argv/tool/counts/required IDs, raw adapter agreement and artifact hashes. Original run IDs and retired runtime identities are preserved. The generic live-runtime/run-id-root MERGE_READY convention is not satisfied; this local verification does not claim a generic merge-gate PASS.

| Group | Observed result |
| --- | --- |
| Unit and client | Server 2195, Inventory 207, client 706, TASK026/027/028 15/32/13, P3 unit 27, Transfer component 13 PASS |
| Native MySQL and real strong-auth API | Movement 44, Transfer 31, migration 7, API 31 PASS; P256/device/nonce/scrypt/JWT, actual stock/cache waits and token-first UserAdmin revocation exercised |
| Existing real Transfer browser | Playwright 8 PASS, real API/MySQL; happy/error/input/navigation/refresh/responsive/unsaved flows and console/network checks. Actual 320px draft and received screenshots inspected. No Reversal UI/TASK033 claim |
| Functional compatibility | Ten unchanged files / 18 strict leaves PASS; P2 DB7/API1 registered, eight supporting commands remain sidecar diagnostics, not new profile suites |
| Quality | Original dependency audit, lint, build and all 34 high-risk file floors PASS; no dependency, command, parser, floor or skip-policy changes |

All sixteen REV032 scenario prefixes map to observed passing JUnit names in the JSON: strict input/proof, complete group, current versions, all five types, paired/shared Bucket legs, Reserved, original Lot/FIFO, once-only native races/unique constraint, HTTP/domain replay, revocation order, rollback and compatibility. These remain DEVELOPER evidence, not formal TC/UAT PASS; canonical scenario specification rows remain NOT_RUN.

The [original broad server command](../evidence/task032-full-native-20261008T025322-954c50f7/diagnostic.json) separately reports 2778 native tests / 2651 PASS / 0 FAIL / 127 guarded SKIP, and final-run coverage 93.61% lines / 84.47% branches / 91.96% functions against unchanged 92/83/90 thresholds. Its same LCOV producer passes all 34 original file floors. It is a diagnostic, not a strict zero-skip suite PASS. Native summary counts include nested wrappers; the 125 visible skip names are separately reconciled against current passing case/suite reports, except Customer import and Core Stock capacity guards. The four planned capacity leaves remain NOT_EXECUTED, not waived. Formal TC007/UAT/business/release/full-P3 completion and current CI/main readiness are unclaimed.

## Review, failure history and resource disposition

SELF_REVIEW by Codex /root covers correctness, readability, architecture, security and performance; no unresolved Critical/High or required finding was identified. This is not an independent reviewer. Reversal reuses the existing Posting transaction, opaque proof, locks, Operation, Audit and Item read contract; no new dependency or generic abstraction. The inherited Warehouse/SKU eligible-Bucket scan is not a capacity proof. Native cases stay in the approved existing files/commands; unrelated test decomposition or shared refactoring was not added.

Original RED/FAIL evidence and all 205 pre-adoption report bytes remain intact. A once-only error-priority RED exposed and fixed the product ordering bug. Initial native failures were corrected fixture request placement/reason spelling, native JSON expectation and unique-constraint precondition; assertions and safety gates were not weakened. The API noncanonical-path fixture now constructs the literal path rather than accidentally replacing `/v1`. A functional controller stopped before DB/test effects because it retained TASK031's old BLOCKED precondition; only the temporary controller condition was corrected. Passing final-source evidence supersedes, but never relabels, those attempts.

Each owned disposable schema/account/daemon/socket/listener/cache/temp root was precisely cleaned with absence/exit checks; synthetic data is unrecoverable, local evidence retained. Shared/production and other-worktree resources were untouched. The primary checkout remains clean. Main advanced independently and was not fetched or integrated; the unmerged dirty P3 worktree is preserved.

## Decision Required — HD129

Context: TASK032's approved Definition of Done requires actual independent Sam review of this high-risk implementation, not just author self-review or green local tests.

- A: after reviewing this exact source delta and evidence, approve local TASK032 developer DoD; then record HUMAN approval and mark only TASK032 locally DONE.
- B: request specific amendments; retain TASK032 IN_PROGRESS and revalidate any changed source before another review.

Recommendation: A if the implementation satisfies your review. Approval binds only the exact source/PLAN/patch above; it grants no future source, publication/main integration, TASK033 execution, formal/UAT/business/release acceptance or capacity waiver. Default: hold TASK032 IN_PROGRESS/BLOCKED pending your actual answer, preserve all work and perform no publication or later Task implementation.
