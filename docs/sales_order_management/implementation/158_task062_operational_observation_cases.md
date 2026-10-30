# DEC-043 developer observation cases and source mapping

Status: PRIVATE PREPARED / NOT YET INSTALLED OR NATIVE EXECUTED. Sam approved proposal157 SHA62c3c599…; no production activation, noDR, no threshold waiver. Original source initializer remains frozen at28e7a2d…; its initialization proof is separate from final-product measured workload.

R4private static review6c43dc4c… passed only its scoped implementation. Readiness matrix91dc484… found three genuine missing source families; R5 adds fixed staged-after-ack reservation/Intake/allocation counters and direct-worker fault observation. R5review96d3c5… found missing retry SELECT source_type and recovery error double-count; R6 adds that projection and known-error propagation distinction, with real worker/helperRED→GREEN cases. No finding is erased and none of this is native/Phase readiness.

## Required cases

- OBS-H01/H02/H03/W01: actualregistered worker durableSTART beforebusiness, failedSTARTno work, deferredFAILED, abortedpendingUNKNOWN, lostterminalACKno overwrite; DBclock/drainedlease/activationCAS; artifact/policy mismatch/restart/pending/24h boundaries. Synthetic historic metadata is labeled, never elapsed-walltimeproof.
- OBS-F01/F02/P01: Inventory readonlyRR/liveprincipal/no borrowedauthority; exacteffective min-life/activeBaseUOM/ATP/UNKNOWN; actual501FIFOscopes/page500; threequalified samples spanning600000ms, gap/reset/version/head/stock changes andproviderUNKNOWN/recovery.
- OBS-E01/E02: actual native engine rows, exact units/scope/overflow/instrumentation/UNKNOWN; exactScheduler signal reaches everyquery, cancellationhaltsfollow-ups.
- OBS-D01/D02/D03: fixedcreate/convert durations, acknowledgedfreshconfirmationterminal only; rollback→retry,unknowncommit,durablereplay; safe source counters andpublicationfailureretention.
- OBS-T01…T08: exactpartial/zero/fullreservationattempts afterouterCOMMIT; replay/rollbackexcluded, unknownACKseparate; successpriority→ackclock; CSVpersist/precheck/processing/realretry, Channelpre-DB andpersisted validation plusrequestreplay; missingselectedsource/propagatedfault regression.
- OBS-R01: native Confirmation recovery/Intake retry/Backorder wake/Archive failure recovery, originalevents andactualreadonlyreconciliation. Map existing full suites only where they execute each real action/closecondition; noalert-onlyunit counts asrunbook execution.

## Execution contracts

The new mandatory `sales-phase005-observations-unit` explicitly runs15newunitfiles/min42/zeroFAIL/SKIP. The new `sales-phase005-observations-native` runs7newnativecases/min7/zeroFAIL/SKIP, including actualregisteredowner501scope andrealclock/lease/CAS. Two additional Intake source/cooldown cases remain in original `salesImportPrecheck.integration.test.js` under inherited `sales-phase004-native`, withaddedTC060casebinding/+2minimum. All prior developer suites remain mandatory. OBS identifiers are engineering aliases tracing DES014/TASK062/TC060, notnewformalTC/UAT.

Run serialnice10/UV2/GOMAX2 on ownednonce schemas/socket. The active source initializer mustfinish andits finalreceipt/count/helperchecks mustpass before product/spec/migration integration or anynewnativeSQL. Allocate the pendingmigration number fromfreshmain, verify the mechanical installedlayout, migrate onlyownedtestschemas andfreeze finalproductbefore capacity. Native script migrations/fixtures require independentreview beforeexecution; no rawhistory/binlog purge, no backups/DR. Exactcurrentcandidate CI/fullphasereview/allGates still precede already-authorizedmainmerge.

## Scope and storage evidence

Exactlytwoownedoperationaltables andoneguardedactivationCLI; no newplatform/Inventorymutation/HTTPauth/transactionisolation change. No businessrequestSQL/log additions; the Intake retry query additionally projects itsexisting source_type in the same statement. Quantity/cohort definitions are in Design12.4.1 andthe runbook. Completedrun7day cleanup isbounded500; unresolvedfacts remainforensics/UNKNOWN andnotclaimedconstantstorage. Measure actualtable/index/row/scope/instancevolume before readiness.

Initializer at660k hadfilesystem-only8.72GiBsource/22.38GiBindex and1.5safety1mprojection19.82GiB<64GiBsourceadmission; this is not afinalSQLcount orcapacityPASS. All100GiB reserve/1m5m/25mindex-only/300kArchive/50user/latency/memory/coverage/CI/review limits stand. Finalstorage/native/runbook/every-gate result remains NOT_EXECUTED until observed ontheinstalledcandidate.

Private structural validation corrected the new Inventory-readonly contract to the two explicitly required observation REGRESSION suites. The existing sales-provider-regression remains mandatory DEVELOPER and in the original Phase developer list; none of the old obligations/commands/assertions is removed. validate_traceability returned STRUCTURE_PASS/noissues withoutapproval-check; newD/P/historicalNAbindings stillwaitforreviewedactualintegration, not humanapprovalorGatePASS.
