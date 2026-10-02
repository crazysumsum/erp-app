# P3 / TASK-026 developer checkpoint

## Current result

`DEVELOPER_VERIFIED / INDEPENDENT_REVIEW_PENDING` — only TASK-026 is implemented. TASK-026 remains `IN_PROGRESS` until Sam reviews this code checkpoint; TASK-027～034 remain PENDING. This is not P3 completion, MERGE_READY, formal Technical Acceptance, UAT or release approval. No push, PR, remote CI, merge or deployment was performed.

Approved PLAN: `a1bb358b929a2d9a59e4e77d89458943ee8a828cdce8c3c78864da03aa520d19` (APR-086/087, actual Sam reply); DESIGN unchanged: `53fe56c4bc2f45fb053036de71801ed6d0e8507887cd95b35e4645b9e87adfce`. Fresh fetched main remained `29893c304eac11716b1758d9b5e25bd8f0080a7e` at final local verification. Main migrations end at 0063; the observed Sales branch now owns 0067, not 0064. Inventory's approved 0064 allocation was not displaced.

## Material changes and limits

- `0064_create_inventory_transfers.js`: header/line persistence, unique command operations and transfer numbers, snapshots, versions, warehouse inequality, whole In-Transit quantity, required indexes, restrictive business FKs, nullable actor SET NULL FKs and optional Movement references. The rerun inspector checks typed columns/defaults, exact FK columns/parents/schema/rules, indexes and enforced CHECK predicates before additional DDL. Compatible incomplete Movement-FK attachment resumes without altering saved rows; incompatible existing schema fails closed.
- Pure Transfer rules fix Draft edit/dispatch/cancel and In-Transit receive transitions; all other transitions are rejected. Full line identity and quantities are required with no mutation of caller arrays. Existing Inventory errors and positive-safe-integer validation are reused.
- No Draft CRUD, posting, HTTP/internal API, UI, Stocktake, Opening or new dependencies. Bin-to-header-Warehouse ownership, current Active status, receive quarantine reason and post-Draft immutability remain service obligations for TASK-027/028, as approved; no cross-table trigger was invented.
- The approved three-file developer-contract patch is applied exactly, not a weakening of formal suites/coverage/CI. Matrix and formal mappings are unchanged. Full-P3 coverage, DB/API/concurrency and browser obligations remain open.

## Latest current-source evidence

All five runs below share source fingerprint `aea05c3ea0f821cb9898a7222badd78dd77df7a0ebea945f4cea92bc63a042b9`, approved PLAN above, original executing HEAD `29893c3`, and stage `DEVELOPER`. Later local savepoint commits may reuse them only if source/spec contents remain identical; no CI claim is derived from them.

| Suite | Actual result | Evidence |
| --- | --- | --- |
| TASK-026 unit | 15 passed, 0 skipped | [run](../evidence/20261002T005917-4a9579bcd22c/run.json) |
| TASK-026 true MySQL migration | 7 passed, 0 skipped | [run](../evidence/20261002T005922-2708f52305a1/run.json) |
| Existing Inventory unit regression | 155 passed, 0 skipped | [run](../evidence/20261002T005925-a1bb4d476881/run.json) |
| Whole-repository lint | exit 0 | [run](../evidence/20261002T005924-d6e2a3bead14/run.json) |
| Client production build | exit 0 | [run](../evidence/20261002T005929-857c246bf5a5/run.json) |

Real DB checks cover fresh DDL, retained-row reruns, header operation uniqueness/states/versions/warehouse restrictions, actor deletion, line/Bin/composite Lot ownership, quantity/status/line constraints, optional Movement FKs and interrupted FK attachment, plus incompatible index/default/weakened or unenforced CHECK/wrong-parent FK refusal before DDL. Namespace and socket negative probes were separately rejected in the before hook before `mysql.createConnection`: [namespace](../evidence/20261002T005647-fd6f475742a7/run.json), [socket](../evidence/20261002T005908-86ec6c7c0fc9/run.json). Those deliberately FAIL reports are safety evidence, not passing mandatory-suite runs; the final successful suite above is later and on the final source.

## Failure history and recovery

Tests were authored before product code and first failed because the two new product modules did not exist (actual local command output). Initial real DB runs then exposed missing lowercase metadata aliases ([first failure](../evidence/20260930T100357-b500d1d5aa05/run.json)) and MySQL's default FK update rule `NO ACTION` / escaped CHECK literals ([second failure](../evidence/20260930T100613-baf4fd0e286d/run.json)). Query aliases and exact metadata comparison were corrected, without relaxing business constraints. Further negative-fixture failures came from MySQL retaining automatic FK indexes; the fixture was narrowed to a wrong-parent FK on the same column. All original failed reports remain; no failed run was relabeled PASS. Rebuilds targeted only the task-owned synthetic schema.

The first proposal application matched repeated JSON context in P0. Exact PLAN verification caught it before product execution; unique `merge_group` context restored P0 and applied P3. All three canonical files were byte-compared with approved drafts, and PLAN_READY then passed. The retained approved patch hash is unchanged.

## Runtime and review

APR-071/087 governed socket-only MySQL 26.7.0 with `skip_networking=1`, private root `/private/tmp/erp-inventory-task026-mysql-2670.yipk2y0e`, synthetic schema `erp_inventory_task026_b96a99b7a37e`, own mysqld PID 49567, held loopback port 57687 (reservation only; no HTTP server) and unused owned Opening directory. Only approved 0055～0060/0063/0064 functions executed on synthetic prerequisite tables; no shared/full application DB, live credentials or production data were used. After checks, the schema was dropped and absence verified, own daemon shut down with exit 0, socket disappeared and port lease released. Temporary instance files are precisely removed; the Git worktree and recovery stash remain because this work is unmerged.

Five-axis **SELF_REVIEW**, Codex /root: scoped correctness/negative tests, existing migration and error conventions, no external interface/transaction change, fixed-identifier DDL and parameterized data queries, strict runtime guards and required indexes. No unresolved critical/high finding identified by this self-review; it is not independent approval. Sam's PLAN approval is not a code review. Required next action is Sam's independent disposition of the exact local code checkpoint; until then TASK-026 DoD and later-task authority remain open. Local synthetic evidence/logs were inspected for credentials/business data; no external evidence export is authorized.
