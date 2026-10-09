# Item Management Final Alignment Review

## Current Supplier handoff — 2026-10-09

Scope: `REVIEW_AND_ALIGN`, Item documents only, fresh main `394fc3fb11b6dce0bf4c41288904a8fac6d3fa49`; authorization: Sam's active-task “好，請推進工作”, following the concrete Supplier handoff assessment and SKU eligibility recommendation.

- Item §5.14 now delegates the one relation table to Supplier (`supplier_sku_refs`); Item accepts no Supplier payload and builds no duplicate table. Supplier owns its migration/schema approval and refreshes its own contract pin after this PR merges.
- Manual new/rebound sourcing relations require Active Item/SKU, purchasable and effective dates; retained relations show current status and cannot authorize new purchasing. Completed-GR history projection/replay follows Supplier §6.8 even after deactivation/expiry, with source/identity/UOM validation and no status/preferred/purchase eligibility changes. Draft purchase targets are refused; Item still maps restrictive FK errors defensively. The Product Owner's instruction adopts the prior recommendation; no new runtime eligibility implementation is claimed here.
- OPEN-006 names the real Supplier dependency and test cases. FR-043/UOM-008 is linked to TASK-043, DES-020 and TC-004 in the typed ledger and generated matrix.
- TASK-043 is scheduled now for existing Inventory/Sales consumers; the Supplier branch runs after Supplier TASK-038. Archive tests must distinguish current/open operations from completed history or a pure Supplier relation. Single/bulk rollback and concurrent reference creation remain required.
- Old design/plan/source approvals and test evidence remain historical. They cannot authorize or prove the newly integrated main; current-candidate technical/UAT acceptance is still required. Recovery's existing owner waiver remains in its historical scope.

Validation: traceability with approval consistency passes; deterministic matrix regenerated; module boundary and diff whitespace pass. Separate reviewer `/root/item_supplier_handoff_review` approved the corrected slice as REV-018, with 0 open CRITICAL/HIGH findings. This slice contains no product code, schema execution or formal test run.

### HD-005 — Supplier reference ownership and sourcing eligibility

Sam's active-task “好，請推進工作” accepts the preceding recommendation: Supplier owns `supplier_sku_refs`; Item exposes its existing read contract, preserves stable UOM mappings and schedules reference protection under TASK-043. Manual create/rebind targets must be Active, purchasable and effective; retained relations survive deactivation/archive without granting new purchasing eligibility. Completed-GR historical projection follows the already authoritative Supplier §6.8, not a new purchase authorization. This decision is bound to DESIGN `59ee6cb3664ae1742e41b218ffd3bf223e396eb44a4aa24d82028ebb9cf7c16d` at base `394fc3fb11b6dce0bf4c41288904a8fac6d3fa49`, for this documentation handoff only; it is not formal test/business acceptance or Supplier schema approval.

The earlier sections below record historical alignment states and are not current execution evidence.

## Outcome

**STRUCTURALLY PREPARED; BLOCKED, NOT APPROVED.** The v2 canonical set exists in place, the standalone SKU scope decision is resolved and the accountable owner is confirmed. Actual independent review remains outstanding. Product implementation and formal acceptance are outside this run.

## Mode, module and baselines

| Item | Observed value |
| --- | --- |
| Mode | `REVIEW_AND_ALIGN` |
| Module / output | `item-management` / `docs/items_management` |
| Latest default and mode-entry commit | `fd8a4ddb27636aaeb47235f3d4976001fa7dfc7a` |
| V1 alignment recovery commit | `ceb33b9` |
| Topic branch / worktree | `codex/item-management-harness-v2-alignment` / isolated worktree recorded in state |
| Product-code changes | None |
| Formal tests / CI / UAT | `NOT_RUN`; no acceptance result claimed |

## Canonical artifacts

- Added `00_module_manifest.json`, `00_project_profile.json`, `00_harness_state.json` and typed `08_traceability.json`.
- Preserved and formalized 88 requirements (64 FR, 15 NFR, 9 SEC), 20 designs, 6 phases, 44 tasks, 16 technical cases and 16 UAT cases.
- Renamed the complete design narrative from `03_system_design_spec.md` to canonical `03_design_spec.md`; the legacy body is byte-identical before its v2 appendix.
- Regenerated `08_traceability_matrix.md` deterministically from the typed ledger after owner confirmation `HD-002`; structural validation passes.
- Kept inventory, gap, requirement/design review and historical developer evidence distinct from current specification and execution evidence.

## Recovery and no-loss result

At this review's original baseline, the requirement (808-line legacy body), design (1,500), task (1,533) and technical-test (437) bodies compared byte-for-byte with `fd8a4dd`; their legacy SHA-256 values remain recorded in `00_artifact_inventory.md`. No migration, request schema, source diagram, executable test or other machine authority was deleted. One accidental duplicate TASK-012 alias row was removed. Post-review update: ERP Product Owner (Sam) approved TASK-042 on 2026-09-14, so the canonical T23 index now records completed with an explicit reconciliation note and immutable Git/source references; the original unchecked state remains preserved by this paragraph and the inventory hash.

## Review and findings

Review method is `SELF_REVIEW` by `/root`; the prior “Independent” label had no observable reviewer provenance and cannot satisfy the independent-review policy. Static source comparison reconfirmed DR-001–DR-005: missing Attribute/Variant read projection, absent standalone add-SKU flow, missing user-facing audit history, unstable referenced Brand/UOM deletion errors and import mutation/audit divergence. No executable defect was fabricated from static evidence.

Additional v2 HIGH gaps are missing canonical TC result mapping, missing recovery acceptance adapter, missing Playwright Item UAT configuration and missing independent review. Product-source comments still reference the already-absent pre-canonical `design_spec.md`; changing them needs separately authorized source scope.

## Decisions and readiness

- `HD-001` (`ANSWERED`): retain standalone SKU creation for an existing Variant Item and list it as pending implementation under `TASK-038`.
- `HD-002` (`ANSWERED`): accountable Item Management module owner is `ERP Product Owner (Sam)`.
- Design/review result: `CHANGES_REQUESTED`; 0 observed CRITICAL findings, open HIGH findings remain.
- Implementation readiness: `BLOCKED`; no current plan approval or independent review.
- Business/release status: not accepted and not approved.

## Next safe action

Obtain an actual independent review of the current DESIGN baseline. Any product remediation, including TASK-038, requires explicit `IMPLEMENT`; Technical Acceptance/UAT requires `TEST_AND_VERIFY` against an immutable baseline and the missing execution adapters.

## HD-001 — Standalone SKU creation for an existing Variant Item

| Field | Recorded decision |
| --- | --- |
| Mode | `REVIEW_AND_ALIGN` |
| Issue | Design and UAT require an add-SKU flow for an existing Variant Item, but the route, client and page are absent. |
| Impact | Removing it would change business scope, API/UI design, TASK-038, TC-003 and UAT-004. |
| Options considered | Retain as pending implementation; or remove and realign the requirement/design/UAT. |
| Human decision | **保留並列為待實作** |
| Authority / time | User response in the active Codex task, 2026-09-11 (Asia/Hong_Kong). |
| Binding result | Retain the contract; keep `TASK-038` pending; keep TC-003/UAT-004 mandatory and `NOT_RUN`; do not claim implementation. |
| Affected IDs | FR-017, FR-018, FR-019, FR-021; DES-003, DES-008, DES-015; TASK-038; TC-003; UAT-004. |

## HD-002 — Accountable Item Management module owner

| Field | Recorded decision |
| --- | --- |
| Mode | `REVIEW_AND_ALIGN` |
| Issue | Harness approvals and residual-risk decisions require an accountable module owner. |
| Impact | Without an owner, traceability generation and authenticated business/release decisions remain blocked. |
| Options considered | Confirm the proposed owner; or name a different accountable person/role. |
| Human decision | **確認為 ERP Product Owner（Sam）** |
| Authority / time | User response in the active Codex task, 2026-09-11 (Asia/Hong_Kong). |
| Binding result | Record `ERP Product Owner (Sam)` as module owner; this does not itself approve implementation, tests, UAT or release. |
| Affected scope | All Item Management requirements, designs, tasks, tests, approvals and residual-risk decisions. |
