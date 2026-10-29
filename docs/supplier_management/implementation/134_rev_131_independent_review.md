# REV-131 — independent review of the TEST_AND_VERIFY entry, the formal runs and the Technical Acceptance report

- **Reviewer:** `agent-skills:code-reviewer` (a separate agent; I did not write this change)
- **Baseline:** branch `claude/supplier-technical-acceptance` at `80e00c1c`, reviewed as `git diff origin/main..HEAD` (base `a98e50e7`), PR #296
- **Verdict:** **CHANGES_REQUESTED**. 0 open critical, 0 open high. 3 Required, 3 Optional, 4 Nits, and points for the Product Owner. All of them concern the bookkeeping's accuracy; none questions whether the runs are genuine.

## What the reviewer confirmed

- **Mode change.** The external-import clause was used correctly. PLAN_READY on a `git archive` of `7bbf547d` gives LOCAL_CHECKS_PASS. `mode_entry_commit` is the PR #295 merge.
- **Baseline.** `code_commit 7bbf547d` is acceptable: it adds only `00_harness_state.json`, and the source fingerprint is the same in the state, in all 16 runs and in `inspect`.
- **Runtime record.** It is truthful: the mysqld process, port, socket, datadir, `--skip-log-bin`, the version, and node v26.6.0.
- **Evidence.**
  - All 16 run.json files match the report.
  - There is no metadata, tamper or probe issue.
  - Each run is a real execution: distinct run ids, and junit and stdout files that differ.
  - No secret appears in any added line.
- **Code citations.** Every one is exact.
- **DEF-048's facts.** Confirmed. The captured deadlock is in the REGRESSION run's own schema, at a time inside its import.
- **Report honesty.** The report is honest: BLOCKED is not presented as PASS, UAT was not run, and the wrong expectation is admitted.

## Disposition

| Finding | Disposition |
| --- | --- |
| R1: TC-101 failed two checks, and the docs named only one | `import.inside_measured_window` failed as well: the import ended at 03:40:24.195Z, after the load window closed at 03:40:21.338Z. It took 114.6 s, against 66.3 s at TECHNICAL. This is added to the report, to DEF-048, to the run observation, and to HD-152's answer record. HD-152 had already been answered when this was found, so the answer record says so, and the Product Owner is told. |
| R2: the gate result at the PR head is not "three reasons" | The report now says the three reasons hold at `7bbf547d`, state revision 459. It lists the issues the gate adds at later commits: `COMMIT_CHANGED`; `EVIDENCE_COMMIT` for all 16 runs; and `HUMAN_DECISION_REQUIRED` while HD-152 was open. It also states the consequence: these runs can never satisfy the gate at a later commit, so the final Technical Acceptance needs fresh runs at the frozen commit. |
| R3: DEF-048's key evidence was volatile | The deadlock section the reviewer saved is now committed as `testing/def048_innodb_deadlock_2026-10-28.txt`, as a diagnostic attachment and not as run evidence. It records the facts that tie it to this run: the schema name, and 03:40:20Z inside the import. `innodb_print_all_deadlocks` is now ON on the throwaway mysqld, so every later deadlock reaches its error log. |
| O1: the mechanism and the confidence levels | DEF-048 now names the cause and states each confidence level. The supremum lock comes from `replaceSupplierNameGrams`'s `DELETE` on a brand-new Supplier id under REPEATABLE READ. The heavy transaction is very likely the import's row transaction; that is inference. The light transaction, the online create, was the victim. The DEF-034 link is now called weak. |
| O2: the mode change did not say it used the import clause | One sentence is added to the report: the import clause checks PLAN_READY, and HD-149 A authorized entry with TASK-051 open. |
| O3: the host was not quiescent | The load averages recorded by the runner are now in the report and in DEF-048, as are the other module's mysqld and the import being 1.7 times slower. |
| Nits | Fixed: "TC-101 passed in both developer runs"; "commit `7bbf547d` (code-identical to `a98e50e7`)"; insert-intention wording corrected; why the three small result JSONs are identical across stages. |
| PO point: the environment's authorization text names `erp_dev` on 3306 | Stated in the report. Changing the profile would move the plan baseline. |
| PO point: severity | MEDIUM is kept as proposed. The 500s roll back with no data loss and can be retried. |
| PO point: a diagnostic run started while HD-152 was open on this branch | The Product Owner answered HD-152 A before the diagnosis started. The branch now records that answer. |
| PO point: a cheaper diagnosis | Adopted: `innodb_print_all_deadlocks=ON`, and the `lock_deadlocks` counter read before and after (256 at 03:58:28Z). |
