# DEF-034001 remediation diagnosis / HD-011 decision

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
