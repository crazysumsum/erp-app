# TASK-014 — Draft update and inquiry developer increment

Implementation follows actual Sam HD017 A and existing P1/HD016 authority. Source review and focused developer verification are complete; TASK014 remains IN_PROGRESS pending exact-source Sales owner review and canonical contract handoff. This is not whole P1, CI, formal acceptance, UAT or PR readiness.

## Delivered behavior

DRAFT update accepts a complete replacement of 1–100 positive SO lines. Strict CLAIM-only PENDING_UPDATE locks and proves the union of old/new Sales sources, existing Claims, current Inventory counters and versions. Only this document's existing active Claims are excluded from competing capacity. Removed lines remain in source reconciliation. Header CAS and all new Lines/Claims are atomic; durable original outcomes and immutable History/Audit are preserved. No stock quantity changes occur. Per-line50/global5000 selected-member limits and original20sec transaction limit remain unchanged.

A read-only Inventory owner fact checks actual Allocation history after Warehouse/Reservation locks, including allocations missing a Fulfillment projection. Any own historical effect refuses replacement; another Fulfillment's legitimate allocation on a shared Reservation does not. Missing owner schema fails closed. This necessary proof does not add writer authority or change isolation.

Detail/list expose bounded, explicit public DTOs, coherent fresh snapshots, backend permissions and strict parent binding. List supports the five approved sort fields, both directions and bound seek cursors, exact indexed document-number/SO resolution, filters and actor-bound My Recent. HTTP Create/Update recheck fresh permission before framework idempotency cache replay; revocation cannot return a cached success.

## Actual verification

Root native11-file lane: 86 PASS/0FAIL/0SKIP, 87.656sec, /private/tmp/fulfillment-p1-task014-full-native.log. Runtime source fingerprint e02e82e0002c1464341576334ce43ff6f90d318ff57b5052222111a9e4ad3289; fresh owned UUID schemas, no existing database reset. Includes Create14, Update12, PendingUpdate3, Inquiry3, PendingCreate7, Queue11, QueueCapacity1, DraftCapacity1 and P0/Sales native34.

Root units92 PASS/0FAIL/0SKIP: /private/tmp/fulfillment-p1-task014-final-unit.log. ESLint successful: /private/tmp/fulfillment-p1-task014-final-lint.log. Behavioral RED evidence retained in /private/tmp/fulfillment-p1-hd017-provider-red.log, fulfillment-p1-hd017-capacity-red.log, fulfillment-p1-update-native-red.log, fulfillment-p1-create-cache-permission-red.log, fulfillment-p1-update-owner-proof-red.log, fulfillment-p1-list-sort-red.log and fulfillment-p1-inquiry-native-red.log; subsequent qualified GREEN runs and final86 verify corrections. Fixture setup/assertion formatting failures are diagnostics, not product-behavior RED.

Actual 100 SKU lines ×50 real Reservations each exercise Create/Update with5000 real Claims and late final-batch rollback restoring original IDs, Header, operation and audit. One local sample Create574.45ms/Update451.29ms is diagnostic only, not P95/global NFR proof. Original20sec bound retained. Queue original20-sample/2000ms gate retained. EXPLAIN number lookup const/unique/1row; small4-row SO lookup legitimately chooses ALL with idx_ful_order possible. No claim of global scan-free behavior or7.3million/50-user qualification.

Separate reviewer /root/fulfillment_independent_review actually executed10 focused native and36 pure tests, all PASS/0SKIP; read root86 log without claiming to rerun it. Closing APPROVED0C/H/M at ordered27-file subset f3858c2bcbbacda8c9824cbb46b12bb6598d7d8f6d08c5e369d1fe3d3879a8fa. Owner-effect positive/negative, missing schema, late audit/Claim rollback, five sort/tie directions, pending non-apply and actual HTTP cache revocation are included. Sales owner's original two narrow tests are preserved unchanged; their presence is not HD017 owner approval.

## Authority and remaining gates

Actual HD017 A supports this strict pending-update interface. Canonical03 clarifies already approved list wire and required no-effect owner proof; provided-contract SHA is repinned. Derived baseline lineage preserves all historical approvals, exact NFR023 NA reason and mandatory/blocking TC010; no new human decision is represented. Existing Sales owner coordination is authorized, but HD017 exact frozen-source review and narrow canonical handoff remain pending. No P4 journal routing or migrations0101/0102 adopted.

Next: frozen atomic contribution for Sales owner review; then finish TASK014 and TASK015–023. Whole developer/build/security/coverage/browser checks, current-target integration, final independent review and current-candidate CI remain mandatory before draft PR. No P1 merge or release authorization.

## Subsequent actual Sales owner source review

Sales owner chat01a0f0e2-2647-7dc2-a1d4-a7cefa29d0f6 independently reviewed fixed dff54d03f0e38543dbbcc95314fc76e35958d93e in private frozen /private/tmp/sales-hd017-review-ozmn8l3v, re-read actual HD017 A user item01a166ea-d8cd-7af2-a291-da38b60bcc1b, and APPROVED the narrow owner interface source with0 findings. It executed four named root-unit/PendingUpdate/PendingCreate/Sales-provider files: Node50PASS/0FAIL/0SKIP, including parent nodes, not50JUnit leaves. Root subsequently read the actual owner proof and verified all8 reviewed file hashes against the current checkout and the raw log digest. Proof /Users/sam/.codex/worktrees/sales-p4-archive/phase4-private/p4-hd017-frozen-owner-source-review-r1.json SHA8857af19a7f971f31d1457384c094aa19f31207da0d094b1dbd8986eca5c6032; raw log SHA01c93d124a0008139da8247a1f27b91d99e0d4eac1055e24dd77201e05a411ec.

This closes the pending actual Sales owner source review only. Exact canonical paragraphs/reciprocal contract pin handoff remains pending, so TASK014 is not yet DONE. No whole-P1/currentCI, P4 routing/migrations or Archive activation approval is implied. HD018 shared-stock batch advisory is a separate open human decision; its intentionally failing RED remains visible, and no new provider interface was implemented.

## Exact canonical handoff installed

The separate Sales owner canonical package was actually read and verified against independent review proof SHA c5926519056a83468fd111e807682fe93cd35c518dce0a5d23e4ba00821bd15f (reviewer /root/def016_runtime_recovery_review, zero findings). handoff.json SHA b78c5e06479da8beff36b7b2f87a002bfb0da7a12f0863c57630e34de372e213 and minimal patch SHA0edf8400f132c8caf694d714fe77bc76f8ddff353ab824411ad0afc4c19bf2da verified. The carried Sales03 base was exactly cd680c79a59b80a61e245edce54cc47e867bff4d1f61a6a6b6244ad36e981a19; applying only the two approved HD016 paragraphs plus one HD017 paragraph yields b7d81eb92b092c36c5a3800ba7f50fcf3ce30728f6c2cdd29ba6cbb920b0c0bf. Fulfillment's consumed and the carried Sales manifest's named provided pin now match that exact installed source. No other Sales manifest pin or P4 canonical content was imported. Sales W remains separately bound; no claim it already installed this contribution.

With actual owner source and exact canonical contribution reviews complete, TASK014 developer increment can be marked DONE. This document-only handoff changes no source tested in the86-native/92-unit author lane or owner50-node lane; the broader candidate source fingerprint is refreshed truthfully and these source-qualified results do not become whole-P1/currentCI evidence. Later current-target integration must reconcile actual Sales bytes and rerun affected gates. NFR023 exact NA reason, mandatory TC010, 64-suite owner requirement, original20sec bound and all P1 gates remain. HD018 is still OPEN; TASK015 is blocked on actual human choice and its known RED is not hidden or marked PASS.
