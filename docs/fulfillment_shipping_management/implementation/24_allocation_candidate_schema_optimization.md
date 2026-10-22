# Transaction-local pre-Stocktake schema proof reuse — 2026-10-22

## Authorization and scope

Sam explicitly approved reducing repeated missing-table checks inside the same transaction, preserving incomplete-schema rejection and the existing 20-second limit, then remeasuring and running current-candidate CI. This follows [the profiling evidence](23_allocation_transaction_profile.md). This is a bounded owner-internal implementation correction: no quantity, lock ordering, isolation, public API, schema, permission, migration, deadline, applicability or gate change. Existing receipt-batching WIP remains in the candidate and requires its own current-source verification; it is not attributed to this cache optimization.

`InventoryPickSequenceService` now privately records successful pre-Stocktake absence proofs in a WeakSet keyed by the exact transaction executor. Every cache read/add checks DB-owner `getActiveTransactionIsolation` metadata, which cannot be supplied by a command. A proof is added only after the original `ER_NO_SUCH_TABLE`, metadata check proving **both** `inventory_stocktakes` and `inventory_bin_locks` absent, and a successful fallback candidate query. A subsequent read in that same active transaction still executes fresh parameterized candidate SQL and all existing eligibility/rank/quantity/version validation. Only the redundant missing-table attempt and metadata query are omitted.

No candidates, available quantities, actor permissions, result/error objects or global schema status are cached. Autocommit/fake/closed/new executors cannot reuse a proof. Present tables use the original active-Bin-lock query; partial schema, failed inspection and other SQL errors retain rejection. `InventoryLockService` and its locking/absence checks are unchanged.

## Stable-schema deployment invariant

Business transactions do not execute DDL or `USE`/change their database. Installing or dropping Stocktake schema must drain **all affected Inventory writers** before DDL and resume them only after the complete schema is verified, rather than quiescing Sales release alone. The application transaction API's normal executor lifetime and fixed schema are assumed; neither a WeakSet nor an information_schema absence check locks a future nonexistent table against concurrent installation.

The cache does **not** claim to detect a concurrent partial schema installation inside an already-proven transaction. Such concurrent DDL violates the deployment invariant and is outside this bounded optimization's contract. No live installation or provider activation is performed or authorized here. New transactions recheck the schema; tests explicitly cover a partial or complete installation between transactions.

Separate reviewer `/root/fulfillment_independent_review` actually reviewed the proposal and existing DB-owner lifetime/Inventory compatibility authority: proposal APPROVED, 0 C/H/M, with the above invariant clarification. This proposal review does not approve final source, final tests, publication or CI.

## Regression evidence

Native red `/private/tmp/fulfillment-p0-cache-red-r1.log`: two failures reproduced repeated checks before the fix, with other initial safety cases passing. Green `/private/tmp/fulfillment-p0-cache-green-r2.log`: **18 PASS, 0 FAIL, 0 SKIP**, comprising six existing PickSequence tests, seven new native schema-cache regressions, and five preserved bounded-receipt completion tests. Cases cover live quantity/version changes within a transaction, fresh transaction proof, autocommit/forged metadata, both partial-schema variants after a prior transaction's proof, complete schema with a newly active Bin lock, failed inspection, failed fallback, and a closed executor. Existing twenty-second transaction configuration is unchanged.

Current candidate source fingerprint before measurements: `f458a9df067f92f06762f9ac0061379e46f225c056b035b7a817746bf7a2572b`, HEAD `d5e8c33cea19b280bed116be8cfc1b1f7456b7cc`. DESIGN/PLAN remain unchanged. Full strict native developer suite, repeated profiling, independent final-source review and new exact-candidate CI are pending; no PASS is inferred from the focused result.

## Independent source review

Actual separate reviewer `/root/fulfillment_independent_review` APPROVED source increment at HEADd5 / FPf458a9df067f92f06762f9ac0061379e46f225c056b035b7a817746bf7a2572b, 0 C/H/M. Six-file subset `eb4aef2c38be0717486a9450f30e2cb37f6955082148c860a17b63887c47385d` covers candidate cache/test and preserved receipt-batching source/tests. Reviewer independently executed existing PickSequence6 unit tests, allPASS0SKIP, and read the 18-test root log SHA2597f6b1546cbf608b5053892a468b106c2f5662b6a9be355af4fd616968f784 (12 native +6 unit). This source verdict is not new full-suite/CI approval.

## Repeated post-change measurement

Three same-condition profiled native capacity runs completed successfully, zero skips and unchanged20sec transactions. Comparison isolates the new schema proof reuse against the previously preserved receipt-batching WIP (not against the older unbatched implementation):

| Metric | Receipt batching only, previous three-run median | Plus transaction-local schema proof reuse, three-run median |
|---|---:|---:|
| Allocate whole transaction | 6.682 s | **4.920 s** (26.38% reduction) |
| Allocate SQL calls | 45,235 | **35,237** |
| Reallocate whole transaction | 8.978 s | **7.314 s** (18.53% reduction) |
| Reallocate SQL calls | 65,440 | **55,442** |
| Candidate selection SQL per action | 15,000 | **5,002** |
| Candidate selection Allocate / Reallocate | 2.863 / 2.868 s | **1.214 / 1.211 s** |

Each action now has one handled candidate missing-table error and one both-table absence inspection, rather than5,000 each. Fresh successful candidate SELECT still executes5,000 times. The unchanged LockService retains its separate absence check; no locking shortcut is claimed. Whole-transaction ranges: Allocate4.882–4.979s, Reallocate7.256–7.460s; observed row-lock wait deltas0 in allsix transactions. Combined SQL110,675→90,679. Evidence `evidence/allocation-cache-20261022/summary.json` records per-run hashes and reconciled counts/timing; source remainsFPf458. These are local diagnostic results, not current CI PASS.

## Current-source developer verification

All five typed contracts actually PASS on sourceFPf458 / unchangedPLAN: strict P0 developer adapter196PASS/0FAIL/0SKIP (`evidence/20261022T035331-636d325dd2f2/run.json`), real Playwright2PASS/0SKIP (`20261022T035601-3faa6d3fcc24`), lint (`20261022T035513-b9ddb16f6054`), client build (`20261022T035519-7dac1a34d73f`), security audit (`20261022T035522-eede12bf234b`). Native includes both original capacity shapes and late full-capacity receipt-write rollback; no threshold/deadline weakening. The Node JUnit footer reports199 while the configured adapter enumerates196 actual testcase nodes; gate reporting follows the configured adapter, not an inflated conversion. Existing audit low/moderate advisories are not a new waiver; the unchanged high-severity gate passed.

A deliberate in-memory mutation reversing the cache-read active-transaction condition caused the new native cache/fresh-quantity regression to fail as intended (`/private/tmp/fulfillment-p0-cache-mutation.log`); the on-disk source was never mutated. Traceability, module boundary and diff-whitespace checks passed.

First typed lint (`20261022T035333-8f8266704f0d`) failed solely because repository eslint scans private ignored `.mjs` probes under docs with non-Node globals. Executed probe bytes were preserved verbatim as `profile.executed.mjs.txt`, with original summary archived and artifact mapping updated; no lint configuration/suppression/threshold/product change was made. Subsequent typed lint passed. All measurement evidence and original bootstrap failures remain retained. This operational correction leaves sourceFP unchanged.

No current-candidate CI result is yet available. Previous d5 CI FAIL remains authoritative for that previous commit. Full CI and any remaining full-regression closure are required before the previously authorized draft PR; no merge or live activation is authorized.
