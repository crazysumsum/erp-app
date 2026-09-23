# Inventory Management Implementation Readiness

## Status

`DESIGNING` — Sam approved adopting TASK-004's transaction-aware Item lookup contract. The contract and tests are isolated on this latest-main branch; TASK-005 remains paused until the updated DESIGN and PLAN hashes are approved and the contract publication is merged. No Inventory migration has been executed.

## Baseline

- Historical 0.3 design approval: `fabc75e34e1331570e6a276cabd7392ee598b1e992dc6e8b9402e638bab63273`.
- Historical 0.3 plan approval: `8a647f900e8b21ba0cacb3361beb489aa30085cec1c2b8d6c043bf0e72e92bbf`.
- Historical 0.5 DESIGN: `23bdae2d85dc2546e641c19ccf3cd604ef3a068fb43149ae10341f0e54c87eef`.
- Historical 0.5 PLAN: `43b3bd4fc285d531f19bd2e3f8d7f22cb44a1ef2091d1d524e3007f45d28b2f8`.
- `HD-008`: Sam approved adopting TASK-004's transaction-aware `ItemLookupService` contract on 2026-09-23.

## Contract publication checks

- Only `ItemLookupService.js`, its focused tests and Inventory planning records are in scope; TASK-001～TASK-003 code is not carried by this branch.
- The implemented service contract hashes to `ca31b00f228e092fce27def6c5322ec804e9969c83853e90d0965e59a6e86ab1`.
- Both new methods require the caller's transaction executor; they do not open an independent connection.
- The Inventory profile is an explicit whitelist and exposes Serial so Inventory can reject it fail closed.
- UOM resolution accepts only an active SKU UOM with an integer factor from 1 to 1,000,000 and requires Base UOM factor 1.
- Focused Item lookup checks previously passed 33/33; they must be rerun on this publication branch before any PR.

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
- Contract publication does not resume TASK-005 or merge the remaining P0 implementation commits.

## Next safe action

Update the Inventory manifest contract binding, validate the isolated contract and planning artifacts, then obtain fresh DESIGN and PLAN hash approvals. Do not push, merge or start TASK-005 before approval.
