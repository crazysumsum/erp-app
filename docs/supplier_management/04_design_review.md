# Supplier Management Independent Design Review

## Decision

**CONDITIONALLY APPROVED FOR PRODUCT OWNER DESIGN／PLAN REVIEW (REV-004).** The historical approvals below remain valid only for their recorded baselines. Product Owner approved `HD-003` on 2026-09-14, allowing Supplier to consume Item's currently published SKU／UOM identity contract; `REV-004` independently approved the updated candidate. This decision does not authorize implementation: the Product Owner must still approve the full Design／Plan baseline and the relevant provider readiness gates must be satisfied. Production enablement additionally requires Bank security and recovery evidence. Current `origin/main` was subsequently integrated without changing Supplier-owned specification content, and the document validators were rerun.

## Review baseline

- Normative requirement: `01_requirement_spec.md` 1.0 Aligned.
- Normative design: `03_design_spec.md` 1.0 Aligned, with the 2026-09-14 approved Item identity-contract pin refresh pending independent re-review.
- Repository architecture inspected: Node.js ES Modules, Express handler metadata, MySQL transaction services, Vue 3／Quasar／Pinia and discovery conventions.
- Cross-module contracts inspected: Item, Purchasing & Receiving, Customer and current User/permission conventions.
- No Supplier implementation exists; all code-level observations are design readiness findings, not runtime defect claims.

## Original independent reviewer provenance

| Field | Value |
| --- | --- |
| Method | `SEPARATE_AGENT` |
| Reviewer | `/root/supplier_independent_review` |
| Context | Fresh-context Codex collaboration agent; read-only review; no artifact edits |
| Review date | 2026-09-11 |
| Reviewed commit／default baseline | `ab1388101cdfb480cdd74860efc71fc2c350d014` |
| Harness design baseline | `9d9866b87206edad9dd0bda592480398d2233fb26409d237124f549c741086fb` |
| Harness plan baseline | `45674879c52b057013634325840cc08d20e30d5514116ec67078dee4e9112cde` |
| Final disposition | `APPROVE` |
| Open Critical／High | `0／0` |

The original reviewer first returned changes requested, then re-reviewed the first-alignment artifacts. That historical approval remains bound to its recorded Design／Plan hashes; it is not rewritten to cover the repeat-alignment baseline.

## Harness 2.0 repeat-review provenance

| Field | Value |
| --- | --- |
| Method | `SEPARATE_AGENT` |
| Reviewer | `/root/supplier_independent_review` |
| Context | Independent Codex collaboration agent; read-only re-review; no artifact edits |
| Reviewed at | `2026-09-11T06:15:45Z` |
| Reviewed commit／default baseline | `fd8a4ddb27636aaeb47235f3d4976001fa7dfc7a` |
| Harness Design baseline | `2b715d5634a5c611af4ba8faecbfe83fa2111202ec03a05a25ca9e756267faa2` |
| Harness Plan baseline | `df43d9254f913788cde911a8731fe6587a8a63f3d81e684b001fbb4d8c016005` |
| Source fingerprint | `b8f7118725d5ed2c0ec658cf975903aaa6146ec609997d4d8697d90bc6b285f6` |
| Review chronology | `REV-002 CHANGES_REQUESTED` → remediation → `REV-003 APPROVED` |
| Supplier-owned open Critical／High | `0／0` |
| External High dependency gates | `2`：Item relation-name alignment；Purchasing `recordSupply` contract alignment |

The repeat reviewer approved the Supplier-owned Requirement, Design, Tasks, Technical Tests, UAT and Traceability baseline that existed on 2026-09-11. That approval does not cover the later `HD-003` contract-pin update. The two external High gates continue to block PHASE-004.

## 2026-09-14 current independent re-review (`REV-004`)

| Field | Value |
| --- | --- |
| Method | `SEPARATE_AGENT` |
| Reviewer | `/root/supplier_independent_review` |
| Context | Fresh read-only review of the uncommitted candidate; no edits, commits, pushes or application tests |
| Reviewed at | `2026-09-14T08:42:01Z` |
| Candidate commit | `c1ed49225524e60d7dcf28ef8941ea2c14a8f04f` |
| Observed `origin/main` | `c3972422d20c56e9656aef9f894b91d7162c79c7` |
| Harness Design baseline | `be8e5c85347c7db898967e7037164231345ec24d1e8513c1c6406536b9dea210` |
| Harness Plan baseline | `94a87f42917c018b6a971bc98417bef59a31b0fade93bf9a8831df38eeb4a1f4` |
| Source fingerprint | `8a54ee4c94173a6cef5a430d9704fa78867b30f35d3f3b1c35e4b48eeb330453` |
| Disposition | `APPROVED` |
| Supplier-owned open Critical／High | `0／0` |
| External High dependency gates | `2`：Item relation-name alignment；Purchasing `recordSupply` contract alignment |

`REV-004` verified that Supplier's manifest and Item's manifest name the same `item-sku-uom-provider`／`aligned-design-v2` contract and exactly pin the current Item design hash. It also verified that `HD-003` does not remove the Item §5.14 relation-name or Purchasing payload gates. State inspection, traceability approval check, module-boundary validation and `git diff --check` passed at review time. No application test was executed. The reviewer-observed `origin/main` advancement was subsequently integrated without Supplier-document conflict; the same document validators were rerun before PR preparation.

## Architecture review

| Lens | Result | Review evidence |
| --- | --- | --- |
| Module boundary | PASS | Supplier owns its aggregate, bank metadata, approval, settings and soft SKU relation. Business Master, Item and transactional modules retain their data ownership. |
| Simplicity | PASS | Modular-monolith services and existing handler/page discovery are reused; no microservice, generic encryption framework or speculative adapter is introduced. |
| Transaction integrity | PASS WITH TEST GATE | Root/children/status/approval/audit use one MySQL transaction, optimistic version and stable lock order. True-MySQL concurrency tests remain mandatory. |
| State model | PASS | Legal transitions, Pending invalidation, Block→Suspended and Archive restore→Suspended are explicit. Reference/open-matter unknown fails closed. |
| Idempotency | PASS WITH TEST GATE | Create, approval, status and import include framework/domain fences; commit-unknown and row-terminal recovery require integration proof. |
| Migration safety | PASS AFTER ALIGNMENT | Physical numbers are no longer reserved. Each Phase allocates from latest main; applied migrations are immutable. |
| Query design | PASS WITH PERFORMANCE GATE | Exact/prefix/gram candidates, bounded ranking, EXISTS and server paging avoid whole-table in-memory work; 100k/50-user EXPLAIN and latency proof is required. |
| Frontend fit | PASS | Shared components, permission-aware actions, URL filters, conflict UX, accessibility and responsive behavior match `docs/frontend-design.md`. Actual browser validation is deferred to implementation. |

## API and integration review

| Topic | Result | Conclusion |
| --- | --- | --- |
| HTTP contract | PASS | Request/response schemas, pagination, version, auth strength, stable errors and projection allowlists are defined. |
| Business Master | PASS AFTER ALIGNMENT | Supplier has read/validate methods only; schema, seeds, lifecycle and write authorization remain external. |
| Purchasing | PASS | `listForSku`, transaction-aware usability/default lookup and history projection meet Purchasing needs without bank exposure. |
| Lifecycle references | PASS WITH PROVIDER GATE | `OPEN/CLEAR/UNKNOWN` and fail-closed behavior prevent unsafe deletion/archive when required providers are absent. |
| Item | PASS WITH PROVIDER／DOC ALIGNMENT GATE | Supplier pins Item's published `item-sku-uom-provider`／`aligned-design-v2` SKU／UOM identity contract under `HD-003`. Item §5.14's provisional `item_supplier_refs` name remains a distinct owner-approved alignment gate before PHASE-004; the pin refresh does not authorize relation-table change. |
| Payment | PASS AS DEFERRED | Generic Bank decrypt API is rejected; a purpose-specific high-trust payment contract is added only when Payment exists. |
| Backward compatibility | PASS | Supplier adds new capability; no existing API or applied migration is altered. Capability registration is gated by schema/provider readiness. |

## Database review

| Lens | Result | Conclusion |
| --- | --- | --- |
| Normalization / uniqueness | PASS | Binary canonical keys, composite identifier uniqueness and generated unique primary/default/pending slots protect races. |
| Ownership | PASS | Child routes and schema use Supplier ownership FKs; IDOR-safe lookup is required. |
| Referential behavior | PASS | Historical references use RESTRICT/snapshot semantics; destructive actions are bounded to never-used Draft data. |
| Audit immutability | PASS WITH DB TEST | Append-only service/permission design is adequate; migration/DB tests must prove ordinary paths cannot update/delete logs. |
| Business Master FKs | CONDITIONAL | FK/reference shape must match the final shared schema; PHASE-001 cannot invent incompatible columns. |
| Migration recoverability | CONDITIONAL | MySQL DDL implicit commit requires per-migration retry and half-applied recovery exercises; `IF NOT EXISTS` must not hide incompatible existing definitions. |

## Security review

| Threat / control | Result | Conclusion |
| --- | --- | --- |
| Authorization and IDOR | PASS | Explicit permission combinations, fresh actor checks and composite ownership are specified. |
| Highest privilege | PASS AFTER HD-001 | system-admin receives all six permissions but does not bypass password/device reauth, masking, audit, redaction or alerts. |
| Bank confidentiality | PASS WITH INDEPENDENT SECURITY GATE | AES-GCM, AAD, separate blind-index keys, no-store reveal, short-lived UI value and all-channel redaction are appropriate; key custody and rotation must be reviewed separately. |
| Import/export input | PASS | RFC 4180 parser, bounded files/rows, server filenames, formula-injection handling, no Bank import/export and controlled root are specified. |
| Injection / mass assignment | PASS | AJV additional-property rejection, sort allowlists, escaped queries and output encoding are specified. |
| Sensitive observability | PASS WITH TEST GATE | Low-cardinality events and explicit forbidden fields are defined; automated marker scans must prove logs/audit/files remain clean. |

## Testability and operations review

- Pure rules, handler contracts, service transaction behavior, true-MySQL constraints, browser flows, capacity, rotation, backup and restore each have an appropriate test layer.
- `06_technical_test_cases.md` retains 136 technical cases as `TC-001`～`TC-136`; `07_uat_test_cases.md` separates 55 user-observable cases.
- Harness execution contracts are split by server integration, Bank security, authorization security, client UI, performance, resilience, recovery, release operations and Playwright UAT. Their adapters are planned deliverables in implementation; this document review does not claim that the not-yet-created scripts have executed.
- RTO≤4 hours and RPO≤15 minutes require timestamps and reconciliation in an isolated restore, not a document-only assertion.
- The operational system must emit readiness, provider degradation, bank integrity/key errors, stale approval, import lease and conflict metrics without sensitive dimensions.

## Blocking gates by Phase

| Phase | Blocking entry conditions | Blocking exit evidence |
| --- | --- | --- |
| PHASE-001 | Latest main migration inventory; Business Master Currency／Payment Term provider READY | Core API/UI, true-MySQL constraints, provider contracts, permissions, audit and Playwright flows pass |
| PHASE-002 | PHASE-001 merged; settings schema assigned current migration number | Approval SoD, stale/concurrent decisions, settings non-retroactivity and UI flows pass |
| PHASE-003 | Security-approved secret store/key custody; PHASE-001 merged | Crypto review, permission matrix including system-admin, reveal lifecycle, rotation and restore pass |
| PHASE-004 | Item provider READY; required downstream provider registry fixed | SKU ranking, import/export, 100k/50-user, 10k-row, DR, full regression and UAT sign-off pass |

## Residual risks

1. Business Master implementation is present on current main, but Supplier has not yet observed a fresh isolated provider-readiness result; this still blocks Supplier Core rather than merely degrading it.
2. Bank feature cannot be production-enabled until secret-store ACL, incident response, key rotation owner and restore custody are independently evidenced.
3. The complete list of downstream open-matter/reference providers can only be finalized as Purchasing, Receiving, Returns and AP schemas land.
4. Seven-year minimum retention does not settle jurisdiction-specific longer retention or legal hold; destructive purge remains gated.

## Reviewer recommendation

Submit the Design／Plan baseline to the Product Owner before starting any Phase. After that approval, proceed with `PHASE-001` only after provider readiness proof. Do not create shadow Business Master tables, fixed migration reservations, production fakes or Supplier-local copies of downstream eligibility logic. “Conditionally approved” does not authorize implementation or release and does not mark any test PASS.
