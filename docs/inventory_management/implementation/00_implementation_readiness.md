# Inventory Management Implementation Readiness

## Status

`PLANNED` — Sam approved the final exact MySQL Server 26.7.0 design/plan hashes. Product implementation remains paused until Sam separately confirms resumption of `IMPLEMENT`.

## Baseline

- Default / worktree baseline: `a264d41e402c0adc3caf05555034755f54e7abbf`
- Historical 0.3 design approval: `fabc75e34e1331570e6a276cabd7392ee598b1e992dc6e8b9402e638bab63273`
- Historical 0.3 plan approval: `8a647f900e8b21ba0cacb3361beb489aa30085cec1c2b8d6c043bf0e72e92bbf`
- Human authorization: Sam, active Codex task, 2026-09-23: `Inventory Management 切換到 IMPLEMENT`.

## Entry checks

- 0.4 design and plan approval: final hashes independently approved by Sam on 2026-09-23.
- P0 scope: `PHASE-001`; first task: `TASK-001` migration inventory and upstream-contract verification.
- Runtime observation: the local MySQL client/server binaries report 26.7.0, but no server is currently reachable. After `IMPLEMENT` resumes, allocate an isolated synthetic-data schema, web port and opening-file root, and assert the running server is exactly 26.7.0.
- CI blocker: `.github/workflows/ci.yml` still declares `mysql:8.0`; P0 must pin it to a reproducible 26.7.0 runtime before migration verification.

## Boundaries

- No migration execution, production access, deployment, CI merge, Technical Acceptance or UAT has occurred.
- Migration execution remains a separate explicit authorization.

## Next safe action

Obtain Sam's separate confirmation to resume `IMPLEMENT`; `TASK-001` will reconcile CI/local runtime to exact MySQL Server 26.7.0 without modifying existing migrations.
