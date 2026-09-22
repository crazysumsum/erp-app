# Item Management non-TASK-043 UAT closeout — 2026-09-22

## Acceptance supersession — approved isolated execution

This section supersedes the earlier `BLOCKED / PENDING` conclusions below. ERP Product Owner Sam subsequently:

- approved the first catalogue shape and authorized synthetic Brand/Internal Barcode fixtures;
- approved `DEC-023` (master data, audit and import summaries at least seven years; import source/result files one year, with longer applicable legal periods taking precedence);
- designated the isolated local MySQL environment as staging-like for this UAT and accepted its differences from deployed staging;
- declared authority to accept the Product, Security, Operations and Compliance outcomes while accepting the consolidated-owner risk; and
- retained the existing recovery `PASS_WITH_OWNER_WAIVER` limitation.

The exact synthetic values were Brand `UAT驗收品牌-20260922` and Internal Barcode `INT-UAT-20260922-000001`. They existed only in schema `erp_item_uat_acceptance_20260922`; `erp_dev` was not used by this acceptance run.

| UAT | Technical result | Business acceptance | Final disposition |
| --- | --- | --- | --- |
| UAT-014 | PASS | ACCEPTED | The approved Category hierarchy, Brand, EA/BOX UOM, Capacity/Flavor attributes, `BOX = 24 EA`, internal Barcode, ownership and zero-duplicate checks passed in UI and MySQL. |
| UAT-015 | PASS | ACCEPTED | Playwright completed create → Barcode find → edit → activate/deactivate → audit → CSV upload/preflight/confirm/execute/result download; the imported SKU was searchable afterward. |
| UAT-016 | PASS | ACCEPTED_WITH_RECORDED_RISK | The delegated role surface passed; full-scale performance and retention evidence passed; recovery remains explicitly owner-waived rather than ordinary independent-signer PASS. |

Observed acceptance data after the passing journey:

- The UI-created Item was updated to `UAT 樽裝飲品 20260922（已覆核）`, and both Item and SKU ended `inactive` after the lifecycle exercise.
- The import job completed with one successful row and zero failures; `UAT-IMPORT-20260922-001` was created and searchable.
- Audit contained Item create/update/activate/deactivate/import and matching SKU create/activate/deactivate actions.
- Category, Brand, UOM and Attribute duplicate counts were all zero.
- Browser console, request-failure and HTTP 5xx assertions were clean on the passing acceptance cases.

Acceptance evidence:

- `evidence/20260922T030500-item-uat015-pass-uat014-attempt3/item-uat-acceptance.xml` — `UAT-015` PASS on the clean isolated dataset; `UAT-014` stopped afterward only because the temporary locator required a unique Brand text while the table intentionally renders name and official name.
- `evidence/20260922T031500-item-uat-acceptance-targeted-retest/item-uat-acceptance.xml` — corrected targeted `UAT-014` and `UAT-016`, 2/2 PASS on the same unchanged dataset.
- `evidence/20260922T023000-item-uat016-performance/item-uat016-performance.xml` — full-scale performance assertions PASS on the same product source fingerprint.
- `evidence/task-044-owner-waiver-20260921/` — recovery 23/23 checks, RTO 176 ms and RPO 66 seconds, retained as `PASS_WITH_OWNER_WAIVER`.

The first two acceptance attempts were test-harness locator mistakes (wrong update endpoint wait, then a non-unique audit-reason locator). They are retained under `evidence/20260922T024500-item-uat-acceptance-attempt1/` and `evidence/20260922T025500-item-uat-acceptance-attempt2/`; neither exposed a product defect. `UAT-014`, `UAT-015` and `UAT-016` now have no remaining acceptance blocker. Overall module status remains `BLOCKED` only for the separately excluded `TASK-043` / `UAT-005` / `UAT-013` dependency.

After evidence capture, the exact isolated schema and storage directory were removed, its advisory lock was released, and verification found no acceptance markers in `erp_dev`.

## Initial execution snapshot (superseded by the acceptance section above)

## Scope and baseline

- Scope: execute the remaining UAT that does not depend on `TASK-043`: `UAT-014`, `UAT-015` and `UAT-016`.
- Explicit exclusions: `UAT-005` and `UAT-013` remain blocked by `TASK-043` and were not reclassified or simulated.
- Code baseline: `71616ec040a7558856083035801554dda940ab5e` (`main`, merge of PR #122).
- Approved plan: `ad2dc754c4b25f7f0acf12ad21354ec3a03d1bd6a8879176917c3f1998416b92`; source fingerprint: `ffbda80ecae8cd5d9d18be7423b49750cc2d38e6aeadf5014145784a262b58bd`.
- Environment: local client/API plus MySQL `erp_dev`, synthetic data only. This is not a separately controlled staging environment.
- Executor: primary `TEST_AND_VERIFY` agent. Business acceptance is recorded separately and is never inferred from automation.

## Result summary

| UAT | Execution result | Business acceptance | Conclusion |
| --- | --- | --- | --- |
| UAT-014 | BLOCKED | PENDING | The documented catalogue is explicitly demonstration-only. Category, Brand, UOM and Attribute examples exist without duplicates, but no SKU UOM conversion or internal Barcode sample exists. Compliance has not approved `DEC-023`. |
| UAT-015 | BLOCKED | PENDING | Browser and true-MySQL supporting journeys passed, but the formal case requires a staging-like release environment and explicit business-owner sign-off. |
| UAT-016 | BLOCKED | PENDING | Full-scale performance, current security/retention checks and owner-waived recovery evidence meet their observed technical thresholds. Unqualified recovery acceptance and named Security, Operations and Compliance decisions remain absent. |

Overall UAT status is `BLOCKED`: no product failure was found, but none of the three cases meets all formal entry, environment and human-acceptance conditions.

## UAT-014 — initial catalogue and retention approval

The read-only review found the following current local sample data:

- Category: `食品 › 飲品 › 樽裝飲品` — present and active.
- Brand: `示範品牌 A` — present and active.
- UOM: `EA`／件 and `BOX`／箱 — present and active.
- Attribute: `CAPACITY`／容量 and `FLAVOR`／口味, with active `原味` and `檸檬味` options — present.
- Duplicate Category names, UOM codes and Attribute codes: zero.
- SKU UOM conversions: zero; therefore the proposed `BOX` factor of 24 is not represented in a usable SKU sample.
- Internal Barcode sample: zero; `INT-DEMO-000001` is documented but not present in the database.

The repository labels these values as development examples that must not be promoted as a production catalogue without business approval. The retention baseline is documented as at least seven years for master data, import summaries and audit, and one year for import source/result files; longer applicable legal periods take precedence. The file-retention behavior passed its true-MySQL test, but `DEC-023` still requires a named compliance review. Because the production-sample and compliance preconditions are missing, the result is `BLOCKED`, not `FAIL`.

## UAT-015 — business release journey

Supporting execution on the exact baseline produced:

- Playwright: 11 passed, 0 failed, 2 skipped. `UAT-005` was skipped for `TASK-043`; `UAT-015` was deliberately skipped because local MySQL cannot supply staging ownership or human sign-off. The passing browser cases cover find, audit display, create validation, adding a SKU to an existing Variant Item, lifecycle/catalog behavior, UOM/price semantics, export, role navigation and accessibility/error handling.
- True-MySQL integration: 22 passed, 0 failed or skipped. This includes the continuous Catalog → Item with two SKUs → search → update → lifecycle → audit → cleanup journey, plus upload → preflight → confirm → execution → result, rollback, authorization-revocation, lease-recovery and retention paths.

The observable functional journey is green, and no Item product defect was raised. Formal `UAT-015` remains `BLOCKED` because its stated entry condition is a staging-like release environment and its exit condition is an explicit business-owner decision.

## UAT-016 — performance, security, retention and recovery acceptance

### Performance

The opt-in release test ran at its specified scale: 100,000 SKUs, 1,000,000 Barcode rows, 1,000,000 UOM rows, 50 concurrent workers and a 10,000-row import. All three assertions passed:

| Measurement | Observed | Threshold |
| --- | ---: | ---: |
| Exact SKU lookup p95 | 369.5 ms | < 2,000 ms |
| Exact Barcode lookup p95 | 406.0 ms | < 2,000 ms |
| First page p95 | 797.4 ms | < 2,000 ms |
| Status + Category filter p95 | 1,479.0 ms | < 2,000 ms |
| 10,000-row preflight + execution | 6.937 s | < 600 s |
| Lookup during import p95 | 3.9 ms | < 2,000 ms |

### Security and retention

- The current browser run passed the `item.mgmt`-only navigation/API surface case without exposing User Management.
- The true-MySQL import suite passed no-permission rejection, post-confirm permission revocation and transaction rollback cases.
- The expired-file case returned `410` while retaining the job summary, matching the implemented one-year file-retention behavior.
- These observations do not replace the named Security and Compliance acceptance decisions.

### Recovery

The retained `TASK-044` restored-copy evidence is part of this `main` baseline and passed 23/23 reconciliation checks with RTO 176 ms and RPO 66 seconds, within RTO ≤ 4 hours and RPO ≤ 15 minutes. Its disposition remains `PASS_WITH_OWNER_WAIVER` under `APR-025`, because the Product Owner approved agent-generated signing instead of an independently controlled signer. The machine-readable `TC-016` status intentionally remains `NOT_RUN`; this UAT must not restate the waived control as ordinary `PASS`.

`UAT-016` therefore remains `BLOCKED` pending explicit Security, Operations and Compliance decisions and either acceptance of the recorded recovery waiver for release or an independently signed recovery exercise.

## Evidence

- `evidence/20260922T020000-item-uat-current-main/item-uat-browser.xml` — current-main Playwright result, 11 pass / 2 skip / 0 fail.
- `evidence/20260922T021500-item-uat015-support/item-uat015-integration.xml` — true-MySQL journey/import result, 22 pass / 0 skip / 0 fail.
- `evidence/20260922T023000-item-uat016-performance/item-uat016-performance.xml` — full-scale performance result, 3 assertions passed.
- `evidence/task-044-owner-waiver-20260921/` — retained recovery manifest, signature and 23-check owner-waiver result.
- The first browser attempt at `evidence/20260922T015000-item-uat-closeout/` failed only because Vite rejected fonts reached through a worktree `node_modules` symlink. Replacing the symlink with a physical dependency clone removed the environment artifact; targeted `UAT-012` and the complete browser rerun then passed. This was not classified as a product defect.

## Cleanup and residual decisions

Post-run read-only checks found zero Items, SKUs, Barcodes and import jobs, zero `PERF-*` SKUs, and zero retained performance/integration users or roles. No UAT fixture remains in `erp_dev`.

The remaining decisions are:

1. Business and Compliance must approve or replace the proposed production catalogue, including a real internal Barcode and SKU UOM conversion sample, and Compliance must decide `DEC-023`.
2. The Product Owner must execute/accept `UAT-015` in a staging-like release environment.
3. Security, Operations and Compliance must record their `UAT-016` decisions; recovery retains the explicit owner-waiver limitation.
