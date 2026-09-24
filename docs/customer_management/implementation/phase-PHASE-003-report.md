# PHASE-003 — Developer Evidence Report

## Scope and status

- Candidate branch: `codex/customer-p3-sensitive-bulk`.
- Latest integrated parent: `origin/main` at `497ef6ce65a8b9fa3c911efc824176dcd1f0e303`.
- Scope: TASK-020 through TASK-028.
- This is developer verification only. It is not Technical Acceptance, UAT or a
  release claim.

## Delivered capability

PHASE-003 adds guarded Customer Bank access, owner-bound encryption and blind
indexes, rotation/reindex maintenance, encrypted private attachment storage and
recovery, resumable CSV import with partial-success results, bounded filtered
export, and the corresponding permission-aware UI. Durable operation outcomes,
current-permission checks, fixed lock order and bounded recovery prevent replay,
stale publication and commit-unknown corruption.

## TASK-028 developer gate

- Repository ESLint, `git diff --check`, client coverage (665/665), the production
  client build and Customer Playwright (16/16) passed. Playwright monitored console
  and network failures and exercised the sensitive Bank/attachment flows plus the
  complete import/export UI at the approved viewport widths. The build retained
  only the existing chunk-size advisory.
- The exact Customer server suite, including real MySQL integration and TC-064,
  passed 255/255. Customer-scoped measured coverage was 92.72% lines, 72.70%
  branches and 89.73% functions. The focused attachment, Bank, import/export and
  recovery suite separately passed 105/105.
- Real MySQL Customer integration passed 16/16. It covered encrypted attachment
  durability, Bank storage/rotation/reindex, import commit-unknown recovery,
  bounded export and its retry/recovery race, equality-key concurrency, party
  ownership, lookup and HTTP idempotency.
- TC-064 imported exactly 10,000 representative create-only rows. On the final
  measured run, precheck took 479.96 ms, execution 48,453.33 ms and total system
  processing 48,933.29 ms, below the ten-minute requirement. Execution throughput
  was 206.38 rows/s; row latency p50/p95 was 4.59/6.97 ms. The normal authenticated
  Customer list API was sampled 446 times during execution with zero errors and
  8.50/12.21 ms p50/p95 latency. Five-millisecond plus per-batch/per-row sampling
  measured 81,527,792 bytes peak heap growth against the explicit 256 MiB ceiling.
  MySQL recorded zero new InnoDB row-lock waits, zero current waiters, and one
  additional connection against the ten-connection pool. All 10,000 rows completed
  without failure or skip, and the fixture, audit/job/authorization rows and private
  files were removed.
- The Customer Bank maintenance CLIs completed against local MySQL with
  `processed=0`, `remaining=0` for both encryption rotation and blind-index
  reindex. Recovery/fault-injection checks passed for attachment stage/finalize,
  import source/result, export registration/publication and authorization
  revocation. Capability-disable tests remained fail-closed when config or current
  permissions were absent. Keys and ciphertext are retained during disablement;
  key removal remains prohibited until the zero-old-key proof succeeds.
- The tracked-source no-secret scan found no committed private-key block or
  populated DB/JWT/Customer-key environment assignment outside the documented
  placeholder file. Bank schema/integration tests also confirmed no plaintext
  account-number column or stored plaintext fallback.

## Coverage deviation

The repository-wide coverage command is not a valid green gate on current `main`:
with the shared temporary Customer/Supplier Bank key rings required for application
discovery, two global configuration tests assume those same environment values are
absent. Excluding only those mutually incompatible environment-default assertions,
all 1,804 applicable server tests passed, but aggregate repository coverage was
83.66% lines, 81.28% branches and 81.94% functions, and the existing out-of-scope
`refreshTokenHandler.js` branch floor remained 83.33% versus 90%. The Product
Owner's standing instruction confines this work to Customer Management; no
Supplier, Item or User/Auth assertions, thresholds or source were weakened to make
this Phase appear green. Customer runtime behavior has no failing test.

## Main reconciliation and publication policy

- Latest `origin/main` was checked before each merge. The first TASK-028
  reconciliation brought in upstream Supplier Bank UI, Item lookup source/test and
  Inventory documentation changes; the final reconciliation added Inventory
  documentation only. Both merges were conflict-free, remained outside Customer
  product/test paths and were not authored or claimed as Customer work.
- The Product Owner explicitly directed this PR to be pushed and merged without CI
  and accepted that risk. Local developer gates and independent exact-candidate
  review remain mandatory and are not waived.

## Exit status

`DEVELOPER_VERIFIED` pending independent exact-candidate review and Phase PR
publication.
