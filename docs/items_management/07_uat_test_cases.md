# Item Management UAT Test Specification

## Status and execution rule

All cases are `NOT_RUN`. Existing developer browser smoke is supporting evidence only and is not business acceptance. Browser cases prefer Playwright for reproducibility, while business Catalog/retention decisions require human sign-off.

| UAT ID | Requirements | Business objective / actor | Preconditions and data | Steps | Expected result / acceptance | Priority | Surface / automation | Result | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| UAT-001 | FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010 | Find and manage large Item/SKU lists / item viewer | Approved Catalog and mixed active/inactive/archived fixtures | Search by code/barcode/name; combine filters/sort/page; refresh/share URL; export current result; exercise empty/loading/error | Correct ranked, stable, permission-scoped results; state survives navigation; export matches visible criteria; recoverable states are clear | P1 | UI_BROWSER / PLAYWRIGHT_PREFERRED | NOT_RUN | — |
| UAT-002 | FR-011, FR-012, FR-013, FR-014, FR-015 | Understand a complete Item/SKU and its history / item viewer | Variant Item with typed values, UOMs, barcodes, media and audit | Open Item then each SKU, attributes/media/history and optional downstream summary | All current data and lifecycle status are understandable; audit shows actor/time/before/after/reason; no inventory calculation is invented | P0 | UI_BROWSER / PLAYWRIGHT_PREFERRED | NOT_RUN | — |
| UAT-003 | FR-016, FR-019, FR-020, FR-021, FR-022, FR-023, FR-024 | Create a Standard Item safely / item manager | Valid/invalid SKU, Catalog, UOM, barcode and price data | Create Draft; correct validation; copy; create directly Active; retry a repeated submission | Exactly one SKU; all-or-nothing persistence; actionable validation; no duplicate from retry; copied unique identifiers are controlled | P0 | UI_BROWSER / PLAYWRIGHT_PREFERRED | NOT_RUN | — |
| UAT-004 | FR-017, FR-018, FR-019, FR-021 | Create and extend a Variant Item / item manager | Variant attributes/options approved for a category | Generate combinations; remove some; create; then add a unique SKU to the existing Item; attempt duplicate/Standard additions | Only confirmed unique complete combinations exist; duplicate and Standard-limit attempts are rejected without partial data | P0 | UI_BROWSER / PLAYWRIGHT_PREFERRED | NOT_RUN | — |
| UAT-005 | FR-025, FR-026, FR-027, FR-028, FR-029, FR-030, FR-031 | Maintain Item/SKU without overwriting others or history / item manager | Two editors, referenced/unreferenced SKU, reason/password fixtures | Edit normal fields; create stale-version conflict; attempt SKU-code and reference-sensitive changes | Allowed changes are visible and audited; stale change does not overwrite; sensitive change requires approved auth/reason; referenced change is blocked | P0 | UI_BROWSER / PLAYWRIGHT_PREFERRED | NOT_RUN | — |
| UAT-006 | FR-032, FR-033, FR-034, FR-035, FR-036, FR-037, FR-038 | Apply lifecycle and deletion rules / item manager | Items/SKUs and Catalog in every status, with/without references | Activate/deactivate/discontinue/archive/restore; delete referenced and unreferenced data | Legal transitions cascade as specified; historical data remains; referenced deletion gives an actionable in-use result; no partial transition | P0 | UI_BROWSER / PLAYWRIGHT_PREFERRED | NOT_RUN | — |
| UAT-007 | FR-039, FR-040, FR-041, FR-042, FR-043 | Configure packaging and scan products / item manager and operations user | Piece/box/carton UOMs and primary/secondary GTINs | Add conversions, choose defaults, scan each barcode, try duplicates and invalid factors | Integer factors and default/base rules hold; each code finds one SKU; duplicates/invalid values are rejected clearly | P0 | UI_BROWSER / PLAYWRIGHT_PREFERRED | NOT_RUN | — |
| UAT-008 | FR-044, FR-045, FR-046, FR-047, FR-048, FR-049 | Maintain the agreed Item price reference / item manager | Multiple SKUs with different values | Enter/view/change/clear prices and inspect history/export | Values show HKD and tax-not-applicable consistently with four-decimal persistence; one SKU does not overwrite another; history is auditable | P1 | UI_BROWSER / PLAYWRIGHT_PREFERRED | NOT_RUN | — |
| UAT-009 | FR-050, FR-051, FR-052, FR-053, FR-054, FR-055, FR-056, FR-057, FR-058 | Safely maintain Items in bulk / item manager | Approved CSV template with create/update/warning/error/duplicate rows | Upload, review preflight, cancel; confirm corrected file with strong auth; monitor; download result/export; retry repeated action | Preflight changes nothing; whole confirmed batch succeeds or rolls back; row feedback is actionable; duplicate execution is prevented; file/report availability follows retention | P0 | UI_BROWSER / PLAYWRIGHT_PREFERRED | NOT_RUN | — |
| UAT-010 | FR-059, FR-060, FR-061, FR-062, FR-063, FR-064 | Investigate accountable change history / authorized auditor | Mixed UI/API/import/lifecycle changes and unauthorized user | Filter by target/action/actor/date; inspect sensitive actions; attempt unauthorized access | Complete immutable history answers who/when/what/reason/source without exposing secrets; unauthorized access is denied | P0 | UI_BROWSER / PLAYWRIGHT_PREFERRED | NOT_RUN | — |
| UAT-011 | FR-001, FR-011, FR-016, FR-025, FR-032, FR-050, FR-059 | Respect viewer/manager/no-access roles / three business users | Accounts with item.view, item.mgmt and neither | Execute representative read, write, import, audit and navigation actions | Viewer can read only; manager can perform approved actions; no-access user sees neither data nor restricted controls/routes | P0 | UI_BROWSER / PLAYWRIGHT_PREFERRED | NOT_RUN | — |
| UAT-012 | FR-006, FR-008, FR-010, FR-015, FR-016, FR-025, FR-050 | Operate accessibly under common failure states / business user | Keyboard-only session, slow/error API and unsaved edits | Navigate/edit/submit with keyboard; trigger validation/server error; refresh/back with dirty form | Focus and messages identify the problem; no silent data loss; loading/error/retry/navigation behavior is understandable | P1 | UI_BROWSER / PLAYWRIGHT_PREFERRED | NOT_RUN | — |
| UAT-013 | FR-014, FR-030, FR-034, FR-037, FR-038 | Preserve real downstream operations / Purchasing/Inventory/Sales owner | First real SKU consumer and historical transaction snapshots | Use an active SKU, then try incompatible master changes/archive/delete; inspect history | New operations obey current eligibility; destructive/incompatible action is blocked; historical snapshot remains meaningful | P0 | MANUAL_BUSINESS / MANUAL_REQUIRED | NOT_RUN | — |
| UAT-014 | FR-050, FR-059 | Approve initial Category/UOM/Attribute/internal Barcode samples / business and compliance owners | Proposed production sample catalogue and retention policy | Review semantics, duplicates, ownership and retention; sign or record changes | Initial master-data rules are explicitly approved; any change is traced to requirement/design/tests | P0 | MANUAL_BUSINESS / MANUAL_REQUIRED | NOT_RUN | — |
| UAT-015 | FR-001, FR-016, FR-025, FR-032, FR-050, FR-059 | Business release acceptance / business owner | Technical exit criteria satisfied in staging-like environment | Execute representative create→find→edit→lifecycle→audit→import journey and review known risks | Critical journey meets approved business outcomes; owner records PASS/FAIL and residual-risk decision | P0 | UI_BROWSER / PLAYWRIGHT_PREFERRED plus human sign-off | NOT_RUN | — |

`HD-001` (2026-09-11) retains the “add a unique SKU to the existing Item” step in `UAT-004`. It remains mandatory acceptance scope for `TASK-038` and is `NOT_RUN`, not waived.

## Non-UAT requirements

`NFR-001` through `NFR-015` and `SEC-001` through `SEC-009` are primarily technical/operational controls. Their UAT applicability is `N/A` except where users observe performance, accessibility, authorization, audit or recovery outcomes in UAT-001/002/010/011/012/015. Objective verification is assigned to TC-001, TC-002, TC-008, TC-009, TC-010, TC-011, TC-012 and TC-016.

## Entry and exit

Entry requires a pinned build/commit, target environment, approved fixtures/actors, completed P0/P1 technical preconditions, and defect triage. Exit requires every P0 business case executed with evidence, no unaccepted critical/high defect, and explicit business sign-off. Automated browser PASS never substitutes for human business acceptance.
<!-- HARNESS_V2_FORMAL_DEFINITIONS -->

# Appendix A — Harness 2.0 Formal UAT Definitions

All cases remain `NOT_RUN`. UI_BROWSER cases use Playwright when the missing project configuration is supplied; manual owner decisions cannot be replaced by automation.

## UAT-001 — Find and manage large Item/SKU lists / item viewer

### Business objective and actor
Find and manage large Item/SKU lists / item viewer

### Preconditions and data
Approved Catalog and mixed active/inactive/archived fixtures

### Steps
Search by code/barcode/name; combine filters/sort/page; refresh/share URL; export current result; exercise empty/loading/error

### Expected business result
Correct ranked, stable, permission-scoped results; state survives navigation; export matches visible criteria; recoverable states are clear

### Acceptance criteria
Required evidence is complete and baseline-bound; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-002 — Understand a complete Item/SKU and its history / item viewer

### Business objective and actor
Understand a complete Item/SKU and its history / item viewer

### Preconditions and data
Variant Item with typed values, UOMs, barcodes, media and audit

### Steps
Open Item then each SKU, attributes/media/history and optional downstream summary

### Expected business result
All current data and lifecycle status are understandable; audit shows actor/time/before/after/reason; no inventory calculation is invented

### Acceptance criteria
Required evidence is complete and baseline-bound; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-003 — Create a Standard Item safely / item manager

### Business objective and actor
Create a Standard Item safely / item manager

### Preconditions and data
Valid/invalid SKU, Catalog, UOM, barcode and price data

### Steps
Create Draft; correct validation; copy; create directly Active; retry a repeated submission

### Expected business result
Exactly one SKU; all-or-nothing persistence; actionable validation; no duplicate from retry; copied unique identifiers are controlled

### Acceptance criteria
Required evidence is complete and baseline-bound; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-004 — Create and extend a Variant Item / item manager

### Business objective and actor
Create and extend a Variant Item / item manager

### Preconditions and data
Variant attributes/options approved for a category

### Steps
Generate combinations; remove some; create; then add a unique SKU to the existing Item; attempt duplicate/Standard additions

### Expected business result
Only confirmed unique complete combinations exist; duplicate and Standard-limit attempts are rejected without partial data

### Acceptance criteria
Required evidence is complete and baseline-bound; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-005 — Maintain Item/SKU without overwriting others or history / item manager

### Business objective and actor
Maintain Item/SKU without overwriting others or history / item manager

### Preconditions and data
Two editors, referenced/unreferenced SKU, reason/password fixtures

### Steps
Edit normal fields; create stale-version conflict; attempt SKU-code and reference-sensitive changes

### Expected business result
Allowed changes are visible and audited; stale change does not overwrite; sensitive change requires approved auth/reason; referenced change is blocked

### Acceptance criteria
Required evidence is complete and baseline-bound; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-006 — Apply lifecycle and deletion rules / item manager

### Business objective and actor
Apply lifecycle and deletion rules / item manager

### Preconditions and data
Items/SKUs and Catalog in every status, with/without references

### Steps
Activate/deactivate/discontinue/archive/restore; delete referenced and unreferenced data

### Expected business result
Legal transitions cascade as specified; historical data remains; referenced deletion gives an actionable in-use result; no partial transition

### Acceptance criteria
Required evidence is complete and baseline-bound; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-007 — Configure packaging and scan products / item manager and operations user

### Business objective and actor
Configure packaging and scan products / item manager and operations user

### Preconditions and data
Piece/box/carton UOMs and primary/secondary GTINs

### Steps
Add conversions, choose defaults, scan each barcode, try duplicates and invalid factors

### Expected business result
Integer factors and default/base rules hold; each code finds one SKU; duplicates/invalid values are rejected clearly

### Acceptance criteria
Required evidence is complete and baseline-bound; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-008 — Maintain the agreed Item price reference / item manager

### Business objective and actor
Maintain the agreed Item price reference / item manager

### Preconditions and data
Multiple SKUs with different values

### Steps
Enter/view/change/clear prices and inspect history/export

### Expected business result
Values show HKD and tax-not-applicable consistently with four-decimal persistence; one SKU does not overwrite another; history is auditable

### Acceptance criteria
Required evidence is complete and baseline-bound; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-009 — Safely maintain Items in bulk / item manager

### Business objective and actor
Safely maintain Items in bulk / item manager

### Preconditions and data
Approved CSV template with create/update/warning/error/duplicate rows

### Steps
Upload, review preflight, cancel; confirm corrected file with strong auth; monitor; download result/export; retry repeated action

### Expected business result
Preflight changes nothing; whole confirmed batch succeeds or rolls back; row feedback is actionable; duplicate execution is prevented; file/report availability follows retention

### Acceptance criteria
Required evidence is complete and baseline-bound; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-010 — Investigate accountable change history / authorized auditor

### Business objective and actor
Investigate accountable change history / authorized auditor

### Preconditions and data
Mixed UI/API/import/lifecycle changes and unauthorized user

### Steps
Filter by target/action/actor/date; inspect sensitive actions; attempt unauthorized access

### Expected business result
Complete immutable history answers who/when/what/reason/source without exposing secrets; unauthorized access is denied

### Acceptance criteria
Required evidence is complete and baseline-bound; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-011 — Respect viewer/manager/no-access roles / three business users

### Business objective and actor
Respect viewer/manager/no-access roles / three business users

### Preconditions and data
Accounts with item.view, item.mgmt and neither

### Steps
Execute representative read, write, import, audit and navigation actions

### Expected business result
Viewer can read only; manager can read and perform approved actions without an additional item.view grant; no-access user sees neither data nor restricted controls/routes

### Acceptance criteria
Required evidence is complete and baseline-bound; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-012 — Operate accessibly under common failure states / business user

### Business objective and actor
Operate accessibly under common failure states / business user

### Preconditions and data
Keyboard-only session, slow/error API and unsaved edits

### Steps
Navigate/edit/submit with keyboard; trigger validation/server error; refresh/back with dirty form

### Expected business result
Focus and messages identify the problem; no silent data loss; loading/error/retry/navigation behavior is understandable

### Acceptance criteria
Required evidence is complete and baseline-bound; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-013 — Preserve real downstream operations / Purchasing/Inventory/Sales owner

### Business objective and actor
Preserve real downstream operations / Purchasing/Inventory/Sales owner

### Preconditions and data
First real SKU consumer and historical transaction snapshots

### Steps
Use an active SKU, then try incompatible master changes/archive/delete; inspect history

### Expected business result
New operations obey current eligibility; destructive/incompatible action is blocked; historical snapshot remains meaningful

### Acceptance criteria
Required evidence is complete and baseline-bound; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-014 — Approve initial Category/UOM/Attribute/internal Barcode samples / business and compliance owners

### Business objective and actor
Approve initial Category/UOM/Attribute/internal Barcode samples / business and compliance owners

### Preconditions and data
Proposed production sample catalogue and retention policy

### Steps
Review semantics, duplicates, ownership and retention; sign or record changes

### Expected business result
Initial master-data rules are explicitly approved; any change is traced to requirement/design/tests

### Acceptance criteria
Required evidence is complete and baseline-bound; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-015 — Business release acceptance / business owner

### Business objective and actor
Business release acceptance / business owner

### Preconditions and data
Technical exit criteria satisfied in staging-like environment

### Steps
Execute representative create→find→edit→lifecycle→audit→import journey and review known risks

### Expected business result
Critical journey meets approved business outcomes; owner records PASS/FAIL and residual-risk decision

### Acceptance criteria
Required evidence is complete and baseline-bound; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-016 — Accept measurable performance, security, retention and recovery outcomes / Product, Security, Operations and Compliance owners

### Business objective and actor
Accept measurable performance, security, retention and recovery outcomes / Product, Security, Operations and Compliance owners

### Preconditions and data
All mandatory technical suites complete on the release candidate; controlled staging-like recovery environment and reviewed evidence are available

### Steps
Review thresholds, role/abuse-path results, audit/redaction, retention, backup/restore timeline and residual risks; record explicit decisions

### Expected business result
Approved thresholds are met or a named owner records rejection/accepted residual risk; RTO <=4h and RPO <=15m have observed evidence

### Acceptance criteria
Required evidence is complete and baseline-bound; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.
