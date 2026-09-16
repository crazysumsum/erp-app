# Item Management Implementation Readiness

## Scope

`IMPLEMENT` is authorized by `ERP Product Owner (Sam)` in the active Codex task. This branch carries the aligned Item Management implementation through the current `TASK-044` developer candidate; it does not authorize release, formal Technical Acceptance, business UAT, deployment, or a CI/merge waiver.

## Baseline and isolation

- Default branch / observed remote baseline: `origin/main` at `e4aed631ce1d3eda34f4727a36d656462d7f0db4` (refreshed 2026-09-16).
- Topic branch / worktree: `codex/item-management-task-038` / `/private/tmp/erp-item-management-task-038`.
- Branch synchronization: merge commit `9f4d5c9ba8a790a26da8c3e74d2d7d466633dd15` incorporates that exact `origin/main` without conflicts.
- Runtime: developer checks use local isolated resources only. TASK-044 uses source `item_recovery_tc016_20260915`, restored target `item_recovery_tc016_20260915_run1`, and separate restored media/import roots; `erp_dev` is preserved and no production data or deployment action is in scope.

## Task readiness

`TASK-037` is implementation-complete: dependencies TASK-023/TASK-024 are recorded complete, Owner decision `HD-003` defines the public projection contract, and `REV-003` has reviewed the code. Server/client tests, lint, production client build, and browser validation passed. Owner-authorized local MySQL execution of TC-013 passed multi-row ordering and cross-owner option exclusion; `REV-004` confirmed that evidence.

`TASK-038` remains in implementation pending the Harness state reconciliation and merge gates. The new `POST /api/v1/skus/create` contract is idempotent, creates Draft SKU records atomically with audit, accepts only Variant Items, and relies on the existing database uniqueness guard for combinations. Current-candidate checks passed: local MySQL Item create/high-risk integration (49 tests), server suite (1,211 pass; 227 explicit DB skips), client suite (467 tests), lint, production client build and manager-only Playwright read/create flows. Independent review found no open P0/P1; CI and merge remain separate gates.

`TASK-039` and `TASK-040` have current developer implementation evidence. The Audit UI has unit, build and browser evidence. Referenced Brand/UOM deletion now maps MySQL FK failures to actionable `CATALOG_IN_USE` dependency details; focused service tests cover direct, wrapped and raced-away reference errors, and owner-authorized local MySQL TC-014 evidence confirms all existing local reference types plus rollback with no delete audit. `REV-007` found no remaining P0/P1/P2; CI and formal acceptance remain separate gates.

`TASK-041` is implementation-complete with developer evidence. Import execution now uses a connection-aware Item domain service rather than worker-owned aggregate SQL, re-authorizes the confirming actor, propagates the confirmed reason into per-aggregate audit, and commits aggregate/audit/completed state in one transaction. Failure status uses lease-owner fencing, including an observed two-worker takeover race where the stale worker returns `lost_lease` without changing the newer owner's completed result. Focused unit checks and all 21 true-MySQL import cases pass; the full server regression reports 1,448 tests: 1,447 pass, 0 fail and one explicit performance-suite skip. A separate bounded 10,000-row performance run also passes. `REV-008` records independent review; CI and formal acceptance remain separate gates.

`TASK-044` now has the fail-closed recovery adapter, CLI, unprovisioned repository trust policy, unit coverage and a real local-MySQL integration test. On candidate `be9244ef9f51b6b6775fe916e22d0bd141a93fc2`, lint and production client build pass; client tests report 57 files / 492 tests passed; recovery-focused tests report 10/10 passed; the complete server regression reports 1,497 total / 1,255 passed / 0 failed / 242 environment-gated skips; and the separately restored-schema MySQL recovery integration reports 1/1 passed. These are developer checks only. The retained manifest is still unsigned, the trust policy remains `UNPROVISIONED`, and formal `TC-016` has not run.

## Known limits

- Item-level Attribute write/update and arbitrary typed SKU Variant values remain outside TASK-037.
- TASK-042 documentation reconciliation is complete by maintainer decision: T23's index omission now matches its detailed implementation/Git evidence while retaining the original source hash and pre/post counts.
- TASK-043 remains dependency-blocked: refreshed `origin/main` contains no real downstream module that owns a reference to `item_skus`, so an honest provider/registry integration cannot yet be implemented. TASK-044 remains in progress only for independent signing, trust-policy approval, formal `TC-016`, CI and human sign-offs.
- `DEC-025` (Product Owner Sam, 2026-09-14): `item.mgmt` now explicitly grants complete Item Management API read/write access. Read policies accept `item.view` or `item.mgmt`; write policies remain `item.mgmt`. This resolves the earlier SKU-create page/read-projection conflict without a write-only alternate UX.
- The current candidate has developer self-test evidence and existing independent Item source review (`REV-013`); current CI, PR review and exact-baseline Product Owner approval remain required before formal verification or merge.
