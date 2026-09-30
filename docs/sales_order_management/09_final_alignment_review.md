# Sales Order Management Final Alignment Review

> **Current readiness (2026-09-30): BLOCKED — candidate baseline refresh.** Older sections retain their original review-time facts and approvals; they are historical evidence. The current source observation and proposed disposition are in `09_final_alignment_review.md` §12. No product implementation or acceptance execution has occurred.

## 1. Mode, Scope and Baseline

| Item | Result |
| --- | --- |
| Execution mode | `REVIEW_AND_ALIGN` |
| Output | `docs/sales_order_management/`（in-place replacement authorized） |
| Feature | Sales Order Management |
| v1 alignment worktree | `codex/sales-order-requirements` at `62b4d7f41d204238be652ebb4b7787209d463910` (historical) |
| Harness 2.0 alignment worktree | `codex/sales-order-align-harness-v2` |
| Refreshed default baseline | `main` at `0ca4e9f7e0b29d2e43e982f340a48edbda3d96c2` (equal to `origin/main`) |
| Source code changed | No |
| Application/acceptance tests executed | No |

## 2. Generated Aligned Artifacts

| Artifact | Outcome |
| --- | --- |
| `00_artifact_inventory.md` | Source types, authority, hashes, baseline and missing implementation classified. |
| `00_gap_analysis.md` | 15 documentation/implementation/baseline gaps with severity, evidence, impact and action. |
| `01_requirement_spec.md` | 140 canonical FR aliases, 16 NFR and 15 SEC; approved DR target recorded. |
| `02_requirement_review.md` | Requirement quality and unresolved gates independently assessed. |
| `03_design_spec.md` | 20 canonical Design items mapped to the unchanged detailed design. |
| `04_design_review.md` | 12 adversarial findings across architecture/security/DB/SRE/engineering/QA. |
| `05_development_tasks.md` | Five mergeable Phases and 63 canonical Task aliases, all `PLANNED`. |
| `06_technical_test_cases.md` | 60 formal Technical Acceptance cases, all `PLANNED`. |
| `07_uat_test_cases.md` | 129 legacy UAT cases preserved with one-to-one canonical aliases, all `NOT_RUN`. |
| `08_traceability_matrix.md` | Requirement → Design → Phase → Task → TC → UAT and gate status. |
| `08_traceability.json` | Typed ledger: 171 requirements, 20 designs, 5 phases, 63 tasks, 60 technical tests, 129 UAT cases with applicability/mandatory/blocking flags. |
| `00_module_manifest.json` | Module identity, scope, allowed/approval-required/forbidden paths, provided/consumed contracts with pinned SHA-256 and data ownership. |
| `00_project_profile.json` | Reviewed command/environment/permission contracts and the four mandatory CI checks. |
| `00_harness_state.json` | Revisioned state, baselines, approvals, reviews and four open major decisions. |

## 3. Provenance and Legacy Alignment

- Preserved: the full semantics of all four legacy files are embedded in the corresponding canonical files; only obsolete document paths were normalized. Git commit `97d50e2` preserves the pre-reconciliation workspace copies; its Requirement、Tasks及UAT match the recorded SHA-256 values, while its Design also contains the later Fulfillment contract amendments now merged into the canonical design. The legacy filenames were replaced as explicitly authorized.
- Enhanced: numeric Harness aliases, separately numbered NFR/SEC controls, Technical-vs-UAT separation, Phase gates, traceability and provenance.
- New: only `NFR-014` RTO <=4h and `NFR-015` RPO <=15m, explicitly approved by the user on 2026-09-10.
- Assumed/open: legacy `ASM-001–009` remain assumptions; actual workload, provider ownership, first Adapter security/address handoff and legal retention start remain open.
- No legacy document is represented as having been authored under this Harness review.

## 4. Design Gate

| Measure | Result |
| --- | --- |
| Open CRITICAL | 0 |
| Open HIGH | 5 (`DR-001`–`DR-005`) |
| Open MEDIUM | 5 (`DR-006`–`DR-010`) |
| Resolved MEDIUM/LOW | 2 (`DR-011`–`DR-012`) |
| Gate | **CONDITIONAL** |

Key blockers are missing upstream provider implementations/owners, unproved cross-module Inventory transaction/lock contract, absent disk-stream upload, unimplemented fresh Sales authorization, and a source branch 13 commits behind current main with untracked documents.

## 5. Traceability Coverage

| Layer | Coverage / count |
| --- | --- |
| Requirements | 140 FR + 16 NFR + 15 SEC = 171 |
| Design | 20 canonical items; 171/171 requirements covered |
| Plan | 5 Phases, 63 Tasks; 171/171 requirements covered |
| Technical Acceptance | 60 planned cases; 171/171 requirements covered |
| UAT | 129 not-run cases; every business FR covered |
| Mechanical validator | PASS; no likely gap |

The validator's 144/171 informational UAT coverage is expected: infrastructure-only NFR/SEC items use explicit `N/A` UAT applicability and objective Technical Acceptance instead of fabricated business tests.

## 6. Phase Order and Merge Boundaries

| Phase | Checkpoint | Principal blocker | Planned merge boundary |
| --- | --- | --- | --- |
| PHASE-001 | Upload/providers/config/primitives/DB foundation; feature disabled | DR-001–005 | Foundation PR or ordered compatible PR set |
| PHASE-002 | Quotation + manual Draft + inquiry | PHASE-001 | One vertical capability PR |
| PHASE-003 | Confirmation + Reservation/Backorder + lifecycle | Inventory/DBA contract approval | One commitment/lifecycle PR |
| PHASE-004 | CSV + canonical Channel intake | Disk gate; no public Channel route | One intake PR |
| PHASE-005 | Inquiry/export/archive/reconciliation/capacity/DR | workload, open-matter providers, Ops evidence | One release PR or ordered query/archive/evidence set |

Each Phase must start from then-current main in a dedicated worktree. If main moved, integrate it into the Phase branch and rerun all affected gates before merge. Migration numbers are assigned only after current-main discovery.

## 7. Unresolved Decisions and Implementation Gaps

| Item | Owner / evidence required | Blocks |
| --- | --- | --- |
| Approved Customer/Inventory/Fulfillment provider version and contract tests | Module owners, Engineering | PHASE-001/003/005 |
| Inventory batch transaction/global lock order | Inventory owner + DBA + real-MySQL proof | PHASE-003 |
| Disk-stream upload memory/security gates | Framework owner + QA | PHASE-004 CSV enablement |
| Fresh actor/service reauthorization | Security + Engineering | All write/job effects |
| Actual order-line distribution and peak rate | Product/Data/QA | Performance sign-off |
| First platform auth/address handoff | Integration + Security + Fulfillment | Adapter go-live |
| Downstream open-matter providers | Fulfillment/Invoicing/Returns owners | Corresponding Archive enablement |
| Retention start/longer legal period | Business/Compliance | Future purge; no-purge remains safe |

The absence of Sales migrations/modules/handlers/pages/tests is an `IMPLEMENTATION_GAP`, not a documentation failure. It is represented by planned Tasks; this mode did not fill it with stubs or product code.

## 8. Validation Evidence

- `validate_traceability.py` (Harness 2.0, observed 2026-09-15): **`STRUCTURE_PASS`**. Scope is formal definitions and graph consistency only — not semantic coverage, test execution or authorization.
- `render_traceability.py --write`: **`RECORDED`**; `08_traceability_matrix.md` is now generated from `08_traceability.json` and is no longer hand-maintained.
- Cross-module regression check: `fulfillment_shipping_management` remains `STRUCTURE_PASS` after its pinned Sales design contract hash was updated in the same PR. `customer_management` and `purchasing_receiving_management` remain `BLOCKED` on **pre-existing** drift against `docs/business_master/03_design_spec.md` and `docs/supplier_management/03_design_spec.md` respectively; those are outside this module's scope and were not touched.
- The v1 `09_traceability_validation.md` was **deleted**: it recorded a v1 validator PASS against a worktree root that no longer exists, and per `MIGRATION.md` §6 an old PASS string cannot be promoted to current-gate evidence.
- Identifier completeness: FR 140/140, NFR 16/16, SEC 15/15, DES 20/20, PHASE 5/5, TASK 63/63, TC 60/60, UAT 129/129.
- Obsolete legacy filenames/path references were removed; canonical document references resolve within the top-level package.
- Git commit `97d50e2` preserves all four pre-reconciliation workspace files. Requirement、Tasks及UAT match the initial SHA-256 inventory; the Design difference is the documented Fulfillment contract alignment now present in `03_design_spec.md`.
- Markdown trailing-whitespace scan is clean; final whitespace check is recorded in the handoff.
- Application lint/unit/integration/build/security/browser/performance/restore/UAT were **NOT RUN** because REVIEW_AND_ALIGN forbids claiming execution acceptance.

## 9. Final Disposition

**ALIGNED TO HARNESS 2.0 — `STRUCTURE_PASS`; DESIGN APPROVED AS A PLANNING BASELINE; NOT READY FOR IMPLEMENTATION.**

The design was approved as a planning baseline by human independent reviewer Sam on 2026-09-15 (`APR-DESIGN-001`,
`REV-002`). That approval does not accept the five open `HIGH` findings and does not authorize `IMPLEMENT`, test
execution, UAT or release. `STRUCTURE_PASS` means structural checks only — not business coverage, not acceptance.

To proceed, first preserve/commit the documents, update the planning baseline from current main, and obtain the owners/evidence required by the affected Phase entry gates. A separate explicit `IMPLEMENT` authorization is required before product-code changes.

## 10. PLAN_READY gate closure (2026-09-15)

`verify_gate.py --gate PLAN_READY` now returns **`LOCAL_CHECKS_PASS`** for a **scoped** start. The path from `BLOCKED` to here was four separate things, recorded so the reasoning can be audited:

**1. Three findings were re-dispositioned, not waived.** `DR-003` (50 MB upload), `DR-004` (fresh authorization) and `DR-005` (stale baseline) were `OPEN` `HIGH`. None is an external unknown: each is an implementation obligation already bound to a mandatory technical test — `TC-004`/`TC-005`/`TC-006` for `DR-003`, `TC-008` for `DR-004`, `TC-002` for `DR-005` — and each becomes a `PHASE-001` exit criterion. `DR-005` is additionally closed on observed evidence: the documentation is committed and merged to `main` at `d6b03f9`, so it is neither untracked nor recoverable only from a vanished worktree.

**2. Four medium findings were closed or explicitly deferred.** `DR-006` by approving a **synthetic** performance baseline (`APR-BASELINE-PERF-001`) — not measured business data, and re-runnable if real distribution differs. `DR-007` by recording the canonical-intake-only scope boundary the design already implements. `DR-008` by accepting fail-closed archive behavior. `DR-009` deferred to `PHASE-005` timed-recovery evidence against `NFR-014`/`NFR-015`.

**3. Two findings remain OPEN and were not resolved.** `DR-001` and `DR-002` are genuine external dependencies: `server/src/modules/` on `main` at `d6b03f9` contains `audit`, `authorization`, `businessMaster`, `item`, `role`, `user` — no `customer`, `inventory`, `fulfillment` or `sales`. What was approved is not the risk but a **reduced scope** that avoids it (`APR-RISK-001`).

**4. Three recording defects were corrected.** `APR-DESIGN-001` carried a path glob where `approval_valid()` matches on `module_id`; the RTO/RPO `UAT_NA` approval and the `RISK` approval were bound to the DESIGN baseline, but every non-`DESIGN` approval kind must bind to the PLAN baseline. These misrepresented approvals that had actually been given.

### Authorized scope

| Scope | Status |
| --- | --- |
| `PHASE-001` `TASK-001`–`TASK-008` | **Authorized** for `IMPLEMENT` — upload framework hardening and Sales primitives; no dependency on any missing provider |
| `TASK-009`, `TASK-010`, `PHASE-001` exit gate | **Blocked** — require Customer and Inventory modules to exist |
| `PHASE-002` – `PHASE-005` | **Blocked** — approved as a plan, not authorized for entry |

`TASK-001` must re-discover the migration sequence before coding: it is `0027` on `d6b03f9`, not the `0024` the plan was written against.

`LOCAL_CHECKS_PASS` is local evidence consistency only. It is not authorization, not CI, and not business acceptance. No product code has been written and no test has been executed.

## 11. State reconciliation and IMPLEMENT readiness (2026-09-15)

### The real blocker that was found

`state_tool.py checkpoint` into `active_mode: IMPLEMENT` was **refused**:

```
BLOCKED  STATE_ERROR  unblocked state must clear resume_status
```

`resume_status` was correctly set to `PLANNED` while `status` was `BLOCKED`, but was not cleared when `status` became `PLANNED`. `validate_state()` does not check this, so `state_tool inspect` and `verify_gate --gate PLAN_READY` both passed while the transition into `IMPLEMENT` was actually unreachable. It is now cleared, and a probe checkpoint returns `RECORDED` (the probe was reverted; the module remains `REVIEW_AND_ALIGN` / `PLANNED`).

### Why `state_tool inspect` reads BLOCKED from the primary repo

This is structural, not a defect in this module. `state_tool inspect` calls `validate_state(observed=True)`, which compares three fields against the environment you inspect from:

| Field | Compared against |
| --- | --- |
| `baseline/worktree` | the `--repo-root` you passed |
| `baseline/code_commit` | that repo's current `HEAD` |
| `baseline/source_fingerprint` | a hash of tracked **and non-ignored untracked** files, excluding this module's docs |

Two consequences follow:

1. **A committed state file can never record the commit that contains it.** Recording `code_commit` requires knowing a SHA that depends on the file's own content. So `inspect` cannot pass at the commit that introduces the state — only in the working tree before that commit is made.
2. **The fingerprint moves for reasons outside this module.** It covers non-ignored untracked files, so a developer's local scratch files change it; and because it spans the repository outside `docs/sales_order_management`, any other module's commit changes it too.

This is why **all eight** v2 modules in this repository report `BLOCKED` on `state_tool inspect` from the primary repo, not just this one. It is the normal resting state between sessions.

`verify_gate` deliberately calls `validate_state()` **without** `observed=True`, which is why `PLAN_READY` is unaffected. **`verify_gate --gate PLAN_READY` is the readiness signal; `state_tool inspect` from the primary repo is not.**

### What was changed

- `resume_status` cleared — the substantive fix.
- `baseline/worktree` re-anchored from the deleted `sales-plan-gate` worktree to the primary repository, so a resuming session has a live path.
- `next_safe_action` now carries the entry procedure, including the requirement to re-observe `worktree` / `code_commit` / `source_fingerprint` in the new worktree.

### Entry procedure

1. `git fetch origin --prune`, create a worktree from the refreshed default branch.
2. Re-observe and checkpoint the three environment fields **in that worktree**.
3. Checkpoint `active_mode` to `IMPLEMENT` with a real authorization reference.
4. Start at `TASK-001`, which re-discovers the migration sequence — `0027` on main, not the `0024` the plan was written against.

Scope limits are unchanged: `TASK-009`, `TASK-010`, the `PHASE-001` exit gate and `PHASE-002`–`PHASE-005` stay blocked while `DR-001` and `DR-002` are open.


## 12. Current scoped implementation readiness refresh (2026-09-30)

### Scope, authority and observed baseline

- Active mode remains `REVIEW_AND_ALIGN`; this change prepares entry to `IMPLEMENT` and writes only `docs/sales_order_management/**`.
- User authorization: current Codex chat, 2026-09-30, Sam's exact reply **「同意，請推進」** to the preceding recommendation to repair the planning baseline, scope and self-test configuration, then resume TASK-001～008 after PLAN_READY. This is authority for preparing this candidate; it is not recorded as approval of a future, unseen hash.
- Fetched default/worktree source: `dd36250819b80cb679c688bc8a893e694119f66a` (`origin/main`; fresh worktree branch `codex/sales-readiness-refresh`). Recovery point is this exact committed source; no source documents were deleted.
- Candidate DESIGN hash: `97b111294cbb55350d8318ab20c1a203bbba3f3e3fdd6d4063beba6288ea23a2`.
- Candidate PLAN hash: `932a40a9b77a1d3d0f56fb701a07b115a155dda21a9b69132fa9eb065413610d`.
- Requirement/design narrative, provided Sales contract file, stable FR/DES/PHASE/TASK/TC/UAT IDs and formal acceptance flags are unchanged. Manifest scope/contracts, project profile and task-level path/self-test details changed, so old DESIGN/PLAN/risk/SCOPE/UAT_NA approval use is invalidated by hash; historical records remain intact.

### Reviewed consumed-contract changes

Hash refresh follows the actual diff review above; it is not approval or proof of provider readiness.

| Contract | Prior pinned SHA-256 | Reviewed current SHA-256 | Compatibility and readiness conclusion |
| --- | --- | --- | --- |
| `inventory-batch-reserve-release-contract` | `ffbffdf71a6b2cd639ba41f68c5bfe1965310d920387023908ef1070d881790f` | `9df21d75c290dab878991e8e42ec9eeef4c35b0e4a43783b33f7c3c7444b5f92` | Reviewed 44 additions / 37 deletions since ea601dd: exact MySQL 26.7.0, approved Item transaction lookup/SKU name, migration allocations and evidence rules. These do not implement the Sales-specific reserve/release contract. Inventory reservations/allocations are not present on this source baseline; DR-001/002 remain open. |
| `customer-snapshot-and-credit-contract` | `f132bb6122586508153b0356c5a6c29c8d79a55bb5f0afbe6f8c2b699d445776` | `ab567021254b09d5103caac5bba9b2e3324c0278e726d84999870abcdd7fe440` | Reviewed 25 additions / 3 deletions: Business Master impact checker, bank normalization hardening and durable export. Sales findById(purpose:new_sale)/getCreditPolicy signatures are unchanged and now implemented. Sales consumer integration/owner proof remains TASK-009 work. |
| `item-lookup-service` | `6aff6504eb3cae4347c05a7deaba1c4c7eb1e2de3142f9a7de1eb4587c2f8d90` | `2f6924b6545395a56581619d0f621a215f0aa18115115071cc8ed00d023c685a` | Reviewed additive skuName and Inventory transaction/UOM helpers. Existing generic lookup remains available; findManyForSale/findSaleUom/searchForSale and suggested-price Sales projection remain absent. Do not replace those contracts with raw table reads. |
| `permission-catalogue` | `bc0828b5052be1cad23ac6db941f23fde802d482db1c64aa8dadccee87e21fdf` | `4bf3b094d3f62dd61f89190feb453f156f22a10b1b8cbd9cb4864e4f1b45c80b` | Reviewed additive Customer/Supplier/Inventory permissions. Existing permission semantics unchanged; Sales permissions are not seeded or exposed. |
| `idempotency-service` | `6f0f61e8507c206d3d47d93cbf0d099dc916bb95e3de02f163c4283bd7c17925` | `a4bcd80a3c5b067515b3200ea9de1cad0ec5e6f96f8824c2103cd1af0e97a291` | Reviewed identityScope broadening from jwt-only to authenticated non-public identities; jwt-password/device identities no longer fall back to IP. Existing actor scoping is reused; no Sales-specific bypass. |

### Current provider and migration observations

| Dependency | Observed source | Current disposition |
| --- | --- | --- |
| Customer | `server/src/modules/customer/CustomerLookupService.js`: `findById`, `getCreditPolicy`, allowlisted `new_sale` | Core provider exists. Historical "Customer absent" is superseded. TASK-009 and owner/consumer contract proof are not marked DONE or newly authorized. |
| Item | `server/src/modules/item/ItemLookupService.js` | Generic/batch and Inventory lookup exist; named Sales lookup/price projection still missing. TASK-009 remains blocked for entry. |
| Inventory | `server/src/modules/inventory/` | Core/master/posting/inquiry exist; `InventoryReservationService`, Sales batch reserve/release and reservation-state lookup are absent. DR-001/002 and TASK-010 remain blocked. |
| Fulfillment | no `server/src/modules/fulfillment/` | Lifecycle/open-matter/archive coordination unavailable; downstream/archive remain fail closed. |
| Sales | no Sales source, handlers, UI, jobs, migrations or tests | Product implementation has not started. |
| Migrations | maximum committed file `0062_create_supplier_import_rows.js`; prefixes unique | Do not infer that `0063` is free: Inventory's design still allocates future `0063`/`0064`, while Supplier occupies earlier Inventory-planned `0061`/`0062`. TASK-001 must coordinate current owners before a Sales migration allocation; no file was renamed or number allocated here. |

### Proposed scoped entry and execution policy

1. Restore entry only for `PHASE-001 / TASK-001`～`TASK-008`. TASK-009～011, PHASE-001 completion and PHASE-002～005 remain unauthorized/blocked. No new provider implementation, public Sales route/menu/job, Channel transport or archive enablement.
2. Primitives/tests use the existing approved `server/test/sales/**` directory. Shared Upload/FileType/regression paths are now explicitly categorized as approval-required. Requested SCOPE approval covers the exact shared paths added to manifest plus Upload/config, permission catalogue and **only** `server/database/migrations/*_seed_sales_permissions.js` for this scope; it does not authorize all other modules/migrations.
3. `sales-foundation-developer` is a DEVELOPER-only planned suite for the scoped Task self-check. It requires real JUnit nodes, at least six tests, zero skips and TC-003～008 IDs. Sales cases do not exist yet: no runnable/PASS claim is made. Existing full `sales-technical` suite, all 60 formal cases, every Phase developer/merge/exit gate and UAT requirements remain mandatory. This suite cannot make a partial Phase MERGE_READY.
4. TASK-006 reuses `assertActorFresh()` and makes the already-approved DR-004 helper obligation explicit. It must additionally reject absent/inactive actors and require current Sales permissions, with actual tests; no permission-query reimplementation.
5. CI required-check names now include the observed `Browser tests (Playwright)` job. Latest default is PR #169's dependency-fix baseline; its CI was observed **in_progress**, not PASS. The earlier failure on bea7b5f is historical. The fetched dd36250 source CI was subsequently observed **success**: all five jobs passed in https://github.com/crazysumsum/erp-app/actions/runs/36676959943. This is source-baseline evidence, not CI for this documentation candidate or a future product candidate. Current-candidate CI and actual code review remain mandatory before implementation merge.
6. Runtime remains unallocated except this document worktree. Test schema, ports, private temp directory, actual owner and environment authorization must be observed/checkpointed before executing implementation checks. No shared DB, real transaction or live notification is authorized.

### Approval disposition and current gate

`DEC-005` requests a real human decision on these exact candidate DESIGN/PLAN hashes, limited TASK-001～008 risk disposition (DR-001/002 remain OPEN), the specific shared SCOPE above and carry-forward of the unchanged NFR-014/NFR-015 manual-UAT non-applicability. No prior approval hash or reviewer identity is rewritten.

Current status is **BLOCKED pending candidate-bound review/approvals**. Local structural checks may pass while PLAN_READY correctly stays BLOCKED; neither is product/test acceptance. After the decision, record fresh approvals, rerun PLAN_READY, fetch default again, and enter IMPLEMENT in a fresh implementation worktree with actual runtime observations. No product code is written before that handoff.

### Validation and reviewer provenance

Actual separate-agent review: **APPROVE CANDIDATE DOCUMENTATION** by `/root/sales_readiness_review`; provenance, verified hashes and the two carried-forward HIGH findings are recorded in `04_design_review.md` §6. This does not satisfy the pending human risk decision.

The following read-only commands ran against this worktree before the documentation commit:

| Command | Actual result | Scope |
| --- | --- | --- |
| `validate_traceability.py docs/sales_order_management --repo-root /private/tmp/erp-sales-readiness --json` | `STRUCTURE_PASS` | Canonical definitions/relations/profile/matrix only; no business or execution PASS. |
| `validate_module_boundary.py docs/sales_order_management --repo-root /private/tmp/erp-sales-readiness --base dd36250819b80cb679c688bc8a893e694119f66a --json` | `LOCAL_CHECKS_PASS` | Exactly this module's documentation changes; no product writes. |
| `state_tool.py inspect docs/sales_order_management --repo-root /private/tmp/erp-sales-readiness --json` | `LOCAL_CHECKS_PASS` before commit | Live worktree/spec/source observations; reconcile code_commit again after publishing or at implementation entry. |
| `git diff --check` | exit 0 | Patch whitespace. |
| `verify_gate.py docs/sales_order_management --repo-root /private/tmp/erp-sales-readiness --gate PLAN_READY --json` | `BLOCKED` | Candidate-bound DESIGN/PLAN, NFR-014/015 UAT_NA, risk/review disposition and DEC-005 remain pending. All five CONTRACT_DRIFT errors are resolved. |

No application build, Sales developer suite, formal Technical Acceptance, UAT, business acceptance or release was executed. CI evidence above refers only to the fetched source SHA. Historical validation/approval records were preserved.

Requested new shared SCOPE is limited to these planned TASK-001～008 paths:

- `server/config/api.js`;
- `server/src/framework/upload/normalizeUploadConfig.js`, `uploadConcurrencyGate.js`, `uploadMiddleware.js`, `cleanupUploadedFiles.js`;
- `server/src/framework/middleware/apiDispatcher.js`;
- `server/src/services/filetype/FileTypeService.js`, `builtInFileTypes.js`;
- `server/src/modules/authorization/permissionCatalogue.js`;
- `server/database/migrations/*_seed_sales_permissions.js` (number still subject to owner coordination);
- `server/test/uploadLimits.test.js`, `configNormalizers.test.js`, `fileTransfer.test.js`, `fileTransferFailureModes.test.js`, `applicationFactory.test.js`, `permissionCatalogueConventions.test.js`, `permissionCatalogueStartupGuard.test.js`, `directoryLookups.test.js`, `apiDispatcher.test.js`.

Each basename in a grouped bullet is relative to the directory of its first full path. Existing Sales-owned source/tests remain within their manifest scope. No Customer/Inventory/Item/Fulfillment provider writes or other migrations are granted.
