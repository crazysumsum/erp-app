# Customer UI defects / HD-012 bounded shared-table proposal

## Current decision boundary

Sam explicitly authorized DEF-034002 and DEF-027001 repair, verification and normal
PR/merge, preserving full downstream acceptance BLOCKED. Existing DESIGN section9.1
explicitly prohibits DataTable modification and the manifest excludes its source.
Actual reproduction localizes DEF-034002 in that shared component. **HD-012 is
therefore OPEN: no shared product code has been changed and no exception is inferred
from the general repair request.** The proposed canonical changes are not active
until Sam approves their exact revised DESIGN/PLAN and shared-file scope.

Actual separate reviewer Jason (`/root/customer_task011_review`) APPROVED the final
proposal only after state184 reconciled its hashes/question and refreshed contract
pin. REV-055 records this final result; original draft approval and Required
metadata correction remain in REV-053/054. This is not human approval or defect
closure. Local state/traceability/docs-only boundary/diff checks pass.

Proposed DESIGN `a2b29b795515f6ee408201d3ac2650a1d42d74728c1ca4c9f2fe68cbfc292356`.
Proposed PLAN `3b15603d9608dcb388f90806f643a5d221514b17ef302f2e2d2f2851699735e0`.

An initial structural check found CONTRACT_DRIFT because the provided Customer
contract pins this whole design document. Refreshed only that own-document SHA to
`5020a183c2ea1e290b8ba0ce1736524e21a99b6268ee54502c5ac48f7e10873d` after reviewing
the UI-only amendment; provider version/behavior and all downstream contract text
are unchanged. STRUCTURE_PASS then passed. The earlier draft hashes/review remain
historical in state; the final hashes above require fresh actual review/approval.

Latest main and isolated worktrees began at
`10ca62adc47d4d099a78afba04e7b569bdd6b370` (PR#233 verified MERGED; its exact-head
CI/review/cleanup closure was observed, not replayed). Planning branch contains
docs only. The separate implementation worktree preserves local test-only commit
`3b890ef4` (exact full SHA in state observation), independently written search
reproductions plus the import-test synchronization correction. It is not part of
this planning PR, a shared fix, a green merge candidate or full acceptance.

## DEF-034002 — stale successful/error search response

- Links: FR-001/NFR-001, DES-016/018/019, PHASE-002/TASK-016, TC-040.
- Severity MEDIUM, status IN_PROGRESS/BLOCKED on HD-012; type IMPLEMENTATION_DEFECT
  plus explicit design/scope exception needed for the shared root fix.
- Expected: after a newer search completes, late old successes/errors cannot
  replace its rows/count/page/error/loading. Clearing restores current results.
- Actual: controlled older success replaces a newer empty result; controlled old
  error displays an obsolete error/retry after the new empty result has succeeded.
- Root: DataTable.onRequest unconditionally writes rows/pagination in its await
  success, error in catch, and loading in finally, without request identity.
  Customer q-input additionally reloads synchronously using pre-update child props
  while QTable already requests on filter change, creating redundant requests.
- Real Playwright browser regression, synthetic API boundary, three cases:
  **1PASS/2FAIL/0SKIP** before any product fix. Sequential input/empty/clear passed;
  deterministic reversed success and error failed at the final observable state.
  Explicit promise gates and request completion events reproduce ordering without
  arbitrary delay; this is not a network or server query/normalization defect.
- Test author `/root/customer_ui_search_repro` actually exists, authored tests
  without product changes. Main agent ran RED. Exact test-only source fingerprint
  `6cb461cb9e1d1ea2094a9b4ec0b1111055fb456421d7a1076d98e45faac1b3ed`
  matches committed source3b890ef4; executions preceded that local commit.
- Proposed remedy: local request counter/identity in existing DataTable, allowing
  only the newest request to write rows/count/pagination/error or clear loading;
  remove Customer's duplicate explicit input reload. No new prop, API, dependency,
  cancellation contract or Customer-specific branch in shared code.
- Required verification: DataTable unit RED/GREEN for old success/error and loading
  ordering/latest failure; existing client-side mode/initial page/sort/retry tests;
  the deterministic browser cases, typed/clear/URL/page/refresh/error/permission
  flows and relevant responsive/keyboard behavior. Mutation must expose stale
  writes. Full Customer suite, affected client suite/build/lint, configured
  repository browser suites, final-head CI and actual independent review remain.

## DEF-027001 — import keyboard automation races dialog teardown

- Links: FR-084..093/NFR-001, DES-013/016/025, PHASE-003/TASK-027, TC-065.
- Severity MEDIUM; root classification TEST_AUTOMATION_DEFECT; targeted fix verified
  but full-suite/independent review still required before closure.
- Current-main complete Customer browser suite: **15PASS/1FAIL/0SKIP**; same TC-065
  detail/error assertion as PR#233. Source main10ca62ad/fingerprintbccc7235...3449.
- Trace: upload route fulfillment started at19914.441ms, background job-detail
  focus at19916.162ms (~1.7ms later), while asynchronous UI close/refocus was not
  synchronized. QDialog retains/restores focus across its close transition.
  Playwright CLI attached to the original paused test; after waiting, focus could
  reach the intended detail button and the unchanged scenario completed.
- Minimum test correction waits for the upload heading, including hidden DOM, to
  have count0; then focuses the actual detail button, asserts focused and presses
  Enter. No product import code change, forced click, sleep, retry or assertion
  removal. Focused corrected TC-065: **1PASS/0FAIL/0SKIP**. It preserves mobile
  layout, invalid-row messages, password confirmation/counts and download checks.
- The full Customer suite must pass after the search fix; this targeted pass is not
  closure or business/UAT acceptance. Regression specifications clarify this
  synchronization without lowering the prior intent.

## Scope choice requiring Sam

Recommended: approve HD-012's exact revised DESIGN/PLAN and the sole shared source
`client/src/framework/ui/DataTable.vue` (and existing client unit-test paths),
limited to generic latest-request-wins behavior. The manifest marks the source
approval-required. Customer page/test changes remain within existing module scope.
Shared callers can observe improved concurrent-response handling, so retain the
public component contract and run cross-caller tests. No other module product
code, schema, security policy, package or CI setting may change.

Alternative: decline shared scope; leave DEF-034002 blocked and separately finish
only the import-test repair. A Customer-specific table replacement/request wrapper
would duplicate shared state/ordering behavior and is not proposed. No default
shared write happens while the decision is unanswered; recommendation is not
approval. One scoped implementation PR after approval and all gates, not release.

TASK-030/031/032/034 and full downstream/mixed-load/production DR/business/release
acceptance remain BLOCKED. Existing DEF-034001 closure and its historical measured
capacity evidence are preserved, not rerun/rebound by this UI diagnosis.

## Reproduction environment and retention

Node26.6.0, existing locked Playwright1.63.0/Chromium/Vite; own loopback5204 and
synthetic network-mocked Customer fixtures, no real account/backend/DB/3306 writes.
Raw XML/traces/screenshots remain private under owned
`/private/tmp/erp-customer-ui-runtime.kirCP5/`; they are not exported in the PR.
Browser/debug server processes finished; runtime artifact cleanup follows durable
sanitized evidence capture. A temporary diagnostic attached through actual
Playwright CLI, not a simulated browser. No token/storage contents were inspected.
No root graphify graph covers this frontend; source/caller searches were used.

Commands: `npx --no-install playwright test --config
client/e2e/customer-management/playwright.config.js`; the unchanged full suite first,
then `--grep TC-065 --debug=cli` (diagnostic, paused, not a timing-proof PASS),
corrected `--grep TC-065`, and independently authored `--grep DEF-034002` (RED).
Each used a separate HARNESS_RUN_DIR/HARNESS_RESULT_PATH under the owned root.
No final shared implementation, final-head implementation CI, formal Technical
Acceptance or UAT has occurred.
