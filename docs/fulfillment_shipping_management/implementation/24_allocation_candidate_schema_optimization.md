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

Historical candidate source fingerprint before measurements: `f458a9df067f92f06762f9ac0061379e46f225c056b035b7a817746bf7a2572b`, HEAD `d5e8c33cea19b280bed116be8cfc1b1f7456b7cc`. DESIGN/PLAN remain unchanged. **Historical checkpoint before subsequent verification:** full strict developer suite, repeated profiling, independent final-source review and new exact-candidate CI were pending; no PASS is inferred from the focused result.

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

**Historical checkpoint before CI dispatch:** no new-candidate CI result was then available. Previous d5 CI FAIL remains authoritative for that previous commit. Full CI and any remaining full-regression closure are required before the previously authorized draft PR; no merge or live activation is authorized.

## Exact candidate CI result

Commit `1cb2a7b37386f9d24b7c12d405d16aca9fbeed8f`, sourceFPf458, [GitHub run39719857793](https://github.com/crazysumsum/erp-app/actions/runs/39719857793), actual workflow_dispatch: **SUCCESS**, all13 underlying jobs success, including four native server coverage shards, merged coverage/file floors, client coverage, Playwright, TC-042 mixed load and the strict Test aggregate. Run identity/status is preserved at `/private/tmp/fulfillment-p0-ci-39719857793.json`; old failed runs remain unchanged.

The actual capacity case moved to server shard3 after new test-file discovery; logs `/private/tmp/fulfillment-p0-ci-job-119630586515.log` show:

- 5,000 Reservations: **PASS**, Allocate12,641ms, Reallocate18,363ms, combined90,679transaction SQL, sampledMaxHeap194,729,904bytes, configured transactionTimeoutMs20,000 unchanged. Whole test43,595.862ms includes setup and both transactions; it is not a single43-second transaction.
- Original100-member/5,000-leg allocation plus10,000old/new reallocation legs and injected final-chunk rollback: **PASS**, Allocate6,295ms, Reallocate11,969ms, actual auxiliary legs15,000, zero skips.
- New schema-proof native cases passed in shard2; bounded receipt completion/late chunk rollback passed in shard4. No timeout/skip/permission/schema/quantity exception was added.

The CI result verifies the combined previously preserved receipt-batching plus new schema-proof candidate. The local before/after comparison isolates the new schema-proof change; there is no historical per-action timing for the old failed CI case, so no invented per-action CI speedup is claimed. A single CI success does not prove timing stability under all runner loads. Reallocate has **1,637ms** headroom under20sec in this run; retain this explicit residual performance risk rather than increasing the deadline or asserting a large safety margin.

Additional current-source server FILES/default-provider-off regression: **3,647 discovered /2,637PASS /0FAIL /1,010 qualified native/opt-in skips**, `/private/tmp/fulfillment-p0-cache-server-files-r2.log`. The mandatory P0 developer suite separately passed196testcases/0SKIP, including its unit and native cases; current native CI also passed. The first same-command local attempt was blocked by sandbox localhost `listen EPERM` (93failed tests); it is retained as `/private/tmp/fulfillment-p0-cache-server-files.log`, then the unchanged command passed with authorized local socket permission. No product/test/gate alteration addressed that environment restriction.

This completes the bounded optimization/remeasure/current-CI request. It does not constitute formal TC/UAT, complete broader P0 closure, a PR review/merge approval, live deployment or provider activation. No draft PR was created in this bounded resumed step.

## Independent bounded closure

Actual separate reviewer `/root/fulfillment_independent_review` independently confirmed GitHub run39719857793 through its GitHub connector: checkout1cb2a7b3, all13jobsSUCCESS, realcapacity/partial-schema/receiptregressionlogs, global96.08/87.11/94.39 and39filefloors. Verdict **APPROVED,0C/H/M**, sourceFPf458; current CI receiptSHAd62dfed708ad25202c1af25f45dbcc28ffa0ad947322930cc6f8bd86fda9d4da. Reviewer validated all updated artifact hashes and exact prior reviewedsummary preservation. DEF-002 may close with this currentCI evidence; DEF-003/overallTASK011/formalacceptance/PR/merge remain outside this bounded closure. The1637ms Reallocate headroom remains an explicit residualrisk, not a deadline exception.
