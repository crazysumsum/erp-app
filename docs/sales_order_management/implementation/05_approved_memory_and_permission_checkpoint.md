# Approved memory and permission checkpoint

Mode: IMPLEMENT, TASK-005/006 scoped continuation. Sam answered “核准” to the two concrete memory/migration decisions in the current chat. No partial Phase merge or local SQL execution was granted.

## Implemented decisions

The existing isolated actual-HTTP upload test now asserts sampled peak increases for the warmed 50 MiB request: heapUsed <=16 MiB, external <=32 MiB and RSS <=64 MiB. The 5 MiB measurement remains a baseline. Existing full hash, size, prefix/no-full-buffer and cleanup assertions remain. These are developer bounds for a single request, not instantaneous-peak proof, concurrent production capacity or formal TC-004 acceptance.

Migration `0067_seed_sales_permissions.js` preserves Inventory allocation 0063–0066. Latest main still has migration sources only through 0063. It idempotently seeds `sales.view`, `sales.mgmt`, `sales.import`, and grants no roles. The decision summary had accidentally omitted `sales.import`; original approved TASK-006 (05_development_tasks.md, Goal) and SALES_PERMISSIONS explicitly require all three, so the omission was disclosed and the original task followed. Existing `sales.operation` and its description remain unchanged and owned solely by Inventory migration 0063.

Permission catalogue, seed ownership conventions and a fake-connection migration check agree. The new check calls the seed twice, verifies exactly the planned permissions/descriptions and refuses any SQL other than permission lookup/insertion. No local database connection or migration execution occurs. The repository CI continues its established isolated MySQL workflow.

The consumed permission-catalogue pin is refreshed to actual source hash `e6363b8928b0f86d8c3ebba0a25695e9879dbb05d0bf9992fcdd175aa389cc0e`, labelled source-only. Inventory contract pin remains stale/unadopted; no provider integration or ownership approval is implied.

Current DESIGN `e9d632b185332a00ed4bd59c86ed73c25a4120a4f6a9affc27c3232b53b625c5`; PLAN `e93b9beea40f9c707cf5ea39b75293d79f5ecd461297c0ba4a55c58b55a614f3`. Historical approval hashes remain intact. New decisions apply only to the above scope; full design/risk/provider/Phase approval is not fabricated.

## Developer checks and independent review

Permission test observed RED before the seed existed and GREEN after implementation. Combined focused server-workspace regression: **240 passed, zero failures, zero skips**; lint and whitespace passed. The isolated memory test passed the fixed approved limits. Private logs: `/private/tmp/sales-permission-red.log`, `-green.log`, `/private/tmp/sales-approved-memory.log`, `-combined.log`, `-lint.log`; raw logs/key material are not exported.

Reviewer: Codex `/root/sales_readiness_review`, SEPARATE_AGENT, read-only. APPROVED delta against initial candidate `57b39c762a7af61838affdf75c5d8418af2bc8f6`, current DESIGN/PLAN above. No actionable findings. Independently ran permission conventions, startup guard, new seed and transfer tests from server cwd: **35 passed, zero failures/skips**. Reviewer measured 50 MiB sampled increases heap **8.54 MiB**, external **24.40 MiB**, RSS **20.53 MiB**, all within the approved bounds.

Previous PR #174 head 57b39c7 has five mandatory CI checks PASS (run 36694008122). Those observations remain historical and cannot satisfy the changed candidate. The new commit needs its own CI. Full Phase readiness and merge remain blocked by Inventory contract adoption, provider/baseline reconciliation and TASK-009..011. No formal acceptance/UAT or READY_FOR_TESTING claim.
