# HD-009 — Resolve the P0 / Sales P4 Archive prerequisite cycle

Decision: **A1 APPROVED**, actual direct Sam selection in this chat on 2026-10-20. HD-008 A remains adopted; this supplement addresses a newly observed predecessor, not a request to reapprove that ownership direction.

## Concrete evidence

Approved Fulfillment design §4.17/§9.3 requires Archive mirrors with `archive_batch_id` FK to `sales_archive_batches` and Sales-owned order manifests. P0 TASK-010 includes those mirrors. Entry main `76223f4` has neither Sales table. Sales P4 cannot fully merge before its real Fulfillment provider/participant exists. Consequently, strict complete P0 first / complete P4 second leaves a schema dependency cycle; FK omission, production stubs or premature schema installation would violate the approved plan.

Sales' actual handoff is `docs/sales_order_management/implementation/112_hd008_fulfillment_p0_coordination.md` in its independent worktree, observed after source preservation `fdd93a50`. It retains genuine historical DEC-029 dual-owner approval and all old evidence; overlapping writes are paused. It proposes the narrow Sales-owned prerequisite contribution below. No copied source or migration execution has occurred here.

## Recommended supplement A1

Include only Sales' Archive batch/manifest foundation as a named **Sales-owned contribution in the complete Fulfillment P0 PR**. Retain the single complete P0 PR and P4's remaining complete PR; P4 consumes the merged P0 implementation afterward. Keep all existing module checks, native migration tests, independent review and exact-head CI requirements.

Concrete existing source: `server/database/migrations/0088_create_sales_archive_batches.js`, SHA256 `b6eeecb12fd08e3f4a6129c8448b1c9346c4f55ca73bda458653b93d7a410946` at Sales handoff. It creates only `sales_archive_batches` and `sales_archive_order_manifests`, with indexes/checks/FK and rerunnable structural inspection. Its helper imports from migrations0070 and0083 already exist on main. Sales retains data ownership and reviews the contribution. Copying this one reviewed file is a source contribution, not merging/cherry-picking the entire unreviewed P4 branch.

Scope supplement: that exact migration path, focused developer tests under existing Fulfillment integration-test paths, and necessary Sales coordination/contract documentation as an owner contribution. Keep 0089 Sales mirrors and0090 Sales Export persistence with Sales P4. Existing unmerged0091–0093 Fulfillment schema source remains preserved as reference; unique final allocation and withdrawal/replacement from the Sales P4 candidate must be agreed before new numbered files are created. No number is reserved by this proposal.

Execution order after approval:

1. Agree a single forward migration inventory with Sales and record old/new identity mapping; verify fresh main.
2. Finish TASK-001 and TASK-002/003 developer work; implement owner-reviewed provider extensions and pass Checkpoint0B.
3. Deliver the adopted two-table foundation before P0 mirror DDL in the isolated developer migration sequence, together with normal/rerun/partial/upgrade/native FK tests. Preserve old results as historical; new candidate evidence must actually run.
4. Complete every P0 Task and full Phase Gate before one P0 PR. Sales P4 then integrates the resulting main, removes duplicate fulfilled contributions from its candidate and completes all remaining original P4 checks/review/CI.

This changes which complete PR carries the minimal predecessor; it does not complete P4, enable the Archive scheduler or alter retention/quantity/acceptance rules. Provider ABI details remain owner-reviewed; live cutover remains separately gated.

## Alternative B

Create a joint complete P0+P4 candidate and satisfy both full Phase Gates before a combined merge. This avoids moving the two-table foundation separately but greatly enlarges the review, runtime validation and coupled delivery. It needs explicit coordinated merge-group approval and preserves both modules' requirements.

## Authority required

The user has authorized P0 implementation and HD-008 coordination, but this newly discovered prerequisite changes the prior P4/P0 delivery grouping. The Harness `SKILL.md` says “Major impact means ask a human before choosing”; implementation reference08 says “Do not silently change … Phase boundaries.” Therefore approval of this concrete supplement precedes source transfer or migration allocation. TASK-001 and dependent product work remain incomplete while the decision is pending. No earlier approval is erased.

## Actual approval and independent proposal review

Sam selected「A1：批准兩表基礎切片納入完整 P0 PR（建議）」after the concrete proposal was presented. Decision-time proposal SHA256 `babf2e13ff29f7f108b0473e8bafc8a44d571ab17143857eb38eeefdc60dcd95`. Independent R7 by `/root/fulfillment_independent_review`, method `SEPARATE_AGENT`, PASS on those exact bytes, 0 open CRITICAL/HIGH/MEDIUM; source0088 hash and main helper identities independently verified. R7 is not a fabricated human approval or native test. This actual human answer adopts the delivery supplement and its necessary scope; derived plan bindings must preserve the former baseline/history.

The coordinator sent the adopted direction and a proposed unique migration inventory to existing Sales chat. Exact inventory acknowledgement remains to be observed before new migration files/source transfer; schema execution still waits Checkpoint0B and separate runtime authority.

Derived current PLAN: `6a954bdfa3361e6e21a244c7ebb0109c512ec40230ffc4285fa8320d13ce88ed`; DESIGN remains `8618ff250af0b61d64f5beac528e529bb2224964f8986a02f4c4d8f6043c66ff`. APR-013/014/015 bind the actual A1 answer and preserved scope/NFR obligations; prior approvals stay historical.
