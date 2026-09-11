# Customer Management Aligned Requirement Specification

## 1. Normative Baseline

The complete aligned business requirement is [`requirement.md`](requirement.md). This entry provides canonical IDs, provenance, resolved clarifications and measurable gates for downstream design, planning and testing without rewriting the approved business intent.

If this entry and the source requirement appear inconsistent, the source requirement plus explicitly approved decisions govern; the discrepancy must be returned to requirement review rather than silently resolved in code.

## 2. Business Outcome and Scope

Customer Management is the single controlled source of company-customer identity, lifecycle, addresses, contacts, identifiers, commercial defaults, optional credit policy, bank accounts, attachments, approval settings, import/export and audit for a single-company wholesale ERP.

In scope and out of scope remain exactly those in `requirement.md` §2. In particular, this module does not own pricing, Sales Orders, Fulfillment, Returns, invoices, receivables, payments, refunds, exchange rates, customer groups, temporary shipping addresses, consumer CRM or multi-company isolation.

## 3. Canonical Functional Requirement Map

Each canonical ID maps one-to-one by position within its source family. Example: `FR-001 = FR-LIST-001`, `FR-011 = FR-VIEW-001`, and `FR-100 = FR-AUDIT-007`.

| Canonical IDs | Existing IDs | Source | Provenance |
| --- | --- | --- | --- |
| FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010 | FR-LIST-001～010 | `requirement.md` §8.1 | `EXISTING`; alias is `ENHANCED` |
| FR-011, FR-012, FR-013, FR-014, FR-015, FR-016 | FR-VIEW-001～006 | §8.2 | `EXISTING`; alias is `ENHANCED` |
| FR-017, FR-018, FR-019, FR-020, FR-021, FR-022, FR-023, FR-024, FR-025 | FR-CREATE-001～009 | §8.3 | `EXISTING`; alias is `ENHANCED` |
| FR-026, FR-027, FR-028, FR-029, FR-030, FR-031, FR-032, FR-033 | FR-EDIT-001～008 | §8.4 | `EXISTING`; alias is `ENHANCED` |
| FR-034, FR-035, FR-036, FR-037, FR-038, FR-039, FR-040, FR-041 | FR-STATUS-001～008 | §8.5 | `EXISTING`; alias is `ENHANCED` |
| FR-042, FR-043, FR-044, FR-045, FR-046, FR-047, FR-048, FR-049 | FR-PARTY-001～008 | §8.6 | `EXISTING`; alias is `ENHANCED` |
| FR-050, FR-051, FR-052, FR-053, FR-054, FR-055, FR-056 | FR-CREDIT-001～007 | §8.7 | `EXISTING`; alias is `ENHANCED` |
| FR-057, FR-058, FR-059, FR-060, FR-061, FR-062, FR-063 | FR-BANK-001～007 | §8.8 | `EXISTING`; alias is `ENHANCED` |
| FR-064, FR-065, FR-066, FR-067, FR-068, FR-069, FR-070 | FR-FILE-001～007 | §8.9 | `EXISTING`; alias is `ENHANCED` |
| FR-071, FR-072, FR-073, FR-074, FR-075, FR-076, FR-077 | FR-APPROVAL-001～007 | §8.10 | `EXISTING`; alias is `ENHANCED` |
| FR-078, FR-079, FR-080, FR-081, FR-082, FR-083 | FR-SET-001～006 | §8.11 | `EXISTING`; alias is `ENHANCED` |
| FR-084, FR-085, FR-086, FR-087, FR-088, FR-089, FR-090, FR-091, FR-092, FR-093 | FR-IMPORT-001～010 | §8.12 | `EXISTING`; alias is `ENHANCED` |
| FR-094, FR-095, FR-096, FR-097, FR-098, FR-099, FR-100 | FR-AUDIT-001～007 | §8.13 | `EXISTING`; alias is `ENHANCED` |

Priority, actor, validation, alternate behavior and acceptance meaning are inherited in full. A canonical alias never weakens a `Must` or turns a `Should` into out of scope.

## 4. Business Rules and Acceptance Criteria

- `BR-001..BR-042` and `AC-001..AC-052` remain normative without renumbering.
- `BR-025` means only creation/submission of a new sales or new credit-bearing transaction requires an Active Customer.
- `BR-026` means a later Suspended, Blocked or Archived status must not by itself prevent fulfillment of an already-confirmed order, invoicing of an already-shipped transaction, settlement/credit of an existing receivable, or a legitimate historical return. Each consumer must still validate its source document, ownership, current child record and its own permission.
- Customer master changes never rewrite confirmed transaction snapshots.

The preceding status clarification is `ENHANCED`: it consolidates existing intent from `BR-025`, `BR-026` and integration requirements and does not add a new business capability.

## 5. Security Requirements

`SEC-001, SEC-002, SEC-003, SEC-004, SEC-005, SEC-006, SEC-007, SEC-008, SEC-009, SEC-010, SEC-011, SEC-012, SEC-013, SEC-014` map one-to-one to `requirement.md` §11 and remain `EXISTING`.

They require backend authorization, no permission inheritance, non-self approval, sensitive-bank least privilege, owner-safe resource lookup, encryption and masking, fresh authorization for high-risk actions, injection/file protection and auditable bulk/sensitive access.

## 6. Non-Functional Requirements

| Canonical ID | Source / requirement | Measure | Provenance |
| --- | --- | --- | --- |
| NFR-001 | Existing NFR-001 | 50-user normal mixed load: standard list and exact code/name query p95 < 2 seconds. | `EXISTING` |
| NFR-002 | Existing NFR-002 | Server paging defaults to 20 and caps at 100. | `EXISTING` |
| NFR-003 | Existing NFR-003 | Validate 100,000 customers with stated child-cardinality baseline. | `EXISTING` |
| NFR-004 | Existing NFR-004 | 10,000-row CSV precheck plus execution < 10 minutes, excluding user wait. | `EXISTING` |
| NFR-005 | Existing NFR-005 | Address/contact lookup meets p95 target with zero cross-customer leakage. | `EXISTING` |
| NFR-006 | Existing NFR-006 | Domain data, children, status, settings and audit have consistent outcomes. | `EXISTING` |
| NFR-007 | Existing NFR-007 | Concurrent edit/default/approval never silently overwrites or violates invariants. | `EXISTING` |
| NFR-008 | Existing NFR-008 | Duplicate create/import/activation/approval/status requests do not duplicate effects. | `EXISTING` |
| NFR-009 | Existing NFR-009 | Master, settings, encrypted banks, files and audit are restorable as one coherent set. | `EXISTING` |
| NFR-010 | Existing NFR-010 | Non-essential dependency failure cannot expose data or relax eligibility. | `EXISTING` |
| NFR-011 | Existing NFR-011 | UI, CSV and interfaces use consistent fields, states, permissions and errors. | `EXISTING` |
| NFR-012 | Existing NFR-012 | Settings can add approved parameters without speculative behavior. | `EXISTING` |
| NFR-013 | Existing NFR-013 | Shared/central catalogs have a single owner and interpretation. | `EXISTING` |
| NFR-014 | Existing NFR-014 | Locale/time/amount/address presentation follows `APP_TIME_ZONE` and unambiguous exchange formats. | `EXISTING` |
| NFR-015 | New measurable DR requirement | Production `RTO <= 4 hours`, `RPO <= 15 minutes`; isolated restore must reconcile DB, key rings, general files, bank-sensitive files and audit before service is declared recovered. | `NEW — USER APPROVED 2026-09-10` |

## 7. Assumptions and Constraints

- `EXISTING`: single company, company customers, wholesale business and no row-level customer ownership isolation.
- `EXISTING`: MySQL 5.7, Node.js ES modules/Express handler conventions and Vue 3/Quasar frontend.
- `EXISTING`: account/customer identifiers are stable numeric IDs; display names, codes and bank values are never downstream foreign keys.
- `ENHANCED`: customer status eligibility is purpose-specific and unknown purposes fail closed.
- `ENHANCED`: destructive retention automation is disabled until Legal/Compliance confirms legal hold and any period longer than seven years.
- `ASSUMPTION`: exact deployment availability percentage is governed by the ERP platform SLO; this feature adds no separate active-active architecture.

## 8. Dependencies and Open Issues

| ID | Matter | Owner / deadline | Status |
| --- | --- | --- | --- |
| OI-001 | Customer production DR target: RTO<=4h, RPO<=15m. | Product Owner/Operations | `APPROVED 2026-09-10` |
| OI-002 | Confirm whether applicable law/contract requires retention longer than the seven-year baseline and define legal hold. | Legal/Compliance before purge release | `OPEN — NON-BLOCKING FOR CORE` |
| OI-003 | Confirm initial Currency, Payment Term, Category, Industry and Territory data. | Business/Finance before production activation | `OPEN — RELEASE DEPENDENCY` |
| OI-004 | Verify actual Sales, Fulfillment, Returns, AR and Payment provider contracts after their branches merge to main. | Module owners at Phase entry | `OPEN — IMPLEMENTATION DEPENDENCY` |
| OI-005 | Provision production key custody, malware scanner, private storage and backup ownership. | Security/Operations before sensitive capability release | `OPEN — RELEASE DEPENDENCY` |

## 9. Requirement Gate

Core business behavior is `READY_FOR_DESIGN_ALIGNMENT`. No unresolved issue changes Customer ownership, lifecycle, permissions, transaction semantics or the core acceptance criteria. OI-002..005 remain explicit Phase/release gates and must not be bypassed with production fakes.
