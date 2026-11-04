# HD-026 — trustworthy rollback and original-source recovery proofs

Status: APPROVED A by Sam actual currentchat reply A：批准安全修補、雙owner唯讀契約及相關chat協調（建議）. Original proposal SHAf404a227e53c1e151761d5729ec52933de2b71cb6b6fe8594d844fa7c38df88a is preserved byte-for-byte privately. Only the exact scope below is authorized; concrete implementation/security/testing gates remain required and three new P2 capacity scenarios are still NOT APPROVED. Current internal PhaseB success, exact late rollback and Create race results remain valid only on their recorded source. Permanent failure recording, revoked-actor cleanup and public Confirm/Recovery are not complete.

## Observed gap and limits of the evidence

`MySqlDatabaseService.withTransaction()` catches a rollback exception, logs it and can still throw the original business ApplicationError; its finally can release that connection. The existing case `a rollback failure is logged and the original error still surfaces` explicitly expects this release behavior. Thus neither a business error nor its public status proves confirmed rollback. This is a code/test-contract finding, not an observed native partial commit or a capacity/performance failure. Independent analysis receipt SHAa815e24537059d137d70df7837df3ae92381514fb4f8e8e961ca1d57dc1886d9 retains that distinction.

Do not claim a subsequent BEGIN necessarily commits a dirty session: the service first issues non-SESSION SET TRANSACTION, which MySQL rejects in an active transaction. A successfully established fresh actual RC transaction, the original operation current X lock and complete owner/local current witnesses can theoretically establish a new authoritative reconciliation independently of the original exception. However, current contracts do not supply those complete negative witnesses, and retaining failed-rollback sessions can damage pool availability.

Inventory `findBySource(null)` conflates absent and unfinished; its Sales-only member enumeration cannot enumerate Shipment Issue. Sales current Order/Line/mapping counters cannot prove absence of an original-event unfinished/foreign/malformed journal. A legitimate same-transaction Sales apply requires a genuine Inventory receipt, but that implication is not a substitute for recognizing inconsistent original-source journals. No missing local Issue projection, null lookup, caller DTO or serviceName is a zero-effect proof.

## Recommended A — bounded shared safety repair and owner-held read proofs

### 1. Shared transaction failure handling

Scope: `server/src/services/mysqldatabase/MySqlDatabaseService.js` and the existing `server/test/mysqlDatabaseFailureModes.test.js` cases only.

- If rollback itself fails, quarantine/destroy that exact acquired connection; never return it to the pool. Throw `DATABASE_TRANSACTION_INDETERMINATE`, retain the original failure as diagnostic cause and retain the safe rollback-failure log. Do not turn this into an original business rejection or automatic retry.
- Add a separate private WeakMap keyed by the actual transaction executor, with a read-only exported getter returning frozen terminal outcome. Only acknowledged COMMIT establishes COMMITTED; only acknowledged rollback establishes ROLLED_BACK; otherwise use INDETERMINATE. No setter, request option or command field can manufacture it. Active/missing transactions have no terminal proof. Keying by reusable Error objects is forbidden.
- The coordinator captures that actual executor only inside its real PhaseB callback and privately binds it to this original capability/event/hash/lease/attempt. A genuinely rolled-back but unrelated transaction cannot be borrowed as this attempt's proof. The getter supplies outcome only, never bookkeeping permission.
- Preserve normal commit/rollback behavior, global default isolation, actual active-isolation metadata, pool limits, statement/body limits and original20second application transaction ceiling. Existing timeout/error compatibility outside the failed-rollback branch stays intact; P2 must inspect the genuine terminal proof instead of inferring rollback from an old error label.
- Keep the existing failed-rollback case and fault injection, updating its unsafe release/original-public-code expectation to require destroy/no-release/indeterminate plus preserved original diagnostic cause. Add outcome assertions to already existing successful commit/rollback cases using their same transaction attempts. No new regularly discovered case or additional load is requested here.

This changes the exceptional rollback-failure behavior for all modules using the shared service. It is a safety improvement with a material compatibility surface, so HD010 does not silently authorize it.

### 2. Inventory original Issue outcome protocol

Scope: narrow additions in `InventoryLookupService.js` / `InventoryFulfillmentService.js`, an owner helper if needed, and the existing Inventory design contract pin. Preserve every old reader/writer ABI and all stock authorization.

Use a two-stage read protocol mirroring the existing prepare/post lock separation:

1. Prepare a read context on the caller's actual active RC transaction. Verify a genuine private Confirmation/Recovery failure-reconciliation capability, then take the existing Fulfillment Inventory scope row shared lock and original exact Issue root/member/leg source read locks **before** Sales/domain locks. Do not create/upsert a missing scope, claim an operation or upgrade shared scope to exclusive.
2. After the coordinator holds the appropriate Sales/local parents and complete saved source set, finish the owner read under the existing Inventory anchor order. Revalidate that same opaque context/capability/transaction and inspect the complete original event, root/member/leg receipts, movements, Reservation/Allocation identities/counters/current versions and source ownership. Selected100/50/5000 bounds remain; fail closed on overflow, missing schema, unknown membership or inconsistent source.

Return owner-defined ABSENT / SUCCEEDED / UNKNOWN with a genuine same-transaction proof. ABSENT requires zero original-event rows/effects, the complete own immutable picked set still unconsumed and held scope/parent barriers preventing a competing legitimate writer. It does not require global counters or versions to equal old snapshots: another legitimate Fulfillment may change them, and currentVersion≥last-sync remains valid only with all actual counters/source/active-Claim conservation checks. Unfinished, orphaned, foreign, malformed or partial records are UNKNOWN, never ABSENT. SUCCEEDED must reuse the actual owner receipt decoder and validate exact sets/hash/quantities/movements. An Inventory success inconsistent with the local atomic operation is a reconciliation incident; it does not authorize compensating or inferred success writes.

The read/failure transaction cannot later claim/post or upgrade its shared Inventory scope. A normal business retry ends that transaction and starts the unchanged original preclaim-X PhaseB path in a fresh transaction.

### 3. Sales original-event outcome read

Scope: a narrow read addition in `SalesFulfillmentService.js`, its existing design contract pin and required owner review.

Under the same actual RC transaction, after Inventory read-scope preparation but **before Sales/domain parents**, acquire the original indexed event/target journal shared lock. Only then acquire the Sales parent and required Line/mapping read locks, and read the current projection. This follows ordinary Sales operation-before-parent order and avoids journal↔parent deadlock; a held-parent caller must not later wait for the journal. Reuse the owner terminal decoder for complete success; distinguish ABSENT, SUCCEEDED and UNKNOWN, including unfinished/foreign/malformed journals. Bind the opaque proof to transaction, original event, Shipment, SO, actor and immutable intent. Read only; do not create a Sales operation or change ordinary CLAIM/apply/authentication. Current quantity projections remain part of the complete conservation check, not the journal absence proof.

### 4. Fixed-purpose capability and local failure transition

The trusted Confirmation coordinator/Recovery runtime mints private opaque sessions only from its genuine original PhaseA capability or an actual registered cluster-leased Recovery execution. A copied object, JSON field, replacement actor or arbitrary serviceName cannot authorize the owner read. Constructor wiring is trusted code, never HTTP/config input; authorization closures validate the runtime/session, current actual transaction, original locked operation/event/hash/target/actor, lease fence and AbortSignal before and after owner reads. Proofs remain private WeakMap identities and never enter public responses.

Cluster leadership is not ownership of an individual operation. A trusted Recovery execution may mint only a read-only inspection session under the original current operation X lock until it has actually obtained the per-operation fence. Immediate failure bookkeeping requires the private actual PhaseA/attempt lease token, still matching and live; reading lease_owner from a row does not grant ownership. Active-actor business Recovery uses the ordinary expired-lease/fresh-original-actor CAS takeover. Revoked-actor cleanup cannot borrow that success authority: only after expiry, fresh genuine ineligibility and complete owner/local negative proofs may a separate fixed-purpose fenced CAS mint a local-failure-only session, followed atomically by FAILED/DRAFT. Before the actual CAS, or if the lease is still held by another live worker, no local failure write is authorized. No later implementation review may waive this per-operation gate.

Successful Issue/Consume/Sales posting always uses the original actor, freshly revalidated through ordinary owner permissions and genuine existing same-transaction preparation/receipt. The fixed-purpose capability grants only source reads and local failed-attempt bookkeeping. If the original actor is freshly proven inactive or missing required permissions, it cannot authorize Inventory/Sales business writes. Directory/provider errors do not prove revocation.

For a permanent business failure, first obtain a genuine ROLLED_BACK attempt proof or perform a new independently authoritative complete reconciliation. In a new actual RC failure transaction, acquire original operation X and exact lease/hash/target fence, prepare Inventory read scope before Sales/local roots, then obtain both owner and local complete negative witnesses. Only then atomically write original operation FAILED, Shipment DRAFT with confirmation event cleared, safe immutable failure history/audit and version CAS. Preserve the original recorded actor/intent; no data deletion, Claim release, compensating movement or new event. Missing identity, conflicting/terminal state, lost lease or any UNKNOWN cannot be overwritten.

Unknown commit/rollback first observes the original current operation X lock and complete original-source facts. Replay an already consistent terminal result; an inconsistent or unproven state remains SHIPPING/IN_PROGRESS with safe diagnostics and bounded recovery/alerting. Do not infer FAILED from elapsed time, retry exhaustion or an exception. Expired-lease takeover, renewal/fencing, bounded backoff/jitter, shutdown and owned HTTP≤3second200/202 remain required subsequent concrete implementation reviews under the existing approved P2 design; this decision is not an implementation PASS.

## Scope, coordination and validation cost

If A is approved, coordinate the exact shared DB/Inventory/Sales scope with their owner chats and PM before editing overlapping files; preserve other streams. Update the relevant contract documentation/pins and faithful approval lineage, not old evidence hashes. No new owner write API, permission grant, global isolation change, dependency, migration, pool increase, transaction deadline or HTTP input limit.

Use the already approved proposal75 B Recovery/owner-proof/unknown-outcome finite small scenarios and the existing DB failure cases; do not add regular cases, fixtures, repetitions or jobs outside that budget. The legacy case assertion replacement above is explicitly part of A, not deletion/skipping of a failing case. Private minimal functional reproduction is permitted by current policy. Full shared regression and final-candidate CI are still required. Shared dependency changes may select more **existing** capacity groups under PM's current diff router, so actual candidate CI cost is unknown until observed; no new capacity workload is admitted here. The three proposed P2 local capacity scenarios remain NOT APPROVED under Sam's B and must not execute.

## Options

A (recommended): approve only the shared rollback-failure discard/indeterminate/actual-transaction proof, the two narrow owner outcome read protocols, fixed-purpose local failure reconciliation, the exact legacy assertion correction, and owner/PM coordination described here. Complete concrete source/security/fault reviews and existing approved functional validation before exposing Confirm; retain all original gates and limits.

B: hold these new shared/owner changes and the affected permanent-failure/Recovery/Confirm path, while continuing independent P2 inquiry/client/UI preparation and already admitted validation. No full P2/draftPR readiness is claimed. A fresh-transaction reconciliation adapter is a theoretical alternative, but current APIs do not yet prove it; a different complete proposal would still need review and a decision.

No default execution or approval is inferred from silence. Shared repair is strongly recommended, not described as the only logically possible architecture.
