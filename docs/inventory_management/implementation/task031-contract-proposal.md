# HD121 — exact TASK031 design/plan/scope candidate

PROPOSED_NOT_APPLIED. Actual latest Sam A answers HD120 and authorizes preparation of the minimal opt-in HTTP boundary extension, APR159. It is not independent approval of this unseen candidate. TASK031 remains IN_PROGRESS / BLOCKED; TASK026–030 DONE locally, TASK032–034 PENDING.

## Candidate for independent Sam review

[Exact four-file canonical patch](task031-contract-proposal.patch) / [hashes and exact scope](task031-contract-proposal.json).

- Proposed DESIGN `c99381982a7b07b8b310dbd0cabe2a40bd9118f6ce107c77ea211966c72ff265`
- Proposed PLAN `66647031a7b6db326ca1d51e745289616daba67e5c98a02939dc3eda2367c31e`
- Patch SHA256 `235425b04f5dba0f743d75e03799f5b722980e408d1ea3d8e10e3cd06b897ec7`

Only manifest, design, development plan and technical test specification change in the proposal; none is applied to the worktree. Existing requirements/UAT/typed ledger/generated matrix/profile commands, parsers, minima/zero-skip/34 coverage floors remain byte-identical. All160 native references and original failure runs remain on their original baselines, not new TASK031 proof. Source/HEAD and original0064 unchanged.

The exact contract incorporates HD112–120: one operation; IN complete dimensions vs OUT Balance ID/Status source ID; mandatory positive versions or explicit expected-absent null; existing Item Base/Pack conversion with mandatory uomId; fixed reasons with500 UTF8bytes and OTHER>=10 nonwhite codepoints; controlled new Lot/current submission date/no backdate; all positive Status expiry/minlife checks; Reservation/free quantity guards; paired status legs; original scalar-backed response.

## Shared scope and security trade-offs

Six new shared source/test approval paths only:

- server/src/framework/api/apiDefinitionResolver.js
- server/src/framework/middleware/apiDispatcher.js
- server/src/services/idempotency/IdempotencyService.js
- server/test/apiDefinitionResolver.test.js
- server/test/apiDispatcher.test.js
- server/test/idempotencyService.test.js

`idempotencyPreparation:true` is server-owned opt-in; only the new Adjustment/Status use it. Their prepare hook returns credential-free validated business input and a replay wrapper, after unchanged strong auth/schema. Missing metadata/hook/prepared values fail closed, no password-containing fallback. A callback wrapper, rather than an ordinary beforeReplay check that releases its transaction first, keeps current security read locks through sending cached response. Existing native HTTP scope/store/fencing/in-progress/conflict lifecycle is reused; no separate cache/strategy/bootstrap/policy/dependency.

Both new routes use existing inputCoercion:false and explicit604800000ms (7d) TTL. Existing global1h default and all old routes remain unchanged. More retention/read checks for these two actual consumers is intentional, not a change to global settings or a capacity sign-off. Missing global schema validation does not bypass new owned strict normalization.

The submission guard must use current locking reads after waits, not a REPEATABLE READ snapshot. Posting initial transaction checks do not hold auth locks across stock waits; final guard/current domain replay reads lock users, memberships/roles, permissions, device and token-version in declared order. An invalidation committed before the final guard wins, including while blocked on stock/claim/cache. If final guard read locks win first, later revocation waits until the serialized operation completes; there is no retroactive cancellation of committed stock. Deadlocks/timeout remain possible and must rollback, never renew proof or auto-retry. MySQL's [locking-read reference](https://dev.mysql.com/doc/refman/8.0/en/innodb-locking-reads.html) supports the mechanism, not observed26.7.0 runtime proof.

Two Inventory-owned modules cover the two real consumers: local WeakMap context and transaction-only Adjustment/Status posting. Reuse the Posting owner's existing Receipt Lot-resolution SQL (same semantics/Receipt regression) and existing auth comparison/stock locks/UOM/Operation/Audit helpers. Audit permits only two new safe summary identifiers, deviceId and signedRequestAt; no new table/permission, token/password/signature/context persistence, Item/auth source changes, or generic movement engine.

## Developer execution after approval

Three thin increments: shared capability/compatibility tests; trusted-context/domain unit and rollback; strict HTTP plus actual MySQL/API security/concurrency. TC007 defines16 named scenario rows with exact proof expectations; all are PLANNED/NOT_RUN. Reuse approved native Inventory/P3 movement/API/full server/client/lint/build/coverage commands and actual existing Transfer Playwright regression. There is no TASK031 UI change or mock-browser substitute.

New owned exact source/test list is in JSON, including only Posting/Adjustment/context/Audit/schema/handler, existing related tests, fakeInventoryDatabase and the two real integration files. Rebind eight precise shared framework/test paths (the six new ones plus existing TASK030 RequestValidator source/test), byte-identical0064 scope and existing owned synthetic migration use to the proposed PLAN. Existing0064 bytes remain unchanged; no new migration is proposed. Baseline approvals/evidence must be reconciled before any source/test/runtime writes.

## Actual self-review and remaining gate

Codex /root SELF_REVIEW, not independent: API/schema/hash/replay/lifetime and secret separation; snapshot/lock/revocation order; all-or-none stock/Lot/Operation/Audit; zero-skip current evidence; exact paths/legacy compatibility; smallest existing-framework extension. No unresolved blocking document finding after corrections. This is not source or execution verification.

Candidate structural traceability, matrix/pins and independent fresh-copy patch replay PASS; active state/trace/boundary PASS. Active PLAN_READY remains blocked solely HD121, awaiting actual independent Sam approval. Full candidate gate cannot pass before current DESIGN/PLAN/SCOPE approval. FormalTC/UAT NOT_RUN, no full-P3/capacity or release claim.

## Decision Required — HD121

Please independently review the patch and security/compatibility trade-offs above. Approve the exact proposed DESIGN/PLAN, applying these four canonical files, six new shared paths and two unchanged TASK030 paths/0064 scope rebind, then local TASK031 source/tests/developer verification on existing authorized owned synthetic resources. After implementation all mandatory fresh checks and a separate actual Sam implementation review remain required.

Recommendation: approve this narrow candidate after review; otherwise specify amendments. Default is hold canonical/source writes. Approval does not include staging/commit/push/PR/remoteCI/merge/main adoption, TASK032+, client/UI, new DDL/permission/dependency/global-auth/config edits, formal acceptance/release or any gate/floor/capacity waiver.
