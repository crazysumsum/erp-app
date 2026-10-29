# REV-133 — independent review of the DEF-048 fix (HD-153 A)

- **Reviewer:** `agent-skills:code-reviewer` (a separate agent; I did not write this change)
- **Baseline:** PR #298, branch `claude/supplier-def048-name-grams` at `140c369f`, reviewed as `git diff origin/main..HEAD` (base `e7f67b82`)
- **Verdict:** **CHANGES_REQUESTED**. 0 open critical, 0 open high. 1 Required (medium), 3 Optional, 3 Nits, and four points for the Product Owner.

## What the reviewer confirmed

- **The fix is safe.**
  - `createSupplierInTransaction` is the only caller that passes `isNew`; online create and import create both use it.
  - The id comes from the INSERT just before, and auto-increment ids are never reused. A deadlock retry re-runs the whole transaction and gets a new id. So no grams can already exist for that id.
  - Even if they did, the primary key would fail loudly.
  - The update path and every other caller are unchanged.
- **The tests discriminate.**
  - Reverting the fix turns the integration case red, and its control stays green.
  - Two unit mutants are killed: create without `isNew`, and update with `isNew: true`.
  - The full Supplier server suite passes 732/732.
- **The benchmark cannot hit the residual update-path deadlock.** Updates resend the same name, so the grams are never replaced. Each user updates only its own ids.
- **The developer evidence matches** the scratch outputs: 0/0 deadlocks with the fix, and 7/19 with it reverted, failing only on the new checks.
- **The two-step return to IMPLEMENT** is allowed by `state_tool` and disclosed. Since the transition table has no other edge, it was the only route short of hand-editing.
- **The script paths are covered.** They are covered by APPROVAL-HD-117-SCOPE-HD149 and APPROVAL-HD-122-SCOPE-HD149, both valid on plan `598f012b`.

## Disposition

| Finding | Disposition |
| --- | --- |
| R1: the deadlock check could pass vacuously with `innodb_deadlock_detect` OFF, and it dropped HD-153 A's "with innodb_print_all_deadlocks on" | The runner now checks both settings first, before it creates a schema. If either is OFF, it throws and every case FAILs. It records both settings and the absolute before and after counter values. Checked on the throwaway mysqld: with printing turned OFF, the runner failed every case in under a second and left no schema; the setting was then turned back ON. The change is recorded in DEF-048 and the TC map. |
| O1: a stale REPORT_ONLY bullet sat under the fix block | It moved above the block, relabelled "Before HD-153 (REPORT_ONLY)". |
| O2: the warnings file had no size cap and kept local paths | It keeps at most 200 lines plus a count, with the repository path replaced by `$REPO`. This is lint-clean but has not run yet; the formal runs will be its first use, and DEF-048 says so. |
| O3: "during import" spans the whole second load | The TC map now says so: extra deadlocks give a false FAIL, never a false PASS. |
| N1: the update assertion was over-strict | It is now `assert.notEqual(options?.isNew, true)`. The mutant where update passes `{ isNew: true }` still fails it, as checked. |
| N2: the fixed run's warnings were overwritten by the reverted run | Noted. In the formal runs each `run_check` execution has its own run directory, so this cannot recur there. |
| N3: the one-line flatMap and filter | Rewritten as a loop. The files are read in sorted name order, and every line carries its own timestamp. |

## Points for the Product Owner

1. **The check is stricter than HD-153 A.** It fails on any deadlock on the instance, not only name-gram ones. With printing now required on, a FAIL can be traced to its cause.
2. **The ledger narrowed "logs" to "warnings".** The ledger's paraphrase of HD-153 A said "warnings", where the option said "server logs". The record now quotes the option, and says the implementation keeps the warn and error lines. That is what the diagnosis used. It is put to the Product Owner to confirm.
3. **The harness has no VERIFYING or BLOCKED → IMPLEMENTING edge.** Step 1's authorization is recorded only in the prose of MODE-CHANGE-465. Revision 464 was never committed on its own, because the ledger commit `6487c939` holds 465. This is a harness gap.
4. **Residual risk:** an update against an update on adjacent ids can still deadlock. The existing retry covers it, and the benchmark does not exercise it.
