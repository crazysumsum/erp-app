# REV-075: TASK-047 (PR #185), independent review

Reviewer: REV-075, an independent agent using the security-auditor persona. It did not write this code.

> Saved by the author from the reviewer's hand-back: the harness does not let a review subagent write report files. The
> text below is the reviewer's, apart from this note and light formatting. The "Author's follow-up" section at the end is the
> author's.

- **Commit:** `950cfb1f71c3b8f62c463fa71f4089b599c7760b` (PR #185), base `main` `7717702`.
- **Worktree:** `/Users/sam/Documents/workspace/erp-rev075`, detached and clean at the end.
- **Method:**
  - Read the diff, the T47 criteria, design §6.9, FR-IMPORT-008/009, BR-028, AC-040, SEC-012, HD-067, HD-068 and the carry-forward.
  - Ran the server suite the CI way and the client suites against its own schema `erp_rev075` on MySQL 3447.
  - Probed the real API on 3010, with Vite on 5213, real logins and its own users.
  - Seeded 10,000 maximum-length Suppliers to measure the export.
  - Ran 3 mutants of its own.

## Verdict: APPROVED

No open Critical, High or Medium findings. There are four Low and four Info findings.

## Findings

- **L-1: guard and unguard are not inverses for a value that already starts with `'` plus a formula character** (reproduced).
  - `guard("'=x")` leaves the value alone, but `unguard` then turns it into `=x`.
  - Probe: notes `'=SUM(1,2) kept literally` and displayName `'+852 desk` were exported unchanged. On upsert re-import they
    became `=SUM(…)` and `+852 desk`, and both rows were valid updates.
  - A leading `'` can be entered through the UI.
  - Suggested fix: also guard a value that `GUARDED_FORMULA_LEAD` matches, so that `unguard(guard(v)) === v` for every `v`.
- **L-2: an inactive payment term exports a code that the import rejects** (reproduced).
  - On re-import the row is invalid with `PAYMENT_TERM_NOT_ACTIVE`.
  - The same is inferred for an inactive currency (`CURRENCY_NOT_ACTIVE`).
  - This contradicts the round-trip claim in HD-067 2A.
- **L-3: no test catches removing the guard from `paymentTermCode`** (mutant M12 survived).
  - Business Master accepts a code starting with `=`. The current code does guard it on the real API.
- **L-4: memory at the 10,000-row cap.**
  - One export of a 69 MB maximum-length file took about 394 ms, and RSS went from 146 MB to 678 MB.
  - Six concurrent exports by one user peaked at 1.35 GB RSS, with no concurrency limit.
  - The endpoint needs a password plus `supplier.mgmt`, and real data is much smaller. T49 already owns the 10,000-row measurement.
- **I-1: refused exports leave no `supplier_audit_logs` row.**
  - This covers 422 responses and wrong passwords; a wrong password does produce the `auth.password.rejected` system-log warning.
  - It is a product decision against the stricter reading of SEC-012.
- **I-2: mutant M19 survived** (`FORMULA_LEAD` without `\r\n`).
  - Unreachable from app-written data, because `requiredText` rejects control characters.
- **I-3: the audit commits before the CSV is built** (read from the code).
  - If `stringify` threw, the audit would record an export that was never delivered.
- **I-4: `downloadBlob` revokes the object URL right after `click()`.**
  - This is the existing pattern and works in Chromium; some older browsers can cancel the download.

## Verified correct (summary)

- **Authorization:**
  - A wrong password or another user's password gives 403 `PASSWORD_INVALID`, and the session stays.
  - No password gives 400; no token gives 401.
  - A `supplier.view` user gets 403 and has no button.
  - A permission revoked after the token was issued gives 403 `PERMISSION_STALE`, with no audit.
  - The password is redacted from request logs.
- **Filters and cap:**
  - The export uses the list's `supplierListQuery`.
  - In a real browser, the URL, typed search, status and header sort all reached the request, and each file matched the screen.
  - LIKE metacharacters are escaped, and bad input gives 400 without echoing it.
  - 10,000 rows give 200; 10,001 give 422, and the UI shows the message.
- **Bank:** only `suppliers` is read. A real encrypted account's values appear in neither the file nor the audit, and the
  audit holds only filters and the count.
- **CSV:**
  - BOM, CRLF only, and the 30 template v1 columns.
  - Quoting is correct, and CJK text and ✓ survive.
  - Half-width and full-width `= + - @` and a leading Tab are all guarded.
- **Headers and shared code:**
  - `private, no-store`, `Pragma` and an RFC 5987 `Content-Disposition` are sent.
  - The CORS expose change has a small blast radius.
  - `getBlob` callers in Customer and Item are unaffected (vitest).
  - `postBlob` treats 403 as an error, not a logout.
- **Unguard:** it adds no new way to store a formula-leading value, because raw `=…` cells were already accepted.

## Suites

| Suite | Result |
| --- | --- |
| `npm ci`, migrate | 0 |
| T47 server files | 62/62 |
| Server `test:coverage` (serial, real MySQL) | 2,579 tests: 2,565 pass, 0 fail, 14 skipped; floors met |
| Client vitest | 714/714 |
| Lint | 0 |
| Mocked Playwright `supplier-export.spec.js` | 3/3, on a temporary config (port 5214) that was then removed |
| Real-app Playwright | cancel, wrong password, export, status, search, sort, 422, 10k download, viewer and template download all as expected; only the expected 403 and 422 errors |

The manual spreadsheet check was not done (no spreadsheet application available). Formula safety was verified on the bytes.

Mutants of the reviewer's own: M12 (no guard on `paymentTermCode`) and M19 (no CR/LF in the guard) survived; M21 (notes in
the audit) was killed.

Environment: all servers were stopped by PID, the worktree is clean at `950cfb1f`, and only `erp_rev075` was used.
`LOG_DIRECTORY` was not honoured: request logs went to the worktree's gitignored `server/logs/`.

## Author's follow-up

- **I-2:** already covered. The T46 test `server/test/supplierImportResultHandlers.test.js:39` asserts that `\rx` and `\nx`
  are guarded, so M19 is killed by a file the reviewer did not include in its mutant runs.
- **The other findings:** taken to the Product Owner (HD-069).
