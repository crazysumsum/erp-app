# Item Management Standards Gap Analysis

## Summary

| Gap | Severity | Type | Disposition |
| --- | --- | --- | --- |
| GAP-RQ-001 | HIGH | DOCUMENTATION_GAP | RESOLVED: duplicate NFR crosswalk |
| GAP-RQ-002 | HIGH | REQUIREMENT_GAP | RESOLVED by user: measurable RTO/RPO |
| GAP-DES-001 | MEDIUM | DOCUMENTATION_GAP | RESOLVED: canonical `DES-*` index |
| GAP-IMP-001 | HIGH | IMPLEMENTATION_GAP | OPEN: Attribute/Variant values unreadable |
| GAP-IMP-002 | HIGH | IMPLEMENTATION_GAP / SCOPE_DECISION | OPEN: standalone add-SKU flow absent |
| GAP-IMP-003 | HIGH | IMPLEMENTATION_GAP | OPEN: user-facing audit history absent |
| GAP-IMP-004 | HIGH | LIKELY_DEFECT | OPEN: referenced Brand/UOM delete error mapping |
| GAP-IMP-005 | HIGH | IMPLEMENTATION_GAP | OPEN: import bypasses aggregate transactional audit |
| GAP-INT-001 | MEDIUM until dependency exists | DEFERRED_DEPENDENCY | OPEN: downstream reference guard |
| GAP-TASK-001 | HIGH | STATUS_AMBIGUITY | OPEN: T23 index/detail conflict |
| GAP-TASK-002 | HIGH | ACCEPTANCE_GAP | OPEN: staging and human sign-offs |
| GAP-TC-001 | MEDIUM | EVIDENCE_CLASSIFICATION | RESOLVED in docs: developer versus independent evidence |
| GAP-UAT-001 | HIGH | DOCUMENTATION_GAP | RESOLVED: separate UAT specification |
| GAP-TRC-001 | HIGH | DOCUMENTATION_GAP | RESOLVED: canonical traceability matrix |

## Findings

### GAP-RQ-001 — Duplicate legacy `NFR-005`

The legacy requirement assigns `NFR-005` to both change capacity and transactional audit consistency. This makes downstream evidence ambiguous. The canonical crosswalk retains the first as `NFR-005`, maps the second to `NFR-006`, and shifts legacy `NFR-006–012` to canonical `NFR-007–013`. The legacy body is unchanged.

### GAP-RQ-002 — Recovery objectives were not measurable

The design deferred RTO/RPO to a generic ERP policy. The user approved `RTO <= 4h` and `RPO <= 15m` on 2026-09-11. These are now `NFR-014` and `NFR-015`; execution evidence remains pending.

### GAP-IMP-001 — Persisted Attribute/Variant data is omitted from detail responses

`ItemAdminService` returns `attributeValues: []` and `variantValues: []`; schemas enforce `maxItems: 0`. Attribute/Variant tables and write behavior exist, so persisted information becomes invisible through the promised detail API/UI. Remediation: TASK-037 / TC-013.

### GAP-IMP-002 — Designed standalone SKU creation is absent

The design lists `POST /api/v1/skus/create` and a SKU-create page. The implementation supports Variant SKUs during Item creation but has no route/client/page to add a SKU later. Because this may reflect a past scope decision, the owner must either retain and implement the requirement or approve a requirement/design change. Remediation: TASK-038.

### GAP-IMP-003 — Audit is API-only

`GET /api/v1/item-audit/logs` exists, while the designed audit page/timeline/client does not. Authorized users therefore cannot satisfy the documented UI history flow. Remediation: TASK-039.

### GAP-IMP-004 — Referenced Brand/UOM deletion likely leaks an internal DB failure

Current Item/SKU tables reference Brand/UOM. `deleteBrand()` and `deleteUom()` still state that such tables do not exist and do not map FK rejection to `CATALOG_IN_USE`; `deleteAttribute()` demonstrates the expected pattern. This is a static-review `LIKELY_DEFECT`, not an executed FAIL. Remediation: TASK-040 / TC-014.

### GAP-IMP-005 — Import changes are not transactionally audited per aggregate

The execution worker performs direct Item/SKU/UOM SQL. Confirmation writes one job-level `item.import` audit in an earlier transaction, but imported Item creates/updates do not receive the same per-aggregate audit semantics as interactive changes, and the confirm audit is not atomic with later execution. This conflicts with FR-AUDIT-001/004, BR-021 and canonical NFR-006. Remediation: TASK-041 / TC-015.

### GAP-INT-001 — Downstream reference guard remains deferred

No current production Purchasing/Inventory/Sales table has a true SKU FK; existing SKU references are Item-internal children. The design deliberately avoids a speculative provider. Add the contract/FK checks with the first real consumer under TASK-043; do not mark affected downstream acceptance criteria PASS today.

### GAP-TASK-001 — T23 progress conflict

The legacy task index leaves T23 unchecked, while the detailed T23/T24 records and merged code state that the work was completed. Alignment preserves both facts. Only a maintainer-approved historical reconciliation may change the checkbox.

### GAP-TASK-002 — Release checkpoint remains conditional

Checkpoint L explicitly leaves staging migration/re-run and business/QA/Ops/compliance sign-off unchecked. Sample Catalog data is illustrative, not formally business-approved. DR targets have not been exercised. Remediation/evidence: TASK-044.

## Scope integrity

No product behavior was changed. Receiving overrides, real downstream reference integration and formal business sign-off remain owned by their future modules/owners. New work is listed as planned remediation rather than rewritten into completed T01–T36 history.
