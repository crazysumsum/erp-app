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
| DR-007 | MEDIUM | Progress traceability | Frozen T23 index was unchecked while detailed record/code say complete | Automated/human readers could reach different progress conclusions | RESOLVED by maintainer-approved TASK-042 correction; original source evidence retained |
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

## REV-005 — Separate TASK-038 implementation review

- review method: `SEPARATE_AGENT`
- reviewer and actual context/identity: `/root/item_design_review`, a separate Codex agent context
- scope: uncommitted `TASK-038` implementation, including DEC-025 read authorization and SKU Code validation paths; read-only source/spec/test review
- findings: no open P0/P1. `item.mgmt` can read and write Item, SKU, Catalog, Media and Audit APIs while `item.view` remains read-only. SKU Code create, copy and special change all use the same domain validation and return `SKU_CODE_INVALID` for blank, control-character and over-190-character values.
- evidence reviewed: owner-authorized local MySQL Item create/high-risk suite reported 49 passing tests; this reviewer did not execute tests.
- disposition: implementation review is clear for a merge candidate after the remaining Harness state reconciliation, CI and merge gates; it is not formal acceptance or release approval.

## REV-006 — Separate TASK-039 implementation review

- review method: `SEPARATE_AGENT`
- reviewer and actual context/identity: `/root/item_design_review`, a separate Codex agent context
- scope: uncommitted `TASK-039` Item Audit client/page, query allowlist, Category Attribute audit detail, tests and aligned documentation; read-only code review
- findings resolved: all actual Item Audit producer actions and target types are filterable; Category Attribute assignment records express added/removed assignments and updated before/after values; legacy numeric-array records render safely with an explicit missing-detail notice.
- evidence reviewed: current client/server regression and owner-authorized local MySQL Item Audit integration run; reviewer did not execute commands.
- disposition: no open P0/P1 implementation defect. CI, formal acceptance and merge gates remain separate.

## REV-007 — Separate TASK-040 implementation review

- review method: `SEPARATE_AGENT`
- reviewer and actual context/identity: `/root/item_design_review`, a separate Codex agent context
- scope: uncommitted `TASK-040` Brand/UOM referenced-delete error mapping, public dependency details, rollback/no-audit behavior, focused unit/MySQL tests and aligned documentation; read-only code review
- finding resolved: the first candidate returned one coarse UOM reference type and omitted existing SKU measurement FKs. The implementation now performs same-transaction `FOR UPDATE` current reads after the FK conflict and returns the actual ordered subset of `sku_uoms`, `sku_measurements` and `attributes`, with an explicit `unknown` race fallback.
- evidence reviewed: unit 61/61 and focused local-MySQL 1/1. Additional developer evidence records the final full server regression at 1,214 pass with 228 explicit DB skips, the full owner-authorized Item Catalog local-MySQL suite at 10/10 and lint clean. The reviewer did not execute commands.
- disposition: no remaining P0/P1/P2 implementation finding. CI, formal acceptance and merge gates remain separate.

## REV-008 — Separate TASK-041 implementation review

- review method: `SEPARATE_AGENT`
- reviewer and actual context/identity: `/root/item_design_review`, a separate Codex agent context
- reviewed baseline: source fingerprint `905b8478823c24e24f89af163c0d551edb42d616178572b1fd11dd64b04a3073`; TASK-041 code, tests, DES-013 alignment, readiness and Harness state were reviewed read-only
- finding resolved: the first candidate allowed a stale worker whose lease had expired to overwrite a newer owner's completed job with failure state. Success and failure finalization now require `jobId + status='running' + lease_owner`; the two-owner true-MySQL race proves the stale owner returns `lost_lease`, cannot change job/row/aggregate/audit state and cannot rewrite the result file.
- evidence reviewed: focused true-MySQL Item Import 21/21, full server 1,447 pass / 0 fail / 1 explicit skip out of 1,448, bounded 10,000-row performance evidence, lint and `state_tool inspect` at `LOCAL_CHECKS_PASS`. The reviewer did not execute commands.
- documentation follow-up resolved: DES-013 no longer reports the closed direct-SQL gap; TASK-041 is `DONE`, TASK-042 is current, and the exact pass/skip counts agree across readiness and technical-test evidence.
- disposition: final re-review found no remaining P0/P1/P2 implementation finding. CI, formal acceptance and merge gates remain separate.

## REV-009 — Separate TASK-042 documentation reconciliation review

- review method: `SEPARATE_AGENT`
- reviewer and actual context/identity: `/root/item_design_review`, a separate Codex agent context
- reviewed baseline: plan baseline `bf2d68787d0a0a15253c4e126dcbaec5f7ed4ca31ad7bcdd97e8f6898faf1ac9`; read-only review of the T23 index correction, provenance, aligned governance documents and Harness state
- evidence confirmed: pre-TASK-042 canonical counts 304 checked/41 unchecked, post-correction 305/40, and frozen `fd8a4dd` source 303/42; original SHA and unchecked state remain traceable.
- Git provenance confirmed: `21a8be0093d52faa19a1c0f061083046dea2a9f1` implements T23, `45d686ce94c74f08499c35e1e6c3cdc09714480a` is PR #67's merge containing it, and `b153efac5ad8c36acddaf85b98c82d6d1e4622f5` is the later T24 follow-up.
- disposition: no P0/P1/P2 finding. This approves the documentation reconciliation only; it does not claim new product behavior, CI completion or formal acceptance.

## REV-010 — TEST_AND_VERIFY entry readiness review

- review method: `SEPARATE_AGENT`
- reviewer and actual context/identity: `/root/item_design_review`, a separate Codex agent context
- reviewed baseline: design `cdca7fa0e1861eda5f4e19d67701bcc58743ea4b022863f93c53e0df8d46ce4a`, plan `85253762f1aad08a605b0dc91f90dc0a8e524cd70b1ae1d2cbe567738e0fc3f3`
- confirmed: manifest provider SHA matches `03_design_spec.md`; profile only records the user-authorized local test environment and does not lower suites, required case IDs or skip limits.
- changes requested: APR-013/APR-014 were bound to pre-metadata HEAD `89ae37f`, and the first runtime record asserted serialization without an observed lease. The metadata candidate is now committed at `996072b24acb7daff4453f91da46d93c4613e4c6`; superseding APR-015/APR-016 bind that commit, and MySQL advisory lock `erp-item-task044-local-20260914` is observed acquired on connection 23483.
- disposition: `CHANGES_REQUESTED` pending follow-up confirmation and revision-checked mode entry; no test execution is accepted under this review.

## REV-011 — TEST_AND_VERIFY entry follow-up review

- review method: `SEPARATE_AGENT`
- reviewer and actual context/identity: `/root/item_design_review`, a separate Codex agent context
- reviewed baseline: candidate `996072b24acb7daff4453f91da46d93c4613e4c6`, design `cdca7fa0e1861eda5f4e19d67701bcc58743ea4b022863f93c53e0df8d46ce4a`, plan `85253762f1aad08a605b0dc91f90dc0a8e524cd70b1ae1d2cbe567738e0fc3f3`
- findings closed: APR-015/APR-016 supersede the pre-metadata approvals and bind the exact candidate; runtime resources and MySQL advisory-lock evidence are recorded; REV-010 remains preserved.
- reviewer limitation: the separate reviewer environment could not connect to `127.0.0.1:3306`, so it reviewed the lease record and supplied acquisition evidence rather than independently live-querying the lock. The primary verifier separately observed `IS_USED_LOCK(...) = 23483` on the still-open lease session.
- disposition: no remaining P0/P1/P2; current design/plan baseline is approved for PLAN_READY and the revision-checked TEST_AND_VERIFY mode-entry checkpoint.

## REV-012 — REMEDIATE_AND_RETEST independent review

- review method: `SEPARATE_AGENT`
- reviewer and actual context/identity: `/root/item_design_review`, a separate Codex agent context; read-only review, no file edits or test execution
- reviewed baseline: plan `de36880e949c9d73391d3090324f071da1e1f9a4ad96599a68b782f68f186f91`
- first review disposition: `CHANGES_REQUESTED`, three P1 findings—do not weaken the global system-admin permission assertion, resolve Playwright JUnit to the canonical evidence path, and supersede stale readiness/gap claims
- findings closed: the original exact global permission assertion is restored; Item-owned `TC-001` independently snapshots migrations 0010–0026 and exact Item permission seeds; the Playwright reporter resolves absolute Harness paths and canonical evidence exists; readiness/gap records now show fixed items in `RETEST` while preserving historical failures
- evidence reviewed: `remediation-server-scoped.junit.xml` 459/459, `remediation-client.junit.xml` 492/492, `remediation-performance-bounded.junit.xml` 4/4, `remediation-item-uat-browser.junit.xml` 11 pass/2 explicit skips; these are developer remediation artifacts, and the reviewer checked evidence/current files but did not rerun commands
- residual risks: `TC-016` recovery environment, full-scale 100k performance, TASK-043/UAT-005 downstream reference and UAT-015 business sign-off remain blocked and are not waived
- final disposition: `APPROVED`, no remaining P0/P1/P2. This is independent review of the remediation PLAN baseline, not Product Owner approval, formal acceptance, CI or release approval.
