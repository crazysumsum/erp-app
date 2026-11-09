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
| Fulfillment Phase-B owner, TL contract coordination | Historical November 6 gap: actual writer preclaim hash, Sales intent/hash and original attempt/executor outcome were absent. Current November 9: PR #348 / main `06caf911` delivers the normal atomic writer and those true captures; original PR CI `42554850522` and main CI `42557160760` passed. This closes that normal-path source gap, not the cross-process Recovery bootstrap/fence or public activation gates. |
| Fulfillment Recovery owner, TL; Inventory/Sales owners for the exact new proof delta | Current November 9 contract: see [Doc99 dated Recovery addendum](99_task036_joint_reversal_outcome_consumption.md). Fulfillment still owns durable Phase-A/Issue bootstrap, old-writer exclusion and the real TASK-036 Job caller; existing Inventory/Sales reversal readers are delivered but do not prove zero effects. TL must settle the narrow same-fence zero-effect owner contracts before consumed Recovery source. Eventual REVERSE uses its own same-instance owner pair and original fresh view+reverse actor; no standalone read-only helper, SHIP verifier expansion, new storage or revoked-actor exception is authorized. |
| PM / deployment maintainers (actual people still unconfirmed) | environment-specific versions, required provider membership, real instances and named maintainers; missing modules cannot imply `NO_PROVIDER_REQUIRED` |
| Customer owner / TL / PM | complete trusted required-provider composition, Customer root-lock recheck, cooperating writer serialization and deployment evidence; the preserved Fulfillment reader alone is not global readiness and this is not a prerequisite to the internal reversal source handoff |
| Fulfillment public API/UI owner | completed coordinator/Phase B/Recovery, strict Reverse endpoint and 200/202/lookup behavior, full permission/CAS/quantity/atomicity/replay checks and necessary browser validation; no public Reverse route is present in this candidate |

Next action: deliver this exact local source/document package and independent boundary review to TL/PM, then agree one final-main impact assessment and the minimal authorized functional verification plan. Resources remain free; no DB or test process was started for this work.

November 9 TASK-036 continuation: Sam's actual `call_1501354670804769a0f370fc4e9223f7` item 1 approval supersedes the preceding historical documentation-only restriction solely for a local consumed product candidate. [Doc99's current continuation](99_task036_joint_reversal_outcome_consumption.md) records the fixed event-admission ABI, genuine REVERSE-owned pair, unregistered private Job, durable command loader, same-fence three-party zero-effect consumption, exact takeover and fresh normal Phase B. First shared interface/caller commit is `b0c2c907`; Inventory and Sales owners supply their scoped increments and TL reviews the combined source. Missing native owner methods remain UNKNOWN; their integration, complete source review and all new runtime verification are still pending. No test source/execution, parser/lint/build/validator/import, DB/app/browser, CI, push, new storage/migration or activation is authorized. Existing runtime topology/writer/downstream membership remains unproven. This local increment is not TASK-036/P2 completion or READY_FOR_TESTING.

## November 9 continuation — normal Phase B and approved functional candidate

The November 6 observations above remain historical. Product commit `f4d0f2d3d07e3c1889933e33ce77c41198d60462` adds the internal normal Phase B coordinator and its locked-source/projection validation. It connects the genuine Inventory REVERSE preclaim/writer and same-instance Sales receipt application in one RC transaction, with the original operation fence, published lease boundary, full source checks, immutable history and atomic terminal result. It does not add public routes, activate a deployment registry, authorize automatic retry, or implement TASK-036 Recovery. The source received independent and technical-lead review; that is not runtime PASS.

Sam's actual PM-chat decision on November 9, turn `01a1be20-73ec-71c2-9bec-895317bc7b00`, user message `01a1be20-7444-7fb0-be98-e635f5e737f7`, call `call_fc8cb538f28f4de2bf7f702129daa20b`, was 「批准十組、准入發布及一次 CI（建議）」. It approves the frozen six source/permission/identity groups and four normal-Phase-B groups: atomic two-leg restoration, final-audit rollback, lost COMMIT acknowledgement reconciled from the original terminal, and rejection of an active Claim on a zero-shipped line. Exact proposal SHA256 values are `358d787dd1036902e0f5bbfae85f27e6d0efaa803286aeb7aaa34fba97446666`, `41e3f15136db1016d18a63699020d879979ac7f060990b6b75b44dd2b9651f1e`, and supplement `e1eb6ba0c4be8450414ce772e93e442303769f2f75294b49fa364d64a7b5c1a2`.

The fixed workload is ten literal registrations, nine isolated native schema lifecycles and one pure mapper group: in total 7 SO, 10 lines, 12 SKU, 10 Reservations, 13 Allocations, 15 Balances and 10 original Issue details. Twelve empty archive mirrors are installed in six related schemas. Tests remain serial, with unchanged fixture pool limits, transaction settings, safety checks, coverage floors and the 20-second maximum. No local native pre-run, old five-case rerun, capacity or performance batch is authorized by this continuation. Incremental CI duration and cost are unknown until the approved natural run.

Fixture clarification, coordinated with PM/TL: R01 and R05 genuinely call `startReversal`, whose Phase A already executes the downstream guard. They therefore require the explicit synthetic no-downstream registry, just as B01–B04 do. These six isolated fixtures opt in explicitly; R02 has no reversal start and retains the default unknown registry. This corrects a necessary input omitted from the old six-group narrative without changing its preserved original text, data, calls or scale. It is not an assertion about real Returns/invoicing membership or deployment readiness, and no product guard is replaced.

The test/helper and admission receipt remain subject to actual-byte independent review and trusted non-author registration/readback, preserving all live grants. After the fresh-main impact check, the authorized publication is the reviewed product/test/helper/receipt on `codex/fulfillment-task035-phaseb-20261109` in `crazysumsum/erp-app`, a Draft PR, and one normal admitted functional CI. Any actual admission/test failure must be reported with original evidence before another batch; there is no automatic rerun. Merge is a separate decision. TASK-034/035/036 and the full P2 gate remain pending their respective completion criteria; no new runtime PASS is recorded here.
