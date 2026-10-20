# REV-097 — independent review of the core, state and child-ownership carriers

- **Reviewer:** `agent-skills:code-reviewer` (a separate agent; I did not write this change)
- **Baseline:** branch `claude/supplier-task-051-tests-4`, reviewed as `git diff 0fa41eef..HEAD -- server client docs/supplier_management`
- **Verdict:** **CHANGES_REQUESTED**
- **Open Critical / High:** 0 / 0. Two Medium, three Low, plus Info items.

## What the reviewer confirmed

The reviewer ran the core file eight times in a row, once with coverage, and three more times under `taskpolicy -b` with coverage. Every run was green.

They confirmed the concurrent requests overlap:

- **TC-027 and TC-038:** with `FOR UPDATE` and the `AND version = ?` predicate removed, both went red in 3 of 3 runs. This control is stronger than mine.
- **TC-020:** the create race reaches the unique constraint.
- **TC-024:** each of 5 runs gave one 201 and five `IDEMPOTENCY_IN_PROGRESS`.

They also confirmed:

- TC-036's 503 is caused by the unknown-status fixture.
- TC-031, TC-034, TC-045 and TC-046 assert their main Expected Results.
- Extracting the harness changed no behaviour.

## Disposition

The standing instruction is to fix every review finding as recommended.

| Finding | Disposition |
| --- | --- |
| M-1: a failure inside TC-036's lock window left the row locked. `after()` then timed out deleting it, so the app was never shut down, the process hung, and the core51 users were left behind. | Fixed. Both lock windows in TC-036 release the lock and wait for their transaction in `finally`. `h.stop` now removes fixtures in `try` and shuts the app down in `finally`. Control: with `suspend` made to throw, TC-036 failed within 2 s, the process exited, and no core51 users or test Suppliers were left. |
| M-2: TC-017's "a failed create leaves nothing" passed vacuously, because the duplicate is refused by a pre-insert check before any write. | The map Note and the test comment now say that atomicity is not asserted here. Rollback after an audit failure is carried by TC-028 (`supplierManagement.integration:88`), which I checked. |
| L-1: TC-036's second order ran with no lock held. | Fixed. A new step has connection B hold `FOR UPDATE` with an uncommitted suspend while connection A, whose snapshot is already set, calls `assertUsableInTransaction`. A must wait for B and is then refused with `SUPPLIER_NOT_USABLE`. Control: with the step that holds A's lock first removed and the lookup's `FOR UPDATE` dropped, this step alone fails, because A no longer waits. |
| L-2: the client test checked only the aria-label. | Fixed, and it found a real problem: Quasar's `q-banner` defaults to `role="alert"`, so this non-blocking hint was announced as an alert. The warnings banner is now `role="status"`; the blocking-issues banner keeps `alert`. The client test now checks the visible text 「不影響啟用」 and that the role is not `alert`. A browser test (`supplier-list-filters.spec.js`) checks the `status` role and that no alert is shown. Control: removing `role="status"` fails it. |
| L-3: the ledger named the old harness path. | Corrected in the next ledger record. The harness is `server/test/integration/supplierHttpHarness.js`. |
| Info: TC-020's refusal snapshot left out `suppliers`; TC-031 had a needless fallback; TC-024 did not assert the 409. | All three fixed. TC-020 checks that no root row exists for a refused name. TC-031 checks that the issue names `supplierName`. TC-024 asserts `[409, "IDEMPOTENCY_CONFLICT"]`. |
| Info: the 500 ms window in TC-036 could only pass falsely, and only on a very slow machine. | Kept. It cannot fail falsely. |
