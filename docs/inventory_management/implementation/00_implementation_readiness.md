# Inventory Management Implementation Readiness

## Status

`IMPLEMENTING` — `PHASE-001 / TASK-001` and `TASK-002` are complete; `TASK-003` is active on the approved exact MySQL Server 26.7.0 baseline. No migration has been executed.

## Baseline

- Default / worktree baseline: `1a47b65570ed7757b79cdabb1cdea20daadfdbbe`
- Historical 0.3 design approval: `fabc75e34e1331570e6a276cabd7392ee598b1e992dc6e8b9402e638bab63273`
- Historical 0.3 plan approval: `8a647f900e8b21ba0cacb3361beb489aa30085cec1c2b8d6c043bf0e72e92bbf`
- Human authorization: Sam, active Codex task, 2026-09-23: `Inventory Management 切換到 IMPLEMENT`.
- Resume authorization: Sam, active Codex task, 2026-09-23: approved resumption after the 0.4 documentation baseline merged.

## Entry checks

- 0.4 design and plan approval: final hashes independently approved by Sam on 2026-09-23.
- P0 scope: `PHASE-001`; first task: `TASK-001` migration inventory and upstream-contract verification.
- Latest-main proof: `origin/main` and the task worktree both resolve to `1a47b65570ed7757b79cdabb1cdea20daadfdbbe`; tracked migrations end at `0048_create_customer_activation_requests.js` and all four-digit prefixes are unique.
- Parallel allocation proof: active Customer PHASE-003 already owns committed `0049`–`0051` and its approved `CUST-M15`/`CUST-M16` import schema requires `0052`–`0053`. Other inspected active worktrees add no later migration.
- Item prerequisite: Item T18–T22 are `COMPLETE_RECORDED`; `ItemLookupService` exposes the `inventory` purpose and its contract tests cover tracked, inactive and archived SKU outcomes. Inventory still rejects `serial` fail closed; it does not copy Item eligibility rules.
- Local runtime: isolated MySQL Server `26.7.0` is running on `127.0.0.1:3307`, schema `erp_inventory_p0`, socket `/private/tmp/erp-inventory-p0-mysql-2670.dA2Off/mysql.sock`. The schema contains synthetic task data only and remains unmigrated pending separate authorization.
- CI runtime: the official `mysql:26.7.0` image is pinned in `.github/workflows/ci.yml`; a pre-migration `SELECT VERSION()` assertion requires the running service to report exactly `26.7.0`.

## Physical migration allocation

The allocation below is frozen for Inventory after reconciling latest main and every active repository worktree. Customer retains `0049`–`0053`; Inventory owns the next contiguous block and must re-check latest main immediately before each Phase creates its files.

Sam independently confirmed this allocation in the active Codex task on 2026-09-23.

| Physical prefix | Logical migration |
| --- | --- |
| `0054` | `seed_inventory_permissions` |
| `0055` | `create_inventory_master` |
| `0056` | `create_inventory_stock` |
| `0057` | `create_inventory_operations_and_movements` |
| `0058` | `create_inventory_reservations` |
| `0059` | `create_inventory_transfers` |
| `0060` | `create_inventory_stocktakes` |
| `0061` | `create_inventory_opening` |
| `0062` | `create_inventory_audit` |

This preserves the approved FK order. Existing migration filenames and contents remain unchanged.

## TASK-002 developer verification

- A focused regression first reproduced that `jwt-password` requests from different actors on the same IP shared one store key.
- `identityScope` now treats every non-public authenticated strategy as actor-scoped while retaining the existing `jwt:` key namespace; public and unauthenticated requests retain IP scope.
- `idempotencyService`, dispatcher, memory-store and MySQL-store regressions passed: 91 tests, 0 failures. The dispatcher suite required local loopback permission; no database or migration was used.

## Boundaries

- No migration execution, production access, deployment, CI merge, Technical Acceptance or UAT has occurred.
- Migration execution remains a separate explicit authorization.

## Next safe action

Implement TASK-003 permissions, config, constants and public errors; creating the allocated `0054` seed migration is allowed, but executing migrations remains separately authorized.
