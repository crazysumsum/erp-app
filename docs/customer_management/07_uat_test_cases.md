# Customer Management User Acceptance Test Specification

## 1. Purpose and Boundary

These cases let business users judge whether Customer Management supports safe wholesale-customer work. They use observable pages, messages, exported files, history and downstream results—not direct database constraints, fault injection or lock inspection. Those belong to `06_technical_test_cases.md`.

All results are `NOT_RUN` and evidence is `—`. Executable results do not become business acceptance until an authorized business owner signs the relevant batch.

## 2. Roles and Baseline Data

- Viewer: `customer.view`.
- Customer Manager: `customer.view + customer.mgmt`.
- Approver: `customer.view + customer.approval`.
- Settings Manager: `customer.view + customer.settings`.
- Bank Viewer/Manager: explicit bank permissions in addition to required Customer permissions.
- Sales, Fulfillment, Finance/AR and Returns users: their own module permissions only.
- Baseline: unique/deduplicated Customers, all lifecycle states, multiple addresses/contacts/purposes, optional credit, general/bank-sensitive files and mixed-validity CSV. All names, contacts and bank values are synthetic.

## 3. Cases — Access, Search and Core Master Data

| ID | Priority / phase | Requirement | Business objective / actor | Preconditions / data | User steps | Expected business result / acceptance | Evidence | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| UAT-001 | P0/PHASE-002 | SEC-001 | Prevent unauthenticated access / signed-out user | Known Customer URL | Open URL | Login/denial shown; no Customer data appears | — | NOT_RUN |
| UAT-002 | P0/PHASE-002 | SEC-002, SEC-003 | Enforce Viewer vs Manager / Viewer | Existing Active Customer | View then try edit/direct URL | General data is visible; write is unavailable and rejected | — | NOT_RUN |
| UAT-003 | P0/PHASE-002 | SEC-004, SEC-007 | Separate approval/settings / Manager | Manager lacks both permissions | Open approval/settings URLs and attempt action | Both capabilities denied without altering data | — | NOT_RUN |
| UAT-004 | P0/PHASE-003 | SEC-005, SEC-006 | Separate bank view/manage / mixed roles | Customer with bank | List, reveal, edit as each role | Only exact role combinations can reveal/manage; masked view remains safe | — | NOT_RUN |
| UAT-005 | P0/PHASE-002 | SEC-008, SEC-009 | Prevent cross-Customer access / authorized user | Customer A/B child links | Replace IDs in visible URL/action | No other Customer detail or existence clue is disclosed | — | NOT_RUN |
| UAT-006 | P0/PHASE-004 | SEC-012 | Re-check revoked authority / any privileged role | Page open before permission removal | Administrator removes permission; submit without reload | Action is denied and no stale authority effect occurs | — | NOT_RUN |
| UAT-007 | P1/PHASE-002 | FR-001, FR-003, FR-006, FR-009 | Find Customer quickly / Viewer | Many Customers | Search exact/partial, sort/page, refresh/back | Exact Code first; filters/sort/page persist in URL; no duplicate/missing row | — | NOT_RUN |
| UAT-008 | P1/PHASE-002 | FR-004, FR-005 | Find operational/incomplete Customers / Viewer | Mixed status/default/credit data | Apply each filter/completeness option | Results match chosen criteria and Archived is excluded unless requested | — | NOT_RUN |
| UAT-009 | P1/PHASE-002 | FR-007, FR-010 | Understand list states / Viewer | Empty/loading/error/no-permission setups | Open list in each state | Each state is visibly distinct and actionable | — | NOT_RUN |
| UAT-010 | P0/PHASE-002 | FR-008, FR-011..FR-016 | View safe Customer detail / Viewer | Customer with all sections/bank/files | Open detail/history | Required general fields/status shown; sensitive values remain masked/restricted | — | NOT_RUN |
| UAT-011 | P1/PHASE-002 | FR-012, FR-013, FR-014, FR-015 | View role-appropriate details / authorized roles | Mixed data/history | Compare Viewer/Manager/Bank Viewer | Each sees only role-appropriate sections and useful history/links | — | NOT_RUN |
| UAT-012 | P1/PHASE-002 | FR-016 | Recognize inactive Customer / Viewer | Each lifecycle state | Open details | Clear text/icon states explain new-transaction restriction, not color alone | — | NOT_RUN |
| UAT-013 | P0/PHASE-002 | FR-017, FR-018, FR-022, FR-025 | Create a Draft / Customer Manager | Unique Code/name; active currency | Enter minimum fields; Save Draft | Draft created; Code/status/next step and history visible | — | NOT_RUN |
| UAT-014 | P0/PHASE-002 | FR-019, FR-020 | Prevent duplicate identities / Customer Manager | Existing Code and normalized Legal Name | Create/update variants | Hard error blocks save; no “continue anyway” option | — | NOT_RUN |
| UAT-015 | P2/PHASE-002 | FR-021 | Permit legitimate Trading Name duplicate / Customer Manager | Same Trading Name, different legal names | Create second Customer | Warning may appear but legal creation can continue | — | NOT_RUN |
| UAT-016 | P0/PHASE-002 | FR-023, FR-024 | Apply approval setting on activation / Manager | Setting OFF then ON | Activate new Customers | OFF becomes Active; ON requires a different eligible approver and becomes Pending | — | NOT_RUN |
| UAT-017 | P0/PHASE-002 | FR-026..FR-029, FR-031, FR-032 | Edit allowed fields safely / Manager | Existing referenced Customer | Edit name/defaults/classification/credit | Valid changes save with reason where required; history shows safe before/after; old transactions unchanged | — | NOT_RUN |
| UAT-018 | P0/PHASE-002 | FR-027 | Protect Customer Code / Manager | Existing Customer | Try normal edit then approved correction flow | Normal edit cannot change Code; high-risk flow requires required proof/reason | — | NOT_RUN |
| UAT-019 | P0/PHASE-002 | FR-030, FR-033 | Resolve concurrent edits / two Managers | Same version open in two browsers | A saves; B saves | B gets conflict/reload guidance and does not overwrite A; input remains recoverable | — | NOT_RUN |
| UAT-020 | P1/PHASE-002 | FR-094..FR-100 | Trace core changes / Viewer/Manager | Completed create/edit/status actions | Open/filter history | Actor/time/action/object/reason/request correlation visible with sensitive values masked | — | NOT_RUN |

## 4. Cases — Party, Credit, Lifecycle and Approval

| ID | Priority / phase | Requirement | Business objective / actor | Preconditions / data | User steps | Expected business result / acceptance | Evidence | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| UAT-021 | P1/PHASE-002 | FR-042, FR-043 | Maintain multiple addresses / Manager | Customer with address | Add/edit/sort/multi-purpose addresses | All valid addresses/purposes display correctly; one optional default per purpose | — | NOT_RUN |
| UAT-022 | P0/PHASE-002 | FR-046 | Switch default address safely / Manager | Two Shipping addresses | Set second as default | New default selected and old one cleared in one completed action | — | NOT_RUN |
| UAT-023 | P1/PHASE-002 | FR-044, FR-045 | Maintain multiple contacts / Manager | Customer with contacts | Add multi-purpose contacts and defaults | Multiple contacts per purpose allowed; only one default clearly marked | — | NOT_RUN |
| UAT-024 | P0/PHASE-002 | FR-047, FR-048 | Preserve transaction history / Manager + downstream Viewer | Confirmed transaction snapshot | Modify/deactivate selected address/contact | Existing transaction still shows old snapshot; new selection excludes invalid record | — | NOT_RUN |
| UAT-025 | P0/PHASE-002 | FR-049 | Prevent duplicate legal identifiers / Manager | Identifier exists under another Customer | Add normalized equivalent | Save is blocked without exposing unnecessary other-Customer data | — | NOT_RUN |
| UAT-026 | P1/PHASE-002 | FR-042..FR-049 | Show optional completeness / Manager | Customer missing party data | Activate/view completeness | Activation succeeds with non-blocking warnings; missing data is clearly identified | — | NOT_RUN |
| UAT-027 | P0/PHASE-002 | FR-050, FR-051, FR-052 | Distinguish credit states / Manager | No policy, zero, positive, Hold | Save/view each state | “Not configured”, zero and Hold are visibly distinct and not silently converted | — | NOT_RUN |
| UAT-028 | P0/PHASE-002 | FR-053, FR-054 | Validate and audit credit changes / Manager | Existing policy | Enter negative/missing currency then valid change with reason | Invalid blocked; valid saves exact amount/currency/status and history | — | NOT_RUN |
| UAT-029 | P0/PHASE-004 | FR-055, FR-056 | Keep exposure/override outside Customer / Sales/AR user | Different credit states | View/use policy downstream | Latest policy is shown; Customer page does not calculate AR/exposure or grant override | — | NOT_RUN |
| UAT-030 | P1/PHASE-004 | FR-050..FR-056 | Preserve old financial snapshots / Finance | Existing invoice/order then policy change | Compare old and new decisions | Historical figures/snapshots remain unchanged; new decision uses latest policy | — | NOT_RUN |
| UAT-031 | P0/PHASE-002 | FR-034, FR-035, FR-036 | Control new-business eligibility / Manager + Sales | Active Customer | Suspend/reactivate and try new sale | Suspended rejects new sale; valid reactivation restores eligibility; existing work remains visible | — | NOT_RUN |
| UAT-032 | P0/PHASE-002 | FR-035, FR-036 | Block/unblock with separation / Approver | Active/Suspended Customer | Block; attempt unauthorized unblock; authorized unblock | Required reason/re-auth; unauthorized denied; unblock returns Suspended | — | NOT_RUN |
| UAT-033 | P0/PHASE-002 | FR-037, FR-040, FR-041 | Archive/restore safely / Manager | Open and no-open-matter Customers | Archive both; restore valid one | Blockers shown safely; valid archive hidden from normal use; restore returns Suspended | — | NOT_RUN |
| UAT-034 | P0/PHASE-002 | FR-038, FR-039 | Restrict permanent delete / Manager | Pristine Draft and referenced/ever-active Customers | Delete each | Only pristine Draft deletes; others remain with appropriate lifecycle alternatives | — | NOT_RUN |
| UAT-035 | P0/PHASE-002 | FR-071, FR-072 | Submit to another approver / Manager | Approval ON; valid/invalid candidates | Submit with self/disabled/no-permission/valid user | Invalid choices blocked; valid request Pending and assigned correctly | — | NOT_RUN |
| UAT-036 | P0/PHASE-002 | FR-073, FR-074 | Make informed approval decision / Approver | Pending Customer with safe snapshot | Review then approve/reject | Snapshot/diff sufficient without bank overexposure; approve Active; reject Draft with reason | — | NOT_RUN |
| UAT-037 | P0/PHASE-002 | FR-075, FR-076 | Handle change/withdraw/reassign / authorized roles | Pending request | Critical edit, withdraw and reassign scenarios | Stale request cannot approve; requester can withdraw; valid reassign preserves history | — | NOT_RUN |
| UAT-038 | P0/PHASE-002 | FR-077, FR-080, FR-081 | Prevent duplicate decisions/settings overwrite / two users | Same request/setting open twice | Double-click/concurrent decisions and updates | One outcome; second user sees current result/conflict; no contradictory state | — | NOT_RUN |
| UAT-039 | P1/PHASE-002 | FR-078, FR-079, FR-082, FR-083 | Manage prospective settings / Settings Manager | Existing pending request | Toggle approval with reason | Clear impact; only new submissions affected; pending unchanged; history visible | — | NOT_RUN |

## 5. Cases — Bank, Files, Bulk and Audit

| ID | Priority / phase | Requirement | Business objective / actor | Preconditions / data | User steps | Expected business result / acceptance | Evidence | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| UAT-040 | P0/PHASE-003 | FR-057, FR-059, FR-060 | Maintain multiple banks/default / Bank Manager | Customer with two banks | Add/edit/set default/deactivate | Valid optional accounts maintained; at most one active default; no activation impact | — | NOT_RUN |
| UAT-041 | P0/PHASE-003 | FR-058, FR-062 | Reveal bank only when needed / Bank Viewer | Masked account | Reveal/re-auth/wait/leave/back | Full value only after active action, clears after timeout/navigation, and access appears in history | — | NOT_RUN |
| UAT-042 | P0/PHASE-003 | FR-061, FR-063 | Protect referenced/duplicate banks / Bank Manager | Referenced and duplicate accounts | Delete/deactivate/add duplicate | Referenced account only deactivates; same-Customer duplicate blocked; output remains masked | — | NOT_RUN |
| UAT-043 | P1/PHASE-003 | FR-064, FR-066, FR-069, FR-070 | Manage general attachments / Manager | Clean/invalid files | Upload/view/sort/deactivate/delete | Valid optional files work; invalid files rejected; referenced history protected | — | NOT_RUN |
| UAT-044 | P0/PHASE-003 | FR-065, FR-067, FR-068 | Protect Bank Sensitive files / mixed roles | General and bank-sensitive files | Compare list/preview/download/manage | General access follows Customer role; sensitive filename/content only exact bank roles; every attempt traceable | — | NOT_RUN |
| UAT-045 | P1/PHASE-003 | FR-084, FR-085, FR-086 | Prepare and precheck CSV / Manager | Versioned template; mixed rows | Download template, upload, precheck | No Customer is changed; row/field/stable errors and totals are understandable | — | NOT_RUN |
| UAT-046 | P0/PHASE-003 | FR-087, FR-088 | Apply partial-success import safely / Manager | Valid+invalid rows with children | Confirm and review result | Valid rows complete, invalid rows absent, each row all-or-none, totals reconcile | — | NOT_RUN |
| UAT-047 | P0/PHASE-003 | FR-089, FR-090 | Update/retry without duplicates / Manager | Existing customer and repeat request | Import update; refresh/retry confirm | Stable match/version rules apply; no duplicated Customer/child/approval | — | NOT_RUN |
| UAT-048 | P1/PHASE-003 | FR-091, FR-092, FR-093 | Operate background import/export / Manager | Large import and filtered Customer list | Track job; download result/export | Progress/recovery/expiry clear; export matches filters and omits sensitive/internal data | — | NOT_RUN |
| UAT-049 | P0/PHASE-003 | FR-094..FR-100 | Audit sensitive/bulk actions / authorized Viewer | Bank/file/import/export actions completed | Filter history by Customer/actor/action/date | Required attempts/results/correlation visible; no plaintext or file content | — | NOT_RUN |
| UAT-050 | P1/PHASE-003 | SEC-013, SEC-014 | Safe exported content / Manager | Cells beginning formula characters | Export and open in approved viewer | Values display as data, not formulas; export event/criteria traceable | — | NOT_RUN |

## 6. Cases — Downstream Business Flow and Usability

| ID | Priority / phase | Requirement | Business objective / actor | Preconditions / data | User steps | Expected business result / acceptance | Evidence | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| UAT-051 | P0/PHASE-004 | FR-034, FR-042, FR-047 | Create wholesale SO correctly / Sales | Active Customer with defaults | Select Customer and submit SO | Customer selectable; shipping address not required; valid defaults snapshot; status rechecked | — | NOT_RUN |
| UAT-052 | P0/PHASE-004 | FR-034, FR-047, FR-048 | Fulfill existing order safely / Fulfillment | Confirmed SO; Customer later Suspended; addresses mixed | Create/confirm shipment | Existing order can proceed, but only active owned Shipping address/contact can be selected; snapshot saved | — | NOT_RUN |
| UAT-053 | P0/PHASE-004 | FR-034, FR-050..FR-056 | Apply invoice/AR status distinction / Finance | Shipped source/existing invoice; Customer non-Active | Invoice shipped source, settle existing AR, try manual invoice | Existing obligations continue; new manual invoice follows Active-only rule | — | NOT_RUN |
| UAT-054 | P0/PHASE-004 | FR-057..FR-063 | Use bank for authorized refund / Finance | Existing refund source; active/inactive banks | Select bank and submit | Only active owned purpose-valid bank is usable; access is minimal and audited | — | NOT_RUN |
| UAT-055 | P1/PHASE-004 | FR-034, FR-047, FR-048 | Process legitimate historical return / Returns | Historical sale; Customer Archived | Start return from source | Customer status alone does not erase/block historical identity; source snapshot stays unchanged | — | NOT_RUN |
| UAT-056 | P1/PHASE-002 | FR-001..FR-100 | Complete keyboard workflows / all business roles | Running app | Perform assigned primary journey without mouse | All actions, dialogs, validation and focus recovery are usable by keyboard | — | NOT_RUN |
| UAT-057 | P1/PHASE-002 | NFR-014 | Use responsive, understandable UI / all roles | 375/768/1024/1440 screens | Complete list/detail/form/approval journeys | No blocking overflow; labels/headings/status/error are understandable and not color-only | — | NOT_RUN |
| UAT-058 | P1/PHASE-004 | NFR-001, NFR-004, NFR-005 | Complete daily work without excessive wait / operational users | Acceptance load environment | Search, lookup and observe 10k import | Observed flows meet agreed thresholds and remain usable during background work | — | NOT_RUN |


## 7. Cross-cutting control-owner acceptance

| ID | Priority / phase | Requirement | Business objective / actor | Preconditions / data | User steps | Expected business result / acceptance | Evidence | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| UAT-059 | P0/PHASE-004 | NFR-001..NFR-015; SEC-001..SEC-014 | Accept security, privacy, retention, resilience and recovery outcomes / Product, Security, Operations and Compliance owners | Technical Acceptance, performance, restore, redaction and authorization evidence tied to one candidate | Review measured thresholds, denied/allowed role evidence, PII/bank/file handling, retention/legal-hold status, recovery reconciliation and residual risks | Named owners accept or reject each applicable control; unresolved legal, key/storage/scanner, DR or security boundary keeps release blocked; automation alone is not acceptance | Signed baseline-bound decision and low-sensitive reports | NOT_RUN |

## 8. UAT Batches and Sign-off

| Batch | Scope | Entry evidence | Business signatories | Status |
| --- | --- | --- | --- | --- |
| UAT-B1 Core & Lifecycle | UAT-001..UAT-039 | PHASE-001/002 Technical Acceptance PASS | Product Owner, Sales Operations, Customer Data owner | NOT_RUN |
| UAT-B2 Sensitive & Bulk | UAT-040..UAT-050 | Security review plus PHASE-003 Technical Acceptance PASS | Customer Data owner, Finance, Security delegate | NOT_RUN |
| UAT-B3 Consumer & Release | UAT-051..UAT-058 plus P0 regression | PHASE-004 Technical Acceptance, performance and DR evidence | Product Owner, Sales, Warehouse, Finance, Operations | NOT_RUN |

Completion requires all P0 PASS, no open S1/S2, every P1 executed or documented owner/date/risk exception, and named business sign-off. Agent-executed browser steps alone remain `PENDING_USER_ACCEPTANCE` until that sign-off.

## 9. Coverage Manifest

Business acceptance covers FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013, FR-014, FR-015, FR-016, FR-017, FR-018, FR-019, FR-020, FR-021, FR-022, FR-023, FR-024, FR-025, FR-026, FR-027, FR-028, FR-029, FR-030, FR-031, FR-032, FR-033, FR-034, FR-035, FR-036, FR-037, FR-038, FR-039, FR-040, FR-041, FR-042, FR-043, FR-044, FR-045, FR-046, FR-047, FR-048, FR-049, FR-050, FR-051, FR-052, FR-053, FR-054, FR-055, FR-056, FR-057, FR-058, FR-059, FR-060, FR-061, FR-062, FR-063, FR-064, FR-065, FR-066, FR-067, FR-068, FR-069, FR-070, FR-071, FR-072, FR-073, FR-074, FR-075, FR-076, FR-077, FR-078, FR-079, FR-080, FR-081, FR-082, FR-083, FR-084, FR-085, FR-086, FR-087, FR-088, FR-089, FR-090, FR-091, FR-092, FR-093, FR-094, FR-095, FR-096, FR-097, FR-098, FR-099, FR-100.

User-observable security coverage includes SEC-001, SEC-002, SEC-003, SEC-004, SEC-005, SEC-006, SEC-007, SEC-008, SEC-009, SEC-012, SEC-013 and SEC-014. Encryption, runtime DB privilege, RPO/RTO and other purely technical controls are UAT `N/A` and remain covered by Technical Tests.

<!-- HARNESS_V2_FORMAL_DEFINITIONS -->

# Appendix A — Harness 2.0 Formal UAT Definitions

## UAT-001 — Prevent unauthenticated access / signed-out user

### Business objective and actor

Prevent unauthenticated access / signed-out user

### Preconditions and data

Known Customer URL

### Steps

Open URL

### Expected business result

Login/denial shown; no Customer data appears

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-002 — Enforce Viewer vs Manager / Viewer

### Business objective and actor

Enforce Viewer vs Manager / Viewer

### Preconditions and data

Existing Active Customer

### Steps

View then try edit/direct URL

### Expected business result

General data is visible; write is unavailable and rejected

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-003 — Separate approval/settings / Manager

### Business objective and actor

Separate approval/settings / Manager

### Preconditions and data

Manager lacks both permissions

### Steps

Open approval/settings URLs and attempt action

### Expected business result

Both capabilities denied without altering data

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-004 — Separate bank view/manage / mixed roles

### Business objective and actor

Separate bank view/manage / mixed roles

### Preconditions and data

Customer with bank

### Steps

List, reveal, edit as each role

### Expected business result

Only exact role combinations can reveal/manage; masked view remains safe

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-005 — Prevent cross-Customer access / authorized user

### Business objective and actor

Prevent cross-Customer access / authorized user

### Preconditions and data

Customer A/B child links

### Steps

Replace IDs in visible URL/action

### Expected business result

No other Customer detail or existence clue is disclosed

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-006 — Re-check revoked authority / any privileged role

### Business objective and actor

Re-check revoked authority / any privileged role

### Preconditions and data

Page open before permission removal

### Steps

Administrator removes permission; submit without reload

### Expected business result

Action is denied and no stale authority effect occurs

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-007 — Find Customer quickly / Viewer

### Business objective and actor

Find Customer quickly / Viewer

### Preconditions and data

Many Customers

### Steps

Search exact/partial, sort/page, refresh/back

### Expected business result

Exact Code first; filters/sort/page persist in URL; no duplicate/missing row

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-008 — Find operational/incomplete Customers / Viewer

### Business objective and actor

Find operational/incomplete Customers / Viewer

### Preconditions and data

Mixed status/default/credit data

### Steps

Apply each filter/completeness option

### Expected business result

Results match chosen criteria and Archived is excluded unless requested

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-009 — Understand list states / Viewer

### Business objective and actor

Understand list states / Viewer

### Preconditions and data

Empty/loading/error/no-permission setups

### Steps

Open list in each state

### Expected business result

Each state is visibly distinct and actionable

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-010 — View safe Customer detail / Viewer

### Business objective and actor

View safe Customer detail / Viewer

### Preconditions and data

Customer with all sections/bank/files

### Steps

Open detail/history

### Expected business result

Required general fields/status shown; sensitive values remain masked/restricted

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-011 — View role-appropriate details / authorized roles

### Business objective and actor

View role-appropriate details / authorized roles

### Preconditions and data

Mixed data/history

### Steps

Compare Viewer/Manager/Bank Viewer

### Expected business result

Each sees only role-appropriate sections and useful history/links

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-012 — Recognize inactive Customer / Viewer

### Business objective and actor

Recognize inactive Customer / Viewer

### Preconditions and data

Each lifecycle state

### Steps

Open details

### Expected business result

Clear text/icon states explain new-transaction restriction, not color alone

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-013 — Create a Draft / Customer Manager

### Business objective and actor

Create a Draft / Customer Manager

### Preconditions and data

Unique Code/name; active currency

### Steps

Enter minimum fields; Save Draft

### Expected business result

Draft created; Code/status/next step and history visible

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-014 — Prevent duplicate identities / Customer Manager

### Business objective and actor

Prevent duplicate identities / Customer Manager

### Preconditions and data

Existing Code and normalized Legal Name

### Steps

Create/update variants

### Expected business result

Hard error blocks save; no “continue anyway” option

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-015 — Permit legitimate Trading Name duplicate / Customer Manager

### Business objective and actor

Permit legitimate Trading Name duplicate / Customer Manager

### Preconditions and data

Same Trading Name, different legal names

### Steps

Create second Customer

### Expected business result

Warning may appear but legal creation can continue

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-016 — Apply approval setting on activation / Manager

### Business objective and actor

Apply approval setting on activation / Manager

### Preconditions and data

Setting OFF then ON

### Steps

Activate new Customers

### Expected business result

OFF becomes Active; ON requires a different eligible approver and becomes Pending

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-017 — Edit allowed fields safely / Manager

### Business objective and actor

Edit allowed fields safely / Manager

### Preconditions and data

Existing referenced Customer

### Steps

Edit name/defaults/classification/credit

### Expected business result

Valid changes save with reason where required; history shows safe before/after; old transactions unchanged

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-018 — Protect Customer Code / Manager

### Business objective and actor

Protect Customer Code / Manager

### Preconditions and data

Existing Customer

### Steps

Try normal edit then approved correction flow

### Expected business result

Normal edit cannot change Code; high-risk flow requires required proof/reason

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-019 — Resolve concurrent edits / two Managers

### Business objective and actor

Resolve concurrent edits / two Managers

### Preconditions and data

Same version open in two browsers

### Steps

A saves; B saves

### Expected business result

B gets conflict/reload guidance and does not overwrite A; input remains recoverable

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-020 — Trace core changes / Viewer/Manager

### Business objective and actor

Trace core changes / Viewer/Manager

### Preconditions and data

Completed create/edit/status actions

### Steps

Open/filter history

### Expected business result

Actor/time/action/object/reason/request correlation visible with sensitive values masked

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-021 — Maintain multiple addresses / Manager

### Business objective and actor

Maintain multiple addresses / Manager

### Preconditions and data

Customer with address

### Steps

Add/edit/sort/multi-purpose addresses

### Expected business result

All valid addresses/purposes display correctly; one optional default per purpose

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-022 — Switch default address safely / Manager

### Business objective and actor

Switch default address safely / Manager

### Preconditions and data

Two Shipping addresses

### Steps

Set second as default

### Expected business result

New default selected and old one cleared in one completed action

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-023 — Maintain multiple contacts / Manager

### Business objective and actor

Maintain multiple contacts / Manager

### Preconditions and data

Customer with contacts

### Steps

Add multi-purpose contacts and defaults

### Expected business result

Multiple contacts per purpose allowed; only one default clearly marked

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-024 — Preserve transaction history / Manager + downstream Viewer

### Business objective and actor

Preserve transaction history / Manager + downstream Viewer

### Preconditions and data

Confirmed transaction snapshot

### Steps

Modify/deactivate selected address/contact

### Expected business result

Existing transaction still shows old snapshot; new selection excludes invalid record

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-025 — Prevent duplicate legal identifiers / Manager

### Business objective and actor

Prevent duplicate legal identifiers / Manager

### Preconditions and data

Identifier exists under another Customer

### Steps

Add normalized equivalent

### Expected business result

Save is blocked without exposing unnecessary other-Customer data

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-026 — Show optional completeness / Manager

### Business objective and actor

Show optional completeness / Manager

### Preconditions and data

Customer missing party data

### Steps

Activate/view completeness

### Expected business result

Activation succeeds with non-blocking warnings; missing data is clearly identified

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-027 — Distinguish credit states / Manager

### Business objective and actor

Distinguish credit states / Manager

### Preconditions and data

No policy, zero, positive, Hold

### Steps

Save/view each state

### Expected business result

“Not configured”, zero and Hold are visibly distinct and not silently converted

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-028 — Validate and audit credit changes / Manager

### Business objective and actor

Validate and audit credit changes / Manager

### Preconditions and data

Existing policy

### Steps

Enter negative/missing currency then valid change with reason

### Expected business result

Invalid blocked; valid saves exact amount/currency/status and history

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-029 — Keep exposure/override outside Customer / Sales/AR user

### Business objective and actor

Keep exposure/override outside Customer / Sales/AR user

### Preconditions and data

Different credit states

### Steps

View/use policy downstream

### Expected business result

Latest policy is shown; Customer page does not calculate AR/exposure or grant override

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-030 — Preserve old financial snapshots / Finance

### Business objective and actor

Preserve old financial snapshots / Finance

### Preconditions and data

Existing invoice/order then policy change

### Steps

Compare old and new decisions

### Expected business result

Historical figures/snapshots remain unchanged; new decision uses latest policy

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-031 — Control new-business eligibility / Manager + Sales

### Business objective and actor

Control new-business eligibility / Manager + Sales

### Preconditions and data

Active Customer

### Steps

Suspend/reactivate and try new sale

### Expected business result

Suspended rejects new sale; valid reactivation restores eligibility; existing work remains visible

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-032 — Block/unblock with separation / Approver

### Business objective and actor

Block/unblock with separation / Approver

### Preconditions and data

Active/Suspended Customer

### Steps

Block; attempt unauthorized unblock; authorized unblock

### Expected business result

Required reason/re-auth; unauthorized denied; unblock returns Suspended

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-033 — Archive/restore safely / Manager

### Business objective and actor

Archive/restore safely / Manager

### Preconditions and data

Open and no-open-matter Customers

### Steps

Archive both; restore valid one

### Expected business result

Blockers shown safely; valid archive hidden from normal use; restore returns Suspended

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-034 — Restrict permanent delete / Manager

### Business objective and actor

Restrict permanent delete / Manager

### Preconditions and data

Pristine Draft and referenced/ever-active Customers

### Steps

Delete each

### Expected business result

Only pristine Draft deletes; others remain with appropriate lifecycle alternatives

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-035 — Submit to another approver / Manager

### Business objective and actor

Submit to another approver / Manager

### Preconditions and data

Approval ON; valid/invalid candidates

### Steps

Submit with self/disabled/no-permission/valid user

### Expected business result

Invalid choices blocked; valid request Pending and assigned correctly

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-036 — Make informed approval decision / Approver

### Business objective and actor

Make informed approval decision / Approver

### Preconditions and data

Pending Customer with safe snapshot

### Steps

Review then approve/reject

### Expected business result

Snapshot/diff sufficient without bank overexposure; approve Active; reject Draft with reason

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-037 — Handle change/withdraw/reassign / authorized roles

### Business objective and actor

Handle change/withdraw/reassign / authorized roles

### Preconditions and data

Pending request

### Steps

Critical edit, withdraw and reassign scenarios

### Expected business result

Stale request cannot approve; requester can withdraw; valid reassign preserves history

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-038 — Prevent duplicate decisions/settings overwrite / two users

### Business objective and actor

Prevent duplicate decisions/settings overwrite / two users

### Preconditions and data

Same request/setting open twice

### Steps

Double-click/concurrent decisions and updates

### Expected business result

One outcome; second user sees current result/conflict; no contradictory state

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-039 — Manage prospective settings / Settings Manager

### Business objective and actor

Manage prospective settings / Settings Manager

### Preconditions and data

Existing pending request

### Steps

Toggle approval with reason

### Expected business result

Clear impact; only new submissions affected; pending unchanged; history visible

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-040 — Maintain multiple banks/default / Bank Manager

### Business objective and actor

Maintain multiple banks/default / Bank Manager

### Preconditions and data

Customer with two banks

### Steps

Add/edit/set default/deactivate

### Expected business result

Valid optional accounts maintained; at most one active default; no activation impact

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-041 — Reveal bank only when needed / Bank Viewer

### Business objective and actor

Reveal bank only when needed / Bank Viewer

### Preconditions and data

Masked account

### Steps

Reveal/re-auth/wait/leave/back

### Expected business result

Full value only after active action, clears after timeout/navigation, and access appears in history

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-042 — Protect referenced/duplicate banks / Bank Manager

### Business objective and actor

Protect referenced/duplicate banks / Bank Manager

### Preconditions and data

Referenced and duplicate accounts

### Steps

Delete/deactivate/add duplicate

### Expected business result

Referenced account only deactivates; same-Customer duplicate blocked; output remains masked

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-043 — Manage general attachments / Manager

### Business objective and actor

Manage general attachments / Manager

### Preconditions and data

Clean/invalid files

### Steps

Upload/view/sort/deactivate/delete

### Expected business result

Valid optional files work; invalid files rejected; referenced history protected

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-044 — Protect Bank Sensitive files / mixed roles

### Business objective and actor

Protect Bank Sensitive files / mixed roles

### Preconditions and data

General and bank-sensitive files

### Steps

Compare list/preview/download/manage

### Expected business result

General access follows Customer role; sensitive filename/content only exact bank roles; every attempt traceable

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-045 — Prepare and precheck CSV / Manager

### Business objective and actor

Prepare and precheck CSV / Manager

### Preconditions and data

Versioned template; mixed rows

### Steps

Download template, upload, precheck

### Expected business result

No Customer is changed; row/field/stable errors and totals are understandable

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-046 — Apply partial-success import safely / Manager

### Business objective and actor

Apply partial-success import safely / Manager

### Preconditions and data

Valid+invalid rows with children

### Steps

Confirm and review result

### Expected business result

Valid rows complete, invalid rows absent, each row all-or-none, totals reconcile

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-047 — Update/retry without duplicates / Manager

### Business objective and actor

Update/retry without duplicates / Manager

### Preconditions and data

Existing customer and repeat request

### Steps

Import update; refresh/retry confirm

### Expected business result

Stable match/version rules apply; no duplicated Customer/child/approval

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-048 — Operate background import/export / Manager

### Business objective and actor

Operate background import/export / Manager

### Preconditions and data

Large import and filtered Customer list

### Steps

Track job; download result/export

### Expected business result

Progress/recovery/expiry clear; export matches filters and omits sensitive/internal data

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-049 — Audit sensitive/bulk actions / authorized Viewer

### Business objective and actor

Audit sensitive/bulk actions / authorized Viewer

### Preconditions and data

Bank/file/import/export actions completed

### Steps

Filter history by Customer/actor/action/date

### Expected business result

Required attempts/results/correlation visible; no plaintext or file content

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-050 — Safe exported content / Manager

### Business objective and actor

Safe exported content / Manager

### Preconditions and data

Cells beginning formula characters

### Steps

Export and open in approved viewer

### Expected business result

Values display as data, not formulas; export event/criteria traceable

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-051 — Create wholesale SO correctly / Sales

### Business objective and actor

Create wholesale SO correctly / Sales

### Preconditions and data

Active Customer with defaults

### Steps

Select Customer and submit SO

### Expected business result

Customer selectable; shipping address not required; valid defaults snapshot; status rechecked

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-052 — Fulfill existing order safely / Fulfillment

### Business objective and actor

Fulfill existing order safely / Fulfillment

### Preconditions and data

Confirmed SO; Customer later Suspended; addresses mixed

### Steps

Create/confirm shipment

### Expected business result

Existing order can proceed, but only active owned Shipping address/contact can be selected; snapshot saved

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-053 — Apply invoice/AR status distinction / Finance

### Business objective and actor

Apply invoice/AR status distinction / Finance

### Preconditions and data

Shipped source/existing invoice; Customer non-Active

### Steps

Invoice shipped source, settle existing AR, try manual invoice

### Expected business result

Existing obligations continue; new manual invoice follows Active-only rule

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-054 — Use bank for authorized refund / Finance

### Business objective and actor

Use bank for authorized refund / Finance

### Preconditions and data

Existing refund source; active/inactive banks

### Steps

Select bank and submit

### Expected business result

Only active owned purpose-valid bank is usable; access is minimal and audited

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-055 — Process legitimate historical return / Returns

### Business objective and actor

Process legitimate historical return / Returns

### Preconditions and data

Historical sale; Customer Archived

### Steps

Start return from source

### Expected business result

Customer status alone does not erase/block historical identity; source snapshot stays unchanged

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-056 — Complete keyboard workflows / all business roles

### Business objective and actor

Complete keyboard workflows / all business roles

### Preconditions and data

Running app

### Steps

Perform assigned primary journey without mouse

### Expected business result

All actions, dialogs, validation and focus recovery are usable by keyboard

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-057 — Use responsive, understandable UI / all roles

### Business objective and actor

Use responsive, understandable UI / all roles

### Preconditions and data

375/768/1024/1440 screens

### Steps

Complete list/detail/form/approval journeys

### Expected business result

No blocking overflow; labels/headings/status/error are understandable and not color-only

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-058 — Complete daily work without excessive wait / operational users

### Business objective and actor

Complete daily work without excessive wait / operational users

### Preconditions and data

Acceptance load environment

### Steps

Search, lookup and observe 10k import

### Expected business result

Observed flows meet agreed thresholds and remain usable during background work

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.

## UAT-059 — Accept security, privacy, retention, resilience and recovery outcomes / Product, Security, Operations and Compliance owners

### Business objective and actor

Accept security, privacy, retention, resilience and recovery outcomes / Product, Security, Operations and Compliance owners

### Preconditions and data

Technical Acceptance, performance, restore, redaction and authorization evidence tied to one candidate

### Steps

Review measured thresholds, denied/allowed role evidence, PII/bank/file handling, retention/legal-hold status, recovery reconciliation and residual risks

### Expected business result

Named owners accept or reject each applicable control; unresolved legal, key/storage/scanner, DR or security boundary keeps release blocked; automation alone is not acceptance

### Acceptance criteria

Required evidence is complete, low-sensitive and tied to the same candidate/environment; the named business/control owner records PASS, FAIL, BLOCKED or accepted residual risk. Automation PASS never substitutes for business acceptance.
