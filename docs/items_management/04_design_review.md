# Item Management Design Review

## Gate

**CHANGES_REQUESTED — 0 open CRITICAL, 5 product/design HIGH, 4 MEDIUM, plus v2 governance/execution gaps.** The core architecture is coherent and substantially implemented, but the documented design and current main are not fully aligned. This is a documentation/static-code review; no acceptance tests were executed.

## Findings

| ID | Severity | Category | Evidence | Impact | Required action |
| --- | --- | --- | --- | --- | --- |
| DR-001 | HIGH | API/read model | `ItemAdminService` returns empty `attributeValues`/`variantValues`; response schemas cap arrays at zero | Persisted Variant semantics cannot be retrieved or presented | TASK-037 / TC-013 |
| DR-002 | HIGH | Functional/API/UI | Designed standalone SKU-create route/page/client is absent | Existing Variant Item cannot follow the documented add-SKU flow | HD-001 retains contract; implement TASK-038 |
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

Close DR-001 through DR-005 with targeted implementation and acceptance evidence, reconcile DR-007 with a maintainer decision, and complete DR-008/DR-009 operational and human gates. `HD-001` explicitly retained standalone SKU creation on 2026-09-11; missing code therefore remains an implementation gap under TASK-038.

<!-- HARNESS_V2_ALIGNMENT_NOTES -->

## Reviewer provenance

- review_method: `SELF_REVIEW`
- author: `/root`
- reviewer and actual context/identity: `/root` in the same active Codex context; no independence claim
- reviewed_baseline: `018bea0802000f1d991645c0a36fe0c8f98f96c2d591a784c8f2017f86c811ef` after propagation of human decision `HD-001`
- source/evidence reference: static repository/doc inspection at `fd8a4ddb27636aaeb47235f3d4976001fa7dfc7a`
- read-only review constraints: no product code, tests, migrations, deployment or formal acceptance executed

The earlier “Independent” title is historical wording without sufficient provenance. The valid v2 disposition is `CHANGES_REQUESTED`: five product/design HIGH findings remain, plus missing Playwright/recovery adapters and an actual independent review. Decisions `HD-001` and `HD-002` are answered and recorded in `09_final_alignment_review.md`.

## REV-002 — Separate TASK-037 implementation-readiness review

- review method: `SEPARATE_AGENT`
- reviewer and actual context/identity: `/root/item_design_review`, a separate Codex agent context
- reviewed baseline: `134c2722f92eae298da7ad1a1b01b6a75522550e` (`origin/main` and local `HEAD` observed equal on 2026-09-14)
- scope: `TASK-037`, DES-004/DES-014/DES-015 and TC-013; read-only static source/spec review, no test or deployment execution
- finding: the non-empty `attributeValues`/`variantValues` wire shape and order were not specified, which blocks a stable public API/UI implementation
- disposition: Owner decision `HD-003` on 2026-09-14 accepted the contract now recorded in `03_design_spec.md#hd-003--attribute-and-variant-detail-projection-contract`; no remaining design ambiguity blocks the read-projection task. This is not code-review or acceptance evidence.
- follow-up: the separate reviewer reconfirmed the approved `HD-003` content against the current Harness design baseline `6f8d2f674e624cd5311b644b9b466e74f465a1e2d1149ae2d1e2044f027470fc`; the raw file SHA-256 is deliberately distinct from the Harness baseline hash.

## REV-003 — Separate TASK-037 implementation review

- review method: `SEPARATE_AGENT`
- reviewer and actual context/identity: `/root/item_design_review`, a separate Codex agent context
- scope: uncommitted `TASK-037` implementation in `codex/item-management-task-037`; read-only code and test review
- resolved findings: `ATTRIBUTE_VALUE_PROJECTION_SCHEMA` now binds each `dataType` to the exact value and option shape defined by HD-003; mapper tests cover `long_text`, `decimal`, `boolean`, `date` and `single_option`.
- remaining evidence gap: TC-013 still needs an isolated, migrated MySQL run with multiple rows to prove SQL `sort_order, attributeId` ordering and cross-owner option behavior. This is a formal acceptance evidence blocker, not an identified product-code defect.
- disposition: no open Critical or High implementation defect. TASK-037 may proceed as implementation-complete but must not be marked formally accepted until the MySQL evidence exists.

## REV-004 — TC-013 local MySQL evidence review

- review method: `SEPARATE_AGENT`
- reviewer and actual context/identity: `/root/item_design_review`, a separate Codex agent context
- executed evidence: owner-authorized local MySQL run on 2026-09-14 using `DB_INTEGRATION_TESTS=1`, the existing local server environment, and the focused `itemRead.integration.test.js` projection case; result `PASS`.
- coverage confirmed: multiple Item and SKU values return in category `sort_order → attributeId` order; an intentionally cross-owner Item option row is excluded by the query and does not disclose the other attribute's option.
- disposition: TC-013's former MySQL evidence blocker is closed. This is developer/integration evidence only; merge, CI, and business acceptance remain separate gates.
