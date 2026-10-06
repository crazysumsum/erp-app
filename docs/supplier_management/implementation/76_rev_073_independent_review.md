# REV-073: TASK-046 (PR #181), independent review

Reviewer: REV-073, an independent agent using the security-auditor persona. It did not write this code.

> Saved by the author from the reviewer's hand-back: the harness does not let a review subagent write report files. The
> text below is the reviewer's, apart from this note and light formatting. The "Author's follow-up" section at the end is the
> author's.

- **Commit:** `5ab6ab1104ed29d6aa857ec49ce53237a39664c2` (PR #181), base `main` `f81feb8`.
- **Worktree:** `/Users/sam/Documents/workspace/erp-rev073`, detached and clean at the end.
- **Method:**
  - Read the diff, the T46 acceptance criteria, design §6.1, §6.9, §6.11, §7.8 and §12, HD-063, HD-058 and the T46 carry-forward.
  - Ran the server unit suite and the import integration file against MySQL 26.7.0 (`erp_rev073`).
  - Ran client vitest, the mocked Playwright spec, the client build and lint.
  - Probed the real API on :3000 across a 40-state job matrix.
  - Measured the SQL at 10,000 rows against 50,000 Suppliers.
  - Drove the real app with Playwright (real API, real worker, Vite on 5203, real login with device approval in the throwaway database).
  - Ran 3 mutants of the reviewer's own.

## Verdict: APPROVED

No open Critical, High or Medium findings. There are four Low and three Info findings.

## Environment incident caused by the reviewer

The reviewer stopped its API server with `pkill -f "node src/index.js" -U $(id -u)`. macOS `pkill` stops reading options at the first pattern, so `-U` and `501` were also treated as patterns. The command therefore killed every process of the user whose command line contained "501", including everything under `/private/tmp/claude-501/…`.

- The throwaway MySQL on 3446 was shut down at 2026-10-06T02:21:07Z. The reviewer restarted it on the same data directory, port and socket.
- Other processes under that path may also have been killed. The Product Owner was told at once.

## Findings

- **L-1: The formula guard missed the full-width characters `＝＋－＠`** (OWASP CSV Injection).
  - Such a value is accepted as a Supplier Code.
  - The result's Code cell can show another user's current Supplier Code.
- **L-2: The row-number filter fires a request on every keystroke, and nothing drops stale responses.**
  - Evidence: with the `rowNumber=1` response delayed 1.5 s and "12" typed, the page showed `input 12 | rows ["1"]`.
  - Polling can race the filter in the same way.
- **L-3: A malformed `?job=` opens a broken dialog.**
  - `?job=abc`, `0`, or a repeated parameter shows `匯入工作 #NaN` with a raw English "Request validation failed" banner, and sends `GET /supplier-imports/NaN` → 400.
  - `?job=999999` was handled correctly.
- **L-4: No client test covers "a failed precheck offers no download".** Changing `hasResult` to `status === "failed"` survived both vitest and the mocked spec.
- **I-1: The handler's own `Cache-Control` line is overwritten** by the framework's `private, no-store`, so the integration check `/no-store/` could not fail.
- **I-2: The client hard-codes the result file name.**
  - `HttpClient.getBlob` does not return `Content-Disposition`, and CORS does not expose it.
  - The name matches the server's only by convention.
- **I-3: Update rows show the wrong or an empty Code** (read from the code, not reproduced).
  - Update rows store no Supplier Code, so a row whose `supplierId` is not found shows an empty Code.
  - A `SUPPLIER_IMPORT_MATCH_CONFLICT` row shows the code of the Supplier the ID points to.

## Verified correct (summary)

- **Authorization:** a 40-state matrix. The other manager always gets 404, byte-identical to a missing ID. No token gives 401, bad IDs 400, and a withdrawn permission 403 `PERMISSION_STALE`.
- **Status gating:** matches HD-063 2A. Jobs that never ran give 409 even when purged. A failed precheck gives 409. Executed jobs give 200, or 410 once purged.
- **Headers:** `text/csv; charset=utf-8`, `Content-Disposition` with `filename*`, `private, no-store`, `Pragma`, `nosniff` and CSP.
- **CSV content:** a BOM, CRLF and the 8 HD-063 3A columns. A note marker, names, emails and addresses never appeared, and Bank columns are refused at upload.
- **10,000 rows:** an index lookup on the rows plus a PRIMARY lookup on `suppliers`.
  - Database time: 7.1 ms.
  - `resultCsv`: 26–38 ms end to end, using an extra 17–23 MiB of heap.
  - The download is byte-identical through the API and through the UI.
- **Real-browser UI:** all of these worked:
  - template, upload, worker precheck;
  - the approver list excluding the user;
  - the password prompt, and 403 on a wrong password;
  - confirm leading to completed with pending_approval Suppliers;
  - reload sending no extra confirm;
  - polling every 2 s that stops when the job is terminal, and no polling after leaving the page;
  - Escape clearing `?job=`;
  - the revoked banner and the BUSY badge;
  - the purge badge, and no download for jobs that never ran;
  - the 410 race;
  - tab order and labels.

  No storage path or payload appeared in the DOM, and only the expected 403, 410, 400 and 404 errors were seen.
- **Suites:**

  | Suite | Result |
  | --- | --- |
  | Server unit | 0 failures |
  | Import integration | 39/39 |
  | vitest | 13/13 |
  | Mocked Playwright | 5/5 |
  | Build and lint | clean |

  Two server mutants of the reviewer's own were killed; the client `hasResult` mutant survived (L-4).

## Author's follow-up

The Product Owner asked for every REV-073 issue to be fixed. Before each fix was accepted, the author confirmed that its new
test fails with the fix removed.

| Finding | Fix |
| --- | --- |
| L-1 | `guardSpreadsheetCell` also guards `＝＋－＠`; the four values are in the unit test. |
| L-2 | `fetchRows` lets the latest request win: a late answer to an older request (typing or polling) resolves to the newest one. The row-number input is debounced by 300 ms. A unit test and a browser test cover it; the browser test delays `rowNumber=1` and types "12". |
| L-3 | Only a positive-integer `?job=` opens a job; anything else is removed from the URL. Unit and browser tests cover it. |
| L-4 | A unit test: a failed precheck offers neither a download nor an expiry note. |
| I-1 | The handler no longer repeats `Cache-Control`; the integration test pins the framework's `private, no-store` and the handler's `Pragma: no-cache`. |
| I-3 | Update rows keep the CSV's Code in `normalizedPayload.identity`. `root` still never carries a Code, as T43 intended, because an update cannot change it. The result prefers the CSV's Code. An integration test checks that an update row with an unknown ID shows its CSV Code. |
| I-2 | Needs a change outside the Supplier module (`server/config/security.js` to expose `Content-Disposition`, and the shared client `HttpClient.getBlob`). It was raised with the Product Owner rather than made. |
