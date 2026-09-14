# Item Management Implementation Readiness

## Scope

`IMPLEMENT` is authorized by `ERP Product Owner (Sam)` in the active Codex task on 2026-09-14. This stacked branch carries `TASK-038` through `TASK-041` after its exact `TASK-037` parent; it does not authorize release, formal Technical Acceptance, business UAT, deployment, or a CI/merge waiver.

## Baseline and isolation

- Default branch / observed remote baseline: `origin/main` at `5ecc59968f660a0a76d8a481dfb23666752e1a1d`.
- Topic branch / worktree: `codex/item-management-task-038` / `/private/tmp/erp-item-management-task-038`.
- Approved stacked parent / merge order: `03f70112448b38ec5fe4f6782e87c3e69ace71cc` (`TASK-037`) → `TASK-038`; the parent must merge before this dependent branch.
- Runtime: developer checks use the existing local test configuration only. No schema migration, external service or production data action is in scope.

## Task readiness

`TASK-037` is implementation-complete: dependencies TASK-023/TASK-024 are recorded complete, Owner decision `HD-003` defines the public projection contract, and `REV-003` has reviewed the code. Server/client tests, lint, production client build, and browser validation passed. Owner-authorized local MySQL execution of TC-013 passed multi-row ordering and cross-owner option exclusion; `REV-004` confirmed that evidence.

`TASK-038` remains in implementation pending the Harness state reconciliation and merge gates. The new `POST /api/v1/skus/create` contract is idempotent, creates Draft SKU records atomically with audit, accepts only Variant Items, and relies on the existing database uniqueness guard for combinations. Current-candidate checks passed: local MySQL Item create/high-risk integration (49 tests), server suite (1,211 pass; 227 explicit DB skips), client suite (467 tests), lint, production client build and manager-only Playwright read/create flows. Independent review found no open P0/P1; CI and merge remain separate gates.

`TASK-039` and `TASK-040` have current developer implementation evidence. The Audit UI has unit, build and browser evidence. Referenced Brand/UOM deletion now maps MySQL FK failures to actionable `CATALOG_IN_USE` dependency details; focused service tests cover direct, wrapped and raced-away reference errors, and owner-authorized local MySQL TC-014 evidence confirms all existing local reference types plus rollback with no delete audit. `REV-007` found no remaining P0/P1/P2; CI and formal acceptance remain separate gates.

`TASK-041` is implementation-complete with developer evidence. Import execution now uses a connection-aware Item domain service rather than worker-owned aggregate SQL, re-authorizes the confirming actor, propagates the confirmed reason into per-aggregate audit, and commits aggregate/audit/completed state in one transaction. Failure status uses lease-owner fencing, including an observed two-worker takeover race where the stale worker returns `lost_lease` without changing the newer owner's completed result. Focused unit checks and all 21 true-MySQL import cases pass; the full server regression reports 1,448 tests: 1,447 pass, 0 fail and one explicit performance-suite skip. A separate bounded 10,000-row performance run also passes. `REV-008` records independent review; CI and formal acceptance remain separate gates.

## Known limits

- Item-level Attribute write/update and arbitrary typed SKU Variant values remain outside TASK-037.
- TASK-042 through TASK-044 remain pending under their own dependencies and gates. TASK-039 through TASK-041 have current developer implementation evidence and independent review, but still require CI and formal acceptance gates.
- `DEC-025` (Product Owner Sam, 2026-09-14): `item.mgmt` now explicitly grants complete Item Management API read/write access. Read policies accept `item.view` or `item.mgmt`; write policies remain `item.mgmt`. This resolves the earlier SKU-create page/read-projection conflict without a write-only alternate UX.
- A later merge candidate still requires developer self-test, current CI and required code review; none has been created.
