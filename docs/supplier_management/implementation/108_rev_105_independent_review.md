# REV-105 — independent review of the TC-006 carrier and the T51 rehearsal

- **Reviewer:** `agent-skills:code-reviewer` (a separate agent; I did not write this change)
- **Baseline:** branch `claude/supplier-task-051-upgrade` at `e09c61a8`, reviewed as `git diff origin/main..HEAD`
- **Verdict:** **CHANGES_REQUESTED**
- **Open Critical / High:** 0 / 2 at review time. Two High, three Medium, five Low, plus nits.

## What the reviewer confirmed

- **Ledger close:** the PR #258 merge record matches `gh pr view 258` and its checks.
- **TC-006 carrier:** sound for today's migrations. Writes to another module's table and changes to another module's schema are both caught.
- **API contract claim:** true. Nothing under `server/src/handlers`, `server/src/framework` or `client/src` changed between `72e205ef` and main.
- **Supplier migrations:** each has exactly one first-parent commit on main.
- **Rehearsal conclusions:** they hold on a full table list. The evidence behind them did not, see H-1.

## Disposition

The standing instruction is to fix every review finding as recommended.

| Finding | Disposition |
| --- | --- |
| H-1: `GROUP_CONCAT` truncated the table list at 1024 bytes, so the checksums covered 49 of 94 tables and missed every Supplier table and the business rows. `CHECKSUM TABLE` also misses schema, triggers, routines and counters. The script could not fail. | Fixed. Tables are listed one per row; a NULL checksum fails; the checksummed count must equal the table count. The fingerprint also covers columns, indexes, foreign keys, triggers, routines, views, events and AUTO_INCREMENT. The script runs with `set -euo pipefail` and stops on any mismatch. A control changes one restored row and must be detected. Result: **94 tables** restore exactly. The upgrade changes only the migration ledger and adds 0087's index. |
| H-2: `serve()` recorded the subshell's PID, so both servers outlived every run. Six were still running. | The six were all my rehearsal's servers, checked by command line and start time, and were stopped by exact PID. `serve()` now uses `exec`, so `$!` is node. Every server is killed on exit by a trap, and the port must be closed after the kill. After the final run, no rehearsal server remains. The log was regenerated from a clean run. |
| M-1: the carrier's "existing rows unchanged" check could be bypassed by a time-column change, a `WITH … UPDATE`, or a second statement in one query. | Fixed. TC-006 compares existing rows including their time columns. `WITH` counts as a write. A query containing more than one statement fails the run. Controls: the reviewer's three mutants now fail, together with the earlier four (seven in total). |
| M-2: the map counted TC-006 as covered beyond what the carrier proves, and its note gave a wrong path. | The Note now says the carrier is partly automated and lists exactly what is accepted from the manual record. The path is corrected. |
| M-3: "the previous server starts and /health is 200" was thin evidence for a server rollback. | Fixed. The rolled-back server, like the previous and current releases, reads the step-B rows over its own HTTP stack with a real user and device: Supplier list, detail and SKU relations, all 200. The README also notes that the SKU foreign key is enforced after a rollback, and that a server rollback reverts non-Supplier changes. |
| L-1: neither path ran the real runner over the real interleaved history with data. | Fixed. A new step A uses the pre-Supplier release `b3e5aa90^1` with its own runner, then applies the current runner's 58 files in main's order. Every pre-existing object, permission and grant is unchanged. |
| L-2: the instance and credentials were hard-coded, the password was on the command line, and `DROP DATABASE` was unguarded. | Fixed. The socket, port, user and password come from the environment with no defaults. The password goes through `MYSQL_PWD`. The script refuses unless the server reports the expected port, and only touches `erp_t51_rh_*`. |
| L-3: the drop check missed `DROP <column>` without `COLUMN`, and also `DROP KEY` / `CONSTRAINT` / `CHECK` / `PRIMARY KEY`. | Fixed. Every statement containing DROP or TRUNCATE is listed, and only 0087's index reorder is allowed. Control: the reviewer's mutant fails. |
| L-4: unpinned facts. | The test asserts the 15 Supplier migrations by number, and that system-admin is the only role granted `supplier.*`. |
| L-5: the ledger was stale. | `next_safe_action` is updated, and the run is recorded as an observation. |
| Nits | The README lists the three exported symbols and the non-Supplier server changes a rollback reverts, and says paths in the log are shown as `$SCRATCH`. The upgrade check now looks at both added and removed lines. |

## Found while fixing

The first runs of the rewritten script failed on three things in the rehearsal environment, not in the product:

- On MySQL 26.7.0 the triggers query needs a default database, and `MD5()` no longer exists; `SHA2(…, 256)` is used instead.
- Step A first treated every new object as a change. A real upgrade from pre-Supplier main also adds every other module's tables, so the check is now "no line of the before-fingerprint missing or changed" plus "every existing permission and grant row still present".
- An earlier run, before this review, had shown that the local mysql client defaults to latin1. That stored the Chinese name garbled. The client now uses utf8mb4.

## Verification after the fixes

- **Rehearsal:** passes end to end, with its two controls detected. No rehearsal server and no `erp_t51_rh_*` database are left.
- **Migration acceptance file:** 5/5.
- **TC-006 mutants:** seven in total, each failing for the intended reason.
