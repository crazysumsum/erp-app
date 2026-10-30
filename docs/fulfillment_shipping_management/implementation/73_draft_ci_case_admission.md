# CI-P2-DRAFT-001 — first15 functional regression cases (proposed)

Status: APPROVED A for exactly15 cases. Actual Sam currentchat reply:「A：批准這15個功能案例納入常規CI（建議）」。Approval applies to the proposal SHA df3e44f8ae07c4937da00c67647d7cd6be1bec6fa6e81ea7b7f1a5a00bd78759 and its listed4files/case scope; no new jobs/steps/capacity/UI/routing permission. No push/CI trigger yet. All15 were authored locally before receipt of the new project-wide policy and remain unpublished. No existing case has been deleted, skipped or weakened. Product implementation authority and HD025 A are retained, but do not substitute for this new CI-cost approval.

## Policy authority

Actual Sam message01a18b7c-372b-7ac1-ab3a-ebdb48fb436e in project manager chat01a0e71b-fccb-7c81-b9fe-ed817cc58e1f was directly verified with read_thread:
「任何agent要在CI上增加常規測試案例必須先向我解釋清楚得到我同意之後先可以加，不能亂加測試案例導至CI時間不斷加長。」
The PM clarification includes automatically collected test files/cases, new jobs/steps and increased loads/frequency; private minimal functional probes may continue, capacity/performance loads still need their own actual approval. Shared CI routing is being coordinated by PM; no routing change is proposed here.

## Concrete requested addition

| File | New cases | Purpose | Current local evidence |
|---|---:|---|---|
| server/test/fulfillment/shipmentWeight.test.js | 3 | Exact HD025 decimals, bounds/null pairing, reject rounding/coercion/unapproved units, canonical replay | PASS; with the next3 and3 existing canonical tests,9pass in0.1s or less |
| server/test/fulfillment/shipmentDraftCommand.test.js | 3 | Strict identity/version/logistics/Contact pairing and cancel command | PASS as above |
| server/test/integration/shipmentDraft.integration.test.js | 6 | Exact Draft/pointer/empty snapshots; same/different-event race; updateCAS/cancel/recreate; stale/inactive address; exact late-audit rollback; committed-success readfailure recovery/fresh403 | 6PASS/0FAIL/0SKIP;13.754s wall, each1.76–2.46s |
| server/test/integration/shipmentDraftApi.integration.test.js | 3 | Actual HTTP Draft lifecycle/replay; reject body coercion/unknown fields/address/permission; role revocation before cached/domain replay | 3PASS/0FAIL/0SKIP;6.818s wall, each1.84–2.38s |

Total:4 test files/15 new cases. Existing3 canonical cases are regression only and are not counted as additions. The extracted shipmentDraftFixture helper declares no tests and prevents duplicate registration when API cases import shared setup.

## Why existing coverage is insufficient

P0/P1 prove schema, operation journal and picking/provider semantics; they do not call the new Shipment Draft writer or new HTTP routes. They cannot detect a premature Shipment snapshot, broken active pointer after Cancel, decimal Number coercion, partial Shipment effects after audit failure, or a stale cached Draft response after role revocation. These15 cover that first delivery slice only; they do not establish TASK024/025 fullDoD or Confirm/Recovery/UI readiness.

## Data and frequency

Each native/HTTP case uses a new owned synthetic schema, one SO, one SKU, one Fulfillment Line, one Reservation and one Allocation:5 planned/3 picked/2 short. The concurrency case uses two connections only to verify unique/replay correctness. Pure cases exercise approximately tens of malformed scalar values and decimal min/max; they do not create large record sets or repeated latency samples. No100-line/5000-member workload, new load benchmark, browser job, new job/step, increased CI frequency or changed deadline is requested.

If admitted under current CI discovery, all4 files join the existing server test/coverage collection on its currently configured PR/main triggers, executed once across the existing4 serial shards. Coverage floors and all existing regression/capacity gates remain intact. This proposal does not authorize modifying shared routing or claim that unrelated PRs will skip the new functional cases.

## Cost and limits

Measured actual local functional execution is approximately20.6s for9 native/HTTP cases combined, plus less than0.1s for the pure collection. These are case-runtime observations, not product latency/P95/capacity evidence. Native service fixture uses its existing stricter2pool/10s; realHTTP app retains10pool/20s. MySQL is26.7 with original128MiBbuffer/100MiBredo, socketonly, no tuning.

Estimated added CI test work under coverage/hosted runner: approximately40–90s, not yet measured in CI and not guaranteed. Four shards run in parallel, so critical-path growth depends on placement; adding files can redistribute older slow cases as well. The observed postmerge main baseline was22m03s. Under similar placement/resources, an indicative whole-run change is0–90s, but reshuffling/runner variability can exceed this; do not promise a cap or advertise a measured CI improvement. Actual first candidate CI must report its full elapsed time and slowest shard.

Setup failures were retained: two native fixture missing-timestamp runs and three HTTP app-configuration runs. No capacity/performance limit failed, and no guard was disabled. Only successful clean-run timings above are used for cost estimation; failures are not relabeled PASS.

## Options

A (recommended): approve exactly these15 small functional/security/rollback cases for existing regular CI, with no new jobs/steps or capacity/UI samples. Any further P2 cases or expanded load require a separate concrete scope/cost approval under the same policy.

B: retain them as private local evidence and continue authorized engineering preparation; do not publish them into regular CI. The missing CI admission remains an explicit final delivery blocker rather than a waived gate.
