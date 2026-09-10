# Customer Management Independent Design Review

## 1. Review Method

This review treats the design as an external proposal rather than defending its original choices. Perspectives used: Principal/Solution Architect, Security Architect, Database Architect, SRE/Operations, Senior Software Engineer and QA/Test Architect. Evidence comes from the preserved artifacts, aligned requirements/design, current main source structure and merged adjacent-module documents.

## 2. Architecture Summary

The proposal is a Customer bounded module inside the existing Node/Express/MySQL and Vue/Quasar modular monolith. Customer owns master data and lifecycle; shared platform services own authentication, permissions, transactions, idempotency, scheduler, files and crypto primitives. Consumers receive purpose-specific read/validation projections and preserve transaction snapshots. Sensitive bank/file capabilities are isolated and fail closed.

This is proportionate for a single-company SME ERP and avoids premature microservices or a generic Party framework.

## 3. Findings

| Finding | Severity | Related IDs | Evidence | Impact | Recommended action | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| DR-001 Canonical key collation contradicted normalization authority | `HIGH` | FR-018..021; DES-003 | Source inherited `utf8mb4_unicode_ci` for equality keys while saying explicit normalization is authoritative. | DB may collapse values beyond business rules. | Use `utf8mb4_bin` on canonical keys and real-MySQL Unicode vectors. | `RESOLVED` in aligned design. |
| DR-002 Attachment/import file finalize crash window | `HIGH` | FR-064..070, FR-084..093; DES-012, DES-013 | Metadata can commit before rename with no deterministic finalizer for stale `processing`. | Missing files, stuck records, duplicate retries and orphan storage. | Durable operation correlation, deterministic paths and recovery job with hash verification. | `RESOLVED` in aligned design/tasks/tests. |
| DR-003 Generic Customer status lookup could over-block existing obligations | `HIGH` | FR-034, FR-047..056; DES-017 | Source only names `new_sale/history/shipment`; merged AR needs distinct manual/existing-document semantics. | Suspended customer could wrongly block invoice/receipt/return, or inactive customer could enter a new sale. | Enforce an allowlisted purpose matrix and consumer contract tests. | `RESOLVED` in aligned design. |
| DR-004 Sensitive permission delegation alters a cross-system trust boundary | `HIGH` | SEC-004..007, SEC-012; DES-015 | Proposed `adminGuard` exception lets protected admin delegate permissions it does not itself hold. | A flaw could become privilege escalation into bank data. | Keep exception narrow; require current protected-admin role, device+password, reason, target allowlist, audit and independent Security/Backend review. | `OPEN`; blocks TASK-020 and PHASE-003 until approved. |
| DR-005 Framework idempotency alone does not resolve business outcome | `MEDIUM` | NFR-008; DES-006 | Source accepts keys but uses different reconciliation advice per command. | Commit-unknown can lead to new-key replay or operator uncertainty. | Bind durable resource/operation result and standardize safe outcome lookup. | `RESOLVED` in aligned design. |
| DR-006 Default partial-search implementation is not indexable as written | `MEDIUM` | FR-001..010; NFR-001..005; DES-018, DES-019 | Escaped `LIKE` does not specify prefix vs leading wildcard. | Unbounded scans can breach p95 at 100k Customers. | Default exact/token-prefix, inspect `EXPLAIN`; new requirement for arbitrary infix. | `RESOLVED` in aligned design. |
| DR-007 Future migration numbers are not reliable coordination | `MEDIUM` | DES-022 | Source reserves `0027..0041`; current main and parallel modules can move. | Migration collision or unsafe edit pressure. | Allocate physical numbers only after latest-main check; logical ordering remains stable. | `RESOLVED`. |
| DR-008 Reference checker registry has no readiness contract | `HIGH` | FR-037..041; DES-020 | Fail-closed behavior exists, but mandatory providers/version readiness were implicit. | Missing checker can either block forever or permit unsafe delete if misconfigured. | Versioned registry, startup readiness and tri-state results; delete requires all mandatory providers ready. | `RESOLVED` in design; provider implementation remains planned. |
| DR-009 Bank-sensitive file encryption at rest was implicit | `MEDIUM` | SEC-010; DES-012 | Private directory and encrypted backup do not necessarily encrypt live objects/temp files. | Storage/admin compromise could expose documents. | Require encrypted volume/object-store or application envelope encryption and protected temp storage; verify no plaintext artifacts. | `RESOLVED` in aligned design. |
| DR-010 Audit immutability relies primarily on application API absence | `MEDIUM` | FR-094..100; DES-021 | No update/delete route is good, but runtime/migration DB privileges are not separated in the source design. | Compromised runtime credentials could alter audit history. | Runtime least-privilege DB role; migration/emergency role separation; monitor privileged access and backup reconciliation. | `RESOLVED` in aligned design/tasks. |
| DR-011 Legal-hold and final retention policy are not approved | `MEDIUM` | NFR-009, NFR-015; OI-002 | Seven years is minimum; lawful purge/hold process is pending. | Premature deletion could violate obligations. | Ship no destructive purge; obtain Legal/Compliance decision before any retention automation. | `OPEN`; non-blocking for core, blocking for purge. |
| DR-012 Customer providers/consumers are not implemented on main | `HIGH` | DES-017, DES-020, DES-025 | Repository has User/Item frameworks but no Customer implementation; several consumers are also not authoritative. | Integration cannot be verified; production stubs risk duplicating rules. | Hard Phase entry gates; implement real contracts or leave dependent task blocked. | `RESOLVED IN PLAN`; implementation status `PLANNED`. |
| DR-013 Existing mixed test suite can be mistaken for executed acceptance | `HIGH` | All | Legacy test file has 157 `NOT RUN` cases plus QA recommendation. | Readers may conflate detailed design with evidence or business sign-off. | Separate `TC-*` planned specs and `UAT-*` not-run specs; keep execution reports separate. | `RESOLVED` in aligned package. |
| DR-014 No committed real-browser Customer acceptance baseline | `MEDIUM` | DES-016 | Current client has Vitest but Customer/Playwright suite is absent. | UI issues, console errors and network failures may escape static/unit review. | Add Playwright setup/journeys in implementation and enforce Phase UI gates. | `RESOLVED IN PLAN`; execution pending. |

## 4. Cross-Perspective Conclusions

### Architecture

The module boundary is coherent. Purpose-specific Provider methods are required; a generic `purpose` string without allowlist or a generic decrypt/write service would be rejected.

### Database

The schema is unusually detailed and uses appropriate constraints. The aligned binary-key collation, file-operation recovery state, runtime DB privilege separation and real-MySQL race evidence are mandatory corrections.

### Security

Bank and file controls are strong if keys, scanner, encrypted storage and fresh authorization are real. The only unresolved `HIGH` is the protected-admin permission delegation change; it changes a shared authorization boundary and must receive named Security and Backend approval before implementation.

### Operations

RTO/RPO is now measurable. Restore must include keys/files/audit, not only MySQL. Provider readiness and stuck-operation alerts are necessary for safe operation.

### Engineering and QA

Four vertical Phases can be delivered without knowingly broken intermediate states. Formal Technical Acceptance and business UAT remain future work; the package only defines their standards.

## 5. Human Design Gate

| Gate item | Result |
| --- | --- |
| Unresolved CRITICAL findings | 0 |
| Unresolved HIGH findings | DR-004 requires Security/Backend disposition before PHASE-001 implementation |
| Requirement ambiguity changing core architecture | None |
| Implementation dependencies | Customer not implemented; downstream Provider contracts must be verified at Phase entry |
| Major trade-off | Keep modular monolith and separate Customer aggregate; prioritize explicit purpose/security contracts over generic abstractions |
| Gate status | `CONDITIONAL` |

Proposed disposition: approve the documentation for development planning, but do not start TASK-020 or PHASE-003 until Security and Backend owners approve DR-004. All sensitive and downstream capabilities retain fail-closed Phase gates.
