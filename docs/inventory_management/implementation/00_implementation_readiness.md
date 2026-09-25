# Inventory Management Implementation Readiness

## Status

`BLOCKED` — TASK-001～TASK-007 are complete on this P0 branch. TASK-007 is developer-verified, including the approved isolated MySQL 26.7.0 two-connection smoke test; TASK-008 remains pending a separate human decision before implementation continues.

## Baseline

- Historical 0.3 design approval: `fabc75e34e1331570e6a276cabd7392ee598b1e992dc6e8b9402e638bab63273`.
- Historical 0.3 plan approval: `8a647f900e8b21ba0cacb3361beb489aa30085cec1c2b8d6c043bf0e72e92bbf`.
- Historical 0.5 DESIGN: `23bdae2d85dc2546e641c19ccf3cd604ef3a068fb43149ae10341f0e54c87eef`.
- Historical 0.5 PLAN: `43b3bd4fc285d531f19bd2e3f8d7f22cb44a1ef2091d1d524e3007f45d28b2f8`.
- Approved 0.7 DESIGN: `474fc6e215cc86ce9be2866c17156e18ac3dc91ad320937af7a310a2a099e08b`.
- Approved 0.7 PLAN: `12b274ba8529f70c058d9393d9fb83ccc57319641fc3ee756907d73cdc9031e4`.
- Approved 0.8 DESIGN: `56dd0913f0dedf891eb9885d9d89ceb763c3daca1fae3887226ae5358563784e`.
- Approved 0.8 PLAN: `4ac86650205134dacc954badc3e54b2610f2fe43f0625e0eb2b6922616fb3434`.
- Approved 0.9 DESIGN: `4c27910933198d1de4f287e23d83d68775d0707a837c531cc79b5460f2ecc4ff`.
- Approved 0.9 PLAN: `27a3f616185d5b6ed865cbb962bafb05e23c74347df7ea994037d81f9e5583be`.
- Historical IMPLEMENT authorization: Sam, active Codex task, 2026-09-23: `Inventory Management 切換到 IMPLEMENT`.
- `HD-008`: Sam approved adopting TASK-004's transaction-aware `ItemLookupService` contract on 2026-09-23.
- `HD-010`: Sam approved exactly `server/src/modules/item/ItemLookupService.js` and `server/test/itemLookupService.test.js` as the shared publication scope on 2026-09-24.
- `HD-012`／`APR-015`: Sam approved TASK-005's exact two migration paths and execution of `0054`～`0056` only in a fresh disposable MySQL 26.7.0 schema on 2026-09-24.
- `HD-013`: Sam approved TASK-006 operation／Audit services and focused developer tests on 2026-09-24, without TASK-007, push, PR or merge.
- `HD-014`: Sam approved TASK-007's fixed lock protocol, transaction-required internal command context and test support on 2026-09-24, without TASK-008, production migrations or remote actions.
- `HD-015`: Sam selected the isolated disposable MySQL 26.7.0 option for TASK-007's two-connection contention smoke test on 2026-09-24; only test-owned minimal DDL was permitted and the schema had to be removed afterwards.
- `HD-016`～`HD-018`: Sam approved adding exactly the two planned TASK-007 test-support paths to the module allowlist and approved the resulting 0.9 DESIGN／PLAN hashes on 2026-09-25.

## Reconciled P0 checks

- Latest `main` includes PR #141 and PR #142; the published Item contract matches this branch's TASK-004 implementation.
- TASK-001～TASK-004 implementation commits remain isolated on this branch and are not claimed as merged product work.
- The implemented service contract hashes to `ca31b00f228e092fce27def6c5322ec804e9969c83853e90d0965e59a6e86ab1`.
- Both new methods require the caller's transaction executor; they do not open an independent connection.
- The Inventory profile is an explicit whitelist and exposes Serial so Inventory can reject it fail closed.
- UOM resolution accepts only an active SKU UOM with an integer factor from 1 to 1,000,000 and requires Base UOM factor 1.
- After merging latest `origin/main`, focused Item lookup checks passed 33/33 and focused ESLint passed.
- TASK-007 stayed inside the approved module boundary and did not add a migration, start TASK-008 or perform any remote action.
- The corrected 0.9 module boundary and traceability validations pass; the only scope change from 0.8 is the two planned TASK-007 test-support paths.
- Multi-axis TASK-006 self-review found and fixed one unsafe-summary issue before commit: allowlisted summary keys now accept scalar values only, so a nested raw payload cannot hide under an approved key. No correctness, security, maintainability or contract-blocking issue remains in the isolated diff.
- Full `PHASE-001 MERGE_READY` remains blocked by the intentionally unfinished P0 tasks and pending remote CI/review; this local task completion does not claim that Phase gate.
- TASK-005 used a newly observed MySQL 26.7.0 lease; its schema, server and exact temporary root were removed after developer verification and cannot be reused by later tasks.

## TASK-005 developer verification

- Commit `143fd9eb79db27590ae45dff74eb80baf91f1d28` creates only `0055_create_inventory_operations.js`, `0056_create_inventory_audit.js` and the focused Inventory migration integration test.
- The source tuple unique key contains exactly module, document type, document ID, non-null line ID and event ID; `command_type` is excluded. A real two-connection duplicate race produced one winner and one `ER_DUP_ENTRY`.
- Audit permits only exact `SUCCEEDED`／`REJECTED`／`FAILED` outcomes, keeps actor/source snapshots, applies actor `SET NULL` and operation `RESTRICT`, and rejects direct `UPDATE`／`DELETE` through immutable triggers.
- The migration rerun preserved identical DDL, no `inventory_movements` table was created, and the schema test passed on observed MySQL `26.7.0` at the isolated schema `erp_inventory_task005_20260924_1008`.
- Focused Inventory migration test: 1 passed, 0 failed, 0 skipped. Full server developer suite with the repository's CI test keys: 1,684 passed, 0 failed, 303 DB-gated tests skipped. Full repository ESLint passed.
- These are developer checks, not formal `TC-001`／`TC-004` Technical Acceptance or business acceptance.

## TASK-006 developer verification

- Commit `03df3f4c2a13840f44f3420ae0f692a90f7b6225` implements canonical SHA-256 operation hashes, exact source-tuple claim/replay/conflict handling, completed-result source lookup and guarded single completion.
- Command type is part of the hash but not the source unique tuple. Password／token／authorization／reauthentication proof fields are recursively excluded from the hash, while business-field changes alter it.
- Durable result and Audit summaries use explicit server allowlists, scalar-only values and an 8 KiB cap. Required `SUCCEEDED` Audit uses the caller's transaction and propagates insert failure; post-rollback `REJECTED`／`FAILED` Audit uses a short independent transaction, stores no success projection or operation link, and falls back to a safe structured error log if persistence fails.
- Focused operation／Audit tests: 13 passed, 0 failed. Full server developer suite with the repository's CI test keys: 1,697 passed, 0 failed, 303 MySQL-gated tests skipped. Full repository ESLint passed.
- Full server coverage execution was attempted, but without an authorized active MySQL runtime the 303 integration cases were skipped and the repository-wide lines/functions thresholds could not be established. No schema was created or migrated for TASK-006.
- These are developer checks, not formal `TC-004` Technical Acceptance, CI, independent code approval or business acceptance.

## TASK-007 developer verification

- Commits `626be3e83e1511ba1cd4370727a03dc96298beca`, `09863379cf09767f0bd8dcc5d40cbc15d2f8e819`, `34e2f6fdf20bb9d49cfba3e2c08105c7e0ece520` and `ff35f5f0aa13b68de198929753a0a5a74634cf4c` implement the transaction-required internal command context, one fixed-order lock entry point, fault injection／barrier fixtures and the real-connection smoke test.
- The lock helper deduplicates and sorts every key, enforces Warehouse／Stock Control／Bin scope dependencies, uses upsert-before-`FOR UPDATE` for missing control／balance rows, and maps MySQL deadlock／lock-timeout errors to `CONCURRENT_OPERATION`.
- The command context requires the caller's transaction executor and a service-owned authorization contract; it rejects unknown fields, invalid identities and recursively nested sensitive payload fields without opening a pool connection or nested transaction.
- Fault injection covers operation, current state, Movement, Audit and commit boundaries. The concurrency barrier releases only after both parties arrive.
- Focused Inventory checks: 28 passed, 0 failed. The dedicated two-connection MySQL smoke test: 1 passed, 0 failed on observed MySQL `26.7.0`, using test-only schema `erp_inventory_task007_20260925_0855` and no production migration. Full server developer suite with the repository's CI test keys: 1,707 passed, 0 failed, 304 gated tests skipped. Full repository ESLint passed. These checks were rerun after approval of PLAN `27a3f616185d5b6ed865cbb962bafb05e23c74347df7ea994037d81f9e5583be`.
- The disposable schema, local test account, MySQL server and temporary data root were removed after the smoke test. No reusable runtime lease remains.
- Multi-axis self-review found no correctness, security, architecture, performance or maintainability blocker. These are developer checks, not formal `TC-010` Technical Acceptance, CI, independent code approval or business acceptance.

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

- No shared／production database access, deployment, Technical Acceptance or UAT has occurred.
- TASK-005 migration execution occurred only under `HD-012` in its disposable schema; no other project migration was executed there.
- TASK-005 created only `0055_create_inventory_operations.js` and `0056_create_inventory_audit.js`; Movement remains in P1 migration `0059`.
- TASK-006 created only the two approved services, one shared safe-JSON helper and the three planned focused test files.
- TASK-007 created only the approved lock／validation services, test support and focused tests; the smoke test's minimal DDL was disposable and is not a migration or product schema authority.
- The remaining P0 implementation commits are local; no TASK-006／TASK-007 push, PR, CI or merge is claimed.

## Next safe action

Obtain Sam's next explicit decision before starting TASK-008 Warehouse／Bin persistence. No database runtime is active, and no push, PR or merge is authorized.
