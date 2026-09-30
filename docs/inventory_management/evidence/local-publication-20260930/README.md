# P2 publication candidate developer checks — 2026-09-30

Authority: Sam's active Codex reply `批准發布` (APR-080) permits push, P2 PR and required CI. It is not independent full P2 code approval, merge or production deployment authority.

Candidate checked: `52070d40df47178570e217d9f92b2438bcdae785`, including freshly fetched main `8bc4a4cfe68710f384cebca8395b78343bef1db9`. Main integration was conflict-free; only upstream Sales readiness documents and existing compatible dependency patches were added. Inventory product diff, DESIGN `53fe56c4bc2f45fb053036de71801ed6d0e8507887cd95b35e4645b9e87adfce` and PLAN `ec0d27569a86720d4e263103d14e429aa01682a6946f3a65de1bbf02d684c973` are unchanged. Source fingerprint: `5d0662b6ac0296e9660d1352f164bba0f768bffa1ea2978f35d94356da9b495c`.

`npm ci --ignore-scripts` physically synchronized this isolated worktree to the integrated lockfile. Existing commands exited 0:

- `npm test --workspace client`: 687/687 tests, 91/91 files.
- `npx --no-install playwright test --config client/e2e/inventory-management/playwright.config.js`: 18/18, zero failures/skips. Existing tests exercise actual Chromium/UI with synthetic network mocks, including expected error responses and assertions for unexpected console/network errors. This is not a real backend browser test or formal acceptance.
- Same Playwright command rechecked with absolute HARNESS_RUN_DIR/HARNESS_RESULT_PATH: 18/18; original and recheck outputs retained. Port 5205 was free before startup and absent after tests.
- `npm run security:audit`: zero vulnerabilities.
- Existing migration runner: all 66 entries applied to the private synthetic schema before API verification.

Separate Harness DEVELOPER reports under the same source/PLAN/runtime record lint/build PASS, inventory units155/155, private DB7/7 and real API1/1 JUnit leaf (outer security/revocation assertions and nested positive provider/FEFO/Allocation/Issue trace executed). All test suites have zero skips. The reports are registered in module state.

An initial API preflight was correctly BLOCKED with SOURCE_CHANGED and did not execute: a relative HARNESS_RESULT_PATH caused Playwright's JUnit reporter to create only `client/e2e/inventory-management/docs/inventory_management/evidence/local-publication-20260930/inventory-browser.xml`. The original XML was moved unchanged into this directory; only the now-empty generated directories were removed. Read-only state inspection then matched the original source fingerprint. Absolute output paths prevented recurrence, and the fresh API report passed. No product/test/config source was changed and the blocked attempt is not represented as PASS.

Raw outputs retain expected Node experimental localStorage and FORCE_COLOR/NO_COLOR warnings. Reports contain synthetic identifiers and task-owned local paths, not production data; no credentials/session-state artifacts are included. Basic secret-pattern checks found no private keys, GitHub/OpenAI tokens or live Bearer JWTs. This is not a universal confidentiality guarantee.

EXT-115: private socket-only MySQL26.7.0 (`skip_networking=1`), schema `erp_inventory_task025_publish_20260930_0705`, root `/private/tmp/erp-inventory-task025-mysql-2670.QXJiMi`. Verified initial system-only schemas, then migration rows66 and ISSUE1 after API. Dropped only the task schema and verified absence, shut down private instance, verified socket/PID absent, ownerSam/mode700/no symlinks, removed exact root and verified absence. Synthetic data is unrecoverable; reports retained; no shared/production data touched. Runtime is retired, so these are preserved developer results, not live-runtime MERGE_READY attestations.

No full server coverage rerun in this integrated checkpoint: previous raw local coverage is retained in `../local-coverage-20260930/`, and the actual published candidate must receive its own five mandatory CI checks. TASK-023/024/025 remain PENDING until complete DoD/independent review. No formal TC/UAT/business acceptance or merge claim.
