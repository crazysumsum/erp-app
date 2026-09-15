# Item Management Standards Gap Analysis

## Summary

| Gap | Severity | Type | Disposition |
| --- | --- | --- | --- |
| GAP-RQ-001 | HIGH | DOCUMENTATION_GAP | RESOLVED: duplicate NFR crosswalk |
| GAP-RQ-002 | HIGH | REQUIREMENT_GAP | RESOLVED by user: measurable RTO/RPO |
| GAP-DES-001 | MEDIUM | DOCUMENTATION_GAP | RESOLVED: canonical `DES-*` index |
| GAP-IMP-001 | HIGH | IMPLEMENTATION_GAP | RESOLVED by TASK-037 |
| GAP-IMP-002 | HIGH | IMPLEMENTATION_GAP | RESOLVED by TASK-038 and UAT-004 developer retest |
| GAP-IMP-003 | HIGH | IMPLEMENTATION_GAP | RESOLVED by TASK-039 |
| GAP-IMP-004 | HIGH | LIKELY_DEFECT | RESOLVED by TASK-040 |
| GAP-IMP-005 | HIGH | IMPLEMENTATION_GAP | RESOLVED by TASK-041 |
| GAP-INT-001 | MEDIUM until dependency exists | DEFERRED_DEPENDENCY | OPEN: downstream reference guard / TASK-043 |
| GAP-TASK-001 | HIGH | STATUS_AMBIGUITY | RESOLVED: maintainer-approved T23 index correction |
| GAP-TASK-002 | HIGH | ACCEPTANCE_GAP | OPEN: staging and human sign-offs |
| GAP-TC-001 | MEDIUM | EVIDENCE_CLASSIFICATION | RESOLVED in docs: developer versus independent evidence |
| GAP-UAT-001 | HIGH | DOCUMENTATION_GAP | RESOLVED: separate UAT specification |
| GAP-TRC-001 | HIGH | DOCUMENTATION_GAP | RESOLVED: canonical traceability matrix |
| GAP-TC-002 | HIGH | IMPLEMENTATION_GAP | OPEN: recovery adapter/environment |
| GAP-TC-003 | HIGH | IMPLEMENTATION_GAP | CLOSED: canonical IDs emitted and developer retest/regression passed |
| GAP-UAT-002 | HIGH | IMPLEMENTATION_GAP | CLOSED: Playwright project executes; external-condition skips remain separately tracked |
| GAP-REV-001 | HIGH | DOCUMENTATION_GAP | RESOLVED: separate-agent reviews recorded |

## Findings

### GAP-RQ-001 — Duplicate legacy `NFR-005`

The legacy requirement assigns `NFR-005` to both change capacity and transactional audit consistency. This makes downstream evidence ambiguous. The canonical crosswalk retains the first as `NFR-005`, maps the second to `NFR-006`, and shifts legacy `NFR-006–012` to canonical `NFR-007–013`. The legacy body is unchanged.

### GAP-RQ-002 — Recovery objectives were not measurable

The design deferred RTO/RPO to a generic ERP policy. The user approved `RTO <= 4h` and `RPO <= 15m` on 2026-09-11. These are now `NFR-014` and `NFR-015`; execution evidence remains pending.

### GAP-IMP-001 — Persisted Attribute/Variant data is omitted from detail responses

`ItemAdminService` returns `attributeValues: []` and `variantValues: []`; schemas enforce `maxItems: 0`. Attribute/Variant tables and write behavior exist, so persisted information becomes invisible through the promised detail API/UI. Remediation: TASK-037 / TC-013.

### GAP-IMP-002 — Designed standalone SKU creation is absent

The design lists `POST /api/v1/skus/create` and a SKU-create page. The implementation supports Variant SKUs during Item creation but has no route/client/page to add a SKU later. Human decision `HD-001` on 2026-09-11 retains the ability to add a unique SKU to an existing Variant Item and classifies the missing route/client/page as implementation work, not a requirement removal. Remediation: TASK-038.

### GAP-IMP-003 — Audit is API-only

`GET /api/v1/item-audit/logs` exists, while the designed audit page/timeline/client does not. Authorized users therefore cannot satisfy the documented UI history flow. Remediation: TASK-039.

### GAP-IMP-004 — Referenced Brand/UOM deletion likely leaks an internal DB failure

Current Item/SKU tables reference Brand/UOM. `deleteBrand()` and `deleteUom()` still state that such tables do not exist and do not map FK rejection to `CATALOG_IN_USE`; `deleteAttribute()` demonstrates the expected pattern. This is a static-review `LIKELY_DEFECT`, not an executed FAIL. Remediation: TASK-040 / TC-014.

### GAP-IMP-005 — Import changes are not transactionally audited per aggregate

The execution worker performs direct Item/SKU/UOM SQL. Confirmation writes one job-level `item.import` audit in an earlier transaction, but imported Item creates/updates do not receive the same per-aggregate audit semantics as interactive changes, and the confirm audit is not atomic with later execution. This conflicts with FR-AUDIT-001/004, BR-021 and canonical NFR-006. Remediation: TASK-041 / TC-015.

### GAP-INT-001 — Downstream reference guard remains deferred

No current production Purchasing/Inventory/Sales table has a true SKU FK; existing SKU references are Item-internal children. The design deliberately avoids a speculative provider. Add the contract/FK checks with the first real consumer under TASK-043; do not mark affected downstream acceptance criteria PASS today.

### GAP-TASK-001 — T23 progress conflict

The frozen legacy task index left T23 unchecked, while the detailed T23/T24 records and merged code state that the work was completed. ERP Product Owner (Sam) approved the TASK-042 reconciliation on 2026-09-14. The canonical index is now checked and carries an explicit note linking implementation commit `21a8be0093d52faa19a1c0f061083046dea2a9f1`, merge commit `45d686ce94c74f08499c35e1e6c3cdc09714480a`, and T24 follow-up `b153efac5ad8c36acddaf85b98c82d6d1e4622f5`; the original source SHA and pre/post counts remain recorded. Status: `RESOLVED`.

### GAP-TASK-002 — Release checkpoint remains conditional

Checkpoint L explicitly leaves staging migration/re-run and business/QA/Ops/compliance sign-off unchecked. Sample Catalog data is illustrative, not formally business-approved. DR targets have not been exercised. Remediation/evidence: TASK-044.

## Scope integrity

No product behavior was changed. Receiving overrides, real downstream reference integration and formal business sign-off remain owned by their future modules/owners. New work is listed as planned remediation rather than rewritten into completed T01–T36 history.

<!-- HARNESS_V2_ALIGNMENT_NOTES -->

## Harness v2 control gaps

### GAP-DOC-001 — Module owner was not confirmed

- Area: REQUIREMENT / GOVERNANCE
- Severity: HIGH
- Type: DOCUMENTATION_GAP
- Evidence: the v1 review repeatedly requires owner sign-off but names no accountable Item Management owner.
- Impact: approval, risk acceptance and release decisions cannot be authenticated or bound to the current plan.
- Resolution: human decision `HD-002` confirmed `ERP Product Owner (Sam)` on 2026-09-11; manifest, state and reviews were updated.
- Human clarification required: NO
- Status: RESOLVED

### GAP-DOC-002 — Product comments reference the removed pre-canonical design path

- Area: DESIGN / LINKAGE
- Severity: LOW
- Type: IMPLEMENTATION_GAP
- Evidence: Item source comments reference `docs/items_management/design_spec.md`; canonical v2 path is `03_design_spec.md`.
- Impact: developers following inline links reach a missing file, but runtime behavior is unaffected.
- Proposed action: update comments only in an authorized `IMPLEMENT` change or a separately approved source-documentation patch.
- Human clarification required: NO
- Status: OPEN

### GAP-TC-002 — Recovery acceptance environment is not available

- Area: TECH_TEST
- Severity: HIGH
- Type: IMPLEMENTATION_GAP
- Evidence: superseded on 2026-09-15. `server/scripts/runItemRecoveryAcceptance.js` now implements a fail-closed, verification-only adapter for an already restored schema plus media/import roots. Its repo-bound trust policy is deliberately `UNPROVISIONED`, so it emits TC-016 `NOT_RUN` until an approved environment identity, restored-schema prefix and Ed25519 attestation public key are committed. Focused developer tests pass; a true-MySQL rehearsal cannot create an isolated schema because the local `erp_user` is scoped to `erp_dev` only. No approved staging-like restore environment or real backup identifiers are available.
- Impact: the executable gap is remediated locally, but RTO/RPO still cannot receive formal PASS evidence until a real restore is run in an authorized staging-like environment.
- Proposed action: review and commit the adapter, provision an isolated restored schema/volumes with appropriate credentials, generate the pre-restore manifest, then execute the `item-recovery` suite under a newly approved PLAN/candidate.
- Human clarification required: YES for environment/operations authority
- Status: PARTIALLY_REMEDIATED; ENVIRONMENT_BLOCKED

### GAP-TC-003 — Existing automated results do not emit canonical TC IDs

- Area: TECH_TEST / EXECUTION CONTRACT
- Severity: HIGH
- Type: IMPLEMENTATION_GAP
- Evidence: superseded on 2026-09-15. Meaningful server cases now emit `TC-001`–`TC-010` and `TC-013`–`TC-015`, seven client cases emit `TC-011`, and the real performance suite emits `TC-012`; see `testing/evidence/remediation-*.xml`.
- Impact: local mapping is now complete for `TC-001`–`TC-015`; formal credit still fails closed until review, PLAN approval and Harness rerun.
- Proposed action: complete independent review and formal retest without lowering required case mappings.
- Human clarification required: NO
- Status: CLOSED by developer retest and impact regression; formal acceptance rerun remains pending.

### GAP-UAT-002 — Project Playwright configuration is absent

- Area: UAT
- Severity: HIGH
- Type: IMPLEMENTATION_GAP
- Evidence: superseded on 2026-09-15. The configured project executes 13 canonical IDs against live API/UI/MySQL; 11 pass and UAT-005/UAT-015 are explicit external-condition skips.
- Impact: reproducible browser automation now exists; the two skipped cases and business acceptance still block UAT completion.
- Proposed action: formally rerun after PLAN approval; retain TASK-043/real-reference and staging/sign-off blockers.
- Human clarification required: NO
- Status: CLOSED by developer browser retest and client regression; UAT-005/UAT-015 remain separately blocked.

### GAP-REV-001 — Independent review provenance is not observable

- Area: DESIGN REVIEW
- Severity: HIGH
- Type: DOCUMENTATION_GAP
- Evidence: the v1 title said “Independent Design Review” but recorded no separate reviewer identity/context or reviewed design hash.
- Impact: the review cannot satisfy the Harness independent-review gate.
- Proposed action: this run records `SELF_REVIEW`; obtain an actual separate-agent or human review against the current design hash.
- Human clarification required: YES if a self-review exception is proposed
- Status: OPEN
