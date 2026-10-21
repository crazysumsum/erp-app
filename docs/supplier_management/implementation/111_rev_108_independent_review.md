# REV-108 — independent review of the DEF-032 DataTable fix (HD-118 A)

- **Reviewer:** `agent-skills:code-reviewer` (a separate agent; I did not write this change)
- **Baseline:** branch `claude/supplier-def032-datatable-states` at `99da06e2`, reviewed as `git diff origin/main..HEAD` (base `6a9132b2`)
- **Verdict:** **APPROVED**
- **Open Critical / High:** 0 / 0. No Medium, three Low, four Info.

## What the reviewer confirmed

- **Gates:** client unit 913/913, lint and build exit 0; `e2e:mocked` business-master 15/15 and supplier 48/48.
- **Other modules in a real browser** (Playwright with network mocking, branch against base): `/sales/imports` and `/sales/orders` (server mode, own `#no-data`) and `/system/roles` (client mode) now show the loading text while loading, their own or the default empty text only after an empty read, and nothing under the error banner. On base the Sales pages exposed a false 「沒有符合條件…」 `role=status` while loading and on error. No console errors besides the expected 500.
- **Slot forwarding:** scoped slots (`body-cell-*`, `top-right`, `header-cell-*`) keep their scope; about 38 DataTable callers checked, none relies on `#no-data` during loading or error.
- **Mutants:** six of seven turn the tests red; the base component turns the Playwright test red.
- **Ledger:** PR #262 merge facts, run 39558614049 (13/13 before the merge), the MERGE fingerprint, and APPROVAL-HD-118-SCOPE all check out.

## Disposition

The standing instruction is to fix every review finding as recommended.

| Finding | Disposition |
| --- | --- |
| L-1: removing `v-bind="slotProps"` from the page's `#no-data` survived every test. | `DataTable.test` now renders a page `#no-data` that prints `filter` and `message` and expects both. Control: the mutant now fails it. |
| L-2: "after a failed read it shows nothing" is only true in server mode; `/items/uoms` (client mode, catches its own error) still shows 「冇資料」. | The register now says server mode, and records the client-mode case as a known limitation for those pages' owners. The Supplier list uses server mode. |
| L-3: 「載入緊…」 appears nowhere else; the client uses 「載入中」. | Changed to 「載入中…」 in the component, the unit tests and the Playwright test. |
| I-1: no live region on the loading text. | Left as is, as recommended: it sits inside the `aria-busy` region. |
| I-2: an empty no-data strip remains under the error banner. | Left as is (acceptable per the reviewer). |
| I-3, I-4: boundary tool reports OUTSIDE_MODULE (covered by APPROVAL-HD-118-SCOPE); no other-axis issues. | No change. |

## After the follow-ups

Local, not CI: client unit 914/914, lint exit 0, supplier browser suite 48/48. Not re-reviewed.
