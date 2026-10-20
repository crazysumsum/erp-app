# PR250 merged-main integration and Customer PR244 requalification

## Authority and observed baseline

Sam explicitly requests PR250 merge verification, then Customer integration/all
gates/normal PR244 merge; no scope expansion, scheduler stays paused, complete
downstream acceptance stays BLOCKED. GitHub actually reports PR250 MERGED at
2026-10-20T06:03:39Z, merge220d376c6e9c21f9149b7a2a3f01e0752fbfa76d,
head195fc2a0da2c2753ca9d051d4753d2d3f613dcf2 with13successful normal CI checks.
Fetched main64bee2e0 was safely integrated into restored Customer79c2c9aa at
e7bbe6b714bb7c0abc1c5cabd4ecee372310581f, source fingerprint
48c132eecf07a4a3621c70e06161985c3f31d913987bc3fe6b10da8ca5ea3972.
No Customer canonical spec/manifest/profile/ledger changes: approved
DESIGN13a77ed225d0253eaac097b5e3bb13f60c6078d1019500b95e976dd6617af721,
PLANb390c588a323b3c3677bb031f287cebefe2cb284571e901d56aa3f14814f44db.
Old temporary checkout/raw logs were removed by the host; published commits,
minimized results/digests and PRtimeline remain, not reconstructed raw evidence.
The restored checkout is dedicated; unrelated worktrees/data are untouched.

## Defined before execution — developer checks, not formal acceptance

| Case | Risk / preconditions | Execution / expected result | Initial status |
| --- | --- | --- | --- |
| INT-244-LOCK / P0 | Fresh own MySQL13369/schema/ephemeral fixture admin and keys; no shared3306 | Existing Customer catalog SELECT-only/current/shared-lock test; operational default/non-nullCurrency bank/credit/approval; real mutable Customer/Sales batch tests; merged Sales100line barrier and original caller regressions. All assertions pass, no required skip. | NOT RUN |
| INT-244-LOAD / P1 | Same frozen source, serial own load with unchanged pool/workers; no other own CPU-heavy jobs | Replay historical TC042 file from62706bed^ preserving10korders/50klines/50users/30min/3000ms/50MiB memory assertions; only resolve original static imports and import.meta.url base into current repo. Both cases pass0skip, all failures counted, scheduler/reconciliation clean. | NOT RUN |
| INT-244-SERVER / P1 | Existing CI-equivalent DB flags on owned instance | Existing full local server coverage, unchanged92/83/90global and38file floors; preserve existing conditional skips, no new skip policy. Capacity transfers separately executed, not inferredPASS. | NOT RUN |
| INT-244-CLIENT / P1 | Locked deps and isolated app/browser fixture ports | Existing client coverage/build/lint/security; actual Customer Playwright technical suite and mandatory CI browser checks, no required failures/skips. Fixture boundaries explicit. | NOT RUN |

Upstream62706bed changed the CI business profile to2000orders/10users/10MiB.
Its smaller scenarios are not a substitute for the prior Customer10k/50 requirement.
No upstream/product/test/CI edit here: a private historical-test replay adds the
unchanged original workload using current integrated products. Record original and
relocated script digests and mapping. CI on the final published head remains
mandatory and independent from these developer checks.

New owned runtime `/private/tmp/customer-pr244-integrated.KPWDDe`, loopback13369,
schema `erp_customer_pr244_integrated`, MySQL26.7.0/Node26.6.0/256MiB buffer pool.
Synthetic-only account/data/files/keys, matching startup keyrings in memory; do not
export credentials, plaintext bank/file data or key values. Historical failures
remain; no defect closure or successful final gates/cleanup claimed in advance.
HD013/015 waivers stay human waivers, not technical proof. Full downstream
030/031/032 and wholemodule/UAT/operations/release acceptance stay BLOCKED.

## Preliminary actual developer results / publication checkpoint

Real MySQL focused suite83PASS0FAIL0SKIP (46083.595625ms), including Customer
SELECT-only catalog, defaults/non-nullCurrency bank/credit/deterministic approval,
Sales contract and merged100line/singleline/caller lock regressions. Contract units
26PASS0FAIL0SKIP. Client112files/905tests PASS with unchanged coverage floors;
Customer technical Playwright20PASS0FAIL0SKIP (28s), lint/build PASS. Browser suite
uses its existing API fixtures, not a full deployed downstream acceptance. Existing
Quasar LOW advisory GHSA-89vp-x45c-52cq remains; audit's high-severity gate passes.
No dependency, floor, skip policy, production control or source/test change here.

Historical TC042 replay source SHA256
effe7785d11747388b141276df7c21263ffd6738d0542b5c879d2b0e9e3ea5dd;
relocated script SHA256
f2e4bf3a930b914ca56c437ee2fbafcd5c710cd1ae972b3682762f53cc285863.
An independent exact-string assertion reconstructs only the relative static-import
and import.meta.url-base transformations and matches the entire executed script.
No data volume, deadline, assertion, workload or cleanup change. It uses the
current merged product modules, not historical product code. Original load is now
running alone; full server coverage and final exact-head CI/review still pending.
Original failures remain; targeted PASS does not yet close HIGH DEF033001.

This checkpoint may be published as Draft so normal exact-candidate CI proceeds
while final local serial checks run; it is NOT merge readiness. Actual terminal
results/review/CI/fresh-main/merge/cleanup receipts attach to PR244 timeline against
the immutable published head, rather than endless metadata-only candidate changes.
No successful pending gate or cleanup is recorded before it actually occurs.

## Terminal local results and necessary authorization bookkeeping

On unchanged executable fingerprint48c132ee, original TC042 replay completed
2PASS/0FAIL/0SKIP in841393.11375ms. Import10k/50k finished808208.515ms<30min;
4045foreground samples(3645single/400hundred), p95=90.535542ms<=3000ms,
excludedFailures0/warmups0. Scheduler405/27/2runs all failure/timeout0;
all six reconciliation mismatches0. Existing isolated50MiB memory assertions PASS.
Raw original-tc042.log SHA256
fd2bc4f5010a3e8dc9229d431f5e4a14bb7dba6bdd9a231aaac02241fa68867e.

Full server coverage3478tests/3340PASS/0FAIL/0cancel/138existingconditionalSKIP,
571362.429208ms; lines94.12/branches86.58/functions93.51 and38file floors PASS.
Conditional Inventory/Customer opt-in cases are not asserted PASS or a generic
zero-skip formal acceptance. Five capacity transfers are not inferred PASS:
separate SalesCapacity2PASS/0SKIP8232.879916ms; precheck50MiB/100000rows
3PASS/0SKIP12278.8395ms,1000/10000-order ingestion4874/5377ms<=30000ms.
Full coverage SHA25647a33eb0c3a9c6f10aa9dfb261be8e58b3915e2d34b68e04630161ebe1f7917d;
SalesCapacity SHA2562d8738d236979ee7a5a66185d8ba0bae1220995276793c3431e52e5709969601;
precheck SHA2562490dfb7c960c535e6703a373791dbbc71996b68002579c530ca6022ad0d5a00.
All raw logs are retained in the owned runtime root above.

OPEN runtime observation: original replay emitted Node
`MaxListenersExceededWarning: 11 close listeners added to [ServerResponse]`.
Similar warnings appear in existing non-Customer full-suite cases. No stack trace
or demonstrated leak/Customer attribution; actual HTTP samples complete without
request errors. No suppression or listener-limit change. Independent reviewer
`/root/customer_task011_review` verified the raw metrics and requires this disclosure;
TC042 correctness/performance PASS_WITH_OBSERVATION, not warning-free. Any future
minimal trace-warnings reproduction/shared-framework fix is outside this scope.

Exact e26841c CI39389732794 completed all13normaljobs SUCCESS. Final structural
check exposed an omitted SCOPE entry for the unchanged historical Sales defect
report. State227 APPROVAL-SCOPE052 records Sam's actual prior explicit request
to register DEF033001 with reproduction/deadlock/PR244 evidence and notify Sales;
original actual receipt6209331081 remains. This is not new human approval, a
baseline change or permission to repair Sales. Boundary must be rerun after the
record is added. This necessary metadata correction creates a new candidate:
old-head CI is historical, new exact-head normal CI/final independent review and
fresh-main reconciliation remain required. No executable change or repeated
heavy local suite is claimed. Final merge/cleanup receipts remain on PR timeline;
full downstream acceptance BLOCKED, scheduler PAUSED and existing waivers unchanged.
