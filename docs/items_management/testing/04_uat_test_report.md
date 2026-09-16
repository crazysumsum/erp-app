# UAT Test Report

## Scope / Build / Environment

- Scope: `UAT-001`–`UAT-015` on local candidate `49d487e876932e6684cbdbec46043312b3f730bd`.
- Environment: local browser (Headless Chrome 152 through Playwright CLI), client `127.0.0.1:4173`, API `127.0.0.1:3000`, MySQL `erp_dev`, synthetic data.
- Formal configured run: `20260914T093146-7574b753a291`; command stopped because `client/e2e/item-management/playwright.config.js` does not exist.

## Summary

| Metric | Count |
|---|---:|
| Planned | 15 |
| PASS | 0 |
| FAIL | 0 |
| BLOCKED | 13 |
| NOT_RUN | 2 |
| PENDING_USER_ACCEPTANCE | 15 |

The 13 configured automated cases are BLOCKED by the missing project. `UAT-013` and `UAT-014` are manual-only and NOT_RUN. All 15 remain pending business acceptance; supporting browser observations cannot grant sign-off.

## Results

| UAT | Requirement | Technical Execution | Business Acceptance | Evidence | DEF/CR |
|---|---|---|---|---|---|
| UAT-001 | Find/filter/list | SUPPORTING_PARTIAL | PENDING | Search empty state, query URL and refresh persistence observed. | DEF-104 |
| UAT-002 | Detail/history | SUPPORTING_PARTIAL | PENDING | Item audit list and change details observed; no complete Item detail fixture. | DEF-104 |
| UAT-003 | Standard create | SUPPORTING_PARTIAL | PENDING | Create page and empty-input error state observed; no valid aggregate persisted. | DEF-104 |
| UAT-004 | Variant create/extend | SUPPORTING_PARTIAL | PENDING | Variant mode and missing-attribute guidance observed; independent existing-Item SKU addition remains unexecuted. | DEF-104 |
| UAT-005 | Edit/concurrency/reference | BLOCKED | PENDING | No two-editor or real downstream-reference browser fixture. | DEF-104 |
| UAT-006 | Lifecycle/delete | SUPPORTING_PARTIAL | PENDING | Unreferenced synthetic Brand deletion observed; full Item/SKU lifecycle not executed. | DEF-104 |
| UAT-007 | UOM/barcode | BLOCKED | PENDING | No UOM/barcode browser fixture. | DEF-104 |
| UAT-008 | Price | BLOCKED | PENDING | No priced SKU browser fixture. | DEF-104 |
| UAT-009 | Import/export | SUPPORTING_PARTIAL | PENDING | Import/export page, actions and empty job state observed; no confirmed browser import. | DEF-104 |
| UAT-010 | Audit | SUPPORTING_PARTIAL | PENDING | `item.mgmt`-only Brand create/delete rows, actor and reason observed. | DEF-104 |
| UAT-011 | Roles | SUPPORTING_PARTIAL | PENDING | `item.mgmt`-only account could read Item/Catalog/Audit and create/delete Brand; other role matrix not rerun in browser. | DEF-104 |
| UAT-012 | Accessibility/failure/dirty state | SUPPORTING_PARTIAL | PENDING | Labeled controls, validation alerts, expected 400 handling and beforeunload protection observed; full keyboard audit not executed. | DEF-104 |
| UAT-013 | Real downstream SKU consumer | NOT_RUN | PENDING | No real downstream reference implementation/owner fixture. | — |
| UAT-014 | Initial master/retention decision | NOT_RUN | PENDING | Requires named business/compliance owners and production sample catalogue. | — |
| UAT-015 | Business release journey | BLOCKED | PENDING | Technical exit criteria not met; no business-owner sign-off. | DEF-103, DEF-104 |

## Defects

- No confirmed product defect was raised from browser-assisted execution.
- `DEF-104` blocks the formal configured browser suite.

## Change Requests

- None raised. The existing `HD-001` decision to retain independent SKU addition for an existing Variant Item remains mandatory and unexecuted.

## Pending User Acceptance

- ERP Product Owner (Sam) has not been asked to sign off because Technical Acceptance is blocked.
- `UAT-013` needs the first real downstream SKU consumer and its business owner.
- `UAT-014` needs business/compliance review of the production sample catalogue and retention policy.

## UAT Status

`BLOCKED`

## REMEDIATE_AND_RETEST browser execution — 2026-09-15

The configured Playwright project now exists and executes all 13 automated IDs against the running client/API and local MySQL. Eleven cases pass, including the complete UAT-004 flow: open an existing Variant Item, add a unique SKU, reach its detail page, then submit the same variant combination with a different SKU Code and observe the expected 409 without navigation.

| UAT | Automated result | Remaining condition |
|---|---|---|
| UAT-001–UAT-004, UAT-006–UAT-012 | PASS (developer retest) | Formal credit awaits new PLAN approval and Harness execution. |
| UAT-005 | SKIPPED / BLOCKED | TASK-043 still requires a real downstream SKU reference; the test does not fabricate one. |
| UAT-015 | SKIPPED / BLOCKED | Local MySQL is not a staging-like recovery/release environment, and automation cannot grant Product Owner sign-off. |
| UAT-013–UAT-014 | Manual / NOT_RUN | Remain outside the configured automated set and require named business/compliance owners. |

Evidence: `testing/evidence/remediation-item-uat-browser.junit.xml` (developer remediation artifact only). Technical automation has improved, but business acceptance remains `PENDING_USER_ACCEPTANCE`.

## Contract / sign-off identity

- Plan hash / exact code and environment baseline: `85253762f1aad08a605b0dc91f90dc0a8e524cd70b1ae1d2cbe567738e0fc3f3` / `49d487e876932e6684cbdbec46043312b3f730bd` / `ITEM-TASK044-LOCAL-20260914`.
- Actual automated/manual evidence and executor: formal suite executed by primary TEST_AND_VERIFY agent but started 0 cases; browser-assisted exploratory execution used Playwright CLI and is documented in `07_browser_assisted_evidence.md`.
- Separate business authority/source/time: none recorded for acceptance.
- Pending decisions are not automated acceptance: all business acceptance remains `PENDING_USER_ACCEPTANCE`.
