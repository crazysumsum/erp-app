# HD-011 Sales real-provider joint checkpoint

Status: independently reviewed narrow Sales defect correction, approved canonical version clarification and exact P0 contribution delivered. Complete Fulfillment P0 / Checkpoint0B / Sales P4 qualification, current CI and main merge remain pending. No additional human answer is pending for HD-011.

## Actual failure, decision and correction

The first genuine joint run committed Inventory allocation (Reservation1→2), asserted Sales mapping last-sync remained1, then failed at Sales Shipment lock before Inventory Issue. The fixture did not synchronize mapping to conceal the failure. Original private RED-r1, source snapshot and independent classification351afa24… are preserved.

Sam actually selected HD-011 A in owner chat userMessage `01a15c33-caa1-7ac1-a2b7-d7c2eac3052e`, question `call_91c09b99cc944d41913efaee3ca1d4fe`; author and separate reviewer read the human message directly. Exact presented proposal SHA256 `b908c56a08ece0a68c483f8a5f96e49a24fe7becd452c3901759fa8d0b90c3b3` was verified before adoption. Later prefix reconstruction is labelled as reconstruction in the review, not an original saved snapshot. The decision explicitly permits deferred Sales version sync only for Allocation/Release/Reallocate with unchanged Reservation quantities/status and distinguishes Sales CLAIM last-sync from native Inventory current CAS.

The product delta is one Shipment comparison: reject current expectedVersion below Sales last-sync rather than require equality. CLAIM remains strict. Actual Inventory current CAS, private same-transaction receipt, source/event/hash/exact members, every quantity postcondition, original reserve identities,0078/0086 guards and Sales old-mapping CAS remain mandatory. A greater version never proves benign quantity drift.

Sales DES4.10 retains the original per-update refresh sentence and adds the named actual adoption and its narrow exception. The provided-contract pin and engineering wire are aligned. Derived Sales DESIGN `07325c789d3de583c5a7c85de549d243eec46fd0d29755e763798e51bc9caf04`, PLAN `6370daf21488bfd77472532abf89be2c3e66e0ecdbe8010ac7ed8408e21061b9` follow the actual approved delta and unchanged prior baseline; no claim is made that Sam personally inspected those composite hashes. Earlier approvals, source reviews and results are retained, not rewritten.

## Observed developer checks

Seven genuine Sales/Item/Inventory diagnostic native cases passed, zero failures/skips, after actual HD-011 adoption (`sales-owner-joint-native-green-r5.log`). They cover real allocation then Issue and Sales synchronization; a late Sales audit fault rolling back thirteen tables; future/stale Inventory CAS and altered native receipt refusal; actual Reverse plus original-result replay after later versions; changed native quantities refused after the real Issue post; repeated Reallocate/Release/Allocate (Inventory2→3→4→5, Sales last-sync1 unchanged) then Issue syncing mapping6; and strict Sales CLAIM1 alongside the actual Inventory-owned locked current projection2 with immutable counters/source facts. A below-last-sync command is verified to fail before Inventory posting.

These cases use actual production providers, not an Inventory verifier double. They execute a source-hash-pinned **private unqualified owner WIP snapshot**, with the later named InventoryLookup current-state API explicitly pinned. Installed dependencies remain the owner's existing node_modules link, not a hermetic or qualified new-main build. Nothing copies that unreviewed Inventory source into the P4 worktree or proves the full current P0 candidate. Original snapshot/RED and all later source manifests/logs remain retained.

Related Sales/existing-DB regression124 PASS/0FAIL/0SKIP; original Sales native suites21 PASS/0FAIL/0SKIP. Seven of those original21 are still explicitly Inventory verifier test-double components; do not confuse them with the new seven genuine cases. Scoped lint and changed-path boundary checks passed. The owned socket-only MySQL26.7 ran serially at nice10; all `_sf_` test schemas were confirmed cleaned.

Trace validation first detected the changed Sales pin and an existing Customer contract drift. The approved Sales provided pin is corrected. Trace remains **BLOCKED** solely on the pre-existing Customer document pin: expected0c70e3d5… versus actual7b56997a…, whose bytes equal prior Sales HEAD9ceb29ff. No unrelated Customer pin, timing waiver or qualification is silently adopted to make trace green. Full P4 fresh-main reconciliation must disposition it.

## Independent review and exact consumer delivery

Actual separate reviewer `/root/def016_runtime_recovery_review` approved the narrow source/canonical/diagnostic contribution, zero required findings. Proof `sales-owner-joint-r2-source-transplant-reviewer-proof.json`, SHA256 `f24b797d2db8a79df84bace7b01c410b021f711f48e59c306e48db9c20ad3943`, binds exact local files, new derived hashes, actual Sam adoption, source snapshots/raw logs and four consumer before/after files.

Delivered private `p0-sales-provider-version-joint-r4.patch`, SHA256 `7f81a437f5006c41487f7b25561f489841b92138669cec0d57c3fbe60a4e091f`; manifest SHA256 `07f9d6e33b5e86f630585679be62f054f1a01c2b12748a2a5fcdc4c69ae158d3`. It contains only SalesFulfillmentService, the new consumer `fulfillmentSalesInventoryJoint.integration.test.js` (same bytes as local Sales-owned `salesFulfillmentOwnerJoint.integration.test.js`), the minimal canonical Sales HD-011 block, and the matching consumer-specific provided pin/version. It excludes whole P4 design/manifest copying, Export behavior, owner Inventory/DB source, raw evidence and credentials.

The owner integrated newer main during review (manifest generation base dce29110…, review base9a3a6b16…). Reviewer verified all four before-byte identities stayed unchanged, the new test did not exist and actual read-only apply-check still exited0. Supplier/package-lock changes mean the prior diagnostic result cannot qualify the latest owner candidate; the owner must apply the named patch and rerun its actual current source/dependencies. Sales has not written the P0 worktree.

The genuine active Fulfillment Claims aggregate bound is defined by HD-011 but awaits the real TASK008/011 schema/consumer; a pure native Inventory current-state query is not that aggregate proof. Full owner source review/capacity/races/Checkpoint0B, complete P0 CI/review/merge, actual fresh-main P4 integration and removal of duplicate old0091–0093 installers, real Archive participant/coordinator, all original P4 checks/capacity/Playwright/current CI/whole-phase review/unchanged MERGE_READY still apply. No task or phase is marked complete by this scoped handoff.


## Subsequent actual adoption and owner re-execution report

Sales independently verified all four actual P0 after-file hashes against the delivered manifest at owner HEAD9a3a6b16. The owner reports the seven joint cases passing after the new main integration and npm ci, plus30 Inventory native/294 FILES and lint passing. At this observation those results were inline tool outputs, not separate raw log files; no raw-log SHA or Sales-independent rerun is invented. The owner will capture exact logs on its next reviewed-source rerun. This supersedes pending adoption, not full qualification.

A further owner review requires a reverse-only advisory preparation reader rather than the CLAIM current-state getter: reverse-only permission, consumed Reservations and historical inactive SKUs must remain supported. Exact reviewed ABI/return shape/source is still pending; Sales has planned the actual negative/race/late-version joint cases without adopting WIP into P4 or adding operation permission. Full source review/0B/active Claims aggregate/current CI/P4 Gates remain incomplete.


## Reverse-only effect-boundary regression

An eighth real-provider case now creates another fresh principal with only fulfillment.view and fulfillment.reverse in both actual role links and claims. After real Issue consumes the Reservation, the test marks Item and SKU inactive, then performs the original-reference native Reverse and Sales apply successfully, restoring the original Reservation. It adds no operation permission and uses no Inventory/Sales outcome double. Earlier seven case bytes and product source remain unchanged.

Private `sales-owner-joint-reverse-only-native-r1.log` records8PASS/0FAIL/0SKIP on the retained source-pinned diagnostic; SHA256 `89843212e63b2a83c6254fbbf4045047f99e1efb6a04182b83696ff9ac4af6f3`. This is not the unfinished advisory getter or latest owner candidate qualification. Separate R3 review approved only the append-only test and exact consumer transplant, zero required findings: proof SHA256 `01caf2bb4cdf0456387b18f36b3a38a8f33d0fd297e4c11fc03496ff1c7e77f9`.

Delivered single-file patch `p0-sales-reverse-only-joint-r5.patch`, SHA256 `6639b04de34641cd16fc239a3cf339af354261b889460b80a5320e3a8ef732db`, before seven-case test SHA dd2fd9e9…, after eight-case SHA f5cb0b7e…. Actual independent consumer read-only apply-check exited0; owner must apply and rerun current source. New advisory preparation, F2 neutral version advancement and stale-advisory race coverage remain pending exact reviewed owner source/return shape. No additional Gate or task is closed.
