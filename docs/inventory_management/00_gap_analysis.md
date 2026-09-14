# Inventory Management Standards Gap Analysis

### GAP-RQ-001 — Numeric canonical requirement identities are absent
- Area: REQUIREMENT
- Severity: HIGH
- Type: DOCUMENTATION_GAP
- Evidence: the legacy requirement uses category IDs such as `FR-MASTER-001`; Harness 2.0 requires stable module-local `FR-001` style formal definitions.
- Impact: typed Requirement → Design → Phase → Task → Test relations cannot be validated.
- Proposed action: preserve every legacy ID and add a deterministic numeric alias crosswalk plus formal definitions.
- Human clarification required: NO
- Status: RESOLVED by the canonical requirement specification and ledger.

### GAP-DES-001 — Design decisions are narrative-only
- Area: DESIGN
- Severity: HIGH
- Type: DOCUMENTATION_GAP
- Evidence: architecture is detailed, but there are no formal `DES-*` definitions owned by a typed ledger.
- Impact: design coverage and downstream impact cannot be checked mechanically.
- Proposed action: add formal `DES-*` decisions without changing the legacy design meaning.
- Human clarification required: NO
- Status: RESOLVED by the canonical design specification and ledger.

### GAP-TASK-001 — Legacy Phase/Task IDs are not Harness 2.0 definitions
- Area: TASK
- Severity: HIGH
- Type: DOCUMENTATION_GAP
- Evidence: the plan uses `P0`, `P0-T01` and equivalent IDs.
- Impact: parent membership, dependency and inverse test links cannot be mechanically checked.
- Proposed action: preserve legacy IDs as aliases and add `PHASE-*` / `TASK-*` formal definitions.
- Human clarification required: NO
- Status: RESOLVED by the canonical plan and ledger.

### GAP-TC-001 — No standalone current technical-test specification
- Area: TECH_TEST
- Severity: HIGH
- Type: DOCUMENTATION_GAP
- Evidence: technical coverage is spread across design §§9–10 and task §5; only UAT has a standalone file.
- Impact: critical data-integrity, concurrency, authorization, recovery and contract cases lack typed execution contracts.
- Proposed action: create `06_technical_test_cases.md` with all cases `NOT_RUN`, mapped to observed project suites.
- Human clarification required: NO
- Status: RESOLVED structurally; execution remains outside this mode.

### GAP-UAT-001 — UAT cases lack canonical identities and executable-suite mapping
- Area: UAT
- Severity: HIGH
- Type: DOCUMENTATION_GAP
- Evidence: detailed legacy IDs such as `AUTH-001` and `POST-013` exist, but no `UAT-*` definitions or Playwright suite contract exists.
- Impact: business acceptance coverage cannot be validated or executed under the Harness 2.0 model.
- Proposed action: retain every legacy case, add canonical UAT aliases/definitions and classify browser versus manual execution.
- Human clarification required: NO
- Status: RESOLVED structurally; browser execution configuration remains OPEN.

### GAP-TR-001 — Traceability matrix is narrative rather than generated
- Area: TRACEABILITY
- Severity: HIGH
- Type: DOCUMENTATION_GAP
- Evidence: source documents contain hand-maintained summaries but no `08_traceability.json` authority.
- Impact: dangling, asymmetric or incomplete relationships can pass unnoticed.
- Proposed action: build the typed ledger and regenerate the matrix deterministically.
- Human clarification required: NO
- Status: RESOLVED when structural validation passes.

### GAP-RQ-002 — DEC-014 through DEC-019 required human confirmation
- Area: REQUIREMENT
- Severity: HIGH
- Type: UNKNOWN
- Evidence: the legacy `requirement.md` §18.1 labelled these BA baselines as requiring confirmation; the active-task owner response on 2026-09-14 approved all six decisions.
- Impact: transfer, stocktake, opening and segregation-of-duties behavior could materially change.
- Proposed action: preserve the confirmed disposition in the canonical requirement and design while keeping whole-spec approval separate.
- Human clarification required: YES
- Status: RESOLVED by `HD-002`; `DEC-014` through `DEC-019` are approved.

### GAP-DES-002 — Database compatibility baseline conflicted with observed CI
- Area: DESIGN
- Severity: HIGH
- Type: UNKNOWN
- Evidence: the legacy design stated MySQL 5.7 while `.github/workflows/ci.yml` runs MySQL 8.0; the active-task owner response on 2026-09-14 selected MySQL 8.0.
- Impact: generated columns, constraints, locking and migration behavior may differ; current CI cannot establish the stated target compatibility.
- Proposed action: align the canonical requirement, design, plan and executable environment probe to MySQL 8.0.
- Human clarification required: YES
- Status: RESOLVED by `HD-003`; canonical documents now use MySQL 8.0.

### GAP-DES-003 — Inventory product implementation is absent
- Area: DESIGN
- Severity: HIGH
- Type: IMPLEMENTATION_GAP
- Evidence: no Inventory module/handlers/pages/migrations/tests are present; only upstream Item lookup support exists, and the permission catalogue contains only user/device/item permissions.
- Impact: all inventory capabilities remain planned and unverified.
- Proposed action: retain the six planned phases; enter `IMPLEMENT` only after design/plan approval and independent review.
- Human clarification required: NO
- Status: OPEN.

### GAP-DES-004 — Idempotency actor-scope prerequisite remains observable
- Area: DESIGN
- Severity: HIGH
- Type: IMPLEMENTATION_GAP
- Evidence: `IdempotencyService.identityScope()` exists while the legacy design records the strong-auth scope defect as Phase 0 work.
- Impact: high-risk state-changing routes could share the wrong idempotency identity scope.
- Proposed action: keep the prerequisite in Phase 0 and require regression coverage before enabling Inventory writes.
- Human clarification required: NO
- Status: OPEN.

### GAP-UAT-002 — Independent reviewer and business acceptance are missing
- Area: UAT
- Severity: HIGH
- Type: DOCUMENTATION_GAP
- Evidence: the accountable owner was confirmed as `ERP Product Owner (Sam)` on 2026-09-14, but sign-off fields remain blank and no independent reviewer provenance is observable.
- Impact: local files cannot establish approval, implementation readiness, business acceptance or release permission.
- Proposed action: obtain a real independent review, then bind later whole-design, plan and business approvals to the current design/plan hashes.
- Human clarification required: YES
- Status: OPEN / BLOCKING.

### GAP-UAT-003 — Playwright Inventory UAT is not configured
- Area: UAT
- Severity: HIGH
- Type: IMPLEMENTATION_GAP
- Evidence: the repository has no Inventory pages or Inventory Playwright project/cases.
- Impact: browser journeys cannot be executed; static documentation cannot satisfy UI acceptance.
- Proposed action: create the approved Playwright suite during implementation and execute it only in `TEST_AND_VERIFY`.
- Human clarification required: NO
- Status: OPEN.
