# Customer Management Aligned Development Plan

## 1. Execution Rules

- Status of every Phase and Task is `PLANNED`; this review implemented no product code.
- One Phase is one independently reviewable/testable merge checkpoint and one integration PR by default. Task IDs appear in atomic commits; separate PRs require documented ordering and compatibility.
- Each Phase starts from current `origin/main` in a dedicated worktree. If main moves before merge, integrate it in the Phase worktree and rerun the entire Phase gate.
- Physical migration numbers are allocated only after inspecting latest main. Applied migrations are never edited.
- A missing upstream provider, key ring, scanner, encrypted storage or approval is a `BLOCKED` dependency, not permission to add production fakes or duplicate another module's rules.
- Developer verification is not formal Technical Acceptance or UAT. Formal cases are referenced but remain `PLANNED`/`NOT_RUN` until `TEST_AND_VERIFY`.

## 2. Phase Summary

| Phase | Objective / checkpoint | Included tasks | Dependency | Integration impact | PR boundary | Status |
| --- | --- | --- | --- | --- | --- | --- |
| PHASE-001 Core Foundation | Deliver safe Draft Customer root, catalogs, party, credit, audit and basic APIs as a hidden/controlled capability. | TASK-001 (PHASE-001)..TASK-010 (PHASE-001) | User/Auth/DB framework; latest main | Adds permissions, tables, services and core APIs | `codex/customer-p1-core-foundation`; one Phase PR | `PLANNED` |
| PHASE-002 Lifecycle & User Experience | Deliver operable Customer CRUD, lifecycle, optional approval/settings and real-browser core journeys. | TASK-011 (PHASE-002)..TASK-019 (PHASE-002) | PHASE-001 | Adds menus/pages and approval/lifecycle endpoints | `codex/customer-p2-lifecycle-ui`; one Phase PR | `PLANNED` |
| PHASE-003 Sensitive Data & Bulk | Deliver banks, secure attachments, recovery, import/export and sensitive-role administration. | TASK-020 (PHASE-003)..TASK-028 (PHASE-003) | PHASE-002; DR-004 approval; keys/scanner/storage for release | Adds sensitive tables/routes/jobs and background work | `codex/customer-p3-sensitive-bulk`; one Phase PR | `PLANNED` |
| PHASE-004 Consumers & Release Evidence | Deliver purpose-specific downstream contracts, observability, capacity, DR and release evidence. | TASK-029 (PHASE-004)..TASK-036 (PHASE-004) | PHASE-003; real consumer providers | Touches consumer modules only where merged and approved | `codex/customer-p4-integration-release`; one Phase PR | `PLANNED` |

## 3. PHASE-001 — Core Foundation

### Phase Definition

- Objective: a buildable, migration-safe backend supporting Draft Customer, list/detail, address/contact/identifier/credit and atomic audit; activation and general user entry remain disabled until PHASE-002.
- Requirement scope: FR-001..FR-021, FR-026..FR-063, FR-094..FR-100; SEC-001..SEC-003, SEC-008..SEC-014; NFR-001..NFR-003, NFR-005..NFR-008, NFR-011..NFR-014.
- Design: DES-001..DES-009, DES-014, DES-018..DES-023, DES-025.
- Entry: latest main fetched; migration allocation recorded; User/Auth/DB framework tests green; shared-catalog ownership confirmed.
- Acceptance: fresh/upgrade migrations succeed and rerun; canonical uniqueness/default/CAS/audit invariants hold in real MySQL; core API and controlled UI-service contract are stable.
- Phase verification: TC-001..TC-010 and TC-012..TC-029 plus affected regression, lint, coverage and client build. No UAT is claimed.
- Rollback: additive/forward schema; disable routes/permissions and roll back only to schema-compatible app; data correction through audited forward changes.
- Exit: all Tasks done, no unresolved P0 defect, evidence reviewed, Phase PR reviewable and safely mergeable.

### Tasks

| Task | Goal / implementation approach | Requirement / design | Scope / files likely touched | Dependencies | Acceptance and required developer verification | Migration / rollback | Risk / Definition of Done |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TASK-001 (PHASE-001) | Reconcile latest main, logical migration order and provider inventory; publish readiness manifest. | NFR-006, NFR-011; DES-022, DES-025 | migration plan/tests, docs, provider registry manifest | None | No number collision; actual main evidence recorded; missing providers marked blocked. | No DDL yet. | `MEDIUM`; DoD = reviewed manifest and clean baseline. |
| TASK-002 (PHASE-001) | Add six Customer permissions and route-policy constants without implicit inheritance. | SEC-001..SEC-008; DES-015 | permission catalogue, seed migration, permission tests | TASK-001 (PHASE-001) | Catalogue/DB seed match; system-admin does not automatically gain bank access. | Forward seed; safe disable by route/menu. | `HIGH`; DoD = permission matrix tests pass. |
| TASK-003 (PHASE-001) | Implement canonical normalization/validation and binary-collated equality-key schema proof. | FR-002, FR-003, FR-018..FR-021, FR-028, FR-049; DES-003 | customer normalization/validation, schema migration, real-MySQL tests | TASK-001 (PHASE-001) | Unicode/case/space/punctuation vectors match service and DB; concurrent duplicates yield one winner. | Additive columns/tables; forward correction only. | `HIGH`; DoD = TC-004..TC-008 developer checks pass. |
| TASK-004 (PHASE-001) | Create shared Currency/Payment Term and Customer classification catalogs with one owner. | FR-004, FR-005, FR-022, FR-029; NFR-013; DES-002, DES-004 | business master/customer catalog services, migrations, handlers/tests | TASK-001 (PHASE-001) | HKD valid; inactive values preserved but cannot be newly assigned; no duplicate owner. | Shape compatibility guard; no destructive rollback. | `MEDIUM`; DoD = contract/migration tests pass. |
| TASK-005 (PHASE-001) | Create Customer root and append-only audit persistence, projection allowlists and stable errors. | FR-011..FR-033, FR-094..FR-100; DES-004, DES-007, DES-014, DES-021 | root/audit migrations, services/errors/projections/tests | TASK-002 (PHASE-001)..TASK-004 (PHASE-001) | Create/update/CAS/audit atomicity; no SQL/sensitive leakage; list/detail projections stable. | Additive; runtime audit DML privilege constrained. | `HIGH`; DoD = rollback and audit tests pass. |
| TASK-006 (PHASE-001) | Implement Draft Customer create/update/list/detail/duplicate APIs and domain idempotency outcome contract. | FR-001..FR-021, FR-026..FR-033; NFR-001, NFR-002, NFR-008; DES-006, DES-014, DES-019 | services, handlers/schemas, operation outcome, API tests | TASK-005 (PHASE-001) | All schemas reject extra fields; safe idempotent replay; exact/prefix pagination stable; activation stays unavailable until PHASE-002; 409/404 mappings. | No destructive data rollback. | `HIGH`; DoD = TC-010 and TC-012..TC-017 checks pass. |
| TASK-007 (PHASE-001) | Create address/contact/purpose persistence and atomic default switching. | FR-042..FR-048; DES-004, DES-008 | migrations, party service, handlers/tests | TASK-005 (PHASE-001) | Composite ownership, active-purpose rule and single default hold under race; IDOR safe. | Child tables additive. | `HIGH`; DoD = real-MySQL default/ownership tests pass. |
| TASK-008 (PHASE-001) | Create Identifier and Credit policy persistence/APIs preserving null/zero/hold semantics. | FR-049..FR-056; DES-003, DES-004, DES-009 | migrations, credit/party services, handlers/tests | TASK-003 (PHASE-001)..TASK-005 (PHASE-001) | Identifier unique race safe; credit clear/create CAS; no exposure calculation. | Additive; clear is audited business operation. | `HIGH`; DoD = TC-021..TC-025 checks pass. |
| TASK-009 (PHASE-001) | Implement reference-provider registry and minimum Customer lookup contracts for core use. | FR-034..FR-041, FR-047, FR-048; DES-005, DES-017, DES-020 | lookup/reference services, registry/readiness, tests | TASK-005 (PHASE-001)..TASK-008 (PHASE-001) | Unknown purpose/provider fails closed; new_sale Active-only; ownership validation safe. | Disable dependent commands if provider unavailable. | `HIGH`; DoD = readiness/lookup contract tests pass. |
| TASK-010 (PHASE-001) | Complete Phase integration, query-plan, regression and controlled capability gate. | All PHASE-001 scope; DES-018, DES-019, DES-023, DES-025 | integration/performance fixtures, metrics, Phase report | TASK-002 (PHASE-001)..TASK-009 (PHASE-001) | Fresh/upgrade DB, APIs, 100k representative query plans, coverage/lint/build and regressions pass. | Rehearse compatible app rollback. | `HIGH`; DoD = PHASE-001 evidence approved and PR ready. |

## 4. PHASE-002 — Lifecycle & User Experience

### Phase Definition

- Objective: users can create, maintain, activate, suspend, block, archive and approve Customers with clear accessible UI and atomic audit.
- Requirement scope: FR-001..FR-056, FR-071..FR-083, FR-094..FR-100; SEC-001..SEC-004, SEC-007..SEC-014; NFR-006..NFR-008, NFR-011, NFR-014.
- Design: DES-005..DES-010, DES-014..DES-017, DES-020, DES-021, DES-025.
- Entry: PHASE-001 merged and rebased to latest main; core provider ready.
- Acceptance: lifecycle and approval races preserve one legal outcome; UI passes unit/build and Playwright happy/error/permission/accessibility journeys.
- Phase verification: TC-030..TC-044 and UAT-ready evidence scaffolding; affected PHASE-001 P0 regression.
- PR/rollback: one Phase PR; routes/menu may be disabled without dropping data; approval rows remain history.
- Exit: Phase gate passes with no open P0/S1/S2 and all blocked dependencies explicit.
- Dependency-safe execution order begins TASK-012 (PHASE-002) -> TASK-013 (PHASE-002) -> TASK-011 (PHASE-002) -> TASK-014 (PHASE-002); numeric IDs identify work but do not override declared dependencies.

### Tasks

| Task | Goal / implementation approach | Requirement / design | Scope / files likely touched | Dependencies | Acceptance and required developer verification | Migration / rollback | Risk / Definition of Done |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TASK-011 (PHASE-002) | Implement activation and lifecycle commands, high-risk auth, reason and provider-backed delete/archive guards. | FR-022..FR-025, FR-034..FR-041; SEC-003, SEC-004, SEC-012; DES-005, DES-010, DES-015, DES-020 | CustomerService, lifecycle handlers/schemas/tests | TASK-009 (PHASE-001), TASK-012 (PHASE-002), TASK-013 (PHASE-002) | Approval OFF activates directly; ON uses the approval aggregate; exact state matrix, unblock/restore->Suspended, delete fail-closed and audit atomic. | No hard delete except qualified Draft. | `HIGH`; DoD = TC-011 and lifecycle/race tests pass. |
| TASK-012 (PHASE-002) | Add settings singleton and classification/settings administration. | FR-078..FR-083; SEC-007; DES-010, DES-014..DES-016 | migrations, settings/catalog handlers, pages/tests | PHASE-001 | Default OFF, CAS/reason/high-auth, non-retroactive effect, safe UI. | Forward setting seed; toggle reversible. | `MEDIUM`; DoD = settings contract/browser tests pass. |
| TASK-013 (PHASE-002) | Implement activation request schema/service and submit/withdraw/invalidate. | FR-023..FR-025, FR-071..FR-077; DES-006, DES-007, DES-010 | migration, approval service/handlers/tests | TASK-009 (PHASE-001), TASK-012 (PHASE-002) | Different eligible approver, immutable safe snapshot/hash, critical edit invalidates atomically. | Approval history retained. | `HIGH`; DoD = concurrency/idempotency checks pass. |
| TASK-014 (PHASE-002) | Implement approve/reject/reassign queue and block/unblock commands. | FR-071..FR-077; SEC-004, SEC-012; DES-010, DES-015 | approval handlers/services/queries/tests | TASK-011 (PHASE-002), TASK-013 (PHASE-002) | Only one decision; stale/self/wrong approver rejected; queue stable; block rules exact. | No history deletion. | `HIGH`; DoD = TC-034..TC-038 checks pass. |
| TASK-015 (PHASE-002) | Build Customer client services and stable error mapping. | FR-001..FR-083; NFR-011; DES-014, DES-016 | client services/error messages/tests | TASK-006 (PHASE-001)..TASK-014 (PHASE-002) | Version/idempotency/validation mappings preserve server meaning; abort stale requests. | Client rollback route-compatible. | `MEDIUM`; DoD = service tests pass. |
| TASK-016 (PHASE-002) | Build list/create/detail root UI using shared components and URL state. | FR-001..FR-033; DES-016, DES-018, DES-019 | customer pages/components/menu/tests | TASK-015 (PHASE-002) | Loading/empty/403/error, exact/prefix, Draft/activate, conflict/dirty-state accessible. | Menu can be disabled. | `MEDIUM`; DoD = unit/build and Playwright core flow pass. |
| TASK-017 (PHASE-002) | Build address/contact/identifier/credit editors and completeness UI. | FR-042..FR-056; DES-008, DES-009, DES-016 | feature components/pages/tests | TASK-015 (PHASE-002), TASK-016 (PHASE-002) | Multi-purpose/default, null/zero/hold, errors/focus/keyboard correct. | No data migration. | `MEDIUM`; DoD = component/browser cases pass. |
| TASK-018 (PHASE-002) | Build lifecycle, approval queue/detail and settings UI. | FR-034..FR-041, FR-071..FR-083; DES-005, DES-010, DES-016 | pages/dialogs/menu/tests | TASK-012 (PHASE-002)..TASK-017 (PHASE-002) | Legal actions only; clear impact/reason/re-auth; pending diff and setting scope visible. | Feature routes can be disabled. | `HIGH`; DoD = role and failure Playwright flows pass. |
| TASK-019 (PHASE-002) | Execute Phase developer gate and prepare formal test handoff. | All PHASE-002 scope; DES-023, DES-025 | integration/browser suites, Phase report | TASK-011 (PHASE-002)..TASK-018 (PHASE-002) | Lint/coverage/build, real MySQL, API, Playwright console/network/a11y and P0 regression pass. | Compatible rollback rehearsed. | `HIGH`; DoD = PHASE-002 PR ready; no formal acceptance claim. |

## 5. PHASE-003 — Sensitive Data & Bulk

### Phase Definition

- Objective: controlled users can manage encrypted Customer banks/files and reliable imports/exports without plaintext leakage or unrecoverable cross-store states.
- Requirement scope: FR-057..FR-070, FR-084..FR-100; SEC-001..SEC-014; NFR-004, NFR-006..NFR-015.
- Design: DES-006, DES-007, DES-011..DES-016, DES-021..DES-025.
- Entry: PHASE-002 merged; DR-004 approved by Security/Backend; test keys/scanner/encrypted storage available. Production capability remains disabled until production dependencies are ready.
- Acceptance: no plaintext leak, permission/delegation matrix safe, key rotation and file/import crash recovery deterministic, 10k-row target met.
- Phase verification: TC-045..TC-069 plus all sensitive P0 regression and real-browser evidence.
- PR/rollback: one Phase PR; revoke/disable sensitive routes and workers without decrypt-export or table deletion.
- Exit: Security/Operations review accepts evidence; unresolved production dependency remains explicit release blocker.

### Tasks

| Task | Goal / implementation approach | Requirement / design | Scope / files likely touched | Dependencies | Acceptance and required developer verification | Migration / rollback | Risk / Definition of Done |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TASK-020 (PHASE-003) | Implement and independently review protected-admin sensitive permission delegation. | SEC-005..SEC-007, SEC-012; DES-015 | adminGuard, role/user services, audit/tests | DR-004 human approval; TASK-002 (PHASE-001) | Delegation is narrower than route access, requires fresh protected role/device/password/reason and cannot be replayed/escalated by ordinary admin. | Revert guard while permissions remain unassigned. | `HIGH`; DoD = Security+Backend sign-off and tests. |
| TASK-021 (PHASE-003) | Add bank schema, crypto/masking/config and startup fail-closed checks. | FR-057..FR-063; SEC-005, SEC-006, SEC-010..SEC-012; DES-011 | migrations, sensitive services/config/tests | TASK-020 (PHASE-003) | AES-GCM/AAD/blind-index/default/duplicate constraints and no-plaintext scans pass. | Never remove key before zero-old-key proof. | `HIGH`; DoD = crypto/MySQL/security checks pass. |
| TASK-022 (PHASE-003) | Implement bank APIs, reveal/session, rotation/reindex and UI. | FR-057..FR-063; SEC-005, SEC-006, SEC-014; DES-006, DES-011, DES-014..DES-016 | handlers/services/scripts/client pages/tests | TASK-021 (PHASE-003) | Permission/re-auth/IDOR/default/duplicate/reveal timeout/audit and browser memory behavior pass. | Disable permissions/routes; retain ciphertext. | `HIGH`; DoD = TC-045..TC-052 checks pass. |
| TASK-023 (PHASE-003) | Add attachment schema, encrypted private storage pipeline and recovery state. | FR-064..FR-070; SEC-010, SEC-013; DES-012 | migration, file service/config/recovery job/tests | TASK-020 (PHASE-003) | Signature/scan/path/hash/finalize invariants; crash at every boundary converges; no orphan/duplicate. | Retain recoverable metadata/object; no direct delete. | `HIGH`; DoD = fault-injection checks pass. |
| TASK-024 (PHASE-003) | Implement attachment APIs/UI, sensitive download sessions and cleanup. | FR-064..FR-070; SEC-002, SEC-005, SEC-006, SEC-014; DES-012, DES-014..DES-016 | handlers/pages/components/jobs/tests | TASK-023 (PHASE-003) | General/sensitive role matrix, safe headers, audit-before-content, retry and Playwright flows pass. | Disable sensitive route; cleanup only proven orphan. | `HIGH`; DoD = TC-053..TC-058 checks pass. |
| TASK-025 (PHASE-003) | Add import job/row schema, streaming precheck and template. | FR-084..FR-087, FR-091..FR-093; DES-013 | migrations, parser/service/handlers/tests | PHASE-002 | RFC4180/UTF-8/header/size/row/sensitive field handling deterministic; precheck writes no Customer data. | Files/status recoverable. | `HIGH`; DoD = parser/security tests pass. |
| TASK-026 (PHASE-003) | Implement import confirm/worker/resume/result/purge and operation outcome. | FR-088..FR-093, FR-094..FR-100; DES-006, DES-007, DES-012, DES-013 | worker/jobs/services/handlers/tests | TASK-025 (PHASE-003) | Per-row aggregate+audit+terminal marker atomic; lease recovery no replay; result safe; file finalize recoverable. | Stop claims; do not replay applied rows. | `HIGH`; DoD = crash/commit-unknown tests pass. |
| TASK-027 (PHASE-003) | Implement bounded Customer export and import/export UI. | FR-084..FR-093; SEC-013, SEC-014; DES-013, DES-016, DES-019 | export job/APIs/pages/client/tests | TASK-025 (PHASE-003), TASK-026 (PHASE-003) | Filters/permissions/rows reconcile; no bank/file/credit notes; formula-safe; owner-safe expiry/download. | Rebuild result; retain audit. | `MEDIUM`; DoD = browser/API/export checks pass. |
| TASK-028 (PHASE-003) | Execute sensitive/bulk Phase gate, 10k target, rotation and recovery evidence. | All PHASE-003 scope; NFR-004, NFR-009, NFR-015; DES-023..DES-025 | integration/security/performance/recovery suites, runbooks/report | TASK-020 (PHASE-003)..TASK-027 (PHASE-003) | Lint/coverage/build, real MySQL, Playwright, no-secret scan, 10k<10m, rotation/recovery pass. | Sensitive capability disable/recovery rehearsed. | `HIGH`; DoD = Phase PR ready and reviewers sign evidence. |

## 6. PHASE-004 — Consumers & Release Evidence

### Phase Definition

- Objective: connect real consumers through purpose contracts and prove operational, security, performance and recovery readiness.
- Requirement scope: FR-001..FR-100; SEC-001..SEC-014; NFR-001..NFR-015; BR-001..BR-042; AC-001..AC-052.
- Design: DES-001..DES-025.
- Entry: PHASE-003 merged; each touched consumer/provider is merged on main and version-verified; production-like test environment exists.
- Acceptance: cross-module status/ownership/snapshot contracts pass; 100k/50-user performance and RTO/RPO restore meet thresholds; formal test handoff is complete.
- Phase verification: TC-070..TC-090 plus full regression. UAT remains for `TEST_AND_VERIFY` and business acceptance.
- PR/rollback: one Phase integration PR or explicitly ordered compatible PR set when different owners require it; each merge leaves existing modules operable.
- Exit: no unresolved blocking review finding/dependency, runbooks and evidence ready, status `READY_FOR_TESTING` only after implementation mode—not from this plan.

### Tasks

| Task | Goal / implementation approach | Requirement / design | Scope / files likely touched | Dependencies | Acceptance and required developer verification | Migration / rollback | Risk / Definition of Done |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TASK-029 (PHASE-004) | Version and implement Sales new-customer/status/default contracts. | FR-034, FR-042..FR-056; DES-017 | CustomerLookup plus merged Sales provider/consumer/tests | Real Sales contract | New sale Active-only, no order-time shipping address, current policy/default snapshot and submit revalidation. | Backward-compatible provider version. | `HIGH`; DoD = contract tests with real consumer pass. |
| TASK-030 (PHASE-004) | Version and implement Fulfillment existing-order address/contact contracts. | FR-034, FR-042..FR-049; DES-017 | CustomerLookup plus merged Fulfillment consumer/tests | Real Fulfillment contract | Non-Active status alone does not cancel existing order; address/contact must remain active/owned; snapshot exact. | Compatible provider version. | `HIGH`; DoD = positive/negative race tests pass. |
| TASK-031 (PHASE-004) | Implement Invoicing/AR/Returns/Refund purpose contracts only where real modules exist. | FR-034, FR-047..FR-063; DES-017 | named provider methods and actual consumers/tests | Actual merged module per task | Manual invoice Active-only; existing shipment/AR/return continues; refund bank active/owned/audited; no generic decrypt. | Each absent consumer remains blocked, not faked. | `HIGH`; DoD = per-consumer contract sign-off. |
| TASK-032 (PHASE-004) | Complete archive/delete/open-matter Provider registry and degraded-mode behavior. | FR-037..FR-041; NFR-010; DES-020 | provider registry/readiness/health/runbook/tests | TASK-029 (PHASE-004)..TASK-031 (PHASE-004) | Every mandatory provider READY; tri-state enforced; unknown blocks destructive action and is observable. | Disable delete/archive if registry degraded. | `HIGH`; DoD = outage tests and owner review pass. |
| TASK-033 (PHASE-004) | Complete observability, security scans and operational runbooks. | FR-094..FR-100; SEC-010..SEC-014; DES-021, DES-023 | structured events/metrics/alerts/runbooks/tests | TASK-028 (PHASE-003), TASK-032 (PHASE-004) | Useful low-cardinality signals, request/operation correlation, zero secret fixtures in logs/evidence. | Alert/config rollback documented. | `MEDIUM`; DoD = alert drills and redaction scans pass. |
| TASK-034 (PHASE-004) | Execute 100k Customer/50-user/query/lock capacity proof. | NFR-001..NFR-005, NFR-007; DES-018, DES-019, DES-023 | data generator/load tests/query tuning/report | TASK-029 (PHASE-004)..TASK-033 (PHASE-004) | p95/error/import targets met with reproducible environment and no invariant violations. | Focused index forward changes only. | `HIGH`; DoD = signed performance report. |
| TASK-035 (PHASE-004) | Execute backup/restore, key/file/audit reconciliation and RTO/RPO drill. | NFR-009, NFR-015; DES-024 | backup manifests, isolated restore, smoke/runbook/report | TASK-021 (PHASE-003)..TASK-033 (PHASE-004) | RPO<=15m, RTO<=4h; correct keys/files/audit/provider references; missing key fails closed. | No production restore or destructive purge. | `HIGH`; DoD = Operations/Security reviewed evidence. |
| TASK-036 (PHASE-004) | Complete regression, release-readiness and formal-test handoff. | All requirements; DES-001..DES-025 | full suites, traceability, release/handoff report | TASK-029 (PHASE-004)..TASK-035 (PHASE-004) | Lint/coverage/build, real MySQL, Playwright, security, performance, DR and regressions pass; known blockers explicit. | Approved safe revert/disable strategy. | `HIGH`; DoD = Phase PR ready and baseline declared for TEST_AND_VERIFY. |

## 7. Formal Coverage Manifest

Every canonical requirement appears in the Phase/Task mappings above and maps to formal acceptance in `06_technical_test_cases.md` and `07_uat_test_cases.md`:

- FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013, FR-014, FR-015, FR-016, FR-017, FR-018, FR-019, FR-020, FR-021, FR-022, FR-023, FR-024, FR-025, FR-026, FR-027, FR-028, FR-029, FR-030, FR-031, FR-032, FR-033, FR-034, FR-035, FR-036, FR-037, FR-038, FR-039, FR-040, FR-041, FR-042, FR-043, FR-044, FR-045, FR-046, FR-047, FR-048, FR-049, FR-050, FR-051, FR-052, FR-053, FR-054, FR-055, FR-056, FR-057, FR-058, FR-059, FR-060, FR-061, FR-062, FR-063, FR-064, FR-065, FR-066, FR-067, FR-068, FR-069, FR-070, FR-071, FR-072, FR-073, FR-074, FR-075, FR-076, FR-077, FR-078, FR-079, FR-080, FR-081, FR-082, FR-083, FR-084, FR-085, FR-086, FR-087, FR-088, FR-089, FR-090, FR-091, FR-092, FR-093, FR-094, FR-095, FR-096, FR-097, FR-098, FR-099, FR-100.
- NFR-001, NFR-002, NFR-003, NFR-004, NFR-005, NFR-006, NFR-007, NFR-008, NFR-009, NFR-010, NFR-011, NFR-012, NFR-013, NFR-014, NFR-015.
- SEC-001, SEC-002, SEC-003, SEC-004, SEC-005, SEC-006, SEC-007, SEC-008, SEC-009, SEC-010, SEC-011, SEC-012, SEC-013, SEC-014.

## 8. Shared Hotspots and Sequencing

- Serial ownership: permission catalogue/admin guard, application configuration, scheduler config, logging redaction, menu and client error map.
- Parallel only after contracts freeze: root/party/credit; approval/settings; bank/file; import/export; individual downstream consumers.
- Security-sensitive or migration changes receive independent review before downstream work begins.
- A Phase is never marked `DONE` from plans or mocks. It requires executed developer evidence in implementation mode and formal acceptance later in test mode.
