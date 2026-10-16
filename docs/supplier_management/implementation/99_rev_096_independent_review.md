# REV-096 — independent review of the AUTH carriers and HD-109 A

- **Reviewer:** `agent-skills:code-reviewer` (a separate agent; I did not write this change)
- **Baseline:** branch `claude/supplier-task-051-tests-3`, reviewed as `git diff dd63519e..HEAD -- server client docs/supplier_management`
- **Verdict:** **CHANGES_REQUESTED**
- **Open Critical / High:** 0 / 1. Three Medium, four Low, plus Info and nits.

## What the reviewer confirmed

- **CONTRACT:** it matches design §3.2 and §6 on all 57 routes, plus HD-020, HD-067, HD-094 and HD-107 G5. The runtime route set equals the contract.
- **HD-109 A:** it covers every JSON POST route (29 declarations, 36 routes) and leaves out the multipart upload. A static review of every Supplier POST payload in the client found no type problem.
- **TC-116:** the re-authentication lockout cannot make it pass falsely.
- **Prototype pollution:** the check means something, because the app runs in the test's own process.
- **Cleanup:** after the reviewer's runs, nothing was left in `erp_t51`.

## Disposition

The standing instruction is to fix every review finding as recommended.

| Finding | Disposition |
| --- | --- |
| H-1: TC-120 checked only the 201 racer and the 409 racers, so 500s passed. The ledger and the test comment also said the Code race was refused by the app before reaching the database. That is wrong. | Fixed. Every racer must now be 201 or 409 `SUPPLIER_CODE_TAKEN`. The comment now says the pre-check `SELECT` does not lock, so the race is settled by `ER_DUP_ENTRY` and its mapping. Negative control: with both Code mappings removed, two runs each gave `201, 500×4, 409`, and TC-120 failed both times. A correction is recorded in the ledger; the earlier record stays as written. |
| M-1: the import GET routes still accepted `1e3`, `0x10`, `05` and `+5`. | Fixed. Every import `:id` route now uses one positive-integer string schema of up to 15 digits, so the converted ID is always a safe integer. The integer schema is gone. TC-117 adds seven GET cases and one result case. Negative control: putting the integer schema back fails TC-117. |
| M-2: TC-118 scanned an empty approval queue, and no Bank create audit existed to scan. | Fixed. TC-118 turns activation approval on, creates a Bank account over HTTP for a draft Supplier, and activates that Supplier to a pending request. It then scans the queue (`scope=all`), the request detail and that Supplier's audit, which contains the `supplier.bank.create` entry. Approval is switched back off in `finally`. |
| M-3: three clauses were missing from the map's Notes. | Fixed. TC-112's Note says U-SYS Bank masking, audit and alert are not asserted. TC-119's Note says log safety is not asserted. TC-111 has a new carrier for its page half: `client/test/pages/suppliers/pageGuards.test.js` checks that every Supplier page declares permissions and none is public. Negative control: making the Settings page public fails that test. |
| L-1: allowed calls in TC-112 stop at schema validation. | Kept, as the reviewer allowed. The Note already states it, and Bank `#assertMay` has carriers elsewhere. |
| L-2: the secret scan missed the JWT secret and matched Bank key rings only as whole strings. | Fixed. The scan uses `SecretValue.reveal()` for the app's real JWT and DB secrets, splits each key ring into its individual keys, and asserts it has at least four secrets to look for. |
| L-3: the browser evidence named no commit and did not state its scope. | Fixed. It now gives SHA `109436ae` and lists which flows it covers and which it does not. |
| L-4: TC-111's "existing" IDs are not real IDs for the approval, import and SKU-relation routes. | A comment now says so. The result is unaffected, because authentication fails before any lookup. |
| Info: idempotency and nonce rows are left behind. | Not changed. They expire by TTL, as in the other suites. |
| Nits: an unused `admin` in TC-120; a `window.__xss` assertion that cannot fail; a trailing blank line. | Fixed. |
