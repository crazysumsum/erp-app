# REV-128 — independent review of the TASK-051 completion boundary and the rehearsal rerun

- **Reviewer:** `agent-skills:code-reviewer` (a separate agent; I did not write this change)
- **Baseline:** branch `claude/supplier-task051-boundary` at `c8b1a326`, reviewed as `git diff origin/main..HEAD` (base `38f05ba6`)
- **Verdict:** **CHANGES_REQUESTED**. 6 Required, 6 Optional, 2 Nits, and three points for the Product Owner.

## What the reviewer confirmed

- **Equivalence.**
  - `supplier-security` has the same argv as `supplier-server-integration` apart from the report path, with the same cwd, env, adapter and skip limit.
  - `supplier-bank-security` is a strict file subset of that argv.
  - Leaving out `supplier-phase-001-server` is right, because its argv adds other modules' files.
- **Re-judged results** with the harness's `parse_results` and gate rule:
  - server junit sha256 `3ab29aa9…`: 730/730, 89/89 required IDs;
  - security 10/10;
  - the Bank subset 142/142 with 15/15 IDs;
  - client UI 208/208 with 11/11.
- **Commits.** `38f05ba6` and `a51a60b0` share one tree. PR #291's CI was 13 of 13 SUCCESS.
- **UAT split.** The 14 `test.fixme` cases match groups B and C exactly.
- **Defects.** The deferred list matches the ledger, and DEF-034 is OPEN.
- **Performance.** The runner fails closed on a full digest table, which is what failed run 1.
- **HD-147's analysis** holds: neither drifted design touches a contract Supplier consumes.
- **Rerun safety.** The rehearsal ran cleanly, and nothing marks TASK-051 complete.

## Disposition

| Finding | Disposition |
| --- | --- |
| R1: the rollback claim used `72e205ef`, which is not the release before 0103. The real one, `e6398b70`, has the startup schema check (DEF-033); its 0032/0033 inspectors reject `sort_order`, so it would refuse to start. No address or contact rows were seeded. Older README bullets are now false. | The rehearsal adds `e6398b70` and a new step C. Results: it **refuses to start** on the 0103 schema. The three statements in 0103's header, read from the file itself, are then run. After that, both tables are back to their pre-0103 columns and indexes, 0103 is out of the ledger, every row is kept, and `e6398b70` starts and serves the rows over HTTP. Rolling forward applies 0103 again and renumbers the rows. Step B now seeds two addresses and a contact. The read-through checks them, and 0103's backfill is checked as 1, 2 / 1, with every other column compared row by row. The 2026-10-21 rollback bullets are marked as holding for 0087 only. The 0103 production rollback, and the loss of user ordering, are a group C row. |
| R2: AUTO_INCREMENT came from `information_schema`'s day-long statistics cache, so a moved counter went unseen. | The fingerprint sets `information_schema_stats_expiry = 0` for its session. On the same instance, a counter that moved from NULL to 2 read NULL without the setting and 2 with it. The upgrade now shows `auto permissions 30 → 38`, which is accepted only because it goes up. A control adds and removes a Supplier in the restore, and must see the counter change and nothing else. |
| R3: the 41/14 UAT result was presented as one run on the PR head. | The page now gives both runs: the full config at `67472ee6` (41 passed, 14 skipped), and `uat-cross-phase.spec.js` re-run at `5ddfdb09` (2 passed). It also says that product code and every other spec are identical up to `a51a60b0`. |
| R4: DEF-034 named `evidence.importFailedRows`, a poll that was removed in `6f413337`. | The page and `04_defect_register.md` now name the real measures: `report.notApplied` (up to 20 rows), copied into `evidence.import.notApplied`, and the tools' reports kept in `supplier-performance-details/`. Both 2026-10-27 runs recorded an empty list. |
| R5: group A's evidence existed only in the session scratchpad. | Now committed in `testing/t51_evidence/`, with local paths masked: both junit files, the three-suite verdicts, the runner JSON and their stdout reports, both performance runs included. The page says that masking changes the junit's sha256. |
| R6: T51 Verification 3 and AC 2 were not tracked. | Verification 3 (the production-like Playwright smoke) is a group C row. AC 2 has a developer-stage row in A, and its formal part is in C. AC 1 and AC 3 are named on the deliverables row. |
| O: permission comparison not byte-exact | It now compares `CAST(… AS BINARY)`. A control changes one permission name's case inside a rolled-back transaction, and the comparison must count it. `role_permissions` stays covered by its data checksum in the fingerprint. |
| O: the control did not exercise exceptions or counters | Five invented changes must each be reported: a new column, another index on `supplier_sku_refs`, a removed `sort_order`, a moved Supplier counter, and a permission counter that went down. |
| O: index exception too broad | It is narrowed to 0087's two index names. `sort_order` is accepted only as an added column. The two party tables' data is exempt only because it is compared column by column. |
| O: fingerprint limits | Listed in the README's "Not covered": table options, CHECK constraints, generated-column expressions, FK column mapping, `sub_part`, privileges, and the 32-bit checksum. |
| O: no standalone Bank-suite run | Stated on the page. |
| O: the pin row is harness housekeeping, not downstream | Moved to group C. |
| Nit: 440,674 digests lost during the import in run 1 | Added. |
| Nit: the first two reruns' logs were not kept | Stated in the rehearsal README. |

A bug found while fixing: the first permission control changed a description to upper case. The descriptions are Chinese, so nothing changed and the control failed, correctly. It now changes the ASCII name.

## Points for the Product Owner

1. **Rollback across 0103.** It is now rehearsed against the real previous release, with the procedure that 0103's header already gives (REV-118 L-1, approved with the migration under HD-136). What remains is accepting at release that the order users set is lost. That is in group C. A code change to make older releases tolerate the column (the reviewer's option B) is not proposed.
2. **HD-147** (pin refresh timing) is still open.
3. **Committing developer-stage evidence.** It follows the committed rehearsal log and the run evidence under `docs/supplier_management/evidence/`.
