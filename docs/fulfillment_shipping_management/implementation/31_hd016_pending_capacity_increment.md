# HD-016 pending capacity developer increment

Actual HD-016 A authority is the direct human instruction recorded in implementation/29_pending_create_claim_contract.md#actual-adoption--2026-10-23. This increment implements only the approved pending identity and complete current capacity proof; TASK-013 remains IN_PROGRESS. It does not implement or qualify the Create command, concurrency, late audit rollback, all P1 tasks, CI or PR.

## Exact derived shared scope

The approved A requires complete actual Inventory source/current-counter proof before new private documents. Existing owner lookup had a 5,000 command-member bound, while a valid selected command may draw from more than 5,000 accumulated source mappings. The narrowly derived protected path is `server/src/modules/inventory/InventoryLookupService.js`: add a read/lock-only complete source-scope entry point with bounded 500-row batches, all master/control anchors before Reservation locks, original authorization/source/counter checks and ascending primary IDs. Existing entry point retains its 5,000 member bound and exact public fields. No Inventory write API, schema, global isolation or quantity rule changes. Scope derives from actual HD016 A plus separate reviewer approval, not historical unrestricted P0 scope. No new human decision is represented here.

## Real review and evidence

Separate reviewer `/root/fulfillment_independent_review` approved this provider/read-lock increment at ordered five-file subset `190448bf27f6e6212b5b8d4f606880c1fdc80f7ff5254b9315bf9a378c20b81c`, 0 Critical/High/Medium. It independently executed 36 Sales tests successfully; it explicitly excluded full TASK013 qualification.

Qualified behavioral RED: `/private/tmp/fulfillment-p1-hd016-proof-red.log` (5 pass, 2 fail: concealed counter/source drift and 5,001 source scope). Earlier missing-logger fixture failures are setup diagnostics only, not behavioral RED.
Latest exact native file GREEN: `/private/tmp/fulfillment-p1-hd016-proof-green-r2.log` (7 pass, 0 fail, 0 skip), including the added unchanged-old-API 5,001 rejection and unknown flag rejection. The 5,001 source case proves capacity with 5,000 earlier active Claims and one newly available member; it does not enlarge a selected command beyond 5,000 members.
Focused Fulfillment plus Sales unit regression: `/private/tmp/fulfillment-p1-hd016-unit-regression.log` (76 pass, 0 skip). ESLint: `/private/tmp/fulfillment-p1-hd016-lint.log`, successful exit. Legacy persisted CLAIM golden hash remains `cfaeaaae9e23c351588072b4e20723454cef0eabe1db7e7e489586757da9a3fe`.

Native P0 migration, joint Sales/Inventory and Sales provider regression: `/private/tmp/fulfillment-p1-hd016-native-regression.log`, 34 pass, 0 fail, 0 skip; actual fresh UUID schemas cleaned by test teardown. Original 20-second limit, full quality gates, NFR-023 reason and mandatory TC-010 remain unchanged. Sales owner review of the committed contribution remains pending. No operation routing or P4 migrations adopted.
