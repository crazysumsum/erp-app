# TASK-029 — HD105 A implemented / developer verification

## Outcome and immutable local review candidate

Sam's actual A on 2026-10-07 is recorded as HD105 ANSWERED / APR134. His subsequent actual reply 「已審閱，批准 TASK-029」 answers HD106 and is recorded as independent HUMAN review REV083 / scope approval APR135 on the unchanged source below. No detailed review findings were supplied. Native artifact hashes, strict JUnit counts, command/spec/source identity,140 retained refs and owned cleanup were rechecked before marking TASK029 DONE locally. Harness returns to IMPLEMENTING; no product/test changes or test reruns occurred in the review-approval checkpoint. This is not P3 completion, formal TC/UAT acceptance or publication authority.

- Worktree: `/Users/sam/.codex/worktrees/inventory-p3-operations/erp-app`, branch `codex/inventory-p3-operations`; HEAD `869ac07abdd3879254c351d857be911d71e68b6b`. The working diff is uncommitted.
- Source fingerprint: `686578e6e2d8ee67f0e49d6d33080e6d0a31d2c4b230485288fa3ddc1a250338`.
- DESIGN: `de32a25f52faeddc65234963935f44a4e73a6a505f44f52dca2283f5e6913f93`; PLAN: `41949846cafde277c6887a7b572e0b3f945425d9a16f1b96517d99ca1674617c`.
- Adopted main remains `4f09b491d8c7d5393c7e36beb707bc7bb4ad039e`; no later main adoption or remote CI claim.
- Original0064 SHA256 remains `07653bb700a40b026e8bb46b538e0e31b112d6c20010af45b4cc71a6ff7ac143`; no migration, permission seed, dependency, profile, discovery or threshold change.

## Material changes and review scope

[InventoryMasterService.listBins](../../../server/src/modules/inventory/InventoryMasterService.js) first executes its existing lock query. Only ER_NO_SUCH_TABLE followed by proof that BOTH inventory_stocktakes and inventory_bin_locks are absent permits retry with locked=false. Owner/status/search/sort/paging and DTO remain unchanged; LOCKED returns empty. Partial schema, existing lock tables, other SQL errors or failed inspection propagate failure. Existing authorization and all write-side lock/owner/version/stock checks remain intact. Four new regressions cover these boundaries; direct TDD first reproduced the failure and then passed all16 Master cases. Other Master detail/lifecycle future-table references are outside HD105 and are not described as fixed.

[Transfer page](../../../client/src/pages/inventory/TransfersPage.vue), [Draft editor](../../../client/src/components/inventory/TransferEditor.vue), [SKU selector](../../../client/src/components/inventory/TransferSkuField.vue) and [Receive form](../../../client/src/components/inventory/TransferReceive.vue) reuse existing Quasar/FormPanel/DataTable and Inventory client/authorization conventions. They provide explicit per-line SKU/Lot selection, full versioned Draft replacement, whole Dispatch/Receive, In Transit read-only detail, destination-owned Bin IDs and mandatory Quarantine reason. Conflicts retain input without automatic repost. New Draft clears the old detail identity; status-only Receive changes participate in close/refresh guards. The two latter issues were reproduced by failing component regressions before correction.

SELF_REVIEW covered correctness, simplicity, module ownership, security, bounded queries and actual runtime behavior. No open critical/high finding was identified within this increment; self-review is not Sam's independent approval. No generic abstraction, new package, fake lock table or relaxed guard was added.

## Current-source native DEVELOPER results

| Configured contract | Observed result / native evidence |
| --- | --- |
| inventory-p3-browser | [8 PASS](../evidence/task029-inventory-p3-browser-36a6e65e82/run.json) |
| inventory-p3-api | [13 PASS](../evidence/task029-inventory-p3-api-50208b6a10/run.json) |
| inventory-p3-unit | [27 PASS](../evidence/task029-inventory-p3-unit-db85553595/run.json) |
| inventory-developer | [163 PASS](../evidence/task029-hd105-nondb-208aaf4b35/inventory-developer/run.json) |
| inventory-p3-transfers-client | [13 PASS](../evidence/task029-hd105-nondb-208aaf4b35/inventory-p3-transfers-client/run.json) |
| inventory-p3-server-coverage | [2138 PASS](../evidence/task029-hd105-nondb-208aaf4b35/inventory-p3-server-coverage/run.json); configured root unit coverage, not the complete DB integration suite |
| inventory-p3-client-coverage | [706 PASS](../evidence/task029-hd105-nondb-208aaf4b35/inventory-p3-client-coverage/run.json); no invented global client floor |
| inventory-p3-coverage-floors | [original34 high-risk file floors PASS](../evidence/task029-hd105-nondb-208aaf4b35/inventory-p3-coverage-floors/run.json), exact current root LCOV |
| lint / client-build | [lint exit0](../evidence/task029-hd105-nondb-208aaf4b35/lint/run.json), [build exit0](../evidence/task029-hd105-nondb-208aaf4b35/client-build/run.json) |

Every JUnit contract has zero FAIL/SKIP/NOT_RUN. Commands, strict parsers, minimum discovery and original gates are unchanged. The browser used actual MySQL26.7.0, real API, JWT/version revocation, production validation/CORS/limiter and route.continue, not mocked responses. It verified two-line stock-conserving Dispatch/Receive, no-Balance Draft versus rejected Dispatch, view-only controls, unknown SKU/invalid quantity, actual revoked-token401/login/token removal, delayed lookup/loading/XSS escaping, stale409 retained input, Quarantine reason/destination ownership, keyboard/unsaved close/refresh and responsive layout. No unexpected browser console or API network failure remained; only exact expected404/401/409 were allowed. [320px](../evidence/task029-inventory-p3-browser-36a6e65e82/transfer-draft-320.png), [768px](../evidence/task029-inventory-p3-browser-36a6e65e82/transfer-draft-768.png), [1024px](../evidence/task029-inventory-p3-browser-36a6e65e82/transfer-draft-1024.png), [1440px](../evidence/task029-inventory-p3-browser-36a6e65e82/transfer-draft-1440.png) and [received detail](../evidence/task029-inventory-p3-browser-36a6e65e82/transfer-received.png) were visually inspected; narrow forms scroll vertically without document-level horizontal overflow. Screenshot bytes are included in native artifact hashes.

## Retained failures and cleanup

Historical initial fixture/API failures remain in the [HD105 proposal](task029-ui-bin-query-decision.md). After the Bin fix, [4/8 browser PASS](../evidence/task029-inventory-p3-browser-706b56d556/run.json) exposed test selector mistakes: closing Quasar menus, duplicate alert roles and asserting text on an input. Selectors were scoped to observed aria-controls and exact values/messages without relaxing product assertions. [8/8 PASS](../evidence/task029-inventory-p3-browser-487a570703/run.json) is historical after the subsequent UI guard corrections. [7/8 PASS](../evidence/task029-inventory-p3-browser-36c6d7bebc/run.json) correctly observed beforeunload but incorrectly awaited a canceled navigation; triggering native reload and checking the dismissed dialog's retained form corrected the test. [8/8 PASS with revocation](../evidence/task029-inventory-p3-browser-5bc3acad48/run.json) is historical after lint corrections.

[Native lint FAIL](../evidence/task029-hd105-nondb-24368c171f/lint/run.json) identified an implicit Node process reference and forbidden control regex in new files. Explicit node:process import and Item's existing code-point comparison pattern preserve the ASCII restriction without lint suppressions/config changes. Final browser screenshots wait deterministically for the selector menu to hide. All source-bound API/browser/regression proofs were rerun after these corrections; no old PASS was relabelled.

Every owned socket-only MySQL instance/schema/app account/daemon/socket/root/lease and sleep guard was precisely cleaned; actual API migrations used the existing70-entry ledger. Browser Vite5205 absence was verified. Only disposable synthetic data was removed and cannot be recovered; native evidence and dirty/unmerged worktree remain. Non-DB cache/temp/synthetic keys were removed, existing owned dependencies retained. The broken pre-existing temporary Python symlink was not repaired or reinstalled; the existing bundled Python3.12.14 executed the controllers. Known Node/jsdom test warnings and build chunk-size warning remain visible, without configuration suppression.

## Next safe action

TASK029 local implementation DoD is complete after actual Sam review; approval is bound to source686578e6, not an unseen future candidate. The next planned task is TASK030 Bin Move, still PENDING; obtain explicit user start authority before its implementation. Publication needs separate authority, fresh-main integration and current-candidate CI/review. No staging/commit/push/PR/remote CI/merge, laterTasks execution, new main adoption, formal TC006/UAT060 sign-off, release or capacity waiver occurred. Four capacity cases remain NOT_EXECUTED and mandatory at applicable full-P3/release gates. P3 is not complete.
