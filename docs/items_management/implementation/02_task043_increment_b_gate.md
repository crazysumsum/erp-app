# TASK-043 increment-B execution correction — 2026-10-12

Owner decision: Sam's active-task 「批准」 accepts the proposed narrow correction:
independent increment-B gate and isolated-test environment configuration, without
changing business scope or lowering checks. This is not a CI/acceptance waiver.

DESIGN remains `59ee6cb3664ae1742e41b218ffd3bf223e396eb44a4aa24d82028ebb9cf7c16d`.
Corrected PLAN: `01e51df95e1e8742e765c18ec3dcf8205d8b30dd97a9a2feb7b9b7221adef66a`.
Source fingerprint: `d2b9e7c67cd0a54a47746c09fc9282f7bf65f4703d73bcdc40dc448dcb6f986e`.
Existing PR: #198, original candidate `26354042c21a3f6ba453c7b416bfb32299697334`.
Fetched main remains `0feb9d712072048adb20afc470eb87abc8911475`.

## Execution-record changes

PHASE-007/TASK-045 represents only the already approved TASK-043 increment B.
TASK-043 remains the aggregate IN_PROGRESS task and depends on TASK-045; PHASE-006
depends on PHASE-007. Supplier C and formal acceptance D remain outstanding.
All four mandatory developer suites, existing formal applicability/blocking flags,
skip limits and required CI checks are preserved. The server argv additionally
executes actual Item reference guards and the affected Sales Item-UOM compatibility
test. Its env allowlist adds the socket and eight existing CI crypto variables;
keyrings are redacted, with no literal credential written to the profile.

## Preserved failure and repair

Original-candidate CI run `37914121452`, job `113766047583`, failed one assertion:
Sales Item-UOM compatibility expected the old redundant SKU+mapping predicate.
The new helper binds a globally unique mapping ID; the behavior check already
rejected referenced removal correctly. Author reproduced 3 pass / 1 fail, then
updated only SQL-shape/parameter assertions; 4/4 now pass. Blocking, rollback and
ordinary price-edit assertions remain intact. No Sales or Item product code changed
in this correction; no failed test was removed/skipped. The old failed CI remains
historical and cannot establish the new candidate's CI result.

## REV-020 — independent execution-contract review

Method SEPARATE_AGENT, author `/root`, reviewer `/root/item_supplier_handoff_review`.
Actual final response approved the PLAN/source above with no actionable finding.
Reviewer independently ran compatibility/lookup/error suites: 96/96 passed, zero
skips; checked traceability/generated matrix, acyclic dependencies, unchanged
product hashes, env keyring redaction and preserved thresholds. No reviewer DB or
browser execution was claimed.

## Runtime and pending observations

The old temporary worktree and MySQL directory were absent after the interruption.
Only the stale Item worktree registration was removed; its committed/pushed branch
was recovered intact. Other module worktrees were untouched.
New disposable MySQL 26.7.0 runtime: `/private/tmp/erp-item-task043-mysql.XDoqyf`,
schema `erp_item_task043_20261012`, socket-only, TCP/MySQLX disabled. Existing
migrations through 0079 applied successfully; shared databases were not changed.
Configured developer runs, exact new candidate CI/review and merge observations
will be recorded below. Previous developer results are supporting history only,
not current-plan runner results or formal TC/UAT acceptance.
