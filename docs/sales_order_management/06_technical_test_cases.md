# Sales Order Management Technical Test Specification

## 1. Execution Contract

- This is a specification, not evidence. Every case is `PLANNED`; Evidence is `—`.
- Real MySQL is mandatory for migrations, constraints, transactions, locks, deadlocks, commit-unknown, archive and restore cases. Mocks may supplement but not replace this evidence.
- Frontend cases require a running application and Playwright validation of user behavior, console and network results.
- Performance/DR evidence must identify build/commit, hardware, Node/MySQL versions, pool/buffer settings, dataset distribution, cache state and timestamps.
- A failed formal case enters defect/failure triage before product remediation.

Fields: `ID | Title | Type/Priority | Traceability | Preconditions/Data | Steps/Trigger | Expected/Acceptance | Cleanup | Automation | Status | Evidence`.

## 2. PHASE-001 Foundation

| ID | Title | Type / Priority | Traceability | Preconditions / Data | Steps / Trigger | Expected / Acceptance | Cleanup | Auto | Status | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-001 | Provider presence/version gate | CONTRACT/P0 | FR-023–026,043–061,123–140; DES-003; TASK-001,009,010 | provider absent/wrong version/UNKNOWN | startup and command | feature/command fails closed with stable error; no Sales/Inventory write | restore provider | YES | PLANNED | — |
| TC-002 | Fresh/upgrade migration proof | DB/P0 | DES-008,018; TASK-001,011 | empty DB and latest supported schema | migrate, restart, rerun detector | ordered schema/indices/triggers exact; no fixed stale migration number | disposable DB | YES | PLANNED | — |
| TC-003 | Permission catalogue and route matrix | SECURITY/P0 | SEC-001–004,013; DES-009,013; TASK-006 | users with each single permission and none | enumerate UI/direct API | only explicit actions allowed; role names do not grant capability | reset roles | YES | PLANNED | — |
| TC-004 | 50 MB disk-stream memory bound | PERFORMANCE/SECURITY/P0 | FR-076–095; NFR-004/005/008; SEC-006; DES-010; TASK-002–005 | boundary CSV, measured heap | concurrent uploads/precheck | heap does not grow linearly with file; no full Buffer exposed | purge temp | PARTIAL | PLANNED | — |
| TC-005 | Upload traversal/symlink/type/size defense | SECURITY/P0 | SEC-005–008,014; DES-010; TASK-003,004 | traversal names, symlink root, bad MIME/UTF-8, >limit | upload | safely rejected before job/SO; no write outside managed root | remove fixtures | YES | PLANNED | — |
| TC-006 | Upload abort/concurrency/orphan recovery | RECOVERY/P0 | NFR-008/010; SEC-006; DES-010,015; TASK-002–005 | partial streams and full gate | abort/timeout/restart | slots/files released; bounded backpressure; orphan cleanup safe | purge temp | YES | PLANNED | — |
| TC-007 | Money/quantity/state/hash primitives | UNIT/P0 | FR-003–007,030–039,042–075; DES-002,007; TASK-007,008 | scale/overflow/invalid transitions/A-A-B payload | normalize/calculate/transition/hash | decimal exact, invariants hold, invalid rejected, hash stable/conflict distinct | — | YES | PLANNED | — |
| TC-008 | Fresh actor after revocation | SECURITY/P0 | SEC-001/004/013; DES-013; TASK-006 | page/job initiated then actor disabled/revoked | perform command/worker effect | new effect rejected; initiating/system actor preserved; no partial write | restore actor | YES | PLANNED | — |
| TC-009 | Audit/log redaction and correlation | SECURITY/OBSERVABILITY/P0 | NFR-011; SEC-004/007–012; DES-014; TASK-006,011 | token, path, formula, long notes | success/failure paths | safe fixed fields/correlation present; secrets/high-cardinality labels absent | purge test logs | YES | PLANNED | — |
| TC-010 | PHASE-001 full gate | REGRESSION/P0 | All NFR/SEC; TASK-001–011 | clean latest-main branch | lint/unit/coverage/build/audit/contracts/real-DB | all configured gates pass without skips/suppression/lowered thresholds | reset env | PARTIAL | PLANNED | — |

## 3. PHASE-002 Quotation and Manual Draft

| ID | Title | Type / Priority | Traceability | Preconditions / Data | Steps / Trigger | Expected / Acceptance | Cleanup | Auto | Status | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-011 | Quotation CRUD and amount | API/INTEGRATION/P0 | FR-001–008; DES-002,009; TASK-012,016 | active customer/SKUs, currencies | create/update/read | unique number, exact amounts/defaults, no reservation | cancel fixture | YES | PLANNED | — |
| TC-012 | Quotation validation matrix | NEGATIVE/P0 | FR-002–009; SEC-005; TASK-016 | inactive master, dates, 0/negative/overflow, unknown fields | save/issue | field-safe errors; state/data unchanged | rollback | YES | PLANNED | — |
| TC-013 | Quotation/SO sequence concurrency | DB/CONCURRENCY/P0 | FR-018–019; DES-002; TASK-015 | 100 parallel creates, HKT month boundary | allocate | globally unique, correct prefix/month, never reused | rollback isolated DB | YES | PLANNED | — |
| TC-014 | Issue/expire/cancel state machine | API/RECOVERY/P0 | FR-009–011,016; DES-002,015; TASK-017,021 | DRAFT/ISSUED and boundary time | issue/job/cancel/retry | only valid transitions; history/audit once; no Inventory effect | rollback | YES | PLANNED | — |
| TC-015 | Quotation conversion idempotency | INTEGRATION/CONCURRENCY/P0 | FR-012–017; DES-007; TASK-017 | one eligible quotation, simultaneous events | convert/retry | exactly one Draft SO, stable reverse links/difference, no reservation | cancel SO | YES | PLANNED | — |
| TC-016 | Manual Draft validation and totals | API/P0 | FR-018–039; DES-002,009; TASK-013,023 | 1/100/101 lines, mixed currency/UOM | create/update | all business fields/invariants exact; forbidden hidden fields rejected | cancel | YES | PLANNED | — |
| TC-017 | Draft optimistic concurrency | CONCURRENCY/P0 | FR-040–041; DES-009; TASK-023 | two editors same version | save/confirm stale and current | stale 409 with safe currentVersion; no overwrite/merge | rollback | YES | PLANNED | — |
| TC-018 | Lookup and confirmation-time revalidation | CONTRACT/P0 | FR-002,005,023–026,043–046; DES-003; TASK-022,023 | master changes after page load | lookup then save/confirm | lookup is advisory; submit uses provider truth and rejects ineligible item | restore master | YES | PLANNED | — |
| TC-019 | Quotation/Draft browser accessibility | FRONTEND/P1 | FR-001–041; NFR-013; SEC-001/002/007; DES-012; TASK-018–027 | roles, 375–1440px, field/server errors | Playwright core flows | keyboard/focus/labels/states/navigation/refresh correct; no console/network failures | — | YES | PLANNED | — |
| TC-020 | PHASE-002 full regression | REGRESSION/P0 | FR-001–041; TASK-012–027 | production-like build | full Phase gate plus prior P0 | no regression; menu/routes only enabled at exit | reset env | PARTIAL | PLANNED | — |

## 4. PHASE-003 Confirmation, Reservation and Lifecycle

| ID | Title | Type / Priority | Traceability | Preconditions / Data | Steps / Trigger | Expected / Acceptance | Cleanup | Auto | Status | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-021 | Inventory batch contract and lock order | CONTRACT/DB/P0 | FR-047–061,063–075; DES-003,005; TASK-028–030 | multi-SKU, two clients, documented locks | barrier reserve/release | exact per-line result, global lock order, no generic per-line race | rollback | PARTIAL | PLANNED | — |
| TC-022 | Full/partial/zero ATP confirmation | INTEGRATION/P0 | FR-042–053; DES-004–006; TASK-029–031 | three orders, same warehouse | confirm | CONFIRMED; ordered=reserved+backorder; no negative inventory | release | YES | PLANNED | — |
| TC-023 | Multi-line atomicity and snapshot | INTEGRATION/P0 | FR-043–055; DES-002,005; TASK-029,030 | mixed availability and master data | confirm with injected failure | success commits all lines/snapshot/audit or failure commits none | rollback | YES | PLANNED | — |
| TC-024 | Confirm replay and payload conflict | IDEMPOTENCY/CONCURRENCY/P0 | FR-048,055–061; SEC-015; DES-004,007; TASK-029–031 | same event A/A/B | simultaneous/retry | A resolves one outcome/reservations; B 409 no effect | release | YES | PLANNED | — |
| TC-025 | Crash between confirmation phases | RECOVERY/P0 | FR-055–061; NFR-009/010; DES-004; TASK-029,032 | kill after Phase A and inside Phase B | restart recovery | same event converges; no editable false-success state/duplicate | reset | PARTIAL | PLANNED | — |
| TC-026 | Commit-unknown recovery | RECOVERY/P0 | FR-055–061,074; DES-004,007; TASK-029,032,033 | sever connection at COMMIT | lookup/retry same event | server fact resolves exactly one outcome; no new event/effect | restore network | PARTIAL | PLANNED | — |
| TC-027 | FIFO backorder allocation race | CONCURRENCY/P0 | FR-050–061; DES-005,006; TASK-035,036 | ordered confirmed times and replenishment | two workers/manual wake | earlier entries allocated first; one lease; quantity conserved | release | PARTIAL | PLANNED | — |
| TC-028 | Withdraw release failure | INTEGRATION/P0 | FR-062–064; DES-005; TASK-033 | zero fulfilled with release success/failure | withdraw/retry | Draft only after full release; failure remains truthful/replay-safe | restore | YES | PLANNED | — |
| TC-029 | Cancel/close/completed invariants | INTEGRATION/P0 | FR-065–075; DES-002,005; TASK-033,034 | DRAFT/confirmed/partial/full fulfilled | cancel/close/apply result | allowed transitions only; reason/audit; quantities conserved | rollback | YES | PLANNED | — |
| TC-030 | Revoked actor during confirm/lifecycle | SECURITY/P0 | SEC-001/013; DES-013; TASK-031,033 | loaded page then revoke | confirm/cancel/withdraw | transaction rejects before Inventory/Sales effect | restore actor | YES | PLANNED | — |
| TC-031 | Reservation/backorder reconciliation | INTEGRATION/OBSERVABILITY/P0 | FR-053–061,064–075; NFR-011; DES-014; TASK-037 | seeded match/mismatch | run read-only reconciliation | every mismatch detected/correlated; no auto SQL repair | restore fixture | YES | PLANNED | — |
| TC-032 | 50-user confirmation performance | PERFORMANCE/P1 | NFR-003/005; DES-019; TASK-037 | 1/100-line, mixed jobs, real MySQL | load test | p95 <=3s excluding dependency failure; no pool starvation/incorrect result | stop load | PARTIAL | PLANNED | — |
| TC-033 | PHASE-003 full regression | REGRESSION/P0 | FR-042–075; TASK-028–037 | production-like | full Phase and prior gates | all concurrency/recovery/security invariants pass | reset env | PARTIAL | PLANNED | — |

## 5. PHASE-004 CSV and Channel Intake

| ID | Title | Type / Priority | Traceability | Preconditions / Data | Steps / Trigger | Expected / Acceptance | Cleanup | Auto | Status | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-034 | CSV v1 grammar/limits/formula matrix | UNIT/SECURITY/P0 | FR-076–083,091–094; SEC-005–008; DES-010; TASK-039,040 | BOM/CRLF/quotes/bad UTF8/NUL/formula/boundaries | parse/upload | exact valid normalization; unsafe/overlimit rejected with no partial job | purge | YES | PLANNED | — |
| TC-035 | Precheck has no business effect | INTEGRATION/P0 | FR-082–083; DES-010; TASK-041 | valid/invalid/duplicate orders | upload/precheck | status/count/errors stored; zero SO/external-success key/reservation | purge | YES | PLANNED | — |
| TC-036 | Per-source atomicity/batch isolation | INTEGRATION/P0 | FR-079–087; DES-007,010; TASK-041–044 | one invalid multi-line source plus valid peers | confirm batch | bad order has zero effect; valid peers continue; totals exact | rollback | YES | PLANNED | — |
| TC-037 | External key duplicate/retry rules | DB/IDEMPOTENCY/P0 | FR-084–090,102–103; DES-007; TASK-038,044 | success, prior business fail, hash collision | resubmit across batches/channels | success unique per channel; prior failure retryable; collision alerts/no duplicate | rollback | YES | PLANNED | — |
| TC-038 | Intake worker lease/crash/resume | RECOVERY/P0 | FR-083–095,101–105; NFR-009/010; DES-007,015; TASK-044,045 | mid-batch kills/outcome unknown | restart workers | completed not repeated; original event reused; counts/result converge | reset jobs | PARTIAL | PLANNED | — |
| TC-039 | Batch confirmation double action | CONCURRENCY/P0 | FR-094; SEC-015; DES-007; TASK-043 | READY batch | parallel confirm/refresh | one processing job and event; replay returns same state | cancel | YES | PLANNED | — |
| TC-040 | Canonical Channel identity/result contract | CONTRACT/SECURITY/P0 | FR-096–108; SEC-003/010/015; DES-011; TASK-045,046 | two adapters, spoofed payload identity | submit A/A/B | transport identity overrides payload; exact union result; core behavior same | rollback | YES | PLANNED | — |
| TC-041 | No unauthenticated public Channel route | SECURITY/P0 | FR-096–108; SEC-001/003; DES-011; TASK-046 | transport auth undecided | enumerate routes/direct request | no public route registered; only contract tests callable | — | YES | PLANNED | — |
| TC-042 | 10,000-order CSV performance | PERFORMANCE/P1 | FR-090–095; NFR-004/005/008; DES-010,019; TASK-049 | <=50MB, ~50k lines, standard env | end-to-end with 50 users | <=30m, bounded memory/queue, foreground SLO maintained | perf DB | PARTIAL | PLANNED | — |
| TC-043 | PHASE-004 full regression | REGRESSION/P0 | FR-076–108; TASK-038–049 | production-like | full Phase and prior gates | import/channel security, recovery, UI and core invariants pass | reset env | PARTIAL | PLANNED | — |

## 6. PHASE-005 Inquiry, Export, Archive and Release

| ID | Title | Type / Priority | Traceability | Preconditions / Data | Steps / Trigger | Expected / Acceptance | Cleanup | Auto | Status | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-044 | Active views/filter/exact routing | API/DB/P0 | FR-018–021,109–113,120; DES-016; TASK-052,053 | mixed states/sources, 7.3m dataset | query/filter/sort/page | correct stable results; exact index path; Active not silently unioned | retain perf DB | YES | PLANNED | — |
| TC-045 | Export scope/formula/owner/expiry | SECURITY/INTEGRATION/P0 | FR-114–117,135–136; SEC-007/012/014; DES-016; TASK-054–056 | scoped users, text risk, expired job | create/download as owner/other | filter/scope exact; safe CSV; other denied; expired 410 | purge files | YES | PLANNED | — |
| TC-046 | History/audit/snapshot immutability | DB/SECURITY/P0 | FR-016,041,060,075,118–120,126,133; SEC-011; DES-014; TASK-052,062 | completed actions/archive rows | application/direct mutation attempt | append-only/immutable; all actor/time/outcome/correlation present | rollback | YES | PLANNED | — |
| TC-047 | Archive eligibility/cutoff/open matter | INTEGRATION/P0 | FR-121–125,140; DES-003,017; TASK-057 | final/open/backorder/UNKNOWN and 24m boundaries | candidate/recheck | only eligible moved; read-only queries do not change business date; UNKNOWN skipped | rollback | YES | PLANNED | — |
| TC-048 | Archive atomic copy/verify/remove | DB/P0 | FR-125–128; DES-008,017; TASK-058 | aggregate with source/history/audit | inject each copy/verify/remove failure | complete verified archive then Active removal, or Active remains complete; no half aggregate | rollback isolated DB | PARTIAL | PLANNED | — |
| TC-049 | Archive retry/hash/conflict | RECOVERY/P0 | FR-129–132; NFR-009/010; DES-017; TASK-058,059 | interrupted batch, same/different data | rerun/recover | same data resumes idempotently; conflict stops/alerts; report counts exact | reset | PARTIAL | PLANNED | — |
| TC-050 | Active/Archive/external-key routing | INTEGRATION/P0 | FR-133–136; DES-007,016,017; TASK-060,061 | manual/quotation/CSV/channel archived orders | exact/source/link lookup | exactly one tier/resource found; explicit archive label; no duplicate/false 404 | rollback | YES | PLANNED | — |
| TC-051 | Archive immutability/no purge | SECURITY/P0 | FR-132–140; NFR-016; SEC-011; DES-008,017; TASK-059–061 | archive rows <7y and old | UI/API/direct mutation/purge discovery | read/export only; no automatic or user purge; data unchanged | rollback | YES | PLANNED | — |
| TC-052 | Job failure isolation/backpressure | RECOVERY/P0 | FR-130–138; NFR-008–011; DES-015; TASK-054,059,062 | failing import/export/backorder/archive jobs | fail one while Active commands run | failure visible/retryable; other jobs/Active functions continue; bounded resources | clear jobs | PARTIAL | PLANNED | — |
| TC-053 | 7.3m Active query performance | PERFORMANCE/P1 | NFR-001/002/007; DES-019; TASK-063 | production-like distribution and indexes | mixed exact/common workload | p95 <=2s with correct rows/plans and no empty-data shortcut | retain perf DB | PARTIAL | PLANNED | — |
| TC-054 | Archive query and monthly batch performance | PERFORMANCE/P1 | NFR-006/008; DES-017,019; TASK-059,063 | archive scale, 300k candidates, batch500 | query/archive with foreground load | exact <=3s/range <=5s; no long-lock/SLO breach | retain perf DB | PARTIAL | PLANNED | — |
| TC-055 | Mixed 50-user capacity | PERFORMANCE/P1 | NFR-003–005/008; DES-019; TASK-063 | 50 users plus all jobs | sustained workload | all stated latency/batch targets, no pool/thread/disk starvation | stop load | PARTIAL | PLANNED | — |
| TC-056 | Backup set completeness | HA_DR/P0 | FR-138–140; NFR-016; DES-020; TASK-062,063 | Active/Archive/keys/operations/files/config | produce backup/manifests | every required store/version/key identified and restorable | secure/delete test copy | PARTIAL | PLANNED | — |
| TC-057 | Isolated restore and reconciliation | HA_DR/P0 | FR-127/138–140; NFR-016; DES-017,020; TASK-062,063 | representative sources and aggregates | restore isolated env/reconcile | counts/amounts/hashes/status/routes/reservation refs/audit match | destroy isolated env | PARTIAL | PLANNED | — |
| TC-058 | Production RTO drill | HA_DR/P0 | NFR-014; DES-020; TASK-063 | approved production-like recovery plan | timed failure-to-service exercise | usable service and verified critical flows restored in <=4h | restore normal | NO | PLANNED | — |
| TC-059 | Production RPO drill | HA_DR/P0 | NFR-015; DES-020; TASK-063 | controlled writes and backup/log timestamps | restore and measure loss window | reconciled loss window <=15m; no fabricated/duplicate orders | destroy isolated env | NO | PLANNED | — |
| TC-060 | Final system/regression/release gate | SYSTEM/P0 | FR-001–140; NFR-001–016; SEC-001–015; DES-001–020; TASK-001–063 | identified release candidate | full automated/manual/DB/browser/perf/DR suite | no blocking defect, all evidence linked; business UAT remains separate | reset env | PARTIAL | PLANNED | — |

## 7. Mechanical Requirement Coverage

Functional requirements covered: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013, FR-014, FR-015, FR-016, FR-017, FR-018, FR-019, FR-020, FR-021, FR-022, FR-023, FR-024, FR-025, FR-026, FR-027, FR-028, FR-029, FR-030, FR-031, FR-032, FR-033, FR-034, FR-035, FR-036, FR-037, FR-038, FR-039, FR-040, FR-041, FR-042, FR-043, FR-044, FR-045, FR-046, FR-047, FR-048, FR-049, FR-050, FR-051, FR-052, FR-053, FR-054, FR-055, FR-056, FR-057, FR-058, FR-059, FR-060, FR-061, FR-062, FR-063, FR-064, FR-065, FR-066, FR-067, FR-068, FR-069, FR-070, FR-071, FR-072, FR-073, FR-074, FR-075, FR-076, FR-077, FR-078, FR-079, FR-080, FR-081, FR-082, FR-083, FR-084, FR-085, FR-086, FR-087, FR-088, FR-089, FR-090, FR-091, FR-092, FR-093, FR-094, FR-095, FR-096, FR-097, FR-098, FR-099, FR-100, FR-101, FR-102, FR-103, FR-104, FR-105, FR-106, FR-107, FR-108, FR-109, FR-110, FR-111, FR-112, FR-113, FR-114, FR-115, FR-116, FR-117, FR-118, FR-119, FR-120, FR-121, FR-122, FR-123, FR-124, FR-125, FR-126, FR-127, FR-128, FR-129, FR-130, FR-131, FR-132, FR-133, FR-134, FR-135, FR-136, FR-137, FR-138, FR-139, FR-140.

Non-functional/security requirements covered: NFR-001, NFR-002, NFR-003, NFR-004, NFR-005, NFR-006, NFR-007, NFR-008, NFR-009, NFR-010, NFR-011, NFR-012, NFR-013, NFR-014, NFR-015, NFR-016; SEC-001, SEC-002, SEC-003, SEC-004, SEC-005, SEC-006, SEC-007, SEC-008, SEC-009, SEC-010, SEC-011, SEC-012, SEC-013, SEC-014, SEC-015.
