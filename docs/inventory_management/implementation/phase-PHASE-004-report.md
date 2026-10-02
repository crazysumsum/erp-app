# P3 developer checkpoints

## Current TASK-027 result — developer verified, independent review pending

Sam authorized local TASK-027 with actual `開始` (APR-089), then answered HD-079 with actual `A`, approving the exact [two-file command patch](task027-developer-contract-proposal.patch), SHA-256 `05050679e4d46a2c46836f00576404ff9f424224ac60a71edb2f55073e4392fb`. Applied PLAN is `54635da0d969d7ee82bc7b77c60459214a53eff6e5b3bcda98fcd861cd09f494`, DESIGN unchanged; APR-090/091 and REV-052 retain the actual decision. Product savepoint is `0ce2eb88c86d3d378a2525c3071d9a061df7e2ce`, same verified source/spec. TASK-027 is developer verified but IN_PROGRESS; overall status is BLOCKED pending actual Sam independent code review HD-080. This is not Phase completion, merge readiness, formal acceptance or release approval.

Implemented only Draft create, complete replacement (retain owned IDs with line versions, reorder/add/delete atomically), Draft-only cancellation and Transfer list/detail. Header CAS guards the full line set; existing sorted lock protocol covers old/new Warehouse scope, Bins, Lots and Transfer root without creating stock controls or balances. Fresh current actor authorization, canonical SKU inventory profiles, Lot/source-Bin ownership and positive-safe-integer quantities are required. Audit and immutable operation receipts commit with the document; replay returns the original receipt after later edits/cancellation. List paging defaults20/max100, allowlisted filters/sorts and tie-break ID; detail reads header/children/Movements within one consistent transaction and exposes explicit safe projections. Internal date bounds use epoch milliseconds like Movement inquiry; the future HTTP boundary owns company-calendar conversion.

### Actual current-source DEVELOPER evidence

All five runs share source fingerprint `0837d0eede203c7c3e9ef777b84c3b1d8cf7de4ee6df25bcf55ca992f8d8e8d9`, PLAN above, executing HEAD `0d4d0c2`, and private runtime EXT-128. Artifact hashes/lengths were verified after execution. They may support a later local savepoint only if source/spec contents remain identical; they do not establish CI or formal TC/UAT results.

| Suite | Actual result | Evidence |
| --- | --- | --- |
| TASK-027 unit | 25 passed, 0 skipped | [run](../evidence/20261002T040839-79e6d0708d71/run.json) |
| Real MySQL26.7.0 Draft domain | 14 passed, 0 skipped | [run](../evidence/20261002T040840-5374d9cfb1b8/run.json) |
| Existing Inventory regression | 158 passed, 0 skipped | [run](../evidence/20261002T040840-767650988ca5/run.json) |
| Whole-repository lint | exit0 | [run](../evidence/20261002T040840-db4800a1215c/run.json) |
| Client production build | exit0 | [run](../evidence/20261002T040839-080673e8bd03/run.json) |

Real DB cases cover canonical snapshots, reorder/add/delete, late-line atomic rejection, stale header/line versions, cross-owner IDs, cancellation actor/time/reason/Audit, four-state safe queries, receipt replay/conflict, audit-failure rollback, deterministic competing update/cancel, revoked-permission replay, inactive/tracking restrictions, byte-identical nonzero OnHand/Allocated/Reserved rows/versions, and changing source/destination ownership safely. Four-state query fixtures directly set header statuses for read-only checks only: they do not prove Dispatch/Receive transitions. No HTTP/API/UI, actual posting, Stocktake or Opening implementation is claimed. Minimal synthetic parent tables exercise real authorization and Item lookup; only existing0055–0060/0063/0064 migrations execute in the owned fresh schema, not the shared full application DB.

### Review, failure history and remaining gates

Five-axis SELF_REVIEW, Codex /root: correctness/rollback/replay/concurrency and ownership checks; existing Inventory operation, lock, validation, Audit and query conventions; bounded100-line input/20–100 list paging, parameterized values and allowlisted sorts/projections; no new dependencies or shared migration edits. No unresolved critical/high product finding identified by this self-review; Sam's plan decision is not code approval. Browser validation is not applicable to this domain-only Task; mandatory actual browser/API checks remain for their later Tasks.

Valid test-first failures are retained: [missing Transfer service](../evidence/20261002T034512-bc333a40b910/run.json), [real DB before replacement/cancel/query implementation](../evidence/20261002T040046-ba2af73b3b6c/run.json), and [query tests before implementation](../evidence/20261002T040354-9788b76d9bb2/run.json). The first DB run additionally exposed mysql2 DATE objects being converted to invalid strings; canonical SQL DATE_FORMAT under held Lot locks fixed calendar snapshots, and subsequent real DB runs passed. Test error names were aligned with existing VERSION_CONFLICT and INVENTORY_SOURCE_CONFLICT contracts, not weakened assertions. All prior failures and intermediate greens remain unchanged.

The unchanged full-server coverage execution [original blocked run](../evidence/20261002T012718-0d37682dfc22/run.json) could not parse the existing cross-module test label `TC-018 and TC-027 address lookup returns only active owned purpose rows and safe fields`. Exit1/counts0 is not a product RED or passing full-server baseline; original logs/LCOV remain. DEF-003 stays unresolved for full-P3 completion/merge. APR-092 is narrow temporary Task-local continuation only; no coverage/Phase/formal/CI waiver. The complete Phase unit contract still awaits TASK-029's actual handler file, not a placeholder. TASK-028+ remains PENDING; no remote publication/CI/merge, formal acceptance/UAT or deployment occurred.

### Runtime and retained recovery points

EXT-128: owned socket-only MySQL26.7.0, skip_networking1, `/private/tmp/erp-inventory-p3-mysql-2670.h_0k7o89`, schema `erp_inventory_p3_7d2503e5757f`, mysqld58949, controller-held port65101 and unused owned Opening directory. APR-071/091 permit this local synthetic runtime and exact cleanup. Repeated runs reset only this owned schema; no shared/prod data or other worktree was changed. Exact schema absence, daemon exit0, socket/PID-file absence and released port were observed. Only the non-symlink owned root was removed after identity/owner/process checks, and root absence confirmed. Synthetic data is not recoverable; reports/tests, the unmerged worktree and P2 stash remain. Retired runtime evidence cannot be used as a current MERGE_READY lease.

EXT-127 resources were private socket-only MySQL26.7.0 (`@@skip_networking=1`), fresh `erp_inventory_p3_08d4cdc47765`, own PID55846, controller-held port62479 and an unused owned Opening directory. No migration/domain DB run occurred. Exact schema absence, own process exit0, socket/PID-file absence and port release were verified, then only owned non-symlink `/private/tmp/erp-inventory-p3-mysql-2670.d37p2q4a` was removed. No shared/prod or other worktree data was changed; synthetic runtime data is not recoverable, reports/tests are retained. Runtime is retired and cannot back current MERGE_READY evidence.

## Historical TASK-026 result

`TASK-026 DONE / INDEPENDENT_REVIEW_APPROVED` — Sam replied `已審閱，批准 TASK-026` on 2026-10-02 (Asia/Hong_Kong), approving exact local code checkpoint `0d4d0c2203edd3127bea0b06df99b8ef91c38c63` under HD-078 / APR-088 / REV-051. Only TASK-026 is complete; TASK-027～034 remain PENDING and are not authorized by this approval. This is not P3 completion, MERGE_READY, formal Technical Acceptance, UAT or release approval. No push, PR, remote CI, merge or deployment was performed.

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

Historical five-axis **SELF_REVIEW**, Codex /root: scoped correctness/negative tests, existing migration and error conventions, no external interface/transaction change, fixed-identifier DDL and parameterized data queries, strict runtime guards and required indexes. No unresolved critical/high finding identified by this self-review; it is not independent approval. Sam's PLAN approval was not a code review; TASK-026 remained IN_PROGRESS until the actual independent code approval recorded above. Local synthetic evidence/logs were inspected for credentials/business data; no external evidence export is authorized.

The 2026-10-02 closeout rechecked unchanged source/spec and all five retained reports, counts and artifact hashes without rerunning or relabeling historical evidence. The generic evidence checker reports the expected runtime-identity mismatch because the private runtime is cleaned; no old resource lease is fabricated and no current MERGE_READY claim is made. Sam's actual independent code approval completes this Task's local DoD. Next safe action is awaiting separate direction for TASK-027, not implementing it automatically.
