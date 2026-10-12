# HD110 — exact TASK030 input-coercion candidate

## Adopted checkpoint — Sam approved HD110 on 2026-10-07

Actual Sam 「已審閱，批准 HD110」 approved the exact candidate below. Four canonical files applied; HUMAN REV088 / APR144–148 preserve the actual independent DESIGN/PLAN and precise scope decision. APR147/148 normalize only the native module subject, retaining APR144/145; no new authority. Adopted DESIGN46841dae / PLAN8ab85d87 and six shared paths match the candidate; existing0064 is byte-identical. PLAN_READY and boundary passed before implementation.

TASK030 domain/framework/HTTP implementation is developer-verified on sourcefe3130fe; [final implementation review and evidence](task030-implementation-review.md) received actual Sam HD111 approval, HUMAN REV090 / APR149. TASK030 is DONE locally; no later Task or publication authority. The original proposal and candidate hashes below are historical records, not a currently unapplied candidate.

## Historical proposal — before HD110 approval

PROPOSED_NOT_APPLIED. Sam's actual latest A answers HD109: implement a minimal backward-compatible opt-out for Bin Move only. It authorizes this candidate preparation, not independent approval of unseen DESIGN/PLAN hashes. TASK030 remains IN_PROGRESS / BLOCKED, resume IMPLEMENTING. No canonical or framework source changes applied in this checkpoint.

## Candidate to review

[Exact four-file patch](task030-input-coercion-proposal.patch) and [SHA256 metadata](task030-input-coercion-proposal.json). DESIGN `46841dae185fab06e626fca722d1576726702a3d7183fdbb2f23e3459de7f663`; PLAN `8ab85d87051f437b74c6cfb4efc39ba93c8c2dd9e56ca7ea210d7bc5bc705dc8`; patch `df0c1687b723a53cf642304b641a55d170818d3c18663825646e2c2c1f7b9470`.

Four canonical files only: manifest, design, development plan and technical test specification. `static.api.inputCoercion` is optional; only omission or literal false is valid. Only Bin Move sets false. Resolver passes it through dispatcher to the optional third argument of RequestValidator.compile; compile creates a separately configured validator once during route compilation, not per request or by mutating the shared validator. Schema rejects numeric strings/booleans before HTTP idempotency claim/cached replay and handler. Omitted metadata retains existing behavior; invalid values fail startup. Global validation.enabled/defaults/trim/unknown-field/error policy is preserved; no route can re-enable globally disabled validation.

Exact new approval-required shared paths:

- server/src/framework/api/apiDefinitionResolver.js
- server/src/framework/middleware/apiDispatcher.js
- server/src/framework/validation/requestValidator.js
- server/test/apiDefinitionResolver.test.js
- server/test/apiDispatcher.test.js
- server/test/requestValidator.test.js

No broader allowlist, global request configuration, auth/Idempotency/Item service changes, dependency, permission or new DDL. Rebind the already approved byte-identical `server/database/migrations/0064_create_inventory_transfers.js` and its existing isolated synthetic developer migration use to the new PLAN; its SHA remains `07653bb700a40b026e8bb46b538e0e31b112d6c20010af45b4cc71a6ff7ac143`.

## Validation and actual review

STRUCTURE_PASS; generated matrix byte-identical; provided Design pin matches; consumed Item pin unchanged; fresh-copy apply_patch replay matches all four after-SHAs. Requirements, profile argv/parsers/min_tests/zero-skip/34 coverage floors, UAT and traceability ledger/matrix are byte-identical. TC scenarios remain NOT_RUN. Codex /root SELF_REVIEW only: correctness/security ordering, omitted-policy compatibility, startup-only allocation, scope and test requirements examined; no blocking proposal finding. Sam independent review has not occurred.

HEAD `869ac07abdd3879254c351d857be911d71e68b6b`, source `b87a2df4c0fa3583f20d8d79067600dda0d7c62fd8bde8310dbe25a2a8027c72` and active DESIGN3df1df58 / PLAN64ce9971 remain unchanged.143 indexed native reports, including existing MySQL15/15 domain proof, stay on original baselines; none proves new framework/HTTP behavior or is rebound. No new API/DB/UI/CI/product verification executed for this document candidate.

## Decision Required — Sam independent baseline approval

Context: the six shared paths change module scope, thus DESIGN and PLAN; existing hash-bound approvals cannot silently authorize the new baseline. Recommendation/default: approve the exact candidate after your independent review; otherwise hold canonical/source writes and identify amendments.

Approve applying this four-file patch, independent DESIGN/PLAN approval, the six precise shared paths plus unchanged0064 new-PLAN scope, and local TASK030 framework/handler/test work and developer verification using already authorized owned synthetic resources. After approval, reconcile gates, implement and rerun same-source/PLAN framework compatibility, real Bin Move HTTP/MySQL and applicable developer suites; then request Sam implementation review. No commit/stage/push/PR/remoteCI/merge/main adoption, TASK031+, formal acceptance/release or check/capacity waiver is included.
