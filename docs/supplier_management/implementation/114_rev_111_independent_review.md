# REV-111 — independent review of the performance runner (HD-117 A PR 4)

- **Reviewer:** `agent-skills:code-reviewer` (a separate agent; I did not write this change)
- **Baseline:** branch `claude/supplier-task-051-performance` at `9fa31b9d`, reviewed as `git diff origin/main..HEAD` (base `94d52972`)
- **Verdict:** **CHANGES_REQUESTED**
- **Open Critical / High:** 0 / 1 (H-1, fixed below). Five Medium, four Low, four Info.

## What the reviewer confirmed

- **Replay:** the saved reports give the same verdicts through the module, and every check id can fail. 21 mutants were run: 10 were caught, and the 7 surviving conditions are M-3.
- **SIGTERM:** a mid-run SIGTERM drops the schema and kills the tool child.
- **Ledger:** the PR #265 record matches `gh pr view 265` and run 39707483652.
- **for-SKU count:** design §8.7 confirms the lookup lists every Active Supplier, so the Active count is the right expectation.

## Disposition

The standing instruction is to fix every review finding as recommended. H-1, M-4 and L-3 needed two T50 tools changed, which was approved as HD-122 A.

| Finding | Disposition |
| --- | --- |
| H-1: the "no full scan" checks passed on plans that were never seen; the three most expensive statements had none (the MySQL's 1,024-character samples), and the 400-character digest hid `LIKE`. | The verdicts fail any top statement with no plan and unindexed executions. Replayed, the earlier passing run fails TC-085 and TC-129 on exactly those statements. `benchmarkSupplierManagement.js` keeps the full digest (HD-122 A). The local MySQL was restarted with 16,384-character statement texts. The final run shows 12 of 12 plans in both reports; the only base-table scans are the HD-088 text searches. |
| M-1: "5 times faster" not enforced; the list count had no join; no short spike. | `capped.p95 × 5 ≤ uncapped.p95` is enforced. The count check uses a search ("123") that matches two identifiers per Supplier: the API total must equal `COUNT(DISTINCT)`, and the joined count must be larger (762 against 1,055 in the final run). The short spike is named as a gap; TC-129 stays PARTIAL. |
| M-2: "answers after all runs" uses a new app; saturation recorded, not judged; no ramp-up. | The map says a fresh app instance answers. Resources are judged (DB threads at most one pool plus 3, RSS at most 1 GiB). No ramp-up and unjudged CPU are named as gaps. |
| M-3: seven conditions inside checks had no unit case. | The unit test now breaks each condition of each check (44 cases), and `mixed` and `forSku` no longer share one statements array. |
| M-4: nothing checked that the import ran inside the load's measured window; import resources unjudged. | The load tool reports its window and prints it at the start (HD-122 A). The runner starts the import 1 s after the window opens, and a new check requires the import's upload, precheck and execution to fall inside it. Import DB connections and worker RSS are judged. |
| M-5: DEF-034 missing from the ledger. | Added (LOW, OPEN). |
| L-1: after a signal the main flow could start the next tool; exit 130 for SIGTERM; no report. | `runScript` refuses once cleanup has started. Signals write a FAIL report and exit 128 plus the signal number. |
| L-2: invalid JSON crashed the runner; stale reports could be judged; TC-129 read a failed mixed report. | Outputs are removed before each tool. An unreadable report becomes a failure (only for tools that write one: the first version wrongly failed the seed, caught by the sixth run). TC-129's mixed-report checks require exit 0. |
| L-3: the watcher could spin forever and miss late failures. | Removed. `benchmarkSupplierImport.js` records up to 20 not-applied rows with their errors before cleanup (HD-122 A). |
| L-4: the for-SKU comment was wrong about inflation. | Corrected: relations are unique per (Supplier, SKU), so the check catches a lost SKU filter or a join to a child table. |
| Info: load average at the end; "one of five runs". | The load average is recorded at the start and the end; the map's run list is corrected. |

## After the follow-ups

Local, not CI. The final run with the HD-122 tools passed every check (TC-085 4, TC-101 6, TC-128 5, TC-129 5), with load average 2.9 at the start. Unit test 2/2 (44 failing cases). Lint exit 0. Not re-reviewed.
