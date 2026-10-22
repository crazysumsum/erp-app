# REV-112 — independent review of the HD-123 A profile change, and confirmation of REV-109 H-1 and REV-111 H-1

- **Reviewer:** `agent-skills:code-reviewer` (a separate agent; I did not write this change)
- **Baseline:** branch `claude/supplier-task-051-profile` at `45645330`, reviewed as `git diff origin/main..HEAD` (base `6cb8310c`)
- **Verdict:** **APPROVED**
- **Open Critical / High:** 0 / 0. No Medium, four Low, six Info.
- **REV-109 H-1:** **RESOLVED.**
  - JWT_SECRET comes from `test-support/testEnv.js`.
  - Admin credentials and `MYSQL_BIN` are in the four suites' `env_keys`.
  - `mysqldump` is probed.
  - Release `min_tests` is 2.
  - Control: the reviewer ran release without `DB_ADMIN_*`/`MYSQL_BIN` and got FAIL, then with them and got BLOCKED.
- **REV-111 H-1:** **RESOLVED.**
  - 12 of 12 top-statement plans are visible in every performance report, with no digests lost.
  - The only base-table scans are the HD-088 text searches.

## What the reviewer confirmed

- **Profile:** only the HD-123 changes; formatting unchanged.
- **Baselines:** design 29a0615a unchanged. Plan moves from 6cb156c3 to 6c885dba, which equals the state's `baseline.plan` and APPROVAL-HD-123-PLAN.
- **Approvals:**
  - 63 → 71: eight added, none removed or edited.
  - Each `-HD123` copy differs from its original only in id, baseline, source_ref (which quotes the original) and recorded_at.
  - `approval_valid` is true for every new record.
- **Defects:** the 12 re-pointed defects are exactly the scope of APPROVAL-HD-116-RISK-HD123.
- **Reviews:** unchanged.
- **Harness check:** `state_tool inspect` shows only COMMIT_CHANGED and SOURCE_CHANGED.
- **Ledger:** the PR #268 record matches gh.
- **Evidence driver:** it reproduces `run_suite`'s environment, probes, process, redaction, parsing and status rules. The reviewer reran release and resilience through it.

## Disposition

The standing instruction is to fix every review finding as recommended.

| Finding | Disposition |
| --- | --- |
| L-1: the `mysqldump` probe checks `PATH`, the runner calls `$MYSQL_BIN/mysqldump`. | The TC map says `MYSQL_BIN` must point at the same binary (a note rather than another profile change, as recommended). |
| L-2: admin credentials fell back per field (erp_user with the admin password); without them the suites FAIL. | `adminCredentials()` uses `DB_ADMIN_USER`/`DB_ADMIN_PASSWORD` as a pair. `exitUnlessAdmin()` makes every case NOT_RUN (BLOCKED) when `DB_ADMIN_USER` is missing, before any database is touched. Control: release without `DB_ADMIN_*` now reports BLOCKED, 3 NOT_RUN. |
| L-3: a LIKE anywhere exempted every scan in the statement. | `likeTables()` exempts only tables named in a LIKE predicate (an alias qualifier, or the unaliased FROM/JOIN table for an unqualified LIKE). A new unit case adds a scan of another table to a text-search statement and expects the plan check to fail. The real reports still pass. |
| L-4: the evidence driver missed process-start failure, unreadable reports and the after-run baseline check. | All three added (scratch tool, outside the repository). |
| I-1 to I-6 | No change. CONTRACT_DRIFT on the Item design pin predates this branch. MERGE_READY's stale run and review records are the stranding HD-123 expected; CI is the merge gate. Redaction of a short local password is cosmetic. Main merged in. The TC map now describes the driver method. |

Separately, the reviewer reported that the scratch `defsweep.sh` I had been sourcing as an env loader was a mutation sweep. Nothing reached a commit: neither mutated file has changed on main since c2237293, and no worktree of mine had changes. The script is disabled and replaced by an env-only file.

## After the follow-ups

Local, not CI. Through the driver:
- With admin credentials, resilience, recovery, release and performance each report BLOCKED with exit 0. The only gaps are the designed NOT_RUN parts. TC-131, TC-085, TC-101 and TC-129 PASS; probes match; no secret appears in the logs.
- Without admin credentials, release reports BLOCKED (all NOT_RUN).

Verdict unit test 2/2 with 45 cases; lint exit 0. Not re-reviewed.
