# HD-027 — operation lease renewal during a locked atomic transaction

Status: APPROVED A by actual Sam reply:「A：批准限定原子交易行鎖期間的續租例外（建議）」。Original proposal SHAeb54ffc869c69bbf1dc4e0c2bf5f3dc200f7c8550ab4ceb9745f8bf031e1f48b is preserved byte-for-byte privately. B is not adopted; concrete implementation and verification remain pending. This concerns the precise TASK029 renewal acceptance rule, not permission to repeat capacity tests or reduce any safety/transaction gate. Original HD026 A and proposal75 B remain valid for their exact scopes. All nonfunctional execution stays deferred until related UAT.

## Source-grounded conflict

TASK029 requires renewal at an interval shorter than half the operation lease. Existing normalized Fulfillment configuration only requires operationLeaseMs to exceed the application request timeout; it preserves default60000ms. The database transaction ceiling remains20000ms, with bounded connection acquisition. Valid configuration can have application request timeout30000ms, acquisition5000ms, transaction20000ms and lease31000ms. A single permitted atomic transaction can then exceed the15500ms half-lease interval.

Shipment PhaseB takes the original operation FOR UPDATE before Inventory preclaims and keeps that row lock until the complete atomic commit/rollback. A second connection's renewal UPDATE would wait on that same row. A renewal in PhaseB's own transaction is not a published renewal until COMMIT, and rollback loses it. It cannot establish an independently acknowledged half-lease heartbeat. Scheduler leadership is a different lease, in seconds, and does not replace the operation fence. Scheduler has no shared renewal API; its existing job-timeout-plus-grace lease remains unchanged.

Independent source-grounded direction review is private independent-p2-hd026-recovery-runtime-direction-review.json SHAae6e0ad4edea5ac0c372835c39503ff78be09387c5b05e5e9575bf2442b23aa7. Its unresolved MEDIUM is this acceptance/liveness conflict. No real capacity/performance failure is involved.

## Option A — narrow locked-transaction renewal exception (recommended)

Keep the existing configuration values/valid range,60-second default and20-second database ceiling. Renew the exact operation lease by acknowledged short transactions at protocol boundaries, before starting business PhaseB. Outside an atomic operation-row-locked transaction, maintain renewal intervals shorter than half the lease, with actual DB-clock/nonce/identity checks and bounded owned lifecycle.

Explicitly exempt only the time inside an actual bounded atomic transaction that already holds the exact operation row FOR UPDATE from a separate acknowledged heartbeat requirement. Do not start a second connection to renew the held row, release the lock, split PhaseB, or count uncommitted updates as renewal proof. Before posting, verify the published lease still covers the admitted work; check the exact lease/hash/target/original actor and current DB clock again at the final state CAS. A late/missing/unknown renewal, insufficient published lease, lost ownership, abort or expiry refuses/rolls back and remains pending. The20-second ceiling is never raised; no result is inferred from elapsed time.

Recovery inspection still requires the real registered running singleton/cluster invocation. Eligible original actors may obtain an expired-lease CAS and retry only in a new transaction through the ordinary Inventory/Sales writer checks. Revoked actors still require actual expiry, fresh directory proof, both owner and complete local ABSENT, and a new failure-only fence before atomic original-event FAILED/DRAFT. Unknown stays pending; retry exhaustion cannot guess FAILED.

The trade-off is an explicit, narrow refinement of the renewal acceptance text while the database row lock is the exclusive operation fence. A crashed process releases its database lock and is recovered under the original lease; competition may wait for the bounded transaction to end. Correctness, real expiry/CAS, permissions, quantities, rollback and complete functional review remain mandatory.

## Option B — preserve the literal half-lease rule by changing configuration

Increase the operation lease default and reject values that cannot cover the full bounded phase plus connection acquisition and a separately acknowledged renewal before half-lease. Derive and independently verify the minimum from actual database budgets, including acknowledgement and admission overhead, before selecting a number. Do not promise that the current60-second default always has enough margin, or pretend a timer request is an acknowledged renewal.

This retains the literal renewal condition but changes the accepted configuration range/default and lengthens crash-recovery waiting. Existing Fulfillment commands share operationLeaseMs, so compatibility/rollout and affected functional configuration regressions must also be reviewed. Any new test cases or larger workloads still need Sam's actual admission; this option itself grants none.

## Recommendation and pending boundary

Recommend A: it preserves the existing business transaction, default/config compatibility and all fixed safety gates while naming the row-lock exception precisely. Sam actually chose A. Implement only that narrow locked-transaction exception and complete its source/security/functional verification; do not declare TASK029/DEF029/P2 complete from approval alone. Continue the other approved client/query/UI and common Recovery identity/read-only work. The original expected registration RED is retained separately; it is not a Recovery implementation PASS.

## Implemented thin component and actual developer checks

Local `aed5d2bd` saves the exact independently reviewed lease helper and both existing consumers. The private actual-transaction boundary is created while the exact operation X lock is known held and is usable only after the database's real COMMITTED/ROLLED_BACK outcome. Published renewal is acknowledged before entry; a synchronous monotonic deadline check prevents a delayed timer callback from admitting late entry. Original caller cancellation is preserved. Final event/hash/actor/nonce/DB-clock expiry CAS and the20-second ceiling remain unchanged.

Actual current small functional results, recorded before that commit at `ecd0b42f`/source fingerprint `209c22f0018015a21b08f55eddb32ccd7aafa765e98d83eb70e78f3fe2b4cc46`:

- `permanent-failure-private-5ea36516a833/result.json`: exact1PASS,0FAIL/0SKIP,exit0/no timeout; original address conflict is proven absent before FAILED/DRAFT.
- `phaseb-private-b238f3447b26/result.json`: exact2PASS,0FAIL/0SKIP,exit0/no timeout; success/replay and intentional late-audit24-table rollback/same-event recovery.
- The preceding `permanent-failure-private-d10fa03cf1f6/result.json` is retained as FAIL: sandbox Unix-socket EPERM at initial connection, before CREATE DATABASE or product execution. The owned socket-only server UUID and only-base schema set were then checked read-only before the same reviewed runner executed outside the sandbox. No product timeout or NFR measurement occurred.

Independent source/actual-results closure `independent-p2-hd027-lease-thin-source-actual-results-closure-review.json` SHA `c7df6426d7b39b947bbd772cc992ce7f7eafa0a9bef78a1583b77cf8010fbf90`,0C/H/M. Raw reports keep their original commit/spec/fingerprint; the local commit is a byte bridge. Near-half timing, delayed entry, low valid lease, abort/unknown ACK and registered Recovery integration still need their approved bounded functional work. This is not TASK029 or P2 completion.
