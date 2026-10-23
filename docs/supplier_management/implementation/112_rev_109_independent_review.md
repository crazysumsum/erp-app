# REV-109 — independent review of the recovery and release runners (HD-117 A PR 2, HD-119 A)

- **Reviewer:** `agent-skills:code-reviewer` (a separate agent; I did not write this change)
- **Baseline:** branch `claude/supplier-task-051-recovery-release` at `4c434b32`, reviewed as `git diff origin/main..HEAD` (base `b1897840`)
- **Verdict:** **CHANGES_REQUESTED**
- **Open Critical / High:** 0 / 1 (H-1, profile part deferred by HD-120 B). Two Medium, eight Low.

## What the reviewer confirmed

- **Full environment:** both runners do what the commits say; every local check passes, cleanup is complete after normal runs and after failures injected at four points (approval back to OFF each time).
- **Harness change:** the five integration files that use the harness pass 35/35 with `--test-concurrency=1`.
- **Mutants:** redo on takeover and a dump without `--hex-blob` are caught; the author's seven mutants hold.
- **Ledger:** the PR #263 record matches `gh pr view 263` and run 39563474338, and the MERGE fingerprint recomputes.

## Disposition

The standing instruction is to fix every review finding as recommended.

| Finding | Disposition |
| --- | --- |
| H-1: under the harness's own environment (profile `env_keys` only) both suites FAIL: no `JWT_SECRET`, no admin account, no `MYSQL_BIN`; `erp_user` cannot restore triggers with a definer or run migrations. | Runners import `test-support/testEnv.js` first, so `JWT_SECRET` no longer depends on the profile. Re-run with the harness-style environment: the app starts, and the run now fails on `mysqldump`'s privilege error (detected, not silently passed). Adding `DB_ADMIN_USER`, `DB_ADMIN_PASSWORD`, `MYSQL_BIN`, the redaction key and a `mysqldump` probe changes the profile and therefore the plan baseline: **HD-120 B** defers that to one combined profile change after the last runner PR. The TC map states the limitation. |
| M-1: `smoke.no_plaintext_stored` could not see plaintext in VARBINARY columns. | Each stored value is searched as bytes when it is a Buffer, and the ciphertext must differ from the account bytes. Control: an identity cipher now fails the check. |
| M-2: neither suite can reach PASS; the release suite has 2 executable tests against `min_tests` 3. | The TC map says rerunning cannot close them: only a risk approval, or a profile change once production evidence exists. `min_tests` is part of the HD-120 B profile change. |
| L-1: restored import files were never used. | New `reconcile.job_files_match_rows`: every restored job with files names files present under the restored root with the SHA-256 the job row records. Control: a restored job that loses its source file fails it. |
| L-2: CHECKSUM covers data only. | New `reconcile.schema_objects` compares table definitions, triggers, routines and events (107 objects, 13 triggers); a restored column spelling `CHARACTER SET` before an identical `COLLATE` is normalised. Control: a dump without triggers fails it. TC-135 now checks every migration file is in the ledger and records a schema digest; there is no release baseline to compare it with, and the map says so. |
| L-3: the no-redo check could not fail in create-only mode. | TC-134 now imports in upsert mode with an update row first; the update must apply exactly once (one `supplier.update` audit row, version +1). Control: a takeover that redoes that row fails it. |
| L-4: key-ring checks accepted any error. | Missing key must raise `BANK_KEY_UNAVAILABLE` and a wrong key `BANK_ACCOUNT_INTEGRITY_FAILED` (internal code; the public code is deliberately generic). |
| L-5: `mysqlClient` lost stderr on EPIPE, read the dump into one string, and missed errors on exit 0. | The dump streams through file descriptors, stderr is in every error, an `Error` on stderr fails even with exit 0, and `--no-tablespaces` is passed. |
| L-6: TC-133 could process other jobs, and concurrent writers would fail reconciliation. | Precondition: no other open import jobs. Checksums are taken before and after the dump and must match. |
| L-7: temp directories leaked when `start()` failed. | `stop()` removes the log directory even when the app never started. |
| L-8: "every Supplier capability seeded" over-claimed. | The map lists what is seeded and says SKU relations and supply events are not. |
| Nits: case ID derived from the name; a self-contradicting NOT_RUN reason. | IDs are explicit; the TC-134 reason now says restart is a second app in one process, lease expiry is set in the database, and client rollback is not shown. |

## After the follow-ups

Local, not CI, MySQL 26.7.0 with admin credentials: recovery 17/17 checks and release 26/26 checks PASS; reports parse as BLOCKED (NOT_RUN parts); eleven mutants each fail the intended check; harness-based integration tests 35/35; lint exit 0; no schema, fixture or temp directory left. Not re-reviewed.
