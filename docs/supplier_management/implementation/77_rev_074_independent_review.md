# REV-074: TASK-046 REV-073 follow-ups (PR #181), independent review

Reviewer: REV-074, an independent agent using the security-auditor persona. It did not write this code or REV-073.

> Saved by the author from the reviewer's hand-back, because the harness does not let a review subagent write report
> files. The text below is the reviewer's, condensed apart from this note.

- **Commit:** `4a1f488274afa8bedcbd7476cade04b798f11e6c`.
- **Scope:** `git diff 5ab6ab1..4a1f488 -- server client`, plus the whole T46 change re-checked. The merge of main was checked only for breakage in supplier import.
- **Method:**
  - Read the diff, REV-073, the carry-forward and HD-063 to HD-065.
  - Ran the suites: server unit, import integration on MySQL `erp_rev074`, client vitest, the mocked Playwright spec, build and lint.
  - Ran throw-away probes and 5 mutants.
  - Drove the real app (API and Vite started and stopped by PID; no `pkill`).

## Verdict: APPROVED

There are no Critical, High or Medium findings. There are five Low and three Info findings.

## Findings

- **L-1: A late failure of an older row request still beats the newer, successful one.**
  - **Cause:** `fetchRows` sends stale *rejections* straight to the error path.
  - **Evidence:** a vitest probe, and the real app. With `rowNumber=1` held 1.5 s and then aborted, a correct `["12"]` table went blank with `網路錯誤`.
  - **Fix:** route rejections to the latest request too (`request.then(latest, latest)`), and only notify a 404 for the latest request.
- **L-2: A late older request leaves the older page number in the pager** (`DataTable.onRequest` sets the pagination from each request's own arguments).
  - **Evidence:** a vitest probe, and the real app, where the footer read `21–9 of 9`.
  - **Assessment:** better than before the fix, which showed the wrong rows.
  - **Root cause:** the shared `client/src/framework/ui/DataTable.vue`, which sits outside the module's write paths. The fix is a request sequence in `onRequest`.
- **L-3: `?job=` above `Number.MAX_SAFE_INTEGER` still opens the broken dialog.**
  - **Evidence:** `9007199254740992` reaches the server as 400, and the page shows `Request validation failed`.
  - **Fix:** also require `Number.isSafeInteger`.
- **L-4: The row-number input sends values the server rejects** (`-1`, `1.5`, `2000000` → 400 with a raw English banner). This already existed at 5ab6ab1.
  - **Fix:** send only an integer from 1 to 1,000,000.
- **L-5: No test pins I-3's "CSV Code first" order.** Moving `s.supplier_code` first passes every test.
  - **Fix:** add an ID/Code conflict row to the T46 integration test.
- **I-1: Applied update rows now show the CSV's spelling of the Code** (for example `pb-…`) rather than the stored one (`PB-…`).
  - **Suggestion:** prefer the stored Code for applied rows.
- **I-2: A newer 404 is notified once for every pending older request.** This is fixed together with L-1.
- **I-3: The debounce flushes on close, so one request goes out after Escape.** This is harmless.
  - Removing `debounce` passes every test; that is acceptable, since the debounce only reduces load.

## Verified correct

- **L-1 (full-width formula guard):** covers the OWASP list.
  - In the real flow, `＝HYPER-…` was exported as `'＝HYPER-…`.
- **L-2 (latest request wins):** REV-073's race is fixed against the real API.
  - It cannot hang or leak.
  - `job.value` follows the latest request.
  - There is a single poll timer.
- **L-3:** 14 malformed forms are dropped from the URL while other query parameters are kept; `7` opens.
- **L-4:** the REV-073 mutant is now killed.
- **I-1:** `private, no-store` comes from the framework, and the test pins the exact headers.
- **I-3 (`identity`):**
  - Update rows' `root` never carries a Code.
  - T45's writer ignored a planted `root.supplierCode` and `identity.supplierCode`, so the Code was unchanged.
  - An ID/Code conflict is skipped with `MATCH_CONFLICT`.
  - Older jobs without `identity` fall back to the current Code.
- **Merge of main:** only dependency patches, `.npmrc` and `allowScripts`; no supplier import file changed.
- **Suites:**

  | Suite | Result |
  | --- | --- |
  | Server unit | 2094/2094 |
  | Import unit | 63/63 |
  | Import integration | 39/39 |
  | Client vitest | 703/703 |
  | Mocked Playwright | 7/7 |
  | Build and lint | clean |

## Housekeeping

- All rows created in `erp_rev074` were deleted.
- Temporary edits were restored.
- Gitignored build caches and logs remain in the review worktree.
- The servers were stopped by PID.
