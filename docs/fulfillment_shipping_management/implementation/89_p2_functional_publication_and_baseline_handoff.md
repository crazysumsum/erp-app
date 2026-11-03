# P2 functional publication and baseline handoff

Status: local source and bounded developer evidence saved; final baseline/admission/PR-CI sequence requires PM/Sam disposition. No P2 push, PR, workflow dispatch, current-candidate CI, merge, formal Technical Acceptance or UAT is claimed.

## Observed source and completed developer work

The latest observed main `cb685ce30efa433fb7a85e668e37175b7cd19c05` was fetched, independently assessed and merged without conflict as `a5f07bc2dd07438f40b54882e2d41e5699145c85`. All19 incoming paths equal main's actual blobs; Fulfillment/Sales/Inventory/Item/DB/framework/Customer lookup/client product paths and owned fixtures were unchanged by integration. The incoming Purchasing0114–0116 migrations have no filename/number collision. Actual integration observation is private `p2-cb685-actual-integration-observation.json` SHA `41dc46800a768383bd62a337d8302f6f3c123bf133d4ca4c63fe4bae29b5cb3c`; incoming impact review SHA `f4cfa5f58cc62f3c7baf5c9cc23e9ddc1ac611fd72d668f677ce332f3fba387c`. Combined late-migration/P2 startup still requires the candidate's already-approved HTTP/CI work, not a new local batch.

The six reviewed functional publication files were committed locally as `898fbda54855ad0c8a640547bc2784b466394bc9`, source fingerprint `61290e7707f227108c6e33e2dcd34d4652297ea60f46d3497fefac56d61e25e8`. The actual DESIGN/PLAN remain `a2f36f116fbbba29643471dae3665e3c43ed7bd0dae23af32f277fea4c2fad9d` / `7882d19ae5c91ca9aba354e29b000150dde46fa61dcd3a9144455f032e41a7c3`. This publication commit changes no `server/src`, `client/src`, database migration or product configuration bytes. Direct `npm run lint` passed on the identical source fingerprint before commit; this is a real direct check, not a fabricated `run_check` PASS. Earlier formal preflight blocks and all old failures remain recorded.

The actual15 A and22 B approvals admit37 functional registrations in total. Three of the latter already existed (Inquiry2 and Client contract1); the publication adds19 registrations, preserving existing P1 browser exact2 and original DB regressions.

| Original75B family | Routine registration count and source |
| --- | --- |
| Lookup / PhaseA / Issue / HTTP |12 in `shipmentConfirmation.integration.test.js`; finite scenarios retain the original ceilings |
| Recovery |3 in `shipmentRecovery.integration.test.js`, with4/3/3 serial scenarios and complete fixture cleanup between them |
| Inquiry / document safety |2 existing registrations retained |
| Client contract / polling / safe recovery |1 existing plus2 new pure registrations; finite schedules, no command resubmission |
| Native Shipment browser |2 in `p2.spec.js`; one happy fixture and three serial recovery fixtures, one worker/retries0 |

The source transformation reviews are `20953a7b740af99128dea4fb2d0448d73426accbf6b91f905d7a10cbfe3c0720` (Confirmation12), `0228c87a7c1d2da984cfc66bed1c37a11fb9570faaa45c84ba9c6396648a2b37` (Recovery3) and `4b0dc0514d3ad9d5f3b2cbc08b0a2d091e9adb99e5be81d8a25ed2ceca72e2b5` (client/browser/current wiring). They retain513/381 server assertions respectively and the existing browser/pure assertions. The sibling Create15s ceiling and app-before-pool/schema cleanup were corrected before publication. No consolidated execution of these newly wired files is claimed.

[Implementation88](88_issue_owner_and_rollback_developer_checks.md) retains eight actual Node PASS groups/17 scenario results under their original1542 source identity. The final original Fresh Guard slot was then separately validated once: private `lookups/fresh-revoked-private-df99776c205c/result.json` SHA `dfcc3b1ae22f92bef39e5691df4c0853128066c04f12e933ddcf5c253d5467e7`,1 Node/1 scenario PASS,0 FAIL/SKIP/not-run/timeout/guard errors. Real DB revocation causes the sole **preparation RC** transaction to roll back before PhaseB; post0/all24 business facts unchanged/SHIPPING version2 pending. It is not a PhaseB rollback or a Recovery worker test. Actual execution HEAD was a5f with dirty publication fingerprint61290, byte-identical to committed898; raw provenance is not relabelled. Actual closure SHA `d44de473d2081bd611fb14fc7355e93da2a052980059e11e5ecfc2c03507d269`. Thus nine bounded Node groups/18 scenarios have component proofs; this is not37-case/current CI PASS.

Limited aggregate publication/provenance review SHA `800449402a59abcccbe2ef27f92aaa1aeb887ea0350849104623e08da55a84a4` is0 C/H/M. DEF029/030 and TASK027–033 remain open/in progress pending actual delivery gates.

## Main observation and runtime cleanup

Existing main CI [41575307745](https://github.com/crazysumsum/erp-app/actions/runs/41575307745) passed on cb685:13 successful functional jobs, two intended deferred-capacity jobs and the PR-only result callback skipped. Created-to-updated wall time was16m24s, including orchestration/queue; it is not pure billed runner time or P2 CI. Private observation SHA `3348680ecd960ed36ae8bf57161baac4c169c3c8b93328cc57177e807f74c8b7`.

All authorized focused native work is complete. The owned socket-only MySQL was normally shut down after rechecking exact UUID/datadir, networking disabled,0 external clients and only the owned base schema. Socket is absent; datadir and all evidence remain. Cleanup record `lookups/owned-runtime-shutdown-20261103.json` SHA `fefbe43ed616de3b52a29f2e073081e9891ad05d38c2ebfc86cc280bb3c8f590`. No schema was deleted and no other server was touched. Stopping this resource is not a user-requested pause of development.

## Concrete baseline proposal, not yet applied

Private proposal root: `/Users/sam/Documents/workspace/erp-app/.worktrees/fulfillment-p2-runtime/p2-final-baseline-proposal/`. Exact eight-file patch SHA `3652496cd79928418db080945380a6e648c7af9384db72198bbbe06439f4c305`; independent delta closure SHA `9a7f2029d0626b55f07808ab786d1539bc86266952b65ec940ed55c1afb671c9` is0 C/H/M. The earlier nine-file proposal's PHASE004 stage inconsistency and exact original patch9f3 are retained in private history; the fix keeps the profile byte-identical and does not alter P0/P1/P3 phase objects.

The proposal contains:

- Owner-reviewed HD026 addenda in Inventory03 and Sales03, two corresponding owner provided SHA-only updates and Fulfillment's consumed pins. Sales is placed after the actual current HD018 boundary in section2.4, not navigation section6.1. Original ordinary CLAIM/writer/Draft membership remains unchanged. The final single text SHA is `cb8859356ace94320325c6d0d0d3fcb5cece4029ea88c7d56dfd47fe506090ef`; original748 and finalcb885 exact texts are retained. Known prior Sales→Inventory and Customer→Sales consumed drift is explicitly not blindly repinned.
- An explicit P2 developer execution-location contract: local lint/build/security, full unchanged functional regression in the existing exact-candidate CI. Both global and PHASE003 required-suite unions are reconciled; no old local PASS is invented. Original166/230 functional lower bounds,0 unexpected skips, all cases/assertions and coverage floors remain obligations.
- A native JUnit reporter in the **same** existing server command, retaining spec stdout and the existing artifact upload. It adds no case, job, step, shard, worker, repetition or NFR. Current authentic spec-only logs lack file-bound identities: the inspected existing main shard has1006 PASS/84 SKIP, with helper/empty Capacity file PASS entries that cannot establish module counts. Four actual candidate JUnit reports and shard manifests are required before independently reconciling the P0/P1 functional case ledger; missing/ambiguous/insufficient evidence fails closed.

Proposed baselines, not actual approvals:

| Module | Proposed DESIGN | Proposed PLAN |
| --- | --- | --- |
| Fulfillment | `5f5568a32688332add8ec23710628a7fc0eb3b04961b505ab9124686ca8c14bb` | `8b916c8fce891dd28d1679569cfaf974740ad6a5bb56d4d7bf45523473afa931` |
| Inventory | `5c2604a489cba43027789d8909a57f99e1f4068bc502d5b47cfa31505aa0f3f0` | `fc29c4757399670098240eb7f6c066d757fd25e4ae84d43bd8d074baaba182b8` |
| Sales | `9294a1634126ebab18f81840b30eede7626e0ab135b6eb88e5d71c2b2084d465` | `c494e68576804d8daf0f8a62c05231bad9ec5b841f277ac39ef1877c8b7122ab` |

The old human approvals and actual source-bound results remain intact. The original15A/22B/77A/81A human records were independently verified from original user source lines; extract SHA `af2f1475a77a08f0be54f2d6e1d3a3f9024267bcbd8b771f4ccfb7e380f996c2` is provenance, not a new grant.

## Trusted admission composition and CI sequence

Current898 P2 admission draft correctly pins21 inputs, SHA `7314cccacb270aca0c780cdfc3f05c43d46cf3fb41c1b74ac91b7844a932d268`. Its62 labels include37 business registrations,21 unchanged legacy DB registrations, two browser-config labels and two fixture-family labels; they are not62 new cases. The initial16-input draft and its missing-five-pin finding remain preserved.

There is a real aggregate admission blocker: Inventory's existing72-pin atomic receipt includes its old ci.yml. That mismatch disables its other71 pins; merely repinning ci would conflict with the P2 receipt. Only the trusted administrator may verify and publish a valid composition. The private plan `ci-publication-draft/final-grant-composition-plan.json` SHA `8d781bf5e8c114080f7a0df5131212a992ac4509a961681f906d65886ec903cb` proposes one workflow owner,71 retained Inventory pins (69 unchanged plus two approved-proposal metadata updates) and24 future P2 pins. No overlaps or workload growth; independent review SHA `6e16cfb500268a07cb10821dedf749a82e1e024112a3f3d6c1dfb49a0b756cd7` is0 C/H/M **for the plan**. Current registry remains blocked until actual baseline adoption, final-tree recomputation and trusted publication. No feature-agent self-signing, variable modification, controller execution or dispatch was performed.

The authenticated PR CI controller requires an existing PR, fetches/verifies GitHub's actual base/head two-parent merge SHA, creates the admitted tag, and publishes its checked result back to the current PR head. The original instruction requires CI before creating the draft PR. PM has confirmed there is no authorized pre-PR substitute; the sequence must be decided explicitly by Sam. Do not dispatch around the controller or mistake green main for green P2. Preserve actual tested merge SHA/run/attempt and head callback provenance instead of pretending that remote merge-job results were a local run.

PM will consolidate the baseline/evidence-location/reporter disposition, administrator composition and PR-CI order. If approved, adopt only the exact reviewed content, refresh/assess latest main and final-tree pins, obtain trusted admission, then execute the approved functional sequence. Every current required check, authentic four-shard ledger/coverage, native P1/P2 exact2 and required review must pass before qualification. No P2 merge authority is inferred.

## Cost and deferred obligations

The existing approved estimates remain first15:40–90 seconds extra test work, remaining22:6–12 minutes; combined roughly7–14 additional runner-minutes, unmeasured for the consolidated candidate. A full candidate20–35-minute wall estimate is tentative because four-shard assignment and runner contention are unknown;16m24s is only the existing main observation. Any future post-merge main CI is a separate full run and is not authorized here. No new load was run to estimate cost.

All non-functional validation remains after the related UAT, on main only by accepted related-change baseline/revision/individual-case external grant. Preserve catalog identities/data/concurrency/samples/thresholds, the three still-unapproved new capacity scenarios and the original20-second production transaction limit. Formal TC012 and mixed NFR cases remain mandatory/APPLICABLE; no NOT_APPLICABLE, formal PASS or zero-skip fiction is substituted for postponement. A later formal deferred-stage/gate contract is still required before claiming Technical/UAT acceptance; it does not authorize NFR now or erase the current functional delivery work.
