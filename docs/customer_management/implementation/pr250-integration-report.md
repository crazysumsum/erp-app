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
