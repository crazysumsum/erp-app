# REV-137: independent review of the DEF-049 formal re-test and the DEF-050 diagnosis

- **Reviewer:** `agent-skills:code-reviewer`, a separate agent. I did not write this change.
- **Baseline:** PR #303, branch `claude/supplier-technical-acceptance-3` at `90652f01`, reviewed as `git diff origin/main..HEAD` against base `4f101642`.
- **Method:** read-only. No MySQL, no load, no writes.
- **Verdict:** **CHANGES_REQUESTED**. 0 critical, 3 High, 1 Medium, 3 Low, and nits. The formal evidence and the DEF-049 closure hold. The DEF-050 diagnosis misread which statements cost the time, and HD-156, which rested on it, was incomplete.

## What the reviewer confirmed

- **The evidence:** exactly 16 new evidence directories, none from the refused 03:37Z attempt.
  - Every `run.json` is at `558adc22`, with `code_unchanged` and `spec_unchanged` set to true.
  - All 16 rows of the 07 table match their run (0 mismatches), and every artifact's sha256 matches.
- **The DEF-049 closure is sound.** It follows the DEF-048 pattern.
  - TC-101 margins recomputed with the verdict formula: 58.3 s and 61.1 s.
  - Impact regression: 735/735.
  - PR #301's run 40810936200: 13 of 13 checks.
- **TC-085:** p95 2,113 and 1,937 ms; the history is 1,861, 1,991, 1,891 and 1,830 ms.
- **The diagnosis figures:** every number quoted matches `out*.txt`. The faults were in how they were read.
- **The ledger:** #302 and PR #301's facts were confirmed with `gh`. `verify_gate` at HEAD behaves as stated, apart from L2. No secrets were found.

## Disposition

Before acting, I recomputed each finding from the digests in every for-SKU report.

| Finding | Disposition |
| --- | --- |
| **H1: "every `q` request scans the active Suppliers at least twice" is contradicted.** The sorted rest page at 122,758 rows has no `LIKE`. It belongs to `cold` and `deepPage` (636 calls, against 325 + 307). The rest page with `q` ran only 121 times, along the name index. | **Confirmed by recomputation.** The only full scan a `q` request always makes is the `COUNT(*) total`, at 34.7%. The cause statement is rewritten with the per-statement table in DEF-050, 07, 06, HD-156 and the PR body. |
| **H2: "the `q` searches are the whole cost" does not follow.** E2 ran only `typical`, but `cold`, `hot` and `deepPage` send no `q` either. | **Confirmed.** `q`-related statements take 60–62% in all six formal runs and every diagnosis report; the rest page without `q` alone takes 21–24%. The "whole cost" wording is removed. E2 is now described as what it is. |
| **H3: HD-156 is incomplete, and option A's mechanism is unsupported.** An exact total needs a full scan, so saving the COUNT's 35% means changing `total`, a contract change that Purchasing consumes. Missing: the rest-page plan without `q` (22%), and the item-code lookup index (5%). | **Confirmed, and the missing option was measured (E5, `run-restplan.sh`).** On a quiet database, `FORCE INDEX (idx_suppliers_name_id)` took the rest page without `q` from 97–99 to 17–22 ms at offset 10,000, but changed little at 69,000. That is about 10% of total DB time. **HD-156 is rewritten** with five options: (A) the index hint; (B) no exact total, a contract change Purchasing must agree; (C) keyset pagination, a contract change; (D) schema indexes or name-search narrowing, needing sign-off; (E) defer to the production-like environment. |
| **M1: "DB busy" was divided by 70 s, but the digests cover the 60 s window** | **Confirmed.** Corrected to 0.1, 2.1, 8.9 and 10.1 connections (E1), and 19.9 with the pool of 20. Every formal run is at 10.0. The conclusion now reads: the pool of 10 caps throughput at about 29/s, and MySQL here at about 33/s. The table is noted to cover the top 12 digests, more than 99.9% of the time. |
| L1: the 1 GiB buffer-pool run was not warmed; "61 MiB fits" ignores the other tables | The register now says it was not warmed and still read 13,975 pages from disk. "No help" is kept, because the COUNT took 344 and 342 ms at the two sizes. |
| L2: the gate claim omits `HUMAN_DECISION_REQUIRED` | 07 and the observation now say that, from state revision 484, the gate also reports it. |
| L3: the DEF-049 closure could cite the signal that tells fixed from unfixed | Added: `msPerRowByThousand` rose from 4.6 to 8.6 and from 5.4 to 8.8 before the fix. After it, the values stay flat at 4.4–5.5. |
| Nit: the scripts cannot be re-run as committed | A `README.md` in the diagnosis directory says so, lists each experiment, and records the faults in the `out*.txt` summaries. |
| Nit: the `out*.txt` "LIKE statements" lines mislabel the head queries | Recorded in the README. The outputs are kept unchanged. |
| Nit: performance-details files are not hash-bound in `run.json` | This was already true on 2026-10-28. It is a harness limitation, noted here and not changed. |

## Points for the Product Owner

1. **The HD-156 that was first put to you rested on a wrong reading.** Its option A, "take the total from the page scan without a contract change", is not possible. This report replaces that version.
2. **No cheap fix restores a clear margin.** The only option without a contract or schema change, the index hint, saves about 10%. The larger savings change `supplier-core-provider/v1`, which Purchasing consumes, or the schema.
