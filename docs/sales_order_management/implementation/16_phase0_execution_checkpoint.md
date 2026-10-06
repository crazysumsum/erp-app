# Phase 0 execution-contract checkpoint

DEC-013 was explicitly approved by Sam: 「核准 Phase 0 驗證方案及隔離 MySQL（建議）」. The adopted profile preserves the complete formal60-case sales-technical contract and all later-phase obligations, the existing coverage/memory floors, independent review and exact-head CI. PHASE-001 now requires17 explicit developer suites, including all ten Inventory native regressions. Only the four exact upstream large performance cases listed in implementation/15 remain deferred from this developer stage.

## Concrete changes and review

Developer JUnit reports use explicit files and relevant existing assertion labels. No formal acceptance case is fabricated as PASS. TC010 remains an aggregate Phase gate. The necessary TASK025 fixture now compares the complete repository and framework migration-name set, replacing the obsolete fixed count66. Its exact shared test path is in the manifest.

Independent reviewer /root/sales_readiness_review approved the contract at DESIGN8a5844f9483b6c6cc54ba4b0c728fb8f77c95f46d8e133c9c98899b723312082 / PLAN35f9d8b2e2cbf3cfc5a2e90fbe3dd009d199a8fa012ef63121b39bcc910ce1ab; that PLAN precedes the prospective N/A approval-pointer binding. Final delta review is required before binding. Reviewer withdrew its mistaken claim that implementation/15 was missing.

CI36978401179 on c99da0e failed only the newly added unknown-route404 expectation; the unchanged disk-upload memory assertions passed, as did the other four CI jobs. Existing apiDispatcher deliberately returns401 / Unauthorized Access for unregistered /api paths regardless of token. The corrected fixture first verifies the token on the real /api/v1/user/me route200, then checks the fixed catchall401 envelope for its two route probes. This proves those paths' behavior, not exhaustive absence of every possible Sales route. Independent delta review APPROVE, testSHA256988725a4c2876149a4ca175c5dba30a856b059c12e9c9b76921c9b7799b0d5f4; targeted ESLint passed.

## Actual isolated developer observations

Owned MySQL26.7.0 runtime: /private/tmp/sales-phase0-hlnxwrb1, port63795, dedicated schemas; separate socket-only skip_networking=1 instances for021/022/025. Exact disposable metadata is in the private /private/tmp/sales-phase0-runtime.json, including datadirs/sockets/schema names. No pre-existing database, production connection/data or credentials were used. Full current migrations were applied to the Sales/Item and025 schemas.

Direct execution of the approved profile commands produced original JUnit and command/timestamp reports under /private/tmp/sales-phase0-direct-evidence and /private/tmp/sales-phase0-env-ring-failure-evidence. Successful executions collectively cover all17 required suites: core185, providers197, Salesnative8, Itemcompatibility32, tenInventorynative15 tests, totaling437 passing tests with zero failures/skips in those successful runs. Lint, client build and dependency audit also passed. These are developer diagnostics, not registered Harness evidence, formal technical/UAT acceptance, or release/performance signoff.

The Salesnative8 includes actual native COMMIT followed by injected acknowledgement loss, fresh-transaction reserve/release replay without duplicate operations/audit, fixed correlation/safe summaries and conservation. It does not simulate a physical network sever. Other native checks cover snapshots, writer/reference lock races, mappings, reserve/release/rollback,300members, migration drift/rerun/FK/identity/sequence primitives.

Failures are retained honestly: the first private runtime helper generated different Customer/Supplier synthetic key rings, causing startup validation to fail before assertions. The private binding was corrected to the existing required shared key rings; product configuration checks were unchanged. Nine database-only Inventory suites passed in that first run. Rerunning those already-populated schemas correctly failed their empty-schema prerequisites; these failures remain in the second diagnostic package. Fresh disposable schemas are required for each subsequently registered native execution. No assertion, threshold or skip policy was relaxed.

## Remaining gate

PLAN_READY currently reports stale/missing current DESIGN, PLAN and unchanged NFR014/015 N/A approvals. Final current-baseline shared-path approvals are also required for MERGE_READY. Historical approvals remain intact. A prospective APR-PHASE0-UATNA-20261002 pointer is prepared for the same unchanged N/A policy; it does not claim a human approval. The reviewed finalized candidate must be presented for the exact-baseline disposition, then run_check must actually execute/register each suite against fresh bindings. Candidate-head changes require fresh CI. Tasks/fullPHASE001 gate remain pending; later product phases, formal60-case execution, UAT and business/release signoffs remain unimplemented/unexecuted.

## Supporting report repair

Actual Harness parsing exposed an ambiguous provider title containing both TC018 and TC027; those are upstream cases, not Sales case evidence. The minimal stdlib Python adapter runs the exact reviewed provider file list, retains original JUnit names/statuses in original-provider-tests.xml and captured stdout, and emits HARNESS_JSON without case-ID claims. Its real rerun197PASS/0FAIL/0SKIP parses successfully through the unchanged Harness parser, with no Sales cases returned. One runnable stdlib unittest verifies mixed statuses, original names, absence of IDs and DTD rejection. Original failed parser observation and reports remain retained; no unrelated provider test was renamed.

## Final observed candidate CI and review

Exact candidate835d98d9f277caf8bfe3de0c56f56e3ae038bbce, CI36981692327: all five mandatory jobs PASS. Server2519PASS/0FAIL/14 documented upstream opt-in skips; original global coverage93.89% lines/84.15% branches/92.26% functions and34per-file floors PASS. Client92testfiles PASS, original floors PASS. The ten required Inventorynative suites were actually executed locally as described above; no new skip allowance is inferred from the repository CI skips. Original private log /private/tmp/sales-835-green-ci.log.

Actual independent final PR/code review APPROVE by /root/sales_readiness_review at exact835d98d/base95946469, sourceFP5013021977ab5cc254dcf31957adb2a745de0ca8b878e60752bc733c8f96be62, DESIGN9cb5c5/PLANe24686; no unresolved findings in the reviewed scoped changes. The final-baseline question DEC014 is pending, not answered by Sam's later status message「？」.

All four owned disposable MySQL instances were safely stopped after actual VERSION/datadir/socket/pid verification while that required human decision is pending; schemas and restart argv are retained privately. The live mysql-instance resource was removed from state, so no runner can mistake a stopped runtime for an available one. Full resource destruction/worktree cleanup follows completed verification/merge. PR174 remains OPEN DRAFT. No registered Harness execution or formal/merge readiness is claimed.
