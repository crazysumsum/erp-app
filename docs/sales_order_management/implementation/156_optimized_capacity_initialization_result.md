# DEC-041 — Optimized capacity-only initialization and local admission

Sam-approved current-round scale:5000000Active/25000000lines;25000000valid External Keys/300000Archive candidates/50users andallotherperformance/gates unchanged. NoDR perDEC040. Originalproduction7.3m requirement retained; no claim5m proves7.3m.

## Observed optimization

LowCPU nice10/InnoDBconcurrency2 actualbuilder only session sql_log_bin=0, global logging1 unchanged. 1000Active/5000lines/2625Archive externaltargets/3425validkeys/all3625readonlyreconcile:1PASS/0FAIL/0SKIP in210.312s. Originalregisteredworker/real600s deadline retained. Builder app/pool closed, then freshdefaultsession asserted1/global1 and664bytes actuallylogged. No globaldisable/PURGE/RESET/expiry change or historical evidence deletion. Formal measured load must start in a newprocess/defaultpool, never reuse the builder wrapper. This is initialization evidence, not a formal latency PASS; receipt inherited normaldurability label refers onlyglobal settings, seed session0 is explicitly qualified by script and boundary evidence.

Initialization binlog delta:149994939bytes under prior normal seed →57235bytes under new session policy (99.961842percent lower). Only changed tracked server/client files afterward aredatasetModel/modeltest; actual runtime paths/config/schema/helpers unchanged, original pilot source/spec labels retained and no fake new-source rerun. Model tests:approved5m/25m/histogram boundary first RED against oldmodel, then5PASS/0FAIL/0SKIP.

## Capacity-only storage budget

Pilot source mix80percent external gives4mActive externaltargets and21mArchive targets. Active size reduction therefore does not proportionally reduce all historical headers/lineage. All key targets remain valid/unique; no orphan keys or PROCESSING fillers. Single dataset only, noDR copies or backupbudget.

- Projected used data/index pages431.67GiB (small-pilot estimate, not observed fullscale or strict minimum).
- With explicit25percentgrowth margin:source539.59GiB.
- One retained file copy13.24GiB; initializationlogallowance1GiB; measuredworkloadlogallowance32GiB; runtime/temp10GiB.
- Page-based budget595.83GiB; extent-based conservative1431.88GiB. Extents retain free pages and materially overestimate; neither value is a proven minimum.
- Observed free479.67GiB; untouched100GiBreserve leaves379.67GiB. Current recipe fails safe admission even under page-based estimate. No fullvolume seed/CI/fullP4PASS/merge yet.

32GiB is planning space, not an automatic binlog truncation policy. Retain all measured run logs and monitor disk against100GiBreserve; a budget overrun requires resource reconciliation, never silent evidence deletion. Old6.5TiB DR-inclusive recommendation andpreoptimization capacity-only1.8–2.52TiB estimates are superseded. Additional storage or a separately approved further data-scope/storage-layout decision would be required before fullwrites; do not silently reduce25mkeys.

Private evidence:capacity-optimized-local-budget-dec041-r1.json; p4-capacity-writer-pilot-native-r2 receipt/raw/JUnit; capacity-writer-pilot-r2 summary/allocation/logging-boundary; modelRED/GREEN logs anddec041-proposal-r1 review/history. Remaining originallatency/coverage/browser/CI/review Gates retained.

## Optional physical compaction rejected

Actualr3 returned1FAIL/0SKIP (not a performanceSLO/timeout failure), originalreceipt/raw retained. Onfirstcheckedfulfillment_allocations, MySQL OPTIMIZE rewrote3CHECK literal introducers from_utf8mb4 to_ascii andfailed unchangedexactSHOWCREATE assertion. Separateofflinecomparison found onlythese introducer differences for thatfirsttable; no conclusion aboutuntestedtables. Keep exactschema checks; optionalOPTIMIZE route notadopted, no finaldensity/orcompletepostreconcileclaim. Onlybaselineallocation exists; no r3estimate executed. Actualr2sessionpolicyPASS and localbudget NOADMISSION remain. No additionalperformance rerun or guard relaxation.


## DEC-042 superseding current-round scale and actual progress

Sam directly adopted1,000,000Active/5,000,000lines and a separate25,000,000-key index-only benchmark. The old21mhistorical graph and595.83GiB/1431.88GiB resource estimates above are historical, superseded; noDR is executed. Small realbusiness dedup/replay/rollback/Active+Archive routing remain separate required native checks, not replaced by dummy index targets. Original formal production planning requirements and all remaining Gate thresholds remain.

The isolated25m index benchmark actually passed4cases/0FAIL/0SKIP on3ef50098/source28e7a2d4, rawSHAfc4ccde81deb968456bdff3edb3e60d9dfa0343ac494227bfd251f592d884969. Original unique composite index plan isconst/estimated1row;120lookups percache phase gaveP95.40025ms/.082792ms. Initialcache uncontrolled, no coldclaim. Actual independent postexecution review passed; this is index-only capacity evidence, not25m businessorders.

The1k realwriter source pilot passed exact1000headers/5000lines/299oldeligible, quantity/money/Inventorymapping and bidirectionalrouting checks; native per1000ID+controlroot reconciliation is explicitly sampled. A realprecommit lineINSERT fault rolled back; controlled wholechunk checkpoint-loss replay retained the same business digest. All earlier setup failures remain. Independent admission review authorized only expansion, notSLOPASS.

Fresh planning budget after actualpilot allocation:64GiBsource+41.38GiBindex+32GiBlogs+32GiBtemp+8GiBfiles=177.38GiB, with a separate100GiBfree reserve. This is conservative pilot extrapolation, not fullsource measurement orautologdeletionauthority. Full1m/5m source initialization is running one writer/nice10/UV2/InnoDB2; builder-session binlog0 only, global1, freshdefaultlogged measurement pools required. Fullsource finalcounts/300keligibility/invariants, query/mixed/monthlycapacity, CI andwholephase Gate have not passed yet.

Actual receipts remain privately underphase4-private/index-capacity-r1 andsource-capacity-r1. A preserved script/independent-review manifest is atphase4-private/dec042-retained-code-and-reviews-r1/manifest.json. No credentials orfullrawdata are committed.
