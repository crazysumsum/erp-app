# Inventory Management Implementation Readiness

## Status

`BLOCKED` — `PHASE-001 / TASK-001` through `TASK-004` are complete on the implementation branch. The corrected 0.5 DESIGN and PLAN are approved and merged through PR #139, but TASK-004 changed the consumed Item lookup contract while the manifest still pins its pre-implementation hash. TASK-005 remains paused. No Inventory migration has been executed.

## Baseline

- Historical 0.3 design approval: `fabc75e34e1331570e6a276cabd7392ee598b1e992dc6e8b9402e638bab63273`.
- Historical 0.3 plan approval: `8a647f900e8b21ba0cacb3361beb489aa30085cec1c2b8d6c043bf0e72e92bbf`.
- Approved 0.5 DESIGN: `23bdae2d85dc2546e641c19ccf3cd604ef3a068fb43149ae10341f0e54c87eef`.
- Approved 0.5 PLAN: `43b3bd4fc285d531f19bd2e3f8d7f22cb44a1ef2091d1d524e3007f45d28b2f8`.
- Historical IMPLEMENT authorization: Sam, active Codex task, 2026-09-23: `Inventory Management 切換到 IMPLEMENT`.
- Superseding planning decision: Sam approved the dependency-safe `0054`～`0063` allocation and return to `DESIGN_AND_PLAN` before TASK-005.

## Entry checks

- Latest main reconciliation includes PR #139 merge commit `b142bfd9f78ec46a1c36d75b78f0e885c9357ed9`.
- Customer retains `0049`～`0053`; Inventory owns the approved `0054`～`0063` block. Every not-yet-created migration must re-check latest main and stop for re-approval if a collision appears.
- Item T18～T22 are `COMPLETE_RECORDED`; Inventory uses the Item-owned transaction lookup and still rejects `serial` fail closed.
- Isolated MySQL Server `26.7.0` is running on `127.0.0.1:3307` with synthetic schema `erp_inventory_p0`; the schema remains unmigrated.
- The implementation branch pins CI to `mysql:26.7.0` and asserts `SELECT VERSION()` before migration work.
- Open contract gate: `ItemLookupService.js` now hashes to `ca31b00f228e092fce27def6c5322ec804e9969c83853e90d0965e59a6e86ab1`; the approved manifest still pins `6aff6504eb3cae4347c05a7deaba1c4c7eb1e2de3142f9a7de1eb4587c2f8d90`. Updating that binding changes the DESIGN and PLAN hashes.

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

## Completed developer verification

- TASK-002: authenticated idempotency is actor-scoped for `jwt`, `jwt-password`, `jwt-device-password` and API keys; focused dispatcher/store regressions passed 91/91.
- TASK-003: five independent permissions, the idempotent `0054` seed, typed configuration, frozen constants and safe error mappings are implemented; focused server checks passed 16/16, client checks 1/1 and ESLint passed.
- TASK-004: Item-owned transaction-bound Inventory profile and UOM lookup are implemented; Item lookup checks passed 33/33 and ESLint passed. Real-MySQL cases remained skipped because migration execution is not authorized.

## Boundaries

- No Inventory migration execution, production access, deployment, Technical Acceptance or UAT has occurred.
- Migration execution remains a separate explicit authorization.
- TASK-005 may create only `0055_create_inventory_operations.js` and `0056_create_inventory_audit.js`; Movement remains in P1 migration `0059`.

## Next safe action

Resolve `HD-008`: either adopt TASK-004's transaction-aware Item lookup contract and reapprove the resulting DESIGN／PLAN hashes, or revert TASK-004 until Item Management publishes it separately. Do not start TASK-005 or execute migrations.
