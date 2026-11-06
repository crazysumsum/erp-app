# Internal reversal source delivery boundary — 2026-11-06

Status: local source integration and delivery specification only. TASK-034/035/036 are not marked complete; current-candidate functional regression, coverage, CI, UAT and public activation are not claimed. Today's PM/TL assignment permits source integration and this handoff, with no DB, test execution, five-case rerun, CI, push, PR or main merge. All safety checks and the 20-second transaction limit remain.

## Fixed candidate and scope

TL selected the complete internal dependency closure of `54e40d20606763f6eb50592c45b28617b68bc6f8`, rather than reverting to the earlier three-file TASK-034 slice or splitting related capabilities inside shared files. It contains TASK-034 Phase A, TASK-035 snapshot/mapper/original-started and private advisory preparation, plus the already reviewed TASK-036 owner outcome readers. Those readers have no genuine REVERSE issuer/caller; this is not an executable complete reversal or Recovery feature.

| Pin | Observed value |
| --- | --- |
| Preserved five-case candidate / tree | `54e40d20606763f6eb50592c45b28617b68bc6f8` / `64bd082ee07499888abe7adc85d18f541e040d6f` |
| Main actually fetched before integration | `d18a6951beedec6272d06509967b3f241fc108e4` |
| Local product merge / tree | `568a490828f026c86fcebc6a2c2e6f7baea26e31` / `7b7b9136e77351d149ce23b298411b195c2f75bf` |
| Merge parents | preserved `54e40d20` and fetched `d18a6951`; no conflict |
| Branch | `codex/fulfillment-internal-reversal-integration-20261106` |

The merge preserves incoming main changes, including Customer composition and Purchasing work. Its feature diff against exact `d18a6951` contains 11 product files and four historical documents, all byte-identical to their `54e40d20` versions. This document is a separate documentation increment; it does not change that product pin.

| Product path under `server/src/` | Internal capability |
| --- | --- |
| `modules/fulfillment/FulfillmentDownstreamMatterService.js` | explicit downstream readiness guard |
| `modules/fulfillment/FulfillmentOperationService.js` | reversal terminal replay lookup |
| `modules/fulfillment/ShipmentReversalService.js` | Phase A, private started identity, readonly preparation |
| `modules/fulfillment/shipmentReversalCommand.js` | strict command normalization |
| `modules/fulfillment/shipmentReversalMapping.js` | original Issue-to-owner mapping |
| `modules/fulfillment/shipmentReversalSnapshot.js` | original SHIP witness and snapshot |
| `modules/inventory/InventoryFulfillmentService.js` | advisory and original-event outcome readers |
| `modules/inventory/InventoryLookupService.js` | owner reader delegation |
| `modules/inventory/inventoryFulfillmentOutcome.js` | readonly REVERSE outcome validation |
| `modules/sales/SalesFulfillmentService.js` | source scope and original-event outcome readers |
| `services/fulfillment/ShipmentConfirmationRuntimeService.js` | private lazy readonly reversal wrapper |

Historical documents [97](97_task034_main_integration_boundary.md), [98](98_task035_original_issue_reversal_contract.md), [99](99_task036_joint_reversal_outcome_consumption.md) and [100](100_task034_minimal_functional_verification_proposal.md) retain their original observations. This document supplies the current delivery boundary; it does not rewrite their historical baseline or pending execution statements. No feature changes touch handlers/routes, migrations, test/fixture files, CI/admission files, client UI or framework. No production caller of `startReversal` is added. The private wrapper does not create a public route, new writer or REVERSE reconciliation session. Unknown deployment/provider state remains UNKNOWN, never implicit permission.

PM subsequently reported main `97cb27f184b35862a17c37de90589d0ee6b07f3a` from Inventory PR #345. The fixed `568a4908` integration does **not** contain that merge. Finish this handoff first, then coordinate one latest-main impact assessment and final publication candidate with TL; do not repeatedly rerun/review on every main movement. No final publication grant is inferred.

## Evidence reuse and limits

The actual November 5 run passed F01–F05 once on `54e40d20`: five small datasets, seven Phase-A starts, and one owned-child crash after committed DB ACK but before application return. Independent result review was 0 C/H/M. It covers revoked permission, stale version, specified archive-mirror presence, the early already-reversed guard, and that exact post-commit crash/replay boundary. It does not prove complete Phase B, a completed reversed aggregate, precommit crash, unknown commit, or all archive variants. The one-shot grant is consumed; no rerun is proposed.

Private immutable evidence root: `/Users/sam/Documents/workspace/erp-app/.worktrees/fulfillment-p2-runtime/task034-five-functional-once-20261104/`.

| Original artifact | SHA256 |
| --- | --- |
| `run-once.json` | `8fd345d9c0c855277749d256257621227d9a8463468bf1c48ca8efe59535523d` |
| `five-evidence.json` | `3fc3e6843e833575070c67f8198b402bc93517e366c368e2b41c709f7209aaf7` |
| `five.xml` | `a65a2aae7d3750f29890b031b0399a441cd545a2d03737cb4bcf63952e36fb84` |
| `final-result-review-20261105.json` | `d24fa1c48531b31e632f613a0a42c5d41ec084bd7805a0dd17dc8454e54351b3` |

Source comparison preserves all 15 feature paths and finds no change in the historical selection of 315 dependency paths between `54e40d20` and `568a4908`. This selection is not a complete runtime dependency proof: inherited main adds Customer/application composition and other modules. The old runners did not start the real application runtime. Therefore the original results remain original-candidate PASS, not fresh integrated-candidate or application CI PASS. Earlier source reviews and historical documents 93/94/96 remain reusable provenance, with their failures and original run identities preserved.

Reproducible private comparison indexes live at `/Users/sam/Documents/workspace/erp-app/.worktrees/fulfillment-p2-runtime/20261106-delivery-scope/source-integration-pins.json` and `dependency-reuse-bridge.json`. They record full per-file hashes and exact Git pins; they are source observations, not execution receipts or authenticated approvals.

## Remaining delivery checks — not executed today

This is a checklist of existing functional regression and policy gates for the final candidate, not authorization to execute, add tests, change workloads or consume an old one-shot grant. PM/TL must settle the final scope, baseline and permitted execution window first. Keep the existing controller, mandatory review, native evidence and coverage rules; preserve the capacity catalog exclusions in mixed files. Do not run an unfiltered test glob or `verify` command that can include deferred capacity cases.

| Existing check / source | Purpose and evidence limitation |
| --- | --- |
| Root lint, client build, dependency audit at existing high-severity threshold | final integrated static/application compatibility; historical passes do not qualify a new candidate |
| `server/test/integration/fulfillmentOperationMigrations.integration.test.js` | original claim/replay/hash/actor/lease/sequence/journal atomicity; not direct coverage of every new reversal terminal branch |
| `server/test/integration/shipmentConfirmation.integration.test.js` | existing 12 finite functional families: lookup, intent, terminal witness, start rollback, atomic Issue/rollback, owner proof, fresh guards and HTTP outcome/visibility; retain all original assertions and functional deadlines |
| `server/test/integration/shipmentRecovery.integration.test.js` | existing three lease/outcome/revoked-failure families; SHIP recovery regression, not proof of a genuine REVERSE issuer |
| `server/test/integration/shipmentInquiry.integration.test.js` | existing query/document and safety regression |
| `server/test/fulfillment/inventoryBatchReceipts.test.js`, `inventoryBatchValidation.test.js`; integration `fulfillmentInventoryReceipts.integration.test.js`, `fulfillmentInventoryStock.integration.test.js` | original Issue/Reverse normalization, receipt replay, wrong-transaction/source/permission rejection, rollback, competition and advisory validation; use existing catalog to exclude capacity, keeping functional cases in mixed files |
| `server/test/salesFulfillmentService.test.js`, `salesFulfillmentQuantities.test.js`; integration `salesFulfillmentService.integration.test.js`, `salesFulfillmentTransactionComponent.integration.test.js`, `fulfillmentSalesInventoryJoint.integration.test.js` | owner quantity/source/CAS/idempotency regression; the transaction-component verifier double is not genuine joint-owner Recovery proof |
| Existing service-container/application-composition and mandatory client/browser jobs | preserve normal application/SHIP behavior after lazy runtime addition and inherited main composition; no new public Reverse browser flow is claimed |
| Existing server coverage collection/merge and file ledger | global lines 92%, branches 83%, functions 90%, plus all existing per-file floors (including OperationService 95/90/90); no exclusion/suppression/floor reduction to make new code pass |
| Current-candidate mandatory functional CI and actual independent review | authentic current-head results required before any later merge; no new job, step, dispatch, admission receipt or self-approval today |

Dynamic coverage of new original-SHIP witness/mapper, private started/preparation/runtime identity and REVERSE owner-outcome branches is not established by the five cases or old generic regression alone. This is an explicit verification gap, not an observed defect or permission to activate them. TL/PM must decide the smallest necessary functional verification for the agreed source-delivery DoD; any new routine case requires Sam's exact admission under `AGENTS.md`. No case is added or old grant extended in this document. Full TASK-034/035/036 and Phase completion remain pending the relevant implementation and gates; inherited state/traceability is not replaced by old branch state or marked DONE.

All performance/capacity work remains deferred until relevant UAT, with its existing catalog workload/thresholds and module owner; later main-only dispatch requires the separate verified related-change baseline and external case grant. No 5,000-member workload or duration claim is made today.

## Public activation dependencies — separate from this source handoff

These gate safe public use and later complete Phase B/Recovery. They are not all prerequisites to reviewing and handing off the fixed internal source candidate. Design `6cc959d1` in the downstream contract is design provenance, not runtime adoption.

| Owner / coordinator | Missing deliverable before relevant activation |
| --- | --- |
| TL leading Returns owner coordination | real same-transaction `getShipmentReversalStatusInTransaction` provider covering the complete S1/original-Issue set, received/allocated/unsettled effects and archived sources; any received unit blocks the entire Reverse; all relevant writer entrances share the root/S1 serialization locks |
| TL / AR-Invoicing owner | true source claims, invoices, credit notes and unknown financial-event provider, including merged-invoice attribution and effective credit netting; payment is not credit proof; shared writer/archive lock discipline |
| Fulfillment Phase-B owner, TL contract coordination | actual writer preclaim request hash, Sales normalized intent hash, original attempt/executor outcome, lease and fence captured by the genuine attempt; no capability minted from advisory data or a pending row |
| Fulfillment Recovery owner | genuine REVERSE-purpose issuer/session/fence, same-transaction owner proofs and cross-hash/local-terminal checks; current owner readers expose SUCCEEDED/UNKNOWN, not ABSENT; current SHIP verifier cannot authorize REVERSE or safe retry |
| PM / deployment maintainers (actual people still unconfirmed) | environment-specific versions, required provider membership, real instances and named maintainers; missing modules cannot imply `NO_PROVIDER_REQUIRED` |
| Customer owner / TL / PM | complete trusted required-provider composition, Customer root-lock recheck, cooperating writer serialization and deployment evidence; the preserved Fulfillment reader alone is not global readiness and this is not a prerequisite to the internal reversal source handoff |
| Fulfillment public API/UI owner | completed coordinator/Phase B/Recovery, strict Reverse endpoint and 200/202/lookup behavior, full permission/CAS/quantity/atomicity/replay checks and necessary browser validation; no public Reverse route is present in this candidate |

Next action: deliver this exact local source/document package and independent boundary review to TL/PM, then agree one final-main impact assessment and the minimal authorized functional verification plan. Resources remain free; no DB or test process was started for this work.
