# TASK-031 — developer remediation verified; dependency gate blocked

Current disposition (HD126): actual Sam reply 「批准」 approved exact TASK031 source `894fb4eea4259c375705fdaea945a2a2fadc64736a9bbc335f47e35b5789e42e` / review patch `0b8d0c0d7c205c79eaee47520820651508dc5496148c5fc4636d709ab31dd694` and local developer DoD; HUMAN REV094 / APR169. TASK031 is DONE locally. Nineteen existing native developer PASS reports and17 named scenarios were revalidated without rerunning or relabelling tests;205 historical/current evidence refs retained. DEF009/010/011 remain CLOSED. TASK032+ is PENDING; this approval does not authorize future source, publication/main integration, formal acceptance or capacity waiver. Earlier pending-review statements below are preserved historical context.

Current disposition: HD125 actual Sam approval/APR168 HUMAN REV093 adopted exact lock;19 fresh native developer contracts and17 named scenarios PASS on source894fb4ee. DEF011 technical remediation verified; TASK031 still IN_PROGRESS/BLOCKED pending independent Sam HD126 exact source review. [Current review handoff](task031-implementation-review.md). Prior content below is historical; no old result/approval is rebound. No publication/TASK032+/formal/capacity acceptance.

Current local disposition: IMPLEMENT / BLOCKED, TASK-031 IN_PROGRESS. Sam's actual HD123 approval adopted the exact actor-binding candidate; it did not approve this subsequently implemented source or dependencies. No commit, push, PR, CI, merge, main adoption or TASK032 work occurred. Final independent Sam implementation review remains pending.

HEAD `869ac07abdd3879254c351d857be911d71e68b6b`; source `7bc0fbfed8fb1f626b4c008f28310c2b1b8233622668b933d8f90b69780853df`; DESIGN `ccd54a79438c2bb7e1cfcc58c9b8878b47120f0a3f91110a13d7d28202e05853`; PLAN `4c074a4e344599e912aab7e351e93abfc5f447085657f59625f7c7a95c69440a`. Earlier runs retain their original identities; none were relabelled as current-source proof.

## Approved implementation and defect retest

The uncommitted Adjustment/Status transaction stages only its owned new Operation and genuinely inserted new Lot with NULL actor metadata. The final current ordered security guard runs after stock/Item waits, then exact-row conditional bindings establish the trusted actor before business mutations. Missing rows, DB errors, aborts or the original proof deadline roll back the whole transaction. Existing Lot creators, including NULL values, are not backfilled; replay and Receipt/Issue/BinMove/Transfer contracts are preserved. Lot/FIFO/expiry comparisons use owned SQL DATE_FORMAT rather than connection-wide coercion. No DDL, FK removal, global auth/admin/configuration or dependency edits were made.

Five owned source/test files changed after HD123: Adjustment helper, Posting service, Posting service tests, native Movement tests and warehouse API tests. The eight shared source/test paths rebound by HD123 remain byte-identical to the proposal pins. SELF_REVIEW is not independent Sam approval.

DEF009 targeted native revoke-before-Warehouse/post-new-Lot-wait, guard-first ordering, exact actor/creator attribution and bind-failure rollback now pass. DEF010 native new/existing/NULL Lot DATE handling, expiry/min-life/midnight/FIFO and Receipt compatibility now pass. Both have current-source impact regression, so their technical remediation can close; the separate dependency finding DEF011 still blocks the module and task completion.

## Actual current-source checks

- [Movement native MySQL](../evidence/task031-final-db-inventory-p3-movement-database-0b70d45bf0/run.json): 30/30 PASS.
- [Actual strong-auth HTTP/API](../evidence/task031-final-db-inventory-p3-api-08196567a6/run.json): 25/25 PASS, including actual JWT/P-256/scrypt, cache-wait revocation, six Status directions and original UserAdminService token-first disable.
- [Original Transfer native MySQL](../evidence/task031-final-db-inventory-p3-transfer-database-8874ac9496/run.json): 31/31 PASS.
- [Original Task026 migrations](../evidence/task031-migration-regression-inventory-task026-database-7d3fcaab96/run.json): 7/7 PASS.
- [Seven original non-DB contracts](../evidence/task031-regression-nondb-f360ed0b32/diagnostic.json): Inventory190, root2178, client706 and Transfer-client13 PASS; lint/build and all original34 high-risk coverage floors PASS.
- [Four original supporting unit contracts](../evidence/task031-supporting-continuation-nondb-2de387d7ef/diagnostic.json): Task02615, Task02732, Task02813 and P3unit27 PASS. The reused controller's final generic text incorrectly says selected7; this continuation actually selected four, and did not rerun or pass audit.
- [Actual existing Transfer Playwright](../evidence/task031-browser-inventory-p3-browser-3063579b12/run.json): 8/8 PASS against real API/MySQL, no unexpected console/network errors.
- [Existing functional guards, first batch](../evidence/task031-functional-regression-functional-87b8adf76c2e/results.json) plus [last API retry](../evidence/task031-functional-regression-functional-ccf3eebdf5dc/results.json): ten original files / eighteen strict native leaves PASS. Eight supporting commands are sidecar diagnostics, not registered profile contracts; P2DB7 and P2API1 are registered. The first controller adapter stopped at a string-match preflight before resources/tests; a later API attempt stopped before test invocation because its synthetic username exceeded MySQL32 characters. Failures are retained; only that API environment was corrected and rerun, with no product/assertion change.

All strict runs above have zero FAIL/SKIP/NOT_RUN. Own synthetic schemas, accounts, daemons, roots, loopback listeners and sleep-prevention handles were precisely cleaned and absence/exit checked. Deleted synthetic data is unrecoverable; evidence remains. No shared or production resources were touched.

[Broad native full-server developer diagnostic](../evidence/task031-full-native-20261007T085616-5d7e089d/diagnostic.json) separately returned exit0: 2741 total / 2634 PASS / 0 FAIL / 107 guarded SKIP, global coverage 93.58 lines / 84.32 branches / 91.91 functions against unchanged92/83/90, original34 per-file floors PASS. This is not a strict zero-skip profile report. Disposition of those107 skips: Movement30 + Transfer31 + API25 have separate current-source PASS; migration7 has separate PASS; ten existing guarded top-level functional cases have eighteen strict leaves across separate PASS reports; four capacity/release cases remain NOT_EXECUTED for their applicable stage. Skips are never converted to PASS and no capacity waiver was granted.

## Named scenario evidence

Current native JUnit contains actual ADJ031 case names. `root` below means inventory-p3-server-coverage.xml in the seven-contract folder; `DB` means the Movement XML; `API` means the actual warehouse API XML. Aggregate legacy totals alone are not used as scenario proof. Canonical TC007 rows remain NOT_RUN for formal testing; this table is developer disposition only.

| Scenario | Named current-source evidence | Developer disposition |
| --- | --- | --- |
| HTTP-BOUNDARY | root resolver/dispatcher/handler opt-in, strict order and missing hook tests | PASS |
| INPUT | root plus API pre-claim coercion/forgery rejection | PASS |
| REASON | root plus API exact categories/Unicode/OTHER/Audit tests | PASS |
| PROOF | root opaque context/time tests plus API actual JWT/device/password | PASS |
| HTTP-REPLAY | root preparation/store tests plus API immutable credential-free replay | PASS |
| CACHE-WAIT | root synchronous replay guard plus API committed revoke/deadline barriers | PASS |
| DOMAIN-REPLAY | DB unique-claim wait and changed current stock/Item, plus API source replay | PASS |
| UOM | root bounds/current eligibility plus DB Pack conversion/changed factor | PASS |
| IN-LOT | root resolver ownership plus DB new/existing/NULL-date native values | PASS |
| LIFE-FIFO | DB today/min-life/midnight wait and zero/positive FIFO anchors | PASS |
| OUT-RESERVED | root free/uncovered rules plus DB reservation accounting | PASS |
| STATUS | root plus DB/API all six directions and immutable actor receipt | PASS |
| LOCKS-VERSION | root input/version guards plus DB expected-absent races | PASS |
| REVOKE-ORDER | DB two wait positions/committed writers/current guard; API actual admin disable | PASS |
| ACTOR-BIND | root red→green/current root rerun plus DB row0/error/deadline/abort/creator preservation | PASS |
| ROLLBACK | DB reached Operation/Lot/Balance/bind/paired-leg/Audit/completion checkpoints | PASS |
| COMPATIBILITY | root/Inventory/client/Receipt/Transfer/API/browser functional regressions pass; current dependency audit fails | BLOCKED by DEF011 |

## Remaining boundary

[Actual dependency audit FAIL and HD124 decision](task031-dependency-decision.md). This checkpoint does not claim all developer gates, TASK031 DONE, full-P3 verification, formal TC/UAT or release acceptance. Do not advance TASK032 or publish. Current-source functional evidence may remain useful for diagnosis, but any approved dependency/source/baseline change requires fresh affected checks; historical reports must not be rebound.
