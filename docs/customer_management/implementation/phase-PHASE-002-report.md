# PHASE-002 — Developer Evidence Report

## Scope and status

- Candidate branch: `codex/customer-management-phase-002`.
- Product/test candidate commit: `67ad2cb276113c5efc504f4c3295e29b78bf4670`.
- Approved DESIGN and PLAN baselines: the exact hashes recorded in the Harness state
  after the PHASE-002 module-boundary inventory reconciliation.
- Scope: TASK-011 through TASK-019.
- This is developer verification only. It is not Technical Acceptance, UAT or a
  release claim.

## Delivered capability

PHASE-002 delivers Customer lifecycle and user experience on the PHASE-001 root,
party, identifier, credit and lookup contracts: approval/settings persistence,
activation requests and decisions, lifecycle/reference guards, client services,
Customer list/create/detail editing, approval work queue, prospective settings and
classification administration. Permission, password, approved-device, reason,
version and idempotency controls remain enforced by the server.

## TASK-019 developer gate

- The full serial server suite ran against fresh isolated MySQL schema
  `erp_customer_phase002_gate_20260922`: 1,917 passed, 0 failed and two explicitly
  excluded release-performance tests skipped. Coverage passed at 94.93% lines,
  83.95% branches and 91.82% functions; all 34 high-risk per-file floors passed.
- Fresh migrations applied through `0048`; a complete rerun skipped every migration.
  The exact schema was deleted after testing and final absence was confirmed.
- The first full run exposed missing required API descriptions on the four Customer
  classification handlers. The shared metadata fix and a regression assertion now
  allow complete application discovery/startup. A second run exposed only the
  pre-existing Item recovery test's documented `DB_ADMIN_*` setup requirement; with
  the authorized local admin parameters supplied, that test and the final full run
  passed without weakening any assertion or threshold.
- Client coverage passed 603/603 tests at 76.55% statements, 71.81% branches,
  71.06% functions and 78.57% lines. Repository ESLint and the production client
  build passed; the build retained only the existing >500 kB chunk advisory.
- Real-browser Playwright passed 10/10 Customer flows with no relevant unexpected
  console or network failure. It covers list/detail, Draft creation, keyboard address
  creation, role/conflict handling, stale approval, approver selection, reference
  blockers, reassign/withdraw, signed settings/catalog writes, and reachability of
  core actions at 375, 768, 1024 and 1440 pixel widths.
- Compatible rollback was rehearsed by starting the pre-PHASE-002 application commit
  `946f59820a8eeef2d6d0b0de17f59818aab9fd04` against the schema expanded through
  `0048`; `GET /api/v1/health` returned HTTP 200 with database status `connected`.
  The temporary detached worktree was removed.
- `git diff --check`, harness traceability validation and the Customer module-boundary
  check are required again on the exact publication candidate.

## Publication policy

The Product Owner explicitly directed this PR to be pushed and merged without CI and
accepted that risk. Local developer gates and independent exact-candidate review are
still mandatory and are not waived. Formal TEST_AND_VERIFY and UAT remain separate
from this IMPLEMENT phase.
