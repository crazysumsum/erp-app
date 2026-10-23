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
