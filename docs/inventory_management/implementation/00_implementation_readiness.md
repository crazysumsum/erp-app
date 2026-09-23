# Inventory Management Implementation Readiness

## Status

`PLANNED` — P0 TASK-001～TASK-004 are complete on the unmerged implementation branch. Sam approved the corrected DESIGN and PLAN hashes; implementation remains paused until the docs-only correction is merged, the branch is reconciled and `IMPLEMENT` is separately resumed.

## Baseline

- Default / worktree baseline: `a264d41e402c0adc3caf05555034755f54e7abbf`
- Historical 0.3 design approval: `fabc75e34e1331570e6a276cabd7392ee598b1e992dc6e8b9402e638bab63273`
- Historical 0.3 plan approval: `8a647f900e8b21ba0cacb3361beb489aa30085cec1c2b8d6c043bf0e72e92bbf`
- Human authorization: Sam, active Codex task, 2026-09-23: `Inventory Management 切換到 IMPLEMENT`.
- Superseding planning decision: Sam, active Codex task, 2026-09-23: approve dependency-safe `0054`～`0063` allocation and return to `DESIGN_AND_PLAN`.

## Entry checks

- 0.5 DESIGN hash `23bdae2d85dc2546e641c19ccf3cd604ef3a068fb43149ae10341f0e54c87eef` and PLAN hash `43b3bd4fc285d531f19bd2e3f8d7f22cb44a1ef2091d1d524e3007f45d28b2f8` were independently approved by Sam on 2026-09-23.
- Local implementation commits completed TASK-001～TASK-004; none is merged to main. TASK-005 has no DDL change.
- The isolated local MySQL server reports exactly 26.7.0; no Inventory migration has been executed.
- The local implementation branch pins CI to `mysql:26.7.0`; that change is not merged to main.

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

- No migration execution, production access, deployment, CI merge, Technical Acceptance or UAT has occurred.
- Migration execution remains a separate explicit authorization.

## Next safe action

Commit and merge the docs-only PR to main without CI, reconcile the paused implementation branch, and only then ask to resume `IMPLEMENT` at TASK-005.
