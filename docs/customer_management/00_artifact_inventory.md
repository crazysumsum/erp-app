# Customer Management Harness Artifact Inventory

## Review Context

| Field | Value |
| --- | --- |
| Mode | `REVIEW_AND_ALIGN` |
| Output | `docs/customer_management/`（正式基線原位對齊） |
| Source baseline | `origin/main` at `5d39d48` (2026-09-10) |
| Scope | Customer master data, lifecycle, approval, addresses, contacts, identifiers, credit policy, banks, attachments, import/export, audit and downstream lookup contracts |
| Change boundary | Documentation only;正式Customer文件已由對齊版本取代，application code不變 |

## Artifact Inventory

| Source | Apparent type | Coverage / quality | Authority / confidence | Action | Evidence and notes |
| --- | --- | --- | --- | --- | --- |
| `docs/customer_management/requirement.md` | Business requirement specification | `GOOD` | Business decisions confirmed through prior interview; `HIGH` | `PRESERVE + ALIGN` | 100 functional requirements in 13 families, 42 business rules, 14 security requirements, 14 NFRs and 52 acceptance criteria. Missing harness-canonical functional IDs and a quantified DR target. |
| `docs/customer_management/design_spec.md` | System design specification | `GOOD` | Detailed but draft; `HIGH` | `PRESERVE + ENHANCE` | Covers architecture, 19 logical tables, APIs, UI, services, tests and deployment. Missing `DES-*` IDs; some recovery, collation, search and downstream-purpose contracts need alignment. |
| `docs/customer_management/tasks.md` | Development plan | `PARTIAL` | Detailed planning source; `HIGH` | `PRESERVE + ALIGN` | Contains 49 tasks and checkpoints, but not the mandatory `PHASE-* -> TASK-*` hierarchy; one-Task-one-PR guidance conflicts with Phase merge checkpoints. |
| `docs/customer_management/test_case.md` | Mixed technical/UAT test specification | `PARTIAL` | Strong risk coverage; no execution evidence; `HIGH` | `PRESERVE + SPLIT` | 157 `NOT RUN` cases mix unit, DB, API, security, browser, performance and business acceptance. Harness requires separate `TC-*` and `UAT-*` artifacts. |
| `docs/frontend-design.md` | Shared UI/UX standard | `GOOD` | Project standard; `HIGH` | `VERIFY + REUSE` | Required for Customer pages, responsive behavior and accessibility. |
| `server/src/framework/**`, `server/src/services/**` | Existing backend framework | `GOOD` | Implemented baseline; `HIGH` | `VERIFY + REUSE` | Confirms ES modules, handler discovery, AJV, permission policies, MySQL transactions, idempotency, scheduler, time service and upload controls. |
| `client/src/framework/**` | Existing frontend framework | `GOOD` | Implemented baseline; `HIGH` | `VERIFY + REUSE` | Confirms Vue 3/Quasar, page discovery, route guards, shared UI components and HTTP conventions. |
| `server/database/migrations/0001..0024` | Current schema/migration baseline | `GOOD` | `origin/main`; `HIGH` | `VERIFY` | Customer is not implemented. Fixed provisional Customer migration numbers are stale planning data and must be allocated from latest main at implementation time. |
| `docs/invoicing_accounts_receivable_management/**` | Downstream aligned design | `GOOD` | Merged main; `HIGH` | `VERIFY + ALIGN CONTRACT` | Establishes existing-Shipment invoicing, manual-invoice Active-Customer rule, AR handling for non-Active customers, and ERP DR target. |
| `docs/inventory_management/**`, `docs/items_management/**` | Adjacent designs / implemented Item baseline | `GOOD` | Mixed design/implementation; `HIGH` | `VERIFY` | Customer does not own inventory or item behavior; only shared framework and retention/operations conventions are relevant. |
| Sales Order and Fulfillment worktrees outside main | Proposed upstream/downstream designs | `PARTIAL` | Not authoritative until merged; `MEDIUM` | `VERIFY AT PHASE ENTRY` | May inform contracts, but implementation must re-read the versions actually merged to main. |
| Customer application source and migrations | Implementation baseline | `MISSING` | Repository evidence; `HIGH` | `PLAN` | No Customer module, pages, handlers or tables exist on main. This is expected pre-development status, not evidence of a product regression. |

## Classification Summary

- Existing business scope is sufficiently complete to align without reopening broad discovery.
- The design is substantively strong but not harness-traceable and has several recoverability and cross-module contract gaps.
- No tests were executed. Existing `NOT RUN` status is preserved.
- 原有Customer文件已按使用者批准由Harness對齊內容取代；Git歷史仍可追溯取代前版本。
