# Inventory Management Implementation Readiness

## Status

`BLOCKED` — TASK-001～TASK-004 are complete on this P0 branch, and the approved Item contract published by [PR #141](https://github.com/crazysumsum/erp-app/pull/141) is now reconciled from `main`. TASK-005 is `PENDING`; no Inventory migration has been executed.

## Baseline

- Historical 0.3 design approval: `fabc75e34e1331570e6a276cabd7392ee598b1e992dc6e8b9402e638bab63273`.
- Historical 0.3 plan approval: `8a647f900e8b21ba0cacb3361beb489aa30085cec1c2b8d6c043bf0e72e92bbf`.
- Historical 0.5 DESIGN: `23bdae2d85dc2546e641c19ccf3cd604ef3a068fb43149ae10341f0e54c87eef`.
- Historical 0.5 PLAN: `43b3bd4fc285d531f19bd2e3f8d7f22cb44a1ef2091d1d524e3007f45d28b2f8`.
- Approved 0.7 DESIGN: `474fc6e215cc86ce9be2866c17156e18ac3dc91ad320937af7a310a2a099e08b`.
- Approved 0.7 PLAN: `12b274ba8529f70c058d9393d9fb83ccc57319641fc3ee756907d73cdc9031e4`.
- Approved 0.8 DESIGN: `56dd0913f0dedf891eb9885d9d89ceb763c3daca1fae3887226ae5358563784e`.
- Approved 0.8 PLAN: `4ac86650205134dacc954badc3e54b2610f2fe43f0625e0eb2b6922616fb3434`.
- Historical IMPLEMENT authorization: Sam, active Codex task, 2026-09-23: `Inventory Management 切換到 IMPLEMENT`.
- `HD-008`: Sam approved adopting TASK-004's transaction-aware `ItemLookupService` contract on 2026-09-23.
- `HD-010`: Sam approved exactly `server/src/modules/item/ItemLookupService.js` and `server/test/itemLookupService.test.js` as the shared publication scope on 2026-09-24.

## Reconciled P0 checks

- Latest `main` includes PR #141 and PR #142; the published Item contract matches this branch's TASK-004 implementation.
- TASK-001～TASK-004 implementation commits remain isolated on this branch and are not claimed as merged product work.
- The implemented service contract hashes to `ca31b00f228e092fce27def6c5322ec804e9969c83853e90d0965e59a6e86ab1`.
- Both new methods require the caller's transaction executor; they do not open an independent connection.
- The Inventory profile is an explicit whitelist and exposes Serial so Inventory can reject it fail closed.
- UOM resolution accepts only an active SKU UOM with an integer factor from 1 to 1,000,000 and requires Base UOM factor 1.
- After merging latest `origin/main`, focused Item lookup checks passed 33/33 and focused ESLint passed.
- Module-boundary validation against the current PR target, traceability validation and `PLAN_READY` passed.
- Multi-axis code review found no correctness, security, maintainability or contract-blocking issue in the isolated diff.
- Full `PHASE-001 MERGE_READY` remains blocked by the intentionally unfinished P0 tasks, runtime leases and pending remote CI/review; this isolated publication does not claim that Phase gate.
- The previous MySQL 26.7.0 lease is no longer active; a fresh isolated lease and version check are required before any later database work.

## Approved physical allocation

| Prefix | Migration | Owner |
| --- | --- | --- |
| `0054` | `seed_inventory_permissions` | P0-T03 |
| `0055` | `create_inventory_operations` | P0-T05 |
| `0056` | `create_inventory_audit` | P0-T05 |
| `0057` | `create_inventory_master` | P1-T01 |
| `0058` | `create_inventory_stock` | P1-T05 |
| `0059` | `create_inventory_movements` | P1-T05 |
| `0060` | `create_inventory_reservations` | P2-T01 |
| `0061` | `create_inventory_transfers` | P3-T01 |
| `0062` | `create_inventory_stocktakes` | P4-T01 |
| `0063` | `create_inventory_opening` | P5-T01 |

## Boundaries

- No Inventory migration execution, production access, deployment, Technical Acceptance or UAT has occurred.
- Migration execution remains a separate explicit authorization.
- Reconciliation does not start TASK-005 or merge the remaining P0 implementation commits.
- TASK-005 may create only `0055_create_inventory_operations.js` and `0056_create_inventory_audit.js`; Movement remains in P1 migration `0059`.

## Next safe action

Complete reconciliation validation and commit the approved 0.8 boundary records. Keep TASK-005 `PENDING` and migration execution paused pending separate authorization.
