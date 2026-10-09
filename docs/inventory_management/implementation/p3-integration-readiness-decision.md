# P3 integration readiness — HD136

Current P3 integration disposition: actual Sam HD136 A / APR184 authorizes preparation only. [Exact owner/integration candidate](p3-integration-contract-proposal.md) is PROPOSED_NOT_APPLIED; HD137 OPEN. Fresh main 9e9b0ff9ad87846a32036fc86138a834bdb5c82a /143main-only/10branch-only; two conflict proposals and additive Item pin. Current source/DESIGN/PLAN unchanged, TASK026–034 locallyDONE,348 original refs preserved. Candidate adds Salescompatibility/two capacity suites to20originals; no oldprobe/command/floor/gate changes. Structure/tempdryapplyPASS only; no product/newchecks/runtime/publication/P4/formal or capacity waiver. Earlier HD136 pending narrative remains historical context.

Read-only reconciliation is complete. TASK026–034 remain locally DONE on the independently approved source; P3 is not merge-ready. This is not a product-test failure, a new baseline adoption, or permission to publish.

## Observed baseline and blockers

The preserved dedicated branch is `codex/inventory-p3-operations`, HEAD `869ac07abdd3879254c351d857be911d71e68b6b`, source `0cbbea162a3e377df50214fd63b2484b0585d68a2be8dc52ee1615d8b013178c`, DESIGN `b1f4b54a95945c84d55e7828620b538830820dd140be2d15ef38b2695fb4abb4`, PLAN `6e27b339efb827ff8a2bb0c8ce82242f86c577f29bb4510b20884e854f456aac`.

Freshly fetched `origin/main` is `3b493095b9a979c3157c1f4fedf5b37944cdfcfb` ([latest merged PR192](https://github.com/crazysumsum/erp-app/pull/192)). The branch has10 unique commits and lacks141 main commits;53 candidate source/config/spec paths are dirty or untracked. GitHub reports no existing PR for this branch. No worktree or branch can be cleaned as merged.

Main contains changes requiring explicit Inventory/security baseline reconciliation:

- `InventoryReservationService.js` adds `reserveAvailableForSalesBackorderInTransaction`, using fixed `sales.backorderAllocate` service identity, NULL user, fresh registration callback and a locked `fr_job_leases` owner/DB-clock expiry check. Manual Sales reserve/release contract must remain unchanged; worker is reserve-only.
- `inventoryConstants.js` adds `SALES_BACKORDER_BATCH_RESERVE` and `SALES_BACKORDER_LINE_RESERVE`.
- Inventory design §5.7.2 labels DEC021 as an owner-adoption proposal, not Inventory approval or observed release. Already merged source does not authenticate owner approval.
- Shared dispatcher adds `authorizeRequest` preflight; shared idempotency adds optional `Retry-After` on202 replay. Root lockfile and CI also changed. Preserve both reviewed behaviors and required consumer regression; do not silently overwrite or improvise authentication/conflict semantics.

Exact local/main file pins and the complete observed generic gate are in [mechanical observations](p3-integration-readiness.json). The generic MERGE_READY result is BLOCKED: dirty candidate, absent exact-candidate five CI checks/PR review, and incompatible original nested report/retired-runtime conventions. The22 original current-source registered PASS reports remain valid local developer observations, covering all20 P3 phase developer suites plus two task-local suites; they are not relabelled as new-main or generic merge evidence. No fake live resource, moved report, rewritten argv or Harness bypass is acceptable.

The broad native diagnostic retains132 guarded skips. Customer import10k and Core Stock100k SKU/500k Bucket/2M Movement capacity wrappers represent four checks NOT_EXECUTED and unwaived. Capacity is not a separately registered P3 developer suite, but the full-command plan requires explicit evidence/disposition for guarded required checks. No capacity omission is silently considered PASS; any proposed scope deferral or gate change requires a separate exact human decision. Formal Technical/UAT remain NOT_RUN.

## Decision Required

Context: existing Sam review binds the unchanged old source/PLAN, not main's new owner API/security contract. P3 must integrate a fresh main before its planned single PR; P4 depends on P3 integration. A routine merge would otherwise adopt a material contract without Inventory owner disposition.

- A (recommended): prepare an exact P3/main integration and owner-contract candidate for Sam review, preserving approved P3 behavior, main's existing manual Sales contracts and reserve-only worker fencing. Include required DESIGN/PLAN/scope rebinding, minimal conflict-resolution proposal, truthful retired-runtime/native evidence verification and unchanged CI/capacity gates. Candidate preparation only: do not yet adopt canonical changes, merge/rebase, mutate product/shared/auth/DDL/profile, execute new checks, commit/push/PR/CI/merge or start P4. After the exact candidate is reviewed, request the necessary implementation/publication authority together.
- B: hold P3 unchanged while Sam resolves Inventory owner adoption of the Sales worker contract first. P3 publication and P4 remain blocked; preserve all work.

Trade-off: A lets the integration proceed with one concrete reviewed contract and visible compatibility risks rather than stale approval reuse. It requires fresh checks against the eventual new source/PLAN; green checks are not guaranteed. B avoids choosing the contract now but leaves the already-advanced main incompatible with this branch's approved baseline. Recommendation A; default hold until actual Sam answer.

No new product scope, role grant, Inventory DDL, worker release, shared scheduler activation or deployment is proposed. Final exact-head independent Sam review and all five current CI checks remain required before merge. This decision is not formal acceptance or a capacity/skip/threshold waiver.

Only refs were fetched and Git/GitHub/gate observations were read. Primary checkout, all dirty P3 work,348 evidence references, historical approvals/reports, source and canonical baselines remain unchanged. A temporary read-only collector initially used the wrong function keyword, stopped without state/command effects, and was corrected to the actual Harness signature; the observed gate remains BLOCKED. No result was converted to PASS.
