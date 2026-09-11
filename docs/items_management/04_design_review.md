# Item Management Independent Design Review

## Gate

**CONDITIONAL — 0 open CRITICAL, 5 open HIGH, 4 open MEDIUM.** The core architecture is coherent and substantially implemented, but the documented design and current main are not fully aligned. This is a documentation/static-code review; no acceptance tests were executed.

## Findings

| ID | Severity | Category | Evidence | Impact | Required action |
| --- | --- | --- | --- | --- | --- |
| DR-001 | HIGH | API/read model | `ItemAdminService` returns empty `attributeValues`/`variantValues`; response schemas cap arrays at zero | Persisted Variant semantics cannot be retrieved or presented | TASK-037 / TC-013 |
| DR-002 | HIGH | Functional/API/UI | Designed standalone SKU-create route/page/client is absent | Existing Variant Item cannot follow the documented add-SKU flow | Owner decision then TASK-038 |
| DR-003 | HIGH | Audit/UI | Audit query backend exists but no designed audit page/timeline/client | Business users lack the documented history surface | TASK-039 / TC-002, TC-010, TC-011 |
| DR-004 | HIGH | Error contract/data integrity | Brand/UOM delete paths do not map current FK-reference failures to `CATALOG_IN_USE` | Referenced deletion may expose generic 500 semantics and inconsistent UX | TASK-040 / TC-014 |
| DR-005 | HIGH | Transaction/audit | Import worker writes aggregate tables directly; only earlier job-confirm audit exists | Imported changes can lack per-aggregate, same-transaction audit and equivalent domain validation | TASK-041 / TC-015 |
| DR-006 | MEDIUM | Dependency boundary | No real downstream Purchasing/Inventory/Sales SKU reference exists | Archive/delete/critical-change reference rules cannot be fully proved | TASK-043 on first consumer |
| DR-007 | MEDIUM | Progress traceability | T23 index unchecked while detailed record/code say complete | Automated/human readers can reach different progress conclusions | Preserve; reconcile via TASK-042 |
| DR-008 | MEDIUM | Operations | Staging upgrade/re-run, restore and approved DR objectives are untested | Release recovery readiness is unknown | TASK-044 / TC-001, TC-016 |
| DR-009 | MEDIUM | Acceptance governance | Developer evidence exists; independent QA/UAT and owner sign-offs do not | Completion cannot equal release acceptance | Execute separate TEST_AND_VERIFY |

## Cross-discipline review

### Architecture and API

The transaction-oriented Item aggregate, optimistic versions, database uniqueness and fresh actor checks are sound patterns. Public interfaces need alignment at three boundaries: full read projection, standalone SKU creation, and stable Catalog-in-use errors. No new abstraction should be introduced for downstream references until a second real module/provider makes it necessary.

### Database and consistency

Current tables provide the expected Item/SKU/UOM/Barcode/Attribute/Media/Audit/Import structure. FK and unique constraints are appropriate last-line defenses. The most material consistency concern is import: job confirmation and actual aggregate mutation occur in different transactions, while row application bypasses the normal aggregate service. The corrected design should establish one shared domain command contract without forcing 10,000 nested transactions.

### Security and privacy

The design includes authenticated permissions, stronger re-authentication, path/signature checks, redacted evidence and audit. Remediation must preserve fresh-actor validation in workers, prevent IDOR in new detail/audit surfaces, and avoid placing raw import/media content in logs or test evidence. This review found no proof of an exploitable CRITICAL issue.

### SRE and release

Logs, metrics, cleanup jobs, capacity fixtures and forward-only migration guidance exist. The approved recovery thresholds now make DR testable, but no timed restore/RPO reconciliation evidence exists. Release remains conditional until staging and human gates close.

### QA

The retained technical catalogue has strong positive, negative, concurrency, transaction, security, file, performance and recovery coverage. Its Round 1 execution section is developer evidence tied to an earlier commit. Formal current-baseline acceptance must begin at `NOT_RUN`, execute P0/P1 cases with evidence, and keep UAT/business sign-off separate.

## Design decisions retained

- SKU is the operational minimum unit; Item is the aggregate container.
- Standard Item has exactly one SKU; Variant Item may have multiple unique combinations.
- HKD / `tax_not_applicable` is fixed for this scope.
- Database plus audit changes are intended to be transactional.
- Media/import filesystem consistency uses compensation and cleanup because DB/file writes cannot share one transaction.
- Reference guards are integrated only with real downstream owners/providers.
- Production objectives are `RTO <= 4h` and `RPO <= 15m`.

## Gate exit conditions

Close DR-001 through DR-005 with targeted implementation and acceptance evidence, reconcile DR-007 with a maintainer decision, and complete DR-008/DR-009 operational and human gates. Any requirement change, especially removal of standalone SKU creation, must use an explicit change decision rather than being inferred from missing code.
