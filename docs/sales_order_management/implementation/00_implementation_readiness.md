# Sales foundation implementation readiness

Status: CONDITIONAL. IMPLEMENT TASK-001..008 authorized by Sam's current chat「開始」following PR #170. Source/default/entry: `8bc4a4cfe68710f384cebca8395b78343bef1db9`; branch `codex/sales-foundation`, isolated worktree `/private/tmp/erp-sales-foundation`. Current DESIGN `97b111294cbb55350d8318ab20c1a203bbba3f3e3fdd6d4063beba6288ea23a2`, PLAN `a1292e22cfc2854a1ecb8025042851880315e6a553087e6d4cbfe11359783966`. Requirements and approved canonical plan unchanged.

## TASK-001 observed dependencies

Module owners below are ERP Product Owner (Sam), observed in each canonical module manifest. Scheduler is existing framework code maintained by the repository owner (Sam); no new scheduling job is enabled.

| Dependency | Observed file | Foundation readiness |
| --- | --- | --- |
| Customer | server/src/modules/customer/CustomerLookupService.js | Existing new_sale/getCreditPolicy core; focused tests passed. Sales consumer/version proof remains blocked TASK-009. |
| Item | server/src/modules/item/ItemLookupService.js | Generic/Inventory lookups tested; findManyForSale/findSaleUom/searchForSale absent. Sales contract BLOCKED. |
| Inventory | server/src/modules/inventory/InventoryMasterService.js | Existing master tested; main lacks InventoryReservationService/batch Sales API. Sales reserve/release BLOCKED TASK-010. |
| Currency / Payment Term | server/src/modules/businessMaster/BusinessMasterProvider.js | Existing business-master-currency-payment-term-provider/v1 with caller transaction and purpose checks; focused provider tests passed. No Sales consumer written. |
| Warehouse | server/src/modules/inventory/InventoryMasterService.js | Existing warehouse master; Sales availability lookup/lock-order contract not adopted. BLOCKED for later integration. |
| Scheduler | server/src/services/scheduler/SchedulerService.js | Existing singleton/leases; focused tests passed. No Sales jobs registered. |
| Fulfillment | no server/src/modules/fulfillment | BLOCKED; no fallback or stub. |

All main migration prefixes 0001..0062 are unique; existing files remain unchanged. Active Inventory worktree already has 0063_create_inventory_reservations.js and its design plans 0064 allocations. Next potentially available number is 0065; Sales permission allocation requires Sam's pending owner coordination decision. No number has been allocated by this agent and no database migration executed. Further contiguous Sales sequence is not granted.

Read-only TASK-001 verification used actual Git status/log/migration enumeration, source inspection and existing focused Customer/Item/directory/Scheduler, Inventory master and Business Master provider tests. Baseline lint passed. These are developer readiness observations; TC-001/002 Sales integration tests remain NOT_RUN.

## Scope and runtime

This stage uses TDD and incremental implementation skills; security-and-hardening applies to upload trust boundaries and fresh-actor checks. Reuse installed Busboy, Node streams/crypto/filesystem and existing authorization helpers. No new dependency.

The state records the actual private temporary directory and worktree. Task-local FILES checks use synthetic data, fake database services and ephemeral localhost servers. No real database/schema, persistent web-port lease, live notification or transaction has been created. The generic harness runner's current profile still requires separate environment authorization and MySQL/web resources, so its execution gate remains blocked; direct reviewed task-local checks will be recorded honestly. Full sales-technical, formal acceptance and Phase merge remain unavailable until their complete prerequisites are met.

TASK-009..011, PHASE-001 exit and later Phases remain blocked under the scoped approval. Local commits preserve incremental work; no partial product Phase merge is authorized. Plan/design/trace ledger authorities will not be rewritten to disguise readiness or evidence.
