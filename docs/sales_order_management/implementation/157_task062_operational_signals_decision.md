# DEC-043 adoption record and original proposal

Sam directly answered the Sales question call_332a07fe091a4263a69a039bf1495384: 「批准 DEC-043 限定營運訊號方案（建議）」. The actual answer was recorded by Harness state1429; development/isolatedtests/commit/PR/mainmerge authorization continues after all remaining Gates.

The approved original proposal is retained byte-identically in phase4-private/dec043-task062-proposal-r1/157_task062_operational_signals_decision.md, SHA25662c3c59911cd893d3e07ccf9b6c7bba5c19275e771eb8d968aa054cc3e5fb048; its genuine independent proposal review is901e8355…. The historical PROPOSED status below describes that earlier proposal, not a pending new human decision. Current implementation/spec refinements remain within this approved direction and still require independent technical/native/CI/Phase verification. No production activation/DR/merge exception is granted. New canonical DESIGN/PLAN bindings must retain old approvals and cite this real adoption; do not rewrite old hashes or claim Sam manually inspected a later code hash.

---

# DEC-043 proposal — finish the already-required P4 operational signals

Status: PROPOSED, no product source/schema mutation. This is a concrete design/scope decision, not a repeat request for commit/PR/main merge or an excuse to pause the active source initializer.

## Verified baseline and gap

Worktree sales-p4-archive/erp-app, HEAD3ef50098c5285cb7b4b4bfae2f49176cf54e47d0; actualsource28e7a2d4740b22202990144e313d2b70473bcffe1da4818ad8f479ac216aabd9. CurrentapprovedDESIGN1141c4aebb4f82c8b643adf3aed2f82eb9f64852cfe0757045a0c8e29944fc65 / PLAN894e7b2de8242c626150cb7ba78eebe6b8a4f8d4ae443c0d532b4653b62a8650 remain preserved.

Design12.4 andTASK062 require these signals; current code/runbook explicitly says missing. fr_job_stats overwrites/purges current instance rows and cannot establish absence of success over24h. StandardSystemLogger maydrop/filter/fail and cannot be treated as acknowledged complete history. Currentquery/pool elapsed clocks are not engine rows examined orrow-lock wait. Existing InventoryLookup methods are for Fulfillment andcannot be impersonated for Sales monitoring.

Independent actualsource assessment: /private/tmp/p4-task062-minimum-completion-assessment.json SHA09fbc46d14600f86aaebab47d240690b1f59af7b4dfa3b8f21ac2c9de48187ea. Do not mark TASK062/Phase ready from currentpartial metrics.

## Recommended limited implementation

1. Add one Sales-owned operational-observation persistence migration, semanticfilename *_create_sales_operational_observations.js (number allocated against freshmain before implementation). It contains exactly two Sales-owned tables: sales_operational_job_runs (run UUID, fixedjobcode, DBstart/terminaltimestamps, outcome, coverageepoch) andsales_operational_alert_state (activation/versionboundary andper-oldest-demand continuity state, minimalinternalidentity, timestamps, counters/version). It contains a small coverage/run ledger and bounded per-oldest-demand observation state; this is operational telemetry, not a business Operation/Audit or a new logging framework. Store only fixed job/signal codes, private run/coverage identities, timestamps, outcomes, numeric counts and the minimal internal FIFO identities needed to verify the same oldest demand. No payload/reason/customer/SKU name/order number/external ID/token. Do not reuse/pollute existing business tables or fr_job_stats with fake rows.
2. Wrap only the actualregistered Backorder worker's acquired invocation with durable start and terminal observations. If durable start recording fails, the actualregistered invocation fails before anyBackorder domain work; the existingScheduler recordsfailure, cleansup itslease andretains itsnormalretry cadence. Do notrununobservedBackorder work andmerelyrenameitunknown afterwards. A missing terminal observation remains UNKNOWN; no false24h no-success or successful business outcome is fabricated. Keep allbusiness rules, batch/lease/timeout/stock locks andmanualwake behavior. The only new availability trade-off is that the required Backorder observation ledger becomes a prerequisite for an observed worker invocation. Confirmation andall other business commands remain independent.
3. Coverage activation is explicit, version-bound andinitially UNKNOWN. A trusted operator must first prove all contributing Backorder workers use the instrumented version and oldworkers aredrained, then establish the activation boundary; no24h absence inference before a complete post-activation window, across gaps/missing terminal facts, orfrom timestamps manufactured by a restart. Include a narrowly scoped guarded activation entrypoint/runbook; no deployment orproduction execution is authorized by this proposal. Isolateddeveloper fixtures may provide explicitly synthetic boundaries to test thelogic, neverclaim24h walltime elapsed.
4. Extend Inventory's already-approved InventoryReservationService.js with an owner-defined readonly Sales-observation method; use the actualactive registeredmetrics context and a freshreadonly RR snapshot, boundedwarehouse/SKU/minimum-sale-life demand set, exact currentInventory ATP semantics. Do not reuseFulfillment permissions, callmutatingreserve toprobe, directlyqueryInventorytables fromSales, orlet metrics grantreservation authority. A bad/missing owner result is UNKNOWN. Contractversion1 input: bounded1..500 demands withwarehouseId/skuId/sourceLineId/minimumSaleLifeDays plusobservedAtMs; outputsameidentity andAVAILABLE/NO_STOCK/UNKNOWN, decimal-stringeligible/reserved/ATP quantities, actualobservationtime andallowlistedreasoncodes. Authorization is a fixedactualregisteredmetrics principal checked bytheInventoryowner, not a caller-suppliedserviceName or borroweduserpermissions. Exactimplementation/authproof receivesreview; no newpublic HTTP endpoint.
5. Complete the existing Sales metrics job/ownedmodules with real readonlyengine facts, persistedcoverage/FIFO/provider-UNKNOWN observations andduration/outcome mapping. Enginefacts muststate exactscope/units/source/resetcoverage: Sales-table statementrows-examined from a validated performance_schema source; tableLOCK_TIME isnot InnoDBrowwait; anyinstance-wide InnoDBcounter is labeledinstance-wide, never perSalesOrder. Unavailable/disabled/truncated sourcesstayUNKNOWN. No extra SQL/per-rowlogs onbusinessrequest paths. Use the existing5minute metriccadence, boundedSQL/batches andfixedlabels.
6. Explicit alert persistence semantics: recommend the sameoldest demand with positiveeligibleATP atthreeconsecutive5minute observations spanningatleast10minutes before a stock-present FIFO warning; providerUNKNOWN warning uses the same threeconsecutive5minute sampled observations spanningatleast10minutes. Use elapsedtimestamps, notjusttwo records; resetonidentity/eligibility/result change; missing/gapped observations areUNKNOWN anddo notprove persistence. This is consecutive sampled continuity acrossatleast10minutes (atleastthreecadencedobservations), notproof thatATP/provider state stayedunchangedbetween samples. The alertwording muststate thatlimit; do notlabelitcontinuouslypositive/unknown. This fills previouslyunspecified operationalalert semantics; it doesnotchangeFIFO priority, stockallocation, confirmation, cancellation, retentions or anyperformance SLO.
7. Keep history sufficient to make the24h rule provable, with a proposed7dayoperational retention, boundedcleanup thatneverdeletes an activeincomplete window. Persistentoldest-demand state isupdatedinplace andexpiredonlywhen no longerobserved underitsdeclaredcoverage. Exactvolume/bounds must be measured before scaling; do not infer a tinyconstantstorage cost fromthe run ledger alone. Theseareownedoperationaltables, not the seven-year businessAudit/sourcekey retention. No oldevidence deletion/binlogpurge.
8. Finish realterminal timing andrunbookdry-runs with existing HTTP/worker/reconciliation interfaces. Map everyDesign12.4 metric toactualexistingevent/source; add only missingSales-owned counters. No broadframework, sharedlogger ornewobservabilityplatform refactor.

## Required implementation boundaries

Existing allowed Sales modules/SalesJobs/metrics job/tests/runbook andInventoryReservationService.js are reused. Proposed supplemental paths are the newsemanticmigration andnarrowactivationentrypoint/tests ifnotalready covered. Update canonical03/05/Profile/manifest/trace links around this design; preserve old approvals/hashes andbind newones to thisdecision. Exactschema/servicecode receives real independentreview before integration/execution. Do not implement a vague general metrics API.

Prepare privately while1m sourceinitialization runs; do not modify fingerprint-bound code/helpers untilit ends. Apply the approvedminimalpatch, migrate onlythe owned isolatedschemas, focusednative/purechecks andindependentreview, freeze finalproduct, then run the long1m/5m/25m-index/300k/50user workload once. This avoids knowingly running hours on anunfinishedproduct andthen invalidatingthe capacity results.

## Alternatives and decision

A. Approve this limited persistence/provider/engine direction andthe explicitoperationalcontinuity thresholds; complete requiredfeatures/tests before fullGate. Cost: a smallownedmigration, boundedoperationalwrites/readprovider, activation proof andfocusedregression. No fullshippingframework, noDR, no changedbusiness/latency thresholds. Recommended.

B. Keep currentboundary andUNKNOWN signals, waitfor an equivalent trustedFramework/Inventory provider to arrive. The active1m initialization can finish, butTASK062/fullP4merge staysincomplete; no PASS/waiver fabricated.

The proposednewdata persistence, internal ownercontract, operationalcontinuity semantics anddesign/plan binding arethe materialdecision. Existingdevelopment/isolatedtests/commit/PR/mainmerge authorization is retained; allremainingGates mustpass before merge. No additional decision isrequested aboutthe alreadyapproved1m/5m/25m split/noDR/lowCPU.

## Case-first required checks

| Case | Risk / actual operation | Required result and evidence |
|---|---|---|
| OBS-H01 | Real acquired Backorder start/complete/failed/timeout andmissingterminal | Exactdurablestates once; failedbegin no falselyobservedbusinesswork; pendingunknown; workerlease/stockeffects unchanged |
| OBS-H02 | Activation/mixedversions/gap/restart/boundary24h | Unknownuntiltrustedcompletewindow; real DBtimestamps; no oldapproval/hash orsyntheticfixture presented aswalltimehistory |
| OBS-F01 | Inventory formalreadonly ATP inclminimumlife/blockedwarehouse/invalid/missing | Correctownerresult; no mutation/authbypass; no thirdparty tableaccess bySales; exactboundedcontexts |
| OBS-F02 | Sameoldest positiveATP/changedhead/expiredstocks/gaps/10min boundary | Exact sampledcontinuity/reset/UNKNOWN; no FIFO priority edit; safeconstantmetriclabels |
| OBS-P01 | ProviderUNKNOWN continuity thenrecovery | Accurateelapsed10min three-sample threshold; no claim aboutunobservedbetween-sample time; gapsunknown; no single sample calledpersistent |
| OBS-E01 | Actual native engineprovider counters/query/window/reset/unavailable | True rows examined andproperlyscopedlockfacts; neitherresultcount norwallclock forged asenginefact; noclearedguard/permissionbypass |
| OBS-R01 | Readonlyreconciliation andactualrunbookrecoveries perexistingcases | Correctterminalfacts/once-onlyeffects/no blindrepair/no secrets; allrequiredpathsactuallyexecuted |
| OBS-C01 | Finalsource serialregression/coverage/CI/review andallcapacity | Currentcandidate evidence, unchangedthresholds; noDRexecution/PASS; lowCPU/100GiBreserve |

Thisproposal isnotapproval, appliedpatch, testcasePASS, formalacceptance ormergeevidence.
