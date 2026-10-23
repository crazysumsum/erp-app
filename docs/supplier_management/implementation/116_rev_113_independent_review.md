# REV-113 — independent review of the DEF-035 audit page and detail tab (HD-125 A)

- **Reviewer:** `agent-skills:code-reviewer` (a separate agent; I did not write this change)
- **Baseline:** branch `claude/supplier-def035-audit-ui` at `cffa3459`, reviewed as `git diff origin/main..HEAD` (base `19e37a13`)
- **Verdict:** **CHANGES_REQUESTED**
- **Open Critical / High:** 0 / 0. Three Medium, four Low, four Info.

## What the reviewer confirmed

- No account plaintext anywhere on the page or the tab, in a real browser against a real backend.
- Hong Kong day bounds are sent; a reversed range is not queried and is announced (`role="alert"`, `aria-invalid`).
- Records are shown in Hong Kong time; the time-zone mutants fail under `TZ=UTC`.
- Detail values are rendered as text: an `<img onerror>` Supplier name stayed inert.
- The tab is scoped to its Supplier, and `/suppliers/audit` does not clash with `/suppliers/:id`.
- The action and target-type labels match all 41 actions and 10 target types the server writes.

## Disposition

The standing instruction is to fix every review finding as recommended.

| Finding | Disposition |
| --- | --- |
| M-1: 原因 and Request ID off-screen; the request ID cut to about 17 characters, full value only in a tooltip. | The request ID column comes before 原因 and 內容 and is shown in full, monospace, without ellipsis. The 內容 and text cells wrap within a max width. A Playwright check asserts the full UUID is inside a 1440px viewport with a long detail; a mutant with the old column order and no wrap fails it. The real-backend check confirms it. |
| M-2: filters not in the URL. | From, to, actor, target, action, target type, page and page size go into the route query with `router.replace` and are restored on load. Unknown or malformed values are ignored (dates must be real, page size must be one of the configured options). Unit and Playwright tests cover sync, reload and restore. |
| M-3: 7 of 22 mutants survived. | Tests now set target, action and target type and assert each is sent; detail before/after values carry markup; a detail with `changes`/`metadata` keys is shown; the service test uses 50 rows per page. A 13-mutant sweep covering the survivors turns every one red. |
| L-1: the truncation handling targeted a shape the Supplier server never writes. | Summaries are detected per value (`{count, sample, truncated: true}` inside a key such as `changes`) and shown as 「共 N 項，只列頭 k 項」. The test uses the server's shape. |
| L-2: noisy detail. | A notes digest is shown as a length, never the hash. The server digests notes on both sides (`textDigest`), so the line reads 「notes：0 字 → 10 字」; the fixtures use that real shape. Lines empty on both sides are skipped. |
| L-3: a half-typed date sent requests with a negative `from`. | The page queries only when both dates are real dates on or after 1970-01-02. A test types a partial year and expects no request. |
| L-4: a filter change kept the current page. | Any filter change goes back to page 1 (the timeline is remounted with the new filters). Tested. |
| I-1: the register said UAT "exercises" the page. | Now "will exercise". |
| I-2: nothing pinned label parity with the server. | A unit test reads the Supplier server sources and fails if any written action or target type has no label. |
| I-3: English table footer, app-wide. | Predates this change; not Supplier's. No change. |
| I-4: about 20 idempotency rows left by the reviewer's calls. | They expire by TTL. No change. |

The fixes were not re-reviewed by REV-113; the next Supplier review (UAT PHASE-001) re-checks the page against a real backend.

## Verification after the fixes

- Client Supplier suite: 21 files, 182 passed. eslint exit 0; client build exit 0.
- Playwright `supplier-audit.spec.js` (network mocked): 2 passed.
- Real backend (local, not CI; erp_t51 in-process server, vite at :5213): a `supplier.view` user logged in through the UI. Request ID on screen, no account plaintext, notes shown as 「0 字 → 10 字」, markup inert, filter in the URL and restored after reload, the detail tab shows the reveal record without plaintext. No console errors or failed requests.

## Found during the real-backend check

DEF-036 (HIGH): a CLERK cannot load currencies or payment terms, so cannot create a Supplier in the UI. See the defect register; decision HD-126.
