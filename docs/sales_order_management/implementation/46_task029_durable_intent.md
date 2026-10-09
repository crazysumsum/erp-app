# TASK-029 Phase A developer checkpoint

The actual adopted DEC-021 DESIGN dbb9b2ea / PLAN e61659d8 remain unchanged. Confirmation Phase A now commits a fixed CONFIRM_ORDER intent, original actor/event/target/payload hash, minimal version recovery payload, DB-clock lease, CONFIRMING header CAS, append-only history and required safe audit in one transaction. Replays preserve the original event/lease and recheck current permissions; a second intent or stale version cannot commit. Inventory is untouched.

Actual unit56 PASS/0 FAIL/skip includes all51 P1 tests and5 new Phase A cases. Native26 PASS/0 FAIL/skip includes4 new real SQL cases and22 directly affected P1 commands. Required lint passes. The native proof checks an independent service instance, valid DB-clock lease, competing events, real permission revocation and real transaction rollback after required audit failure.

Separate reviewer `/root/sales_p1_review`, TASK029-R1-20261007 APPROVE, source25415f0dc2b8dbd9d05e5149db2808d16dcb70d5f356a9570e39a82346839e26; actual independent unit56/focused lint pass and native26 original log review. Raw failure/R2/R3 artifacts remain private in sales-p2-private. Initial fixture incorrectly disabled the global scheduler, correctly rejected by JWT revocation configuration; only the specific Sales recovery/allocator jobs are now disabled in the fixture. The required audit failure assertion now checks the existing transaction wrapper's original cause.

This proves the committed Phase A boundary, not a completed confirmation or actual killed-process recovery. Phase B, owned crash/ack-loss, UI/browser/performance,28 suites, current-candidate CI and whole P2 merge remain pending. No formal acceptance/UAT or release claim.
