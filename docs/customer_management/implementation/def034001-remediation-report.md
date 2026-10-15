# DEF-034001 remediation / HD-011 developer verification

## Current scoped result — 2026-10-15

Sam explicitly approved HD-011 and PR#232's DESIGN/PLAN, continued repair and
remeasurement, and implementation PR/merge. Planning PR#232 merged normally at
`d69b267df3e7cfcbb703b16ff459c87215815f7c`; its topic branch/worktree were removed.
The canonical proposal bytes remain unchanged to preserve the approved baselines:

- DESIGN `25833d2d2e09a2ce0c763c374d0a0a9b64d3d92e9ee79e8f60cd3ea1e0003d51`.
- PLAN `7b1eb4674d231be20c8882b47a1fe5db0550b2c3429adc859e0be27630a51a34`.
- Product commit `fc32a0e393b6b76d497ea774911497a7dae0181b` plus final test-only
  index-key/no-hint guards, teardown and post-load footprint refinements.
- Final measured source fingerprint
  `af7cbcb3222405b2e826254bbfd6bae5aab2c13883068aedbae077bde28456e9`.

**The two physical Customer scans are fixed and final scoped developer checks
pass.** DEF-034001 is in RETEST pending immutable-candidate review/current CI and
authorized integration; this is not full Customer acceptance or release approval.
TASK-034 and complete downstream/mixed-load acceptance remain BLOCKED. The older
diagnosis/decision section below is immutable historical context, not current
approval/readiness status.

### Minimum implementation and safety

CustomerService.list now joins a distinct UNION of independently searchable
Customer-ID branches for nonempty q; empty q and completeness filters are unchanged.
All existing 14 fields, active-child predicates, escaped/NFKC prefix semantics,
outer filters, archive defaults, exact ranking, stable page IDs/projection, actor
verification and export reader transaction are retained. No new API, cache,
dependency, forced index or optimizer hint was added.

Fresh main had migrations through0081, so0082 adds exactly ten approved indexes
and reuses existing code/legal/trading/contact-email indexes. It prevalidates all
same-name definitions, bounds metadata lock wait, uses INPLACE/LOCK=NONE and restores
the session setting even on failure. No DROP/destructive fallback/production DDL.
Application rollback may retain these additive indexes. The actual migration unit
test first failed on the missing module and then passed10 cases; real migration
checks cover replay, incompatible prefix shape and a deliberately held metadata
lock with timeout/retry. Empty-schema build measured26.2325ms; this is **not** a
populated50k/production build-time guarantee.

The approved plan classifier permits only exact `<derivedN>` / `<unionN,N...>`
result rows, still rejects physical ALL/missing access types and unknown pseudo
rows, and emits every failure. Negative/mixed guards passed; mutating away physical
ALL detection caused4 failures. Independent review required an additional proof:
every positive field branch must be range **on its expected search-leading key**,
not just any range. That guard passes; removing its key check fails the new unit
test. Actual service warm/probe SQL and unit SQL reject FORCE/USE/IGNORE INDEX/KEY
and optimizer hints. None of these changes lowers the5000ms budget or data/load.

### Final unchanged-profile measurements

Own MySQL26.7.0 on127.0.0.1:13373, verified datadir
`/private/tmp/erp-customer-def034001-fix-runtime.i1kGVP/mysql/`, fresh schema
`erp_customer_def034001_fix_20261015`; Node26.6.0, macOS ARM64,15logicalCPUs,
24GiBRAM. No user's shared3306/password/production data was used. Runtime keys were
generated in process and not exported. Each timed run used50,000Customers,
5,000addresses,5,000contacts,20service workers, unchanged pool10,30s admission,
same code-prefix100-match query and four-operation service-only mix. Own browser,
build, integration tests and migrations were stopped/finished before timed load;
the host was not exclusively reserved from unrelated project services.

| Operation | Fresh before p95 ms | Final run4 p95 ms | Final run5 p95 ms |
| --- | --- | --- | --- |
| List/search | 1662.1295 | 7.891083 | 6.992709 |
| Exact lookup | 281.441584 | 2.110333 | 1.758000 |
| Address lookup | 279.266750 | 2.498583 | 2.222041 |
| Contact lookup | 284.640292 | 2.455958 | 1.972667 |

Run4:251,780 correct operations,0errors,8391.64ops/s,30003.67ms including drain.
Run5:289,768 correct operations,0errors,9657.51ops/s,30004.41ms including drain.
Each final enabled suite: **17PASS/0FAIL/0SKIP**, every operation p95<=5000ms,
actual COUNT/page/projection with no physical ALL, and all14 positive search
branches range on their expected key (~1estimatedrow). Materialized candidates
may still be scanned/sorted; this is not a claim of zero temporary work.
InnoDB row-lock-wait counter delta0 in both final timed runs; pre-existing counter
10 includes deliberate earlier lock tests and is not a load failure.

Both runs measured post-load total index footprint: Customers28,033,024bytes,
contacts1,671,168,addresses1,523,712,identifiers98,304(empty during timed mix).
These are all indexes together, not the incremental ten-index cost; TABLE_ROWS is
an estimate. Five thousand identifiers and one credit profile were added **after**
timed metrics only for positive branch proof. No broad-prefix/mixed-write/import/
HTTP/network/production or full-downstream capacity is inferred. Populated index
build duration, incremental storage/write amplification and production DDL remain
operational limitations, not waived release gates.

[Exact before/final metrics and primary plans](def034001-remediation-results.json)
and [all28 complete per-field actual plan records](def034001-search-branch-plans.jsonl).
All fixtures were cleaned after each run (Customers0).

```sh
DB_HOST=127.0.0.1 DB_PORT=13373 DB_USER=root DB_NAME=erp_customer_def034001_fix_20261015 CUSTOMER_PERFORMANCE_TESTS=1 node --test --test-reporter=tap --test-reporter-destination=/private/tmp/customer-def034001-after-4.tap --import /path/to/private-key-preload.mjs --import ./server/test-support/testEnv.js server/test/performance/customerManagement.performance.test.js
```

The same command ran again with destination after-5.tap; no source/profile change
between those runs. Raw temporary logs are summarized/sanitized here and removed
only after durable evidence capture.

### Regression, actual browser and retained failures

- Final Customer/safety routine suite:280PASS/0FAIL,2 explicit extended-runtime
  skips (capacity and restore opt-ins); enabled capacity above has0skips.
- All real Customer MySQL integration nodes:24PASS/0FAIL/0SKIP, including HTTP
  authorization, export/import, banks/attachments, Sales-compatible lookups and
  new search/migration tests. The6-node search test passed before and after the
  query fix, independently authored by `/root/customer_search_regression`.
- Lint passes. Client build passes with the existing chunk-size warning; dependency
  audit and exact final-head repository CI are separately recorded at publication.
- Actual Playwright CLI + unmodified application/real MySQL, synthetic view-only
  user: URL-loaded searches,20+5 paging/refresh, active-child dedup,literal!%_,
  empty0,191-character validation400/error/recovery and detail/back PASS, with0
  unexpected console/network errors. One expected validation400 was asserted.
  Only that disposable user's test device was fixture-approved; no auth bypass or
  production device policy changed. This is not user/business acceptance.
- **DEF-034002 OPEN/MEDIUM:** typing successive searches exposed a stale displayed
  prior row even when the matching new API response had total0. Reloading the URL
  Scope links: PHASE-002/TASK-016/TC-040, FR-001/NFR-001, DES-016/018/019.
  rendered0 correctly. Client/E2E bytes are unchanged from d69b267d; the exact
  reactive request ordering cause remains unconfirmed (duplicate reload/QTable
  requests suspected). Do not call the failed typing path PASS. Diagnose/fix via
  Customer list/DataTable task and retest rapid edits, clear/empty/error, paging and
  request ordering; it is a separate frontend acceptance gap, not a physical scan.
- **DEF-027001 OPEN/MEDIUM:** the unchanged Customer mocked-browser full suite is
  15PASS/1FAIL/0SKIP on both fix and clean main d69b267d. TC-065 line313 never sees
  import errors after job-detail focus/Enter. Focused clean-main case passed, so
  Scope links: PHASE-003/TASK-027/TC-065, FR-082/NFR-001, DES-013/016.
  timing/order sensitivity is suspected, not yet a proven product cause. Preserve
  failure; diagnose import-dialog/focus restoration separately and rerun the full
  suite, keyboard flow and related import recovery. No test was skipped/weakened
  and no frontend code was changed merely to green this backend remediation.

Both frontend gaps keep full Customer acceptance NOT_READY; they do not turn the
approved scoped backend repair/measurements into a full-module PASS. Jason's
independent review confirms the clean-main import failure is outside this diff.
No release or blanket developer-suite PASS is claimed. Existing task DONE entries
remain historical implementation observations, not revalidated acceptance.

Intermediate evidence is not erased: run1's core latency/physical plans passed
(listp956.545584ms), but its post-load diagnostics failed because a one-row
identifier fixture chose index scan and empty credit scalar optimized away the
table. Its one huge aggregated console line was truncated at65536characters;
complete plans were **not** claimed from it. Corrected only post-load fixture
cardinality and one-record-per-field logging. Runs2/3 passed16/16 at the previous
test-source fingerprint920c35d19b54de8b87ca9f9523c0b4cfcd2153ced64de16703fca55f22b46705
(listp956.215416/7.966959ms); final runs4/5 supersede them rather than rebinding them.
Two lint findings in new tests were fixed (escapedU+3000 and callback braces).
An incorrectly port-overridden baseline-browser attempt failed on login/CORS;
the exact original config then established clean-main full-suite15/1 above.
Real-browser diagnostic attempts failed for an unsupported CLI VM URL global,
then a wait exposed DEF-034002; the corrected URL-state run alone passed.

### Review and integration boundary

Jason (`/root/customer_task011_review`, actual separate read-only agent) initially
requested the expected-index/no-hint guard; after correction approved the code/test
slice with no remaining Required finding. Final immutable candidate and final-head
CI must still be observed before merge. The implementation PR/merge/cleanup result
will be referenced in state and the PR closure record without rewriting measurements.

## Historical pre-approval diagnosis and decision (unchanged)

## Authority and current result

Sam explicitly requested fixing both full scans, fresh 50k/20-worker/p95<=5s
measurement, then PR/merge, keeping complete downstream acceptance blocked.
This authorizes remediation, not silently replacing the approved DES-019 search
strategy or changing the physical query-plan acceptance rule.

**Product fix NOT IMPLEMENTED; HD-011 PENDING; DEF-034001 HIGH/OPEN.**
The canonical draft is a proposal only. The historical approval and all failures
remain intact; no prior evidence is relabeled as applying to this new proposal.

## Fresh unchanged reproduction

2026-10-15, main `09487bc65bff3a2360dffcaa246d5630269f11d2`, source fingerprint
`685238fea731fd9b586449a3a587c6236faaee451a916377817a7b3fdf9a4aa4`;
approved DESIGN `8462e9c2bc9909f413bb0063de29b44bcbe205d8bfd1209c254ff5d1090f9944`,
PLAN `55ea357b07fb39cc1131b61757b95ca4aa07b246a8dbabfddfecb914e79ba247`.

Fresh task-owned MySQL26.7.0, loopback13371, actual datadir
`/private/tmp/erp-customer-def034001-runtime.kLnI3D/mysql/`, schema
`erp_customer_def034001_20261015`, existing migrations through0081; Node26.6.0,
macOS ARM64,15logicalCPUs,24GiBRAM. No shared3306/production writes. The first
sandboxed initialization failed with a memory-mapping permission SIGSEGV before
data initialization; the explicitly scoped unsandboxed initialization succeeded.
Startup encryption/lookup rings were generated in process, shared only as required
by the existing Customer/Supplier startup contract, and never exported.

Unchanged executable test: 50,000Customers,5,000addresses,5,000contacts;20service
workers,30s admission,defaultpool10; the same synthetic code-prefix100-match search
and four-operation service-only subset as HD-010. No concurrent migration/build/
other test during measurement. Result: **5PASS/1FAIL/0skips**; latencyPASS,
actual-query-planFAIL, combined caseFAIL. All1,572operations correct,0errors,
30,575.55ms including drain,51.41ops/s.

| Operation | Samples | p95 ms |
| --- | --- | --- |
| List/search | 393 | 1,662.13 |
| Exact lookup | 393 | 281.44 |
| Address lookup | 393 | 279.27 |
| Contact lookup | 393 | 284.64 |

COUNT and ID-page each use physical Customers `ALL`,~49,468estimatedrows; the page
also filesorts. The20-ID projection uses primary-key range. Exactly those two
full-scan gate failures were emitted before exit1. Fixture cleanup verified0rows.

Command, against this fresh owned schema only:

```sh
DB_HOST=127.0.0.1 DB_PORT=13371 DB_USER=root DB_NAME=erp_customer_def034001_20261015 CUSTOMER_PERFORMANCE_TESTS=1 node --test --test-reporter=tap --test-reporter-destination=/private/tmp/customer-def034001-before.tap --import /path/to/private-key-preload.mjs --import ./server/test-support/testEnv.js server/test/performance/customerManagement.performance.test.js
```

[Exact sanitized reproduction metrics/plans](def034001-remediation-results.json).

After evidence capture, the owned MySQL process was shut down (exit0) and its exact
temporary root/preload removed. No fixture/data retention is needed: the synthetic
dataset is reproducible. This removes no user's local MySQL or production data.

## Root cause and bounded remedy proposal

Both queries share CustomerService.list's root OR across code/legal/trading/phone/
email and three correlated active-child EXISTS branches. Existing root indexes do
not make that entire predicate indexable. Several searched fields also lack a
search-leading index. The list handler and export snapshot both call this method,
so the root fix belongs there rather than in a handler or UI workaround.

Jason (`/root/customer_task011_review`) independently inspected the actual source,
schema and approved design; recommended distinct indexed candidate-ID UNION plus
ten missing forward indexes. DES-019 currently explicitly specifies EXISTS for
child search. The proposed exception keeps EXISTS for completeness/non-search
filters and retains exactly the old search fields, active-child predicate,
normalization, escaped prefix semantics, outer filters, archived behavior, exact
ranking, stable paging, reader transaction and actor verification. It adds no
cache/token table/new API and no unbounded application-side candidate list.

Indexes alone leave the correlated OR problem; forcing an index while reading its
whole contents is not an honest fix. Dropping phone/child fields changes results;
neither is proposed. Ten additive indexes increase storage/write work and online
DDL still needs metadata locks. Use the existing bounded lock-wait/online-DDL
convention, fail closed on incompatible indexes/unsupported online DDL, measure
costs and reserve a fresh migration number immediately before implementation.
No production DDL or index removal is authorized by this proposal.

## Why a plan assertion correction must be explicit

A disposable diagnostic on this same MySQL used50k indexed synthetic root/parent
rows and5kchildrows. Both candidate branches used range access (99/10rows), the
parent join used PRIMARY eq_ref(1row), while MySQL explained the materialized
109-candidate result as `<derived2> ALL` and `<union2,3> ALL / Using temporary`.
All diagnostic tables were TEMPORARY and disappeared on connection close.
This is not a product-fix experiment or a new capacity PASS.

The existing blanket assertion rejects those synthetic result rows as though they
were physical Customer scans. HD-011 therefore explicitly proposes allowing only
exact engine-generated derived/UNION result forms, while every physical table must
still have a real access type and never ALL. Unknown pseudo rows fail closed.
Negative/mixed-plan regressions must prove a derived row cannot mask a physical
Customers/child scan. Explain actual count/page/projection and every search branch,
not just separate favorable index probes. This is a proposed classification fix,
not a latency/index waiver; implementation must wait for Sam's baseline decision.

MySQL's [materialization documentation](https://dev.mysql.com/doc/refman/26.7/en/subquery-materialization.html)
describes temporary subquery results; the row counts/access types above are direct
observations, not inferred performance guarantees.

## Gate and next action

Proposed DESIGN: `25833d2d2e09a2ce0c763c374d0a0a9b64d3d92e9ee79e8f60cd3ea1e0003d51`.
Proposed PLAN: `7b1eb4674d231be20c8882b47a1fe5db0550b2c3429adc859e0be27630a51a34`.
HD-011 is an OPEN major decision in the machine state; no human approval is inferred.

Approve HD-011's revised canonical DESIGN/PLAN and scoped additive migration/test
classification, or reject/choose another strategy. After approval: failing guard
regressions, minimum query/migration change, every-field real-MySQL correctness,
migration repeatability/incompatible-shape tests, export/auth/filter/paging impact
regression, repeated unchanged-profile capacity measurement and all physical plans;
then actual independent review, final-head mandatory CI, fresh-main integration,
PR/merge and scoped cleanup. Do not claim a fix or close the defect before that.

TASK-030/031/032 and complete downstream/mixed-load acceptance remain BLOCKED;
TASK-034 is not DONE; TASK-035's historical isolated restore is not rerun/rebound or
production DR acceptance. No product source, test assertion or migration has been
changed in this diagnostic/planning slice.
