# HD-015 — P0 developer verification contract alignment (proposal)

## Current blocker and baseline

No adoption yet. Separate reviewer `/root/fulfillment_independent_review` identified one MEDIUM verification-contract blocker after confirming product-source approval remains valid: `fulfillment-technical` runs all `server/test`, has `max_skipped:0`, requires formal TC-001–012, and is required both globally and by PHASE-001 as DEVELOPER. It also remains the full TECHNICAL/REGRESSION suite. Those technical cases include later P1–P3 capabilities; IMPLEMENT/P0 does not execute their full formal acceptance.

The inherited actual CI profile intentionally leaves133 upstream opt-ins off:128 Inventory native suites with distinct owned instance/schema/socket contracts,2 Customer performance,1 Customer restore,1 Item performance and1 Inventory performance. None is a Fulfillment P0 skip. Original thresholds, tests, flags and formal TC requirements cannot be silently changed to make this gate pass.

Current approved product source: HEADf485ef84 plus reviewed fixture deltas, FP41f5f069491169a2576d97fbaa12cca223bed2336c56981fe8c9cdc80a2be2bc; DESIGNeed2eb831ce50d0717992bcc25f04318dd652b16b7f662b3b5f81f9797b5a545 / PLAN70dfa301e8e605ebd879ac8b368e2e7889732d2af22b12d59a42948fecc949dd. R5remainsFAIL (old interrupted Backorder fixture); fresh97-registry-row core with zero Sales/Backorder/Fulfillment rows is running the unchanged complete coverage command. No PR/Gate PASS is claimed.

## A — recommended exact P0-only change

Reviewable unapplied patch: `/private/tmp/fulfillment-p0-hd015-candidate.patch`, SHA256 `cdcfecfa6e84dbb779bcea1d6bb3d7e62176907a1f60a5d84f219e9a99434bce`. It changes only the three module JSON authorities; narrative adoption, generated matrix, approval/state bindings follow only after actual human approval.

1. Preserve the original `fulfillment-technical` object byte-for-semantic-byte: same argv, zero-skip bar, min/count/TC-001–012, DEVELOPER/TECHNICAL/REGRESSION stages. All technical test suite IDs, applicability/mandatory/blocking flags, NFR-023 exact N/A reason and formal-suite TECHNICAL/REGRESSION requirements remain unchanged. P1–P3 phase developer lists still require this existing suite; no future-phase exemption is introduced.
2. Add `fulfillment-p0-developer`, DEVELOPER only, JUnit, at least166 tests and zero skips. Actual Node26 glob discovery (FILES only, not native acceptance) finds166 plain tests:40unitPASS+126nativeSKIP; this is a lower-bound inventory, not a native PASS. On the owned enabled native profile every discovered test must actually pass with zero skips, including nested cases. Exact argv selects all existing `server/test/fulfillment/*.test.js`, `integration/fulfillment*.integration.test.js`, `integration/shipment*.integration.test.js` and `integration/salesFulfillment*.integration.test.js`, serially, with the existing testEnv import. No name-pattern filtering, test deletion, fake receipt or new product code.
3. Add `fulfillment-p0-browser`, DEVELOPER only, current real Playwright config, JUnit/min2/zero skips; owned full schema/API/client ports, trueHD014HTTP/MySQL withdrawal409→clearintent→refresh→Cancel, existing foundation proof. Required before P0 PR; never business UAT.
4. Replace only the global DEVELOPER requirement for `fulfillment-technical` with `fulfillment-p0-developer`; PHASE-001 uses that strict P0 suite plus the browser suite. Existing lint/build/audit requirements stay. PHASE-002–004 retain their existing explicit `fulfillment-technical` requirements and therefore do not lose their original bar.
5. Retain every canonical P0 full-command Gate: complete server FILES/native CI-profile tests and original92L/83B/90F+all39file floors (Operation95/90/90), client tests/coverage/build, lint, audit, fresh/upgrade/partial/rerun migrations, real concurrency/rollback/recovery/capacity, separate review and actual candidate CI. The133 inherited upstream opt-ins must be reported as not executed; any Fulfillment P0 skip blocks. Full mandatory CI remains unchanged. Original R5FAIL and original profile history are retained.

New suite execution requires actual current PLAN/source/HEAD and environment binding after adoption. Existing unchanged full-command raw runs retain their original observed baselines; they are not relabelled as a newly executed formal suite. Current-candidate CI reruns the complete repository gates after publication. No source/threshold/permission/business/API/live cutover change is included.

## B — broader replanning

Keep the current binding and hold the P0 PR while independently redesigning every Phase's developer/formal verification mapping and its required upstream isolated environments. This provides a broader review but delays the approved P0 delivery and expands the planning scope. It does not allow skips, fabricated TC IDs or a zero-test formal PASS.

## Decision and review status

Recommendation/default absent other constraints is A, but actual human approval is required before any profile/manifest/ledger binding changes. The Harness instruction is “Major impact means ask a human before choosing”; this concerns a verification gate and its stage/Phase applicability, not renewed authorization for product implementation, HD012–014, local native testing or PR creation. Independent proposal review R2 passed after fixing one duplicate browser env-key schema finding; the rejected R1 candidate is retained as historical review, not applied. Continue unaffected current native/client checks meanwhile.


## Actual independent proposal review

R1 actualCHANGES_REQUESTED0C/0H/1M: duplicate browser port env-key entries made candidate schema invalid; oldpatchba23/proposale9e96 reviewed, not applied. R2 separate reviewer `/root/fulfillment_independent_review` actually **APPROVED FOR HUMAN DECISION,0C/H/M**, closing this finding; exactreviewedproposalSHAf92ad3af9e8abd59603b3337e7b6181bd91879976f2410ca992ce7c1f0bfc424 /patchSHAcdcfecfa6e84dbb779bcea1d6bb3d7e62176907a1f60a5d84f219e9a99434bce. ThreecandidateJSONschemaPASS, originalformal object identical, P0glob/JUnit166inventory andbrowserreport/envbindingsverified. This is proposalreviewonly, no humanadoption/source/native/Gateapproval. AwaitactualSamchoice.


## Recovery metadata typing (does not adopt A or clear HD015)

Read-onlyPLAN_READYpreflight also detected five narrativeMarkdown paths placed in the typed evidence_files ledger and a source-review fingerprint indexed where the genericgate expects compositeDESIGN. All original Markdown paths and existing reviews/human-answer/external-action references are retained. Pre-repair hashes were recorded; reports17–20 remain unchanged by the typing repair, while this report21 separately records the repair narrative (report17 subsequently appends actual new test results). Proposed recovery is to classify only actualtypedrun.json records in evidence_files and additionally index the same actualR37 source verdict (which explicitly qualified currentDESIGNeed2eb83 andFP41f5) by compositeDESIGN, retaining its originalFP-qualifiedrecord. The standard checkpoint first refused removal of any old pointer; no mutation occurred on that attempt. Actual independent reviewer then confirmed all five entries were narratives, with no genuine run records to remove, and approved a narrow reversible provenance repair under existing P0 authority. Revision64 exact bytes were backed up at `/private/tmp/fulfillment-p0-state64-before-provenance-repair.json`, SHA256 `134796b292f66f5a67cafb520f97a3c9711cec97dce585495f48c95e5366fc8f`; each narrative SHA is recorded in `/private/tmp/fulfillment-p0-state65-provenance-repair.json`. A one-time same-exclusive-lock, old-revision+full-byte CAS advanced only to revision65, removed the five misclassified pointers, retained every narrative and its other references, appended LOCAL_STATE_REPAIR and the same actual REV-037 DESIGN index. No generic Harness code changed. State schema/validation passed; PLAN_READY now has only HUMAN_DECISION_REQUIRED for HD015 and remains BLOCKED. No testresults are synthesized. This is provenance-shape reconciliation, not a newindependentreview or human approval. HD015remainsOPEN/BLOCKED, and noP0Gate/profilebindings are adopted. ActualnewP0suite execution/typedresultrecords are stillrequired afteranyactualA.


Actual separate reviewer rechecked state65 diff and old-byte snapshot: only revision/evidence_files/+1 review/+1 external_action changed, prior arrays retained as exact prefixes, HD015 OPEN with null answer_ref. Independent state/trace/boundary passed and PLAN_READY has only HUMAN_DECISION_REQUIRED. Reviewer verified receipt and resulting state, not independent observation of the write-time lock/CAS sequence. No new approval, test execution or gate exemption.


## Actual adoption

On 2026-10-22 (Asia/Hong_Kong), Sam directly approved:「批准 HD-015 方案 A，繼續完成 fulfillment P0；待所有 TASK、獨立覆核、完整驗證及當前候選 CI 通過後建立 draft PR。」The exact independently reviewed patch SHA256 cdcfecfa6e84dbb779bcea1d6bb3d7e62176907a1f60a5d84f219e9a99434bce was applied to the three authorities. Only NFR-023 approval reference is additionally rebound; its exact reason and TC010 mandatory/blocking flags remain unchanged. Earlier pending/proposal/recovery sections above describe historical observations, not current approval state.

New baseline bindings APR069–072 record this actual human approval and retain all historical records. Original full formal suite object and P1–P3 bindings remain unchanged; strict P0 native166+/zeroSKIP and browser2/zeroSKIP require fresh actual typed execution. Local full-regression results on source41f5 remain historical, not current-candidate CI. Newly fetched main81a873fc has13 Supplier/DataTable paths; integrate cleanly and reverify the actual candidate before publication. No live activation, formal UAT or merge is authorized here.


## Actual post-adoption independent review

Separate reviewer `/root/fulfillment_independent_review` actually APPROVED0C/H/M at HEADce4a2c438a1baa6fc5a14d63eab05ec763ad67ef, main81a873fc941d54c634772c46641db95b552bf298, FPf9de149c2841b0d40b56e36a9135c27a5786d5db0542f4593a708022a85b247f, DESIGNeed2eb831ce50d0717992bcc25f04318dd652b16b7f662b3b5f81f9797b5a545 / PLANf3b9dacf3b513916e6f7f349e15c0fcc035be2bc2995761624e7adb7b6238b05. Verified exact patch+onlyNFRapprovalref, identical original suites/P1–P3/TC010/NFRreason, original31reviewedfilehashes and85historicalmigrations unchanged, no static Supplier/DataTable integration blocker. State/trace/boundary/diff passed; this reviewer round did not execute DB/browser and does not approve P0-GATE/formal acceptance. Root fresh typed/native/browser/fullregression/currentCI remain required.
