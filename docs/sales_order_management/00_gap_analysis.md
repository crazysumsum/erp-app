# Sales Order Management Standards Gap Analysis

## 1. Gap Summary

| Gap | Severity | Type | Disposition |
| --- | --- | --- | --- |
| GAP-RQ-001 | MEDIUM | DOCUMENTATION_GAP | RESOLVED in aligned package |
| GAP-RQ-002 | HIGH | DOCUMENTATION_GAP | RESOLVED in aligned package |
| GAP-RQ-003 | HIGH | DOCUMENTATION_GAP | RESOLVED by user decision |
| GAP-DES-001 | MEDIUM | DOCUMENTATION_GAP | RESOLVED in aligned package |
| GAP-DES-002 | HIGH | IMPLEMENTATION_GAP | OPEN; Phase-entry blocker |
| GAP-DES-003 | HIGH | IMPLEMENTATION_GAP | OPEN; CSV enablement blocker |
| GAP-DES-004 | HIGH | UNKNOWN / CONTRACT_GAP | OPEN; owner review required |
| GAP-DES-005 | HIGH | IMPLEMENTATION_GAP | OPEN; command authorization blocker |
| GAP-DES-006 | MEDIUM | DOCUMENTATION_GAP | RESOLVED as conditional go-live boundary |
| GAP-TASK-001 | MEDIUM | DOCUMENTATION_GAP | RESOLVED by aliases |
| GAP-TASK-002 | HIGH | BASELINE_GAP | OPEN; rebase/replan before implementation |
| GAP-TC-001 | HIGH | DOCUMENTATION_GAP | RESOLVED by `06_technical_test_cases.md` |
| GAP-UAT-001 | MEDIUM | DOCUMENTATION_GAP | RESOLVED by `07_uat_test_cases.md` |
| GAP-TRC-001 | HIGH | DOCUMENTATION_GAP | RESOLVED by `08_traceability_matrix.md` |
| GAP-IMP-001 | HIGH | IMPLEMENTATION_GAP | OPEN; no Sales implementation exists |

### GAP-RQ-001 — Non-canonical Functional Requirement IDs

- Evidence: legacy IDs use domain forms such as `FR-QUOTE-001` and `FR-ARC-020`.
- Impact: the Harness validator and downstream artifacts cannot mechanically prove one-to-one coverage.
- Action: preserve legacy IDs and add one-to-one `FR-001` through `FR-140` aliases.

### GAP-RQ-002 — Security and resilience requirements are not independently numbered

- Evidence: the legacy requirement body embedded in `01_requirement_spec.md` sections 11 and 13.2–13.6 contains mandatory controls as prose.
- Impact: security, recovery, observability and accessibility obligations can silently disappear from design/tasks/tests.
- Action: add `SEC-001` through `SEC-015` and `NFR-009` through `NFR-016` canonical requirements without changing intent.

### GAP-RQ-003 — Missing measurable production RTO/RPO

- Evidence: backup/restore is required, but no recovery objectives were measurable.
- Impact: DR architecture and acceptance could not be objectively approved.
- Action: user approved `RTO <= 4 hours` and `RPO <= 15 minutes` on 2026-09-10; captured as `NFR-014` and `NFR-015`.

### GAP-DES-001 — No canonical Design IDs

- Evidence: the design uses `SAD-*` decisions and section references rather than `DES-*` items.
- Impact: Requirement → Design → Task/Test linkage is not deterministic.
- Action: add `DES-001` through `DES-020` as section-level aliases in `03_design_spec.md`.

### GAP-DES-002 — Required upstream providers are absent from the inspected baseline

- Evidence: current `main` has User and Item implementations but no Customer, Inventory or Fulfillment module/provider implementations; the design itself marks provider readiness as a hard gate.
- Impact: Sales confirmation, snapshots, ATP reservation, release and archive eligibility cannot be safely implemented.
- Action: keep affected Phase entry criteria `BLOCKED` until versioned contracts and owner-approved contract tests exist.

### GAP-DES-003 — 50 MB disk-stream upload mode is not implemented

- Evidence: current `uploadMiddleware.js` accumulates full file buffers before writing; Sales design requires an opt-in disk-stream path.
- Impact: enabling the planned 50 MB CSV route would create avoidable heap pressure and contradict the capacity design.
- Action: implement and prove bounded memory, abort cleanup, symlink defense and concurrency budgets before enabling Sales CSV.

### GAP-DES-004 — Cross-module atomic Inventory contract is proposed, not approved evidence

- Evidence: `reserveAvailableForSalesBatchInTransaction()` and the global lock order exist only in the design document.
- Impact: a weaker or differently ordered Inventory API could cause duplicate reservations, deadlocks or Sales/Inventory divergence.
- Action: Inventory owner/DBA review plus real-MySQL concurrency and commit-unknown tests are mandatory before Phase 2.

### GAP-DES-005 — Fresh actor checks are designed but not a general framework guarantee

- Evidence: current JWT permissions are claims; fresh actor checks exist in selected admin services, while Sales code does not yet exist. Design requires every Sales write and worker continuation to revalidate the initiating actor/service identity.
- Impact: revoked users could otherwise issue, confirm, cancel or bulk-import after authorization changed.
- Action: make fresh authorization part of each command transaction and test permission revocation after page/job initiation.

### GAP-DES-006 — Channel transport and address handoff intentionally deferred

- Evidence: design exposes only a JavaScript canonical contract and explicitly forbids a public Channel route until transport authentication and Fulfillment address delivery are selected.
- Impact: core intake planning is valid, but platform Adapter go-live is not ready.
- Action: keep Adapter transport/address work out of this implementation scope and require a later design gate.

### GAP-TASK-001 — Legacy Phase/Task naming

- Evidence: plan uses `Phase 0..4` and `P0-T01..P4-T14`.
- Impact: Harness hierarchy is semantically present but not mechanically traceable.
- Action: provide `PHASE-001..005` and `TASK-001..063` one-to-one aliases.

### GAP-TASK-002 — Planning baseline is behind current main

- Evidence: source branch is 13 commits behind inspected `main`; migrations on `main` now extend through `0024`.
- Impact: file lists, provider availability, migration numbers and integration assumptions may drift.
- Action: before implementation, integrate latest `main` into a dedicated Phase worktree, rediscover migration numbers, and rerun dependency/readiness review.

### GAP-TC-001 — UAT and technical acceptance are mixed

- Evidence: the legacy UAT body embedded in `07_uat_test_cases.md` combines browser/business cases with concurrency, performance, recovery and infrastructure evidence; there was no standalone `TC-*` specification.
- Impact: engineering acceptance could be confused with business sign-off.
- Action: create `06_technical_test_cases.md`; all cases remain `PLANNED`.

### GAP-UAT-001 — Strong UAT catalogue lacks canonical IDs

- Evidence: 129 planned cases use `AUTH/QUOTE/DRAFT/CONF/LIFE/CSV/CH/INQ/ARC/OPS-*` IDs.
- Impact: UAT is not mechanically linked to canonical FR IDs.
- Action: preserve every case and assign one-to-one `UAT-001..129` aliases.

### GAP-TRC-001 — No complete Harness matrix

- Evidence: legacy documents provide partial section/range matrices only.
- Impact: no single place proves Requirement → Design → Phase → Task → TC → UAT.
- Action: create `08_traceability_matrix.md` and run the deterministic validator plus semantic audit.

### GAP-IMP-001 — Sales module is not implemented

- Evidence: no Sales migrations, backend modules/handlers, frontend pages/services or Sales tests exist on inspected `main`.
- Impact: no requirement is implemented and no planned acceptance case can be marked PASS.
- Action: preserve as future `IMPLEMENT` work; do not create product code in this mode.

## 2. Scope Integrity

The review did not add tax, discount, approval workflow, multi-warehouse fulfillment, platform-specific transport, picking/shipping, invoicing, payment, return/refund or archive purge. These remain explicit non-goals. The only new requirement is the user-approved measurable DR target.

## 3. Harness 2.0 alignment outcome (2026-09-15)

| Gap | Status after this alignment | Evidence |
| --- | --- | --- |
| `GAP-RQ-001` Non-canonical FR IDs | `CLOSED` | 140 `## FR-001 — …` definitions with `Statement` / `Acceptance criteria` / `Failure behavior`; legacy identity retained in each Statement. |
| `GAP-RQ-002` NFR/SEC not independently numbered | `CLOSED` | 16 NFR and 15 SEC canonical definitions. |
| `GAP-DES-001` No canonical Design IDs | `CLOSED` | 20 `## DES-001 — …` definitions with `Decision` / `Rationale` / `Failure behavior`. |
| `GAP-TASK-001` Legacy Phase/Task naming | `CLOSED` | 5 PHASE and 63 TASK canonical definitions with the full required section set. |
| `GAP-TC-001` UAT and technical acceptance mixed | `CLOSED` | 60 TC definitions carry `mandatory` / `blocking` / `applicability` / `suite_id`; 129 UAT definitions carry `execution_surface` / `automation_suitability` separately. |
| `GAP-UAT-001` UAT catalogue lacks canonical IDs | `CLOSED` | 129 `## UAT-001 — …` definitions, one-to-one with the legacy cases. |
| `GAP-TRC-001` No complete Harness matrix | `CLOSED` | `08_traceability.json` ledger plus a generated `08_traceability_matrix.md`; `validate_traceability.py` returns `STRUCTURE_PASS`. |
| `GAP-RQ-003` Missing RTO/RPO | `CLOSED` (earlier) | `NFR-014` / `NFR-015`, user-approved 2026-09-10. |
| `GAP-DES-002`–`GAP-DES-006`, `GAP-TASK-002`, `GAP-IMP-001` | `OPEN` | These are implementation and provider-ownership gaps, not documentation gaps. They are tracked as `DEC-001`–`DEC-004` in `00_harness_state.json` and gate Phase entry. |

### GAP-DOC-001 — Automated UAT suite is declared but not configured

- Severity: `MEDIUM`
- Evidence: all 129 UAT entries are recorded as `execution_surface: UI_BROWSER`, `automation_suitability: MANUAL_REQUIRED`, `suite_id: null`. No `client/e2e/sales-order-management/**` suite exists and the project profile declares no UAT suite.
- Impact: UAT cannot be executed automatically today; business acceptance is manual by definition and is unaffected.
- Proposed action: when the Sales UI is implemented, add a Playwright suite to `00_project_profile.json` and switch the affected entries to `PLAYWRIGHT_PREFERRED` with that `suite_id`. Declaring a suite before it exists would be an unverifiable execution contract, so it was not done here.
- Human decision required: No.

