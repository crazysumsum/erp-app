# Customer Management Harness Gap Analysis

## 1. Assessment Basis

This review compares the four preserved Customer Management documents with the software-engineering-harness standards, the implementation currently on `origin/main`, `docs/frontend-design.md`, and the merged Invoicing & Accounts Receivable contracts. Severity reflects delivery risk, not the writing quality of the legacy documents.

## 2. Requirement Gaps

### GAP-RQ-001 — Functional IDs are not harness-canonical

- Severity: `MEDIUM`
- Classification: `DOCUMENTATION_GAP`
- Evidence: requirements use category IDs such as `FR-LIST-001`; the harness validator recognizes `FR-001` format.
- Impact: automated end-to-end traceability cannot prove coverage even though the business requirements are detailed.
- Action: create a stable one-to-one canonical alias map `FR-001..FR-100`; never renumber or delete the existing IDs.
- Disposition: `RESOLVED` by `01_requirement_spec.md`.

### GAP-RQ-002 — Disaster-recovery objective was not measurable

- Severity: `HIGH`
- Classification: `DOCUMENTATION_GAP`
- Evidence: `NFR-009` requires backup/restore but gives no recovery time or acceptable data-loss window.
- Impact: architecture, backup frequency and release acceptance could not be objectively judged.
- Action: add `NFR-015`: production `RTO <= 4 hours`, `RPO <= 15 minutes` with an isolated restore and reconciliation exercise.
- Disposition: `RESOLVED — USER APPROVED 2026-09-10`.

### GAP-RQ-003 — “New transaction” and “existing obligation” status semantics need a single contract statement

- Severity: `HIGH`
- Classification: `DOCUMENTATION_GAP`
- Evidence: `BR-025` permits only Active customers for new sales/credit transactions, while `BR-026` says Suspended/Blocked/Archived must not break existing transactions. The requirement distributes this distinction across several integration sections.
- Impact: consumers could incorrectly block shipment, invoice, receipt, credit or return processing after a customer is suspended.
- Action: define purpose-specific policies: Active-only for a new sale/manual invoice; existing-order fulfillment, shipment invoicing, AR settlement and historical returns remain eligible subject to their own document and child-record rules.
- Disposition: `RESOLVED` as an `ENHANCED` clarification; no business intent changed.

### GAP-RQ-004 — Legal retention ownership remains external

- Severity: `MEDIUM`
- Classification: `UNKNOWN`
- Evidence: seven years is the stated minimum, while the source requires Legal/Compliance to confirm longer applicable periods and lawful deletion.
- Impact: automatic purge of master/audit/bank/file evidence would be unsafe before legal confirmation.
- Action: keep seven years as a non-decreasing baseline; implement no purge for these records until Legal/Compliance approves policy and legal-hold behavior.
- Disposition: `OPEN`; blocks destructive retention automation, not core development.

## 3. Design Gaps

### GAP-DES-001 — No stable `DES-*` decision identifiers

- Severity: `HIGH`
- Classification: `DOCUMENTATION_GAP`
- Evidence: the design has strong sections and decisions but no canonical design IDs.
- Impact: requirements, tasks and tests cannot form the required traceability chain.
- Action: create `DES-001..DES-025` in the aligned design entry and map every requirement family.
- Disposition: `RESOLVED`.

### GAP-DES-002 — Normalized-key collation does not match the stated source of truth

- Severity: `HIGH`
- Classification: `DOCUMENTATION_GAP`
- Evidence: the design says application normalization defines legal equality, but all text—including `*_key` columns—would inherit `utf8mb4_unicode_ci`, which can equate values beyond the explicit normalization algorithm.
- Impact: distinct legal names/codes may be rejected, or behavior may vary with database collation upgrades.
- Action: keep display/search text on project collation, but define all canonical equality keys as `utf8mb4_bin`; test Unicode, accents, punctuation and case at service and real-MySQL layers.
- Disposition: `RESOLVED` by `DES-003`.

### GAP-DES-003 — File upload has a crash window without deterministic finalization

- Severity: `HIGH`
- Classification: `DOCUMENTATION_GAP`
- Evidence: metadata/audit commit precedes atomic rename; a process crash between them leaves `processing` metadata and a temp object, while the documented cleanup only removes unreferenced orphans.
- Impact: valid uploads can remain permanently unavailable, retries can create duplicates and storage can leak.
- Action: preserve deterministic temp/final names, durable processing state and operation correlation; add a bounded recovery job that finalizes, marks `storage_error`, or safely expires each stale operation. Apply the same rule to import source/result files.
- Disposition: `RESOLVED` by `DES-012` and planned recovery tests.

### GAP-DES-004 — Consumer purpose policies are incomplete

- Severity: `HIGH`
- Classification: `DOCUMENTATION_GAP`
- Evidence: the design names `new_sale`, `history` and `shipment`, but merged AR design also needs `manual_invoice`, `invoice_existing_shipment` and `ar_existing_document`; Returns and refund paths have different eligibility.
- Impact: a generic lookup could either over-block legitimate existing obligations or allow new transactions for inactive customers.
- Action: introduce an allowlisted purpose policy matrix and named methods; unknown purpose fails closed. Consumer handlers remain responsible for their own permission.
- Disposition: `RESOLVED` by `DES-017`.

### GAP-DES-005 — Partial-search semantics and index proof are underspecified

- Severity: `MEDIUM`
- Classification: `DOCUMENTATION_GAP`
- Evidence: requirements allow partial search; design mentions escaped `LIKE` and indexes without saying prefix vs infix. Leading-wildcard matching cannot rely on B-tree indexes.
- Impact: 100,000-customer p95 target may be missed or users may receive inconsistent results.
- Action: define exact and normalized token-prefix search as the default bounded path; if arbitrary infix is later required, treat it as a new requirement with an indexed search design. Verify `EXPLAIN` and latency on representative child data.
- Disposition: `RESOLVED` by `DES-018`.

### GAP-DES-006 — Fixed provisional migration numbers are stale

- Severity: `MEDIUM`
- Classification: `DOCUMENTATION_GAP`
- Evidence: source design tentatively starts at `0027`, while main currently ends at `0024` and other designed modules may merge first.
- Impact: parallel branches can collide or developers may edit applied migrations.
- Action: retain logical migration IDs only; allocate physical numbers after fetching latest main at each Phase entry and never modify an applied migration.
- Disposition: `RESOLVED` by `DES-022`.

### GAP-DES-007 — Domain idempotency outcome lookup is not uniform

- Severity: `MEDIUM`
- Classification: `DOCUMENTATION_GAP`
- Evidence: multiple commands accept `Idempotency-Key`, but recovery guidance alternates between resource GET, audit and framework state without a common response/outcome contract.
- Impact: timeout or commit-unknown may cause unsafe manual retries, especially create, approval, upload and import confirmation.
- Action: bind actor+route+canonical payload hash, retain a durable resource/operation reference, and expose a safe operation outcome lookup or resource reconciliation rule per command.
- Disposition: `RESOLVED` by `DES-006` and `DES-013`.

### GAP-DES-008 — Archive/delete reference checks need registered-provider readiness

- Severity: `MEDIUM`
- Classification: `DOCUMENTATION_GAP`
- Evidence: `CustomerReferenceGuard` is fail-closed, but the required provider set and readiness evidence are not formalized.
- Impact: delete/archive may be permanently blocked, or a missing consumer checker may silently permit unsafe deletion.
- Action: declare provider registry version/readiness at startup; permanent delete requires every mandatory provider `READY` and `NO_REFERENCE`; archive/open-matter policy is purpose-specific and degraded providers return `UNKNOWN`/fail closed.
- Disposition: `RESOLVED` by `DES-020` and Phase gates.

## 4. Planning and Test Gaps

### GAP-TASK-001 — Plan lacks mandatory Phase/Task IDs

- Severity: `HIGH`
- Classification: `DOCUMENTATION_GAP`
- Evidence: source uses `CUS-CAP-*`, `T01..T49` and informal checkpoints.
- Impact: parentage, merge checkpoints and test traceability are not mechanically provable.
- Action: map work into four independently mergeable `PHASE-001..004` checkpoints with minimum executable `TASK-001..036` units.
- Disposition: `RESOLVED` by `tasks.md`.

### GAP-TASK-002 — PR guidance is task-centric rather than checkpoint-centric

- Severity: `MEDIUM`
- Classification: `DOCUMENTATION_GAP`
- Evidence: source recommends one Task per PR while also treating Phase/checkpoints as release gates.
- Impact: 49 small PRs increase migration/shared-file collision and make a coherent Phase hard to test or revert.
- Action: default to one Phase = one integration PR; atomic commits retain Task IDs. Split PRs only when ordered compatibility is documented.
- Disposition: `RESOLVED`.

### GAP-TASK-003 — Upstream provider readiness is not a hard entry gate everywhere

- Severity: `HIGH`
- Classification: `IMPLEMENTATION_GAP`
- Evidence: no Customer code exists on main; Sales/Fulfillment providers are not authoritative on main, while downstream tasks refer to them.
- Impact: teams may create production stubs or duplicate master-data rules to unblock development.
- Action: foundation can proceed, but each consumer integration remains `BLOCKED` until the provider/consumer contract is merged and version-verified. No production fake tables or duplicated rules.
- Disposition: `RESOLVED IN PLAN`; implementation remains `PLANNED`.

### GAP-TC-001 — Technical acceptance and UAT are mixed

- Severity: `HIGH`
- Classification: `DOCUMENTATION_GAP`
- Evidence: source `test_case.md` contains 157 cases across DB, security, UI, operations and business flows in one artifact.
- Impact: technical evidence can be confused with business acceptance, and no independent UAT sign-off boundary exists.
- Action: split into `06_technical_test_cases.md` (`TC-*`, `PLANNED`) and `07_uat_test_cases.md` (`UAT-*`, `NOT_RUN`).
- Disposition: `RESOLVED`.

### GAP-TC-002 — Existing tests do not reference canonical Design/Phase/Task IDs

- Severity: `HIGH`
- Classification: `DOCUMENTATION_GAP`
- Evidence: legacy case IDs map mainly to Requirement/BR/AC ranges.
- Impact: implementation and acceptance evidence cannot identify the design or task under test.
- Action: every aligned technical case cites Requirement, Design and Task IDs; every UAT cites confirmed business requirements.
- Disposition: `RESOLVED`.

### GAP-TC-003 — Browser acceptance tooling is not represented as a prerequisite

- Severity: `MEDIUM`
- Classification: `IMPLEMENTATION_GAP`
- Evidence: the current repository has client unit tests but no committed Customer Playwright suite; project rules require Playwright for UI validation.
- Impact: UI completion could be claimed without real-browser console/network/accessibility evidence.
- Action: add Playwright setup/customer journeys as Phase tasks and technical cases. If environment/startup/auth blocks it, record `BLOCKED`, never silently skip.
- Disposition: `RESOLVED IN PLAN`; execution remains `PLANNED`.

### GAP-UAT-001 — No dedicated business-user acceptance suite

- Severity: `HIGH`
- Classification: `DOCUMENTATION_GAP`
- Evidence: legacy test artifact has technically oriented cases and a QA recommendation, not an isolated business acceptance package.
- Impact: Product Owner, Sales, Fulfillment and Finance cannot independently accept the delivered outcomes.
- Action: produce role-based UAT flows with user-observable evidence only and preserve actual sign-off as `PENDING_USER_ACCEPTANCE` after execution.
- Disposition: `RESOLVED`.

## 5. Implementation Baseline Classification

| Area | Evidence | Classification | Planning consequence |
| --- | --- | --- | --- |
| Customer schema/backend/frontend | No Customer source or migration on main | `NOT_IMPLEMENTED — EXPECTED` | All implementation tasks remain `PLANNED`; not treated as a defect. |
| User/role/auth/idempotency/database/scheduler/upload framework | Implemented and tested on main | `IMPLEMENTED DEPENDENCY` | Reuse; verify contracts at each Phase entry. |
| Item Management | Implemented through migration `0024` | `IMPLEMENTED ADJACENT` | Do not alter except shared compatibility work explicitly required. |
| Sales/Fulfillment/Returns/Payment consumers | Not authoritative on main | `UNKNOWN / NOT IMPLEMENTED` | Consumer-specific tasks are blocked until actual merged contracts exist. |

## 6. Alignment Gate Summary

- Unresolved `CRITICAL`: 0.
- Material `HIGH` gaps: resolved in aligned documentation or converted to explicit implementation gates.
- Open business issue: no unresolved core business behavior; legal confirmation may only lengthen retention.
- Readiness: documentation package can be made `READY_FOR_PLANNING`; application implementation and all formal tests remain unexecuted.
