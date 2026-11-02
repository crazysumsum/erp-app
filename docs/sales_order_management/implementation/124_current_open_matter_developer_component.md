# Current OpenMatter provider developer component

Fulfillment P0 PR271 was independently re-observed MERGED at 2026-10-23T00:51:03Z (Hong Kong08:51), commitfd32762f, all13 CI SUCCESS. P4 remains implementation in progress; no current P4 PR/CI or merge.

## Behavior

The nontransactional Archive advisory establishes its own controlled fresh default RR and reads all12 fixed owner tables with500-row/parent bounds. Strict current schema, migration versions, actual owner membership/line counts/timestamps and routed operation target ownership distinguish CLOSED, OPEN and safe UNKNOWN. Retained archived targets are checked against exact immutable mirror ownership; null target IN_PROGRESS intents still block. Export intents remain unscoped read-only. Existing HD012/013/014 lifecycle method body is byte-identical.

Transaction-aware Archive reads additionally require exact actual active RR/context and a private fixed authorizer. The real runtime adapter is not implemented here; absence, failure or unrelated outer transaction yields UNKNOWN. Input primitives are validated before access and copied/frozen before any await. The fixed 12-table helper grants no Archive authority or freshness certificate; complete earlier operation fences and the real private runtime are still required. No Archive writes are activated.

## Actual verification and repair history

Final raw `p4-openmatter-current-native-r9.log` SHA25666bda5c1df72298864bb7c0557fddb7fd9be54cf2100de0e1b3a2cdb43f9aa66:21 NodePASS,0FAIL/0SKIP (includes parent nodes). Actual UUID MySQL fixtures include terminal Inventory Allocate/Issue/Reverse projections across all12 tables, no business/Inventory modifications by reads, real active Claim/Allocation/reversing states, DRAFT→terminal, null intent, cross-order/archived target ownership,501 operation rows and504 mixed-target Audit rows/global PRIMARY lock ordering, schema/version/availability refusal, unrelated RR refusal and async command/time mutation. Unit20PASS/0FAIL/0SKIP and scoped ESLint0. Raw files remain private outside Git.

Original fixture setup failures remain recorded: r1 omitted formal operation lease/attempt fields; r6/r7 Audit fixture lacked0101. Fixtures were corrected using valid formal fields and the actual migration runner; constraints/indexes were not weakened, and ledger rows were not forged. Accessor RED19PASS/1FAIL and mutation RED18PASS/3FAIL including parent were genuine behavior regressions before fixes. Intermediate PASS runs are historical only.

Separate closing proof `p4-openmatter-current-r2-closing-reviewer-proof.json` SHA2565b4826289d97811779de590db1468cd4b35b8a7dc25dd80dc456c823a5095eff binds exact frozen four files and final raw evidence,0 required findings; DEF021 is narrowly CLOSED. R1 proof is retained unchanged: its live-read findings preceded some captured file hashes, as explicitly clarified by the real reviewer; it is not interpreted as proving every finding in the later captured bytes.

## Remaining obligations

This focused current-schema native file does not replace the original mandatory OpenMatter/fullTC047/048 suite, whose prototype assumptions still need proper porting. No original test, threshold, complete Gate or formal acceptance is removed or called PASS. Implement real private coordinator/lease, participant copy/readback/route/delete/replay, full Sales atomic effects, all original phase regression/coverage/capacity/restore and current browser/CI/review/merge Gates before main merge.
