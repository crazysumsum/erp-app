# Supplier Management Gap Analysis

## Executive result

The legacy documentation had strong domain depth but did not meet the Harness artifact, traceability and ownership standards. The review resolved all specification-level critical conflicts without adding application code. Supplier implementation remains absent and is explicitly an `IMPLEMENTATION_GAP`, not a defect in deployed behavior.

## Findings and remediation

| ID | Severity | Finding | Evidence / impact | Resolution | Status |
| --- | --- | --- | --- | --- | --- |
| GAP-RQ-001 | CRITICAL | Requirement denied implicit system-admin bank access while design seeded all Supplier permissions to system-admin. | Ambiguous highest-privilege behavior could produce insecure or unimplementable role policy. | `HD-001`: requirement now grants bank permissions to protected system-admin, with identical reauth, masking, audit and alert controls. | RESOLVED |
| GAP-RQ-002 | HIGH | Currency／Payment Term ownership was split between Supplier and other modules. | Duplicate write APIs and migrations could create divergent reference data. | `HD-002`: Business Master is sole owner; Supplier only reads, validates and references. | RESOLVED |
| GAP-RQ-003 | MEDIUM | Functional IDs used family names instead of Harness canonical `FR-xxx`. | Mechanical end-to-end tracing was not possible. | Added stable one-to-one FR-001～FR-087 aliases without renumbering legacy IDs. | RESOLVED |
| GAP-RQ-004 | MEDIUM | Recovery objective was not measurable in Supplier scope. | Restore could be declared successful without timing/data-loss evidence. | Added project-approved `NFR-011` RTO≤4h／RPO≤15m and restore reconciliation evidence. | RESOLVED |
| GAP-DES-001 | CRITICAL | Fixed migrations `0010`～`0023` conflict with actual Item migrations through `0026`. | Applying the plan could collide with immutable migration ledger entries. | Replaced physical reservations with logical slices and latest-main allocation per Phase. | RESOLVED |
| GAP-DES-002 | HIGH | Supplier design included Currency／Payment Term schema, seeds and write APIs. | Violated shared ownership and would make downstream contracts inconsistent. | Replaced with transaction-aware Business Master provider dependency and readiness gate. | RESOLVED |
| GAP-DES-003 | HIGH | Downstream provider behavior was documented but lacked a canonical readiness gate. | Missing providers could be silently bypassed or return unsafe eligibility. | Provider registry/readiness is explicit; required unknown/unavailable state fails closed. | RESOLVED |
| GAP-DES-004 | HIGH | system-admin entitlement and sensitive-operation controls were conflated. | Highest privilege could be interpreted as bypassing reauth/audit. | Explicitly separated authorization from bank data protection controls. | RESOLVED |
| GAP-DES-005 | MEDIUM | Design lacked canonical `DES-*` IDs and full requirement manifest. | Tasks/tests could not reference stable design units. | Added DES-001～DES-025 and canonical coverage manifest. | RESOLVED |
| GAP-TASK-001 | HIGH | Legacy tasks had checkpoints but no strict one-Phase/one-PR lifecycle. | Independent verification and branch ownership were ambiguous. | Added PHASE-001～004, TASK-001～051 registry, Phase gates and worktree lifecycle. | RESOLVED |
| GAP-TASK-002 | CRITICAL | T01/T04/T27/T42 implemented stale migrations and Supplier-owned catalog writes. | Would reintroduce both critical design conflicts during coding. | Tasks now block on Business Master readiness and allocate migrations dynamically. | RESOLVED |
| GAP-TST-001 | MEDIUM | One mixed `test_case.md` combined technical and user acceptance concerns. | Business sign-off could be inferred from DB/security cases or vice versa. | Preserved 136 technical cases and added a separate 55-case UAT specification, including previously missing child-data, archive, approval, Bank lifecycle, list-state and Audit flows. | RESOLVED |
| GAP-TST-003 | CRITICAL | A single generic test suite could be satisfied by unrelated repository tests and the hand-written matrix could drift from the ledger. | False-positive acceptance evidence and unreviewable trace links. | Split technical, security, UI, performance, resilience, recovery, release and Playwright UAT suites; generated the matrix from the authoritative JSON ledger. Adapter scripts remain implementation work and cannot be claimed executable yet. | RESOLVED AS DESIGN / OPEN IMPLEMENTATION GAP |
| GAP-DEP-003 | HIGH | Purchasing consumes Supplier eligibility/defaults and must report supply history, but its current design does not yet pin the final transaction-aware `recordSupply` contract. | Runtime could lose supply history or perform a non-atomic side effect. | Supplier now defines preflight plus in-transaction reads and durable idempotent `recordSupply`; Purchasing must align and pin the final provider contract before PHASE-004 implementation. | OPEN DEPENDENCY GATE |
| GAP-TST-002 | HIGH | Highest-privilege bank access and DR objectives had no explicit tests. | Approved decisions lacked verification. | Added system-admin bank-control and RTO／RPO cases in technical and UAT specs. | RESOLVED |
| GAP-IMP-001 | HIGH | No Supplier application code or migrations currently exist. | None of the documented behavior is available for use. | Planned across four implementation Phase PRs; status remains PLANNED. | OPEN IMPLEMENTATION GAP |
| GAP-DEP-001 | HIGH | Business Master Currency／Payment Term provider may not yet be implemented. | Supplier Core cannot safely create or activate records. | PHASE-001 entry gate is BLOCKED until provider schema/API/readiness evidence exists. | OPEN DEPENDENCY GATE |
| GAP-DEP-002 | HIGH | Item and downstream reference/open-matter providers must match final implementation. | Supplier–SKU and lifecycle eligibility cannot be safely inferred. | Require purpose-specific provider contract tests; fail closed when required providers are unavailable. | OPEN DEPENDENCY GATE |
| GAP-SEC-001 | HIGH | Bank key manager, rotation owner and production secret access are deployment concerns. | Documentation cannot prove operational custody. | PHASE-003 requires independent Security review, secret-store evidence and restore/rotation exercise. | OPEN RELEASE GATE |
| GAP-LEGAL-001 | MEDIUM | Retention beyond seven years and legal hold depend on applicable policy. | Purge behavior cannot be finalized solely in Supplier design. | Seven-year minimum retained; purge remains blocked until Legal/Data owner confirms longer retention/legal hold rules. | OPEN RELEASE GATE |

## Scope discipline

No Supplier implementation, Migration, test execution, CI configuration or unrelated module document was changed. Future capabilities such as qualification documents, scorecards, contract pricing, payment execution and multi-company support remain out of scope.

## Alignment decision

The canonical specifications are suitable to enter implementation planning, subject to the open dependency and release gates above. “Aligned” means internally consistent and traceable; it does not mean implemented, tested or production-ready.
