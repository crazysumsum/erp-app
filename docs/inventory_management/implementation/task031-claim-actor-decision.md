# HD122 — TASK031 Operation actor foreign-key lock timing

## HD122 disposition — Sam selected A; HD123 exact candidate pending

Actual latest Sam reply A in this active conversation selects HD122 option A: only new TASK031 Operation temporary NULL actor in the uncommitted posting transaction, bind true trusted actor after final current security guard, exact-row check and whole rollback, no DDL/FK removal/shared-auth change. Direction and exact candidate preparation only; not independent approval of unseen replacement DESIGN/PLAN or newly discovered positive-Lot created_by deferral. HD123 presents the exact four-file candidate, additional owned-new-Lot clause and existing precise scope rebind. Active specs/source/head unchanged, DEF009/010 HIGH OPEN, 164 original evidence refs retained. No source/test/runtime/publication/laterTask/formal/capacity/floor waiver; future Sam implementation review required.

Source review additionally found unchanged0059 Lot created_by users FK before subsequent Bucket waits. Its narrowly scoped creator deferral is proposed explicitly for HD123, not silently adopted or claimed verified. See [exact candidate](task031-actor-binding-proposal.md). Original DECISION_REQUIRED report below remains historical; active source/specs unchanged, both defects OPEN.

## Historical checkpoint — before Sam HD122 A

Status: DECISION_REQUIRED. IMPLEMENT / TASK031 remains IN_PROGRESS, not DONE or publishable.

## Observed baseline and developer evidence

Sam's actual HD121 approval was recorded as HUMAN REV091 / APR160–162 and the fixed four-file candidate was adopted. Current DESIGN `c99381982a7b07b8b310dbd0cabe2a40bd9118f6ce107c77ea211966c72ff265`, PLAN `66647031a7b6db326ca1d51e745289616daba67e5c98a02939dc3eda2367c31e`, HEAD `869ac07abdd3879254c351d857be911d71e68b6b`, source fingerprint `20ec89c06143f630bd00a5c4307d3ceb94936601b587fb610f8c5d74196aa00b`.

The shared first increment passed native server2160 / original34floors / lint on its earlier source `9e67c7446395c13d95f7b0b1e0012ac0d2607b7ff32378d7307d573cb8b281fb`. Later focused framework/Inventory unit checks passed110 before the native test-file addition. These are separate source-bound DEVELOPER observations, not current full-task or formal acceptance.

Current-source native MySQL26.7.0 execution is **FAIL: 21 passed / 3 failed / 24 total / 0 skip**. Immutable original report: [run.json](../evidence/task031-movement-inventory-p3-movement-database-c14be4f826/run.json), [native XML](../evidence/task031-movement-inventory-p3-movement-database-c14be4f826/inventory-p3-movement-database.xml). All15 old TASK030 cases passed; six of nine new aggregate cases passed, not all subcases or all16 planned scenarios. Evidence164 references retain their original baselines; none are promoted to current-candidate completion.

The owned socket-only schema `erp_inventory_p3_e97c542279df` was dropped and observed absent, daemon exit0/socket absent, exact temporary root removed and lease/caffeinate released. Synthetic runtime data is unrecoverable; native evidence is retained. No shared/production database, remote CI/publication or merge was used.

## Root cause / material impact

`InventoryOperationService.claim` inserts a non-null actor_user_id before acquiring stock locks. Unchanged0056 defines `fk_inventory_operations_actor` referencing users(id). InnoDB foreign-key checks acquire shared parent-record locks; see the [official26.7 locking rules](https://dev.mysql.com/doc/refman/26.7/en/innodb-locks-set.html). Source plus the observed isolated process list support this diagnosis: one posting connection waited on the Warehouse FOR UPDATE while another connection waited on UPDATE users(status) for the same synthetic actor. The native revocation test failed with CONCURRENT_OPERATION instead of PERMISSION_STALE; it also exposed an assertion-promise handling problem in the new test that needs correction, not a PASS or security bypass.

This implicit user lock is acquired at Operation claim, before the designed final security guard. Thus merely making initial security SELECTs non-locking does not satisfy §5.4.2's no-security-lock-across-stock-waits promise. The existing real UserAdminService.disable also revokes the token version independently before changing status; that can still invalidate a pending operation, but does not eliminate the earlier user-row lock or justify silently changing the approved serialization point.

No actor-lock workaround, FK removal/check disabling, shared-auth/admin rewrite or acceptance weakening has been applied. Existing partial source and failed tests are preserved.

## Options requiring Sam's decision

A (recommended): for only the two new TASK031 commands, claim the Operation with temporary NULL actor_user_id (existing nullable column) while retaining the original actor label/context. After all stock waits and the final current security guard, bind the real actor_user_id to that exact still-uncompleted Operation in the same transaction, require exactly one updated row, then write stock/Movement/Audit and complete. No committed incomplete/NULL-actor successful row, no DDL, FK removal or new permission; final committed actor and audit trace stay unchanged. Add native binding/rollback/revocation-first/guard-first/source-replay checks. This changes internal transaction metadata timing and requires canonical design/task/test proposal plus new exact baseline review before implementation.

B: retain current non-null actor claim and explicitly amend the contract to acknowledge earlier user-row serialization at Operation claim. Device/role/permission/token final guards remain; user disable may wait across stock locks and eventually timeout/deadlock. Fewer changes but longer security/admin lock contention and a changed serialization guarantee; cannot label this the existing approved no-early-user-lock design.

Default pending answer: hold the affected posting/security path and completion/publication. Sam's choice is direction for an exact candidate, not independent approval of unseen replacement hashes/source, formal acceptance or a check/floor waiver.

## Other native failures (not separate business choices)

Two Lot/life cases failed because mysql2 returned MySQL DATE values as JavaScript Date objects while the existing validation helpers require calendar-date strings. The old Transfer implementation already uses SQL DATE_FORMAT to preserve these dates. Diagnose/fix inside approved owned paths with that established pattern and rerun Receipt compatibility; do not alter global DB config, enable dateStrings just in the fixture to hide a production mismatch, or weaken date validation. The new rollback aggregate's positive-Lot failure injection was not established as reaching Audit while this earlier date failure exists; no overclaim from its aggregate PASS.

Real strong-auth HTTP/MySQL, full-server current-source coverage/floors/lint, Transfer Playwright compatibility and actual final Sam TASK031 source review remain pending. Formal TC/UAT NOT_RUN; TASK032+ and publication remain unauthorized.
