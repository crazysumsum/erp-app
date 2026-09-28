# Supplier Management — defect register (DEF-023 onward)

Narratives for defects whose typed records live in `00_harness_state.json`. The ledger schema has no
description field, so the text that earlier checkpoints wrote into a `summary` field (rejected by the
schema) was moved here verbatim at revision 239. Status is authoritative in the ledger, not here.

## DEF-023 — LOW

The request log's only protection against a bank plaintext is the field-name blacklist redactedFields, while bodyCaptureErrorStatus 500 forces a full body capture on any 5xx into a file kept 30 days. Today the API contract happens to name the field accountNumber, which is on the list. A plaintext arriving under another name, nested, or in a URL is not covered. Demonstrated by removing accountNumber from the list, which turns TC-074 red on the request_log channel. Flagged for SUP-CAP-05, whose CSV import will accept account numbers under column names the blacklist has never seen. REPORT_ONLY: no product change made.

## DEF-024 — LOW

ER_LOCK_DEADLOCK from InnoDB reaches the caller unchanged rather than being retried. Normal for an application to delegate the retry, but it is documented nowhere an operator would look, and bank_operations.md does not exist. Observed when TC-077's fixture ran concurrently with the existing deliberate-contention tests. REPORT_ONLY: no product change made; the harness retries only its own fixture seed, never an assertion.

## DEF-025 — MEDIUM

A node_modules symlink pointing at one developer's absolute path was committed and reached main. .gitignore's node_modules/ entry has a trailing slash and matches directories only, so a symlink of that name was not ignored and git add -A staged it. Two harms: any clone with dependencies installed could no longer git pull (fatal: cannot rmdir 'node_modules': Directory not empty), and the repository carried a machine-specific absolute path. CI could not see it structurally - a runner checks out fresh and runs npm ci, so it never has an existing directory to replace. Fixed by git rm --cached plus a second, slashless .gitignore entry. CORRECTION recorded at the next checkpoint: the harm was understated. The failed pull did not merely refuse to update - before it aborted with 'cannot rmdir', git deleted ignored files it treated as expendable, removing 258 of the 422 top-level packages from the main checkout's node_modules (dotenv and the whole eslint toolchain among them). The directory's mtime matched the failed pull to the second. A clone that attempted a pull between PR #149 and PR #151 was left unable to run lint or tests. Repaired with npm ci in the main checkout after confirming it was clean and that nothing was running from it; afterwards 399 of 422 were present and every one of the 23 absent was an optional platform-specific binary for another OS or CPU, with this machine's darwin-arm64 binding installed; lint exited 0 and the Bank server and client suites passed there.
## DEF-026 — MEDIUM

A reveal of a row whose encryption key is missing from the ring and a reveal of a tampered row both
returned `422 BANK_ACCOUNT_UNREADABLE`. The design makes the first `503 BANK_KEY_UNAVAILABLE` (§6, §8.3)
and the second a generic `500` with a critical alert (§8.3, §12). Fixed on `claude/supplier-def-026-027`:
two errors, two error-level log events (`supplier.bank.key_unavailable`, `supplier.bank.integrity_failed`),
neither carrying the account or the key id. Retest in `02_technical_test_report.md` §2c.

## DEF-027 — HIGH

A row whose lookup key is missing from the ring cannot have its blind index recomputed, so the duplicate
check never matched it and the same Supplier could add the same account again; startup did not notice.
Fixed per HD-037 option (b): create and account-changing update for that Supplier return `503
BANK_KEY_UNAVAILABLE` with an error log (`supplier.bank.duplicate_check_unavailable`); other Suppliers are
unaffected; the only such row can be repaired by re-entering its account. A new eager service,
`SupplierBankKeyCheckService`, logs `supplier.bank.keys_outside_ring` (kind and row count, no key id) at
startup and never refuses to start. The equivalent Customer-module gap is outside this module and was
not taken up, on the Product Owner's instruction.

## DEF-028 — LOW

Design §5.8 masks short accounts with `*`; the projection used `•`. Fixed per HD-037 by changing the code
rather than the design (a design edit would move the DESIGN hash and strand 36 reviews): every mask now
uses `*`. Client unit-test fixtures still carry the old character as mock strings; they do not depend on
the server.
