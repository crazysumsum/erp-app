# TASK-024 client (P2-T03)

**Status:** source candidate only. It is local, not pushed, and has no new tests. It is stacked on `claude/purchasing-task024-backend` (`968f480d`), so it cannot open a PR until that backend PR merges. HD-022 A: "TASK-024's client PR then delivers the pages, the approver choice on submit and the menu entry."

## Delivered

| Item | Where |
| --- | --- |
| 待我審批 `/purchasing/approvals`: view and approval, server pagination, `q` and supplier ID filters, oldest first, links to detail | `pages/purchasing/MyPurchaseOrderApprovalsPage.vue` |
| Fixed approval snapshot on the PO detail page, plus approve and reject with password re-entry | `components/purchasing/ApprovalSnapshotPanel.vue`, `PurchaseOrderDetailPage.vue` |
| Withdraw a pending approval (requester with `purchasing.mgmt`) | `PurchaseOrderDetailPage.vue` |
| 採購設定 `/purchasing/settings`: current value, change with reason, password and device signature, latest 50 changes | `pages/purchasing/PurchasingSettingsPage.vue` |
| Approver choice on submit when approval is on (§7.3) | `components/purchasing/PurchaseOrderForm.vue` |
| Submit message distinguishes 已提交審批 from 已提交並確認 | `PurchaseOrderEditPage.vue` |
| Service methods | `services/purchasing.js` |

Menu entries are declared in each page's `page.menu` under the existing `purchasingReceiving` group. `client/config/menu.js` and `errorMessages.js` are unchanged: all 21 server Purchasing error codes already have messages.

**Permissions:** on the detail page, approve and reject need `purchasing.approval`, and every other action needs `purchasing.mgmt` (§6.1: the permissions do not inherit from each other). The server still checks both.

**Out of scope:** approval history and status history on the detail page. P2-T05 (TASK-026) delivers those.

## Deviations from the design, for review

1. **The decision form is inline, not a `promptPassword()` dialog (§7.4).** The shared dialog cannot pre-fill a reason. That blocks P2-T03's criterion that the reason is kept after an error. It also caps the reason at 190 characters, while the server allows 500.
   - The panel keeps the reason and clears the password after every error.
   - The password never enters the command intent.
   - While a result is uncertain, only the same action can retry, with the same eventId.
2. **Approval withdraw uses `promptReason()`.** That makes the reason required, 5 to 190 characters. The server would accept no reason.
3. **If the approvers lookup fails, the submit dialog still allows submitting.** It shows a warning, and the server decides. On `PO_APPROVAL_REQUIRED` or `PO_APPROVER_INVALID`, the dialog reads the setting again. Supplier activation already uses this pattern.

## Local checks at this candidate (no database)

- `vite build`: exit 0.
- `eslint` on the changed files: exit 0.
- The six existing Purchasing client test files: 112 passed and 3 failed out of 115. All 3 failures are expected and come from existing tests that pin the old behaviour:
  - `purchasingNavigationErrors` "未完成嘅審批、收貨、設定頁未有入口": TASK-021 pinned "no approval or settings entry yet", and this task adds them.
  - `purchasingPurchaseOrderForm` submit case: its service mock has no `lookupApprovers`, so the dialog correctly shows "未能讀取審批設定" instead of "確認後可收貨".
  - `purchasingPurchaseOrderForm` rejected-submit case: a cascade of the case above. That case's open dialog stays in `document.body`, and this case clicks it.
- **Private check, reverted:** I added `lookupApprovers` to the mock, returning `requireApproval: false`, and the form file passed 29/29. Then I restored the file with `git checkout` and confirmed it was clean.

No browser validation yet. It needs the app, a MySQL slot and Playwright.

## Sam's decision

2026-11-09, in the Purchasing chat: "前端測試提案全部批准，TASK-025 可以開始".

**Approved scope:** items 1 to 7 below, exactly as proposed:
- 6 new cases and 2 changed existing cases;
- jsdom only;
- every PR, in the existing client unit job;
- no new job, no capacity workload, no timing threshold.

This does not cover:
- publishing the receipt's digest, which is for the trusted administrator;
- the Playwright browser pass, which needs a PM slot.

## Test proposal (approved 2026-11-09)

**Business risk:**
- An approver could act on data other than the snapshot.
- A non-assignee could see decision controls.
- A failed decision could lose the typed reason, or resend under a new eventId.
- A settings change could be sent without a device signature.

**Gap:** the existing tests cover none of these pages, and backend tests do not exercise the UI.

| # | File | Change |
| --- | --- | --- |
| 1 | new `client/test/pages/purchasing/purchasingApprovals.test.js` | My approvals: request parameters, rows, link to detail, empty state |
| 2 | same | Detail: the snapshot comes from `approval.snapshot`, not the live PO; buttons follow `allowedActions` plus permission; a mgmt-only user sees withdraw and no decision controls |
| 3 | same | Reject needs a reason; after an error the reason stays and the password clears; an uncertain result retries the same action with the same eventId, and the other action is disabled |
| 4 | same | Settings: sends `version`, `requirePoApproval`, `reason` and `password` through `updateSettings`; keeps the reason after an error; shows history |
| 5 | `purchasingPurchaseOrderForm.test.js` | Mock `lookupApprovers` (2 lines, which fixes the two existing failures), plus 1 new case: with approval on, an approver is required and `assignedApproverId` and `requestNote` are sent |
| 6 | `purchasingNavigationErrors.test.js` | Update the TASK-021 pin: two new menu pages and the new page list |
| 7 | `client/test/services/purchasing.test.js` | 1 new case: paths of the new methods; `updateSettings` is signed |

**Scale and trigger:**
- 6 new cases and 2 changed existing cases.
- jsdom only: no database, no concurrency, no data volume, no timing threshold.
- Runs in the existing client unit job on every PR, like the other Purchasing client tests.

**Cost:**
- Estimated under 2 seconds in total, from the current file's 29 cases running in about 0.55 seconds. This is an estimate, not measured for the new cases.
- No new job, and no effect on the critical path.

**Receipt:** a new receipt for the changed and new test files. Changing `purchasingPurchaseOrderForm.test.js` and `purchasingNavigationErrors.test.js` invalidates any receipt that pins them, so those receipts' other files need re-pinning.

**Alternative:** browser validation only, with no new routine cases. That leaves the snapshot, eventId and permission rules unguarded against regression, so I do not recommend it.

**Browser validation, separate from routine CI:** a Playwright pass of the real app on a private MySQL, needing a PM slot. It covers:
- approval on: submit with an approver, approve, and reject with a reason;
- withdraw;
- settings change from a registered device;
- console and network checks.

## Tests and receipt (2026-11-09)

Items 1 to 7 were written as approved.

**Local run:** the 7 Purchasing client test files gave 121 passed out of 121 (115 earlier plus 6 new). jsdom only, no database. `vite build` and `eslint` pass.

**Private discrimination check:** 8 source mutants, each run against its test file and then restored from the commit. All 8 were killed:
- approve gated by mgmt;
- password put into the intent;
- password kept after an error;
- the other action allowed while a result is uncertain;
- snapshot supplier taken from the live PO;
- settings update unsigned;
- approver not sent on submit;
- settings password kept after an error.

**Receipt:** `.github/test-admissions/purchasing-task024-client.json`, sha256 `ba1ce40f4e11e849f062098ff1111e857d359337e1991b9ff909cf76b4f4ea26`, not published. It has 17 files:
- the whole of `purchasing-task018.json` and `purchasing-task021.json`, which these changes invalidate as whole receipts;
- the new test;
- the two new pages.

**Gate (`--static-only`):**
- With this digest and the backend digest added locally: exit 0, 155 inputs accepted.
- Without this digest: exit 1, "Missing Sam approval" for this receipt.

Sam's decision does not authorize the agent to publish the digest. The trusted administrator publishes it.

## TL review fixes (relayed by the PM on 2026-11-09)

**Required fix 1, an uncertain result followed by a 403:**
- **Problem:** a retry that fails with 403 `PASSWORD_INVALID` only rejects that authentication. It does not prove the original transaction failed.
- **Fix:** `useCommandEvent` now keeps the intent (eventId and payload) and the uncertain state when that happens. Only the password is cleared, and only the same action can retry.
- **Messages:** the panel and settings messages show the password error together with "結果尚未確認".
- **Unchanged:** a first, never-uncertain definite rejection still clears the intent.
- **Consumer impact of the shared composable:**
  - `PurchaseOrderForm` save and submit, and detail copy and withdraw, are `jwt` only and never receive `PASSWORD_INVALID`, so their behaviour is unchanged.
  - `ApprovalSnapshotPanel` and `PurchasingSettingsPage` are the intended change.
  - The existing `useCommandEvent` cases do not exercise this path.

**Required fix 2, the mocks:** the two `PASSWORD_INVALID` mocks in `purchasingApprovals.test.js` now use the real 403 (`server/src/services/auth/passwordReauth.js`), not 401. Both occur before any uncertain result, so every assertion is unchanged.

**Candidate:**
- Commit `556925cf` holds the fix.
- Commit `b3b2bbd0` re-pins the receipt. Its digest moves from `ba1ce40f…` to `4569e9a0b0ade48cba63f34c94d5702e85a85d1003262e0f829ab6534650c54f`.
- Pin diff:
  - `client/test/pages/purchasing/purchasingApprovals.test.js`: `0c7b043a…` → `62d284a9…`.
  - `client/src/pages/purchasing/PurchasingSettingsPage.vue`: `853a2599…` → `d801c2ae…`.
  - The panel and the composable are not gate inputs.
- Static gate: exit 0 with 155 inputs on the new digest; exit 1 on the old one.

**Not run after the fix:** no test, build, lint or mutant. The earlier 121/121, build, lint and the 3 expected failures belong to `b072d4f7` and `64ca24c8`. They do not carry over.

**Observations for the TL, not fixed:**
- Other retry rejections may also prove nothing about the original: `PERMISSION_STALE`, `DEVICE_*` on settings, and `CONCURRENT_OPERATION`.
- Detail withdraw still resets its intent on any PO reload, as copy does.

## R1 completed (TL ruling relayed by the PM on 2026-11-09), commit `d46e28d5`

This supersedes the `PASSWORD_INVALID` special case in `556925cf`.

**`useCommandEvent`:**
- Once a command is uncertain, only a success of the same original operation releases it. The server replays the original result for the same eventId.
- Any later error keeps the eventId, payload and uncertain state. That includes `PASSWORD_INVALID`, `PERMISSION_STALE`, `DEVICE_*`, `CONCURRENT_OPERATION`, `VERSION_CONFLICT` and unknown 4xx. There is no code list.
- A first, never-uncertain definite rejection still clears the intent.
- `reset()` and the `uncertain` ref are removed. Intents are keyed with `run(payload, send, key)`, `isUncertain(key)` and `pendingPayload(key)`.

**Consumers and their owners:**

| Consumer | Key | Change |
| --- | --- | --- |
| `PurchaseOrderDetailPage` | `${actor}:${po}:copy`, `:withdraw`, `:approve`, `:reject` | Owns the copy, withdraw and decision commands. `onLoad` no longer resets anything. vue-router reuses the page across PO changes, so a reload or a PO switch keeps every intent bound to its own target. Late responses for a switched PO or actor skip notifications, navigation and reloads. |
| `ApprovalSnapshotPanel` | from Detail through the `command` and `commandKey` props | No longer owns a command, so remounting after loading or an error keeps the decision. The reason is restored from `pendingPayload`. While one action is uncertain the opposite action is locked. Late responses for a switched context are ignored. |
| `PurchasingSettingsPage` | `${actor}:settings` | A GET no longer resets. The toggle and reason are restored from the pending payload. A `VERSION_CONFLICT` after an uncertain result does not enter the stale path. A late response after an actor switch is ignored. |
| `PurchaseOrderForm` | `${actor}:${po or "new"}:save`, `:submit` | `watch(document)` no longer resets. A `VERSION_CONFLICT` after an uncertain result keeps the retry instead of going stale. Late responses after unmount or a PO or actor switch do not emit. |

`usePurchaseOrder` is unchanged.

**Still not recovered, a memory-only limitation:**
- If the owner unmounts, by leaving the page or reloading the browser, the intent is gone. The form's leave guard still warns first. Recovery across a refresh needs the eventId lookup in TASK-033.
- If a reload shows that an approval was decided, perhaps by someone else, the panel disappears. Its uncertain intent stays harmless in memory, with no retry UI.

**Pin diff against receipt `4569e9a0…`:**

| File | Old blob | New blob |
| --- | --- | --- |
| `PurchaseOrderForm.vue` | `46756f67da942965c44ba090da73c199574c6bd2` | `d79e8bbf9b483a5ba7f75a68c916a89ccf728ff9` |
| `PurchaseOrderDetailPage.vue` | `d4bb5eeda0b09b5fa0eaf297f988711ae991582c` | `9ad38f008e514a6f1998dc603c3d18afc8759324` |
| `PurchasingSettingsPage.vue` | `d801c2ae252aafc589a03f6bb6902add02cec186` | `bdbfd1d2470f4f5364bdaae1e4c8c0e1c1c88bc8` |

- The composable and the panel were not gate inputs at `b3b2bbd0`. That is **unverified for the new bytes**, because the gate was not rerun.
- The receipt is **not updated**. It must wait until the test changes below are approved.
- Receipt `4569e9a0…` does not join the administrator's batch with the two earlier digests.

## Verification still needed (none written or run)

### ① Composable: six non-final errors after an uncertain result

A new `it.each` in `client/test/services/purchasing.test.js`.

Each variant makes three calls:
1. `TIMEOUT`;
2. the variant error;
3. success.

The six variant errors:
- 403 `PASSWORD_INVALID`
- 403 `PERMISSION_STALE`
- 400 `DEVICE_SIGNATURE_STALE`
- 409 `CONCURRENT_OPERATION`
- 409 `VERSION_CONFLICT`
- 422 `UNKNOWN_FUTURE_CODE`

That is 6 × 3 = **18 mock calls**.

Assertions:
- all three bodies are equal (same eventId and payload);
- `isUncertain()` is true after the second call and false after the third.

### ② Consumers, resets, opposite actions and switching

New cases, mostly in `purchasingApprovals.test.js`:

| # | Case | Mock calls |
| --- | --- | --- |
| C1 | Detail: approve `TIMEOUT`, then a permission change forces `load()`, so the panel remounts. The reason is restored, reject is disabled, and the approve retry has the same eventId. | getPurchaseOrder 2, approve 2 |
| C2 | Approve `TIMEOUT`, then a retry gets 403. Still uncertain, reject disabled, and the message shows both the password error and "結果尚未確認". The third call succeeds with the same eventId. | approve 3 |
| C3 | PO switch: approve `TIMEOUT` on PO 8, then go to PO 9. PO 9 shows nothing uncertain, and an approve there uses a new eventId and id 9. Back on PO 8, the retry uses the original eventId. | approve 3, getPurchaseOrder 3 |
| C4 | Late response: approve on PO 8 is held, the user switches to PO 9, then it resolves. No `notifySuccess` and no extra getPurchaseOrder. | approve 1, getPurchaseOrder 2 |
| C5 | Actor switch: approve `TIMEOUT` as user 1, then `session.user` becomes user 2. No lock or banner for user 2, and user 2's approve uses a new eventId. | approve 2 |
| C6 | Withdraw `TIMEOUT`, then `load({ keep: true })`. The banner stays, and the retry has the same eventId. | withdraw 2, getPurchaseOrder 2 |
| C7 | Settings `TIMEOUT`, then a retry gets `VERSION_CONFLICT`. No stale banner, the toggle is disabled and the reason kept. The third call succeeds with the same eventId. | updateSettings 3, getSettings 2 |
| C8 | Form save `TIMEOUT`, then the parent passes a reloaded `document` for the same id. Still locked, and the retry body is equal. Goes in `purchasingPurchaseOrderForm.test.js`. | update 2 |
| C9 | Form submit `TIMEOUT`, then a retry gets `VERSION_CONFLICT`. The dialog stays and does not go stale. The third call succeeds with the same eventId. | submit 3 |
| C10 | Form submit is held, the form unmounts, then it resolves. No `submitted` emit. | submit 1 |

**Existing cases that must change**, in `client/test/services/purchasing.test.js`:
- `it.each` "結果未確定（%j）就保留原 payload 同 eventId": `command.uncertain.value` becomes `command.isUncertain()`. Assertions unchanged, 5 variants.
- "明確結果之後下一次係新意圖、新 eventId": the same API rename. Assertions unchanged.
- "reset 之後唔會再用舊 intent": `reset` is gone. **Replacement:** "different keys are independent; a new key never uses an old intent, and the original key keeps its eventId" (3 calls).

### ③ Regression on the new bytes

Runs once, after the PM grants it.

- `cd client && npm test -- <the 7 Purchasing client test files, with the ① and ② changes>`. This is the existing entrypoint: capacity pattern, default file workers, the same as CI. It is **not single-worker**, because the entrypoint refuses options. I recommend keeping the default.
- `cd client && npx vite build`.
- `npx eslint client/src/pages/purchasing client/src/components/purchasing client/src/composables/purchasing client/src/services/purchasing.js`.
- `node .github/scripts/test-admission.mjs --static-only` with the candidate digests set locally.
- Stop at the first failure.

### ⑥ Playwright on the real app

Runs only after the PM grants an exclusive slot. Nothing goes into `client/e2e`.

**Preparation (15 minutes or less):**
- A private mysqld on 127.0.0.1:33619 with datadir `/private/tmp/m024c`, started with `--initialize-insecure` and then `--daemonize --skip-log-bin`.
- Migrate and seed with the existing scripts.
- Server and client dev both bound to 127.0.0.1.
- Env: the 18 exports that `ci023.env` recorded, rebuilt from `ci.yml` values, because the scratchpad may have been wiped.

**Data:**
- Users:
  - U1, requester: view and mgmt.
  - U2, approver: view and approval.
  - U3, settings: `purchasing.settings`, with an approved registered device.
- 1 supplier and 1 SKU.
- PO-A (1 line) and PO-B (1 line), both Draft.

**Flow (25 minutes or less), stopping and reporting at the first failure:**
1. Log in as U3. Turn approval on: device-signed with password, first with a wrong password (expect 403, reason kept), then the correct one.
2. Log in as U1. Submit PO-A with U2 as approver. Withdraw PO-B's approval after submitting it.
3. Log in as U2. The list shows PO-A. Reject once with a wrong password (expect 403, reason kept).
4. **UNKNOWN:** `page.route` lets the first approve reach the server, then aborts the response. The UI shows "結果尚未確認". A wrong-password retry gets 403 and stays locked. A correct retry replays as CONFIRMED.
5. Keyboard: the focus order through reason, password, approve and reject works, and the h1 and h2 exist.

**Bounds:**
- At most 12 business POSTs:
  - 2 settings;
  - 3 submit or withdraw;
  - 4 decisions;
  - 3 margin.
- At most 3 login POSTs.
- At most 40 API GETs, and at most 80 HTTP requests in total.
- Allowed statuses: 200, 403 and 409 only, with no 5xx.
- Console must show no error.

**Cleanup (10 minutes or less):**
- Stop the dev servers and mysqld.
- Delete `/private/tmp/m024c`.
- Confirm with `lsof` that 33619, the server port and the client port are free.
- Close the browser and report the release time.

**Tools:**
- `@playwright/cli`, already installed, as the user's standard. An inline script for the `page.route` fault injection.
- Shared keys: the bank and test JWT keys come only from the `ci.yml` test values. No real secrets.

## Trigger and concurrency, stated once

- **What was approved:** Sam's approved proposal said "every PR".
- **What CI actually runs:**
  - admitted PR dispatch;
  - every push to main;
  - weekly on Monday at 02:17 UTC, which is 10:17 Hong Kong time.
  - Vitest uses its default file workers, not 1.
- **What the receipts say:** this receipt and `purchasing-task024-backend.json` say "every PR and push to main", and "concurrency 1" means within a case.
- **Recommendation:** keep the existing triggers and workers, and have the PM obtain Sam's real approval of the full trigger. I have not changed the workflow or the wording.

## Evidence status

- The 8 client mutants (`mut024c.py`, sha256 `051bc2e1…`) and the TASK-025 3 mutants and `check025.mjs` (sha256 `661ad155…`) are kept as-is under `scratchpad/evidence-2026-11-09/`. They had no specific approval, and they are not re-run or retroactively claimed.
- The earlier 121/121, 68/68, build and lint apply only to their own commits, not to the new bytes.

## R1 invariants (TL review of `fbb2480c`, relayed by the PM on 2026-11-09), commit `2b60ebef`

The fix converges on three existing invariants. It adds no error-code list and no global event or persistence framework. This corrects `d46e28d5`.

| Invariant | Change |
| --- | --- |
| **Stable owner keeps the intent** | `PurchaseOrderEditPage` and `PurchaseOrderCreatePage` now own the form's `save` and `submit` records and pass `commands` to `PurchaseOrderForm`. The form unmounts on the parent's loading, error or permission `v-if`; the records survive. A pending save restores the form's visible values from its stored view, and a pending submit reopens the dialog with its stored approver and note. The screen never shows new data while a retry sends the old body. With no owner passed, which only happens in direct component tests, the form owns its own. Detail owns copy, withdraw and decisions. The panel is now presentational: it emits `decide` and receives `uncertainAction`, `pendingReason`, `busy`, `errorMessage` and `stale`. |
| **One in-flight per key; settle only the captured record** | `useCommandEvent` refuses a second send for a key that is in flight, or a different `meta.action` on an existing record, with a local `COMMAND_PENDING` and no HTTP. Decisions use one key per approval ID, `${actor}:${po}:decision:${approvalId}`, so approve and reject exclude each other across panel remounts. Settlement looks at the captured record's uncertainty at settle time, not a value read on entry. No automatic retry. |
| **Visible callbacks bound to the real lifecycle** | Detail, Settings and Form each keep a local `generation`. It changes on a real PO or actor switch and on unmount, but not on a same-context GET. Success, catch and the former `finally` effects are dropped for an expired view: no notify, navigation, reload or error, and nothing cleared on a new pending record. `saving`, `submitting`, copy and withdraw loading now read `isBusy(key)`, so an old callback cannot clear a new in-flight state. |

**Null approval.** A real approve or reject can succeed with its response lost; the GET then returns `approval: null` and the panel disappears. Detail keeps that record visible in a separate banner (`data-testid="po-detached-decision"`), apart from any new pending approval.
- With the actor's current `purchasing.view` and `purchasing.approval`, it offers a password replay of the original action, target and body.
- Without them it shows a blocked notice and does not bypass.
- The current PO status and other people's history are never taken as the original event's outcome.

**Still memory-only:** if the page owner unmounts or the browser reloads, the record is gone, until TASK-033.

**Pin diff against the committed receipt** (`4569e9a0…`, not used):

| File | Old blob | New blob |
| --- | --- | --- |
| `PurchaseOrderForm.vue` | `46756f67da942965c44ba090da73c199574c6bd2` | `2cfac7685c8b876da63dd4920a8702873d2a674e` |
| `PurchaseOrderDetailPage.vue` | `d4bb5eeda0b09b5fa0eaf297f988711ae991582c` | `2ce6fcad098d78e0c5c511a2e6beac33d99cd927` |
| `PurchaseOrderEditPage.vue` | `e8af0806120e70f3599d5d325ac425776a94466a` | `365757784f6f9e41062cc8c5f67742995338f2fe` |
| `PurchaseOrderCreatePage.vue` | `ae34b43a3fcff83e55112943697cbf3f70c1df51` | `120c3f8dfc353bafe14a638f4f2cc0eecc64be1e` |
| `PurchasingSettingsPage.vue` | `d801c2ae252aafc589a03f6bb6902add02cec186` | `ba536f6b9d643309e04f3a4120be03c0894bf5c5` |

Not pinned at `b3b2bbd0`, and unverified for the new bytes:
- `useCommandEvent.js`: `81a8f174…`
- `ApprovalSnapshotPanel.vue`: `f3b21b36…`

## Verification package, superseding the one above (nothing written or run)

### ① Composable: six non-final errors after an uncertain result

Six fixed sequences: `TIMEOUT`, then the variant error, then success. The variant errors are:
- 403 `PASSWORD_INVALID`
- 403 `PERMISSION_STALE`
- 400 `DEVICE_SIGNATURE_STALE`
- 409 `CONCURRENT_OPERATION`
- 409 `VERSION_CONFLICT`
- 422 `UNKNOWN_FUTURE_CODE`

That is **18 mock calls**. All three bodies are equal, and `isUncertain(key)` is true after call 2 and false after call 3.

Plus **H1**, a helper case:
- A second `run` on the same key while the first is in flight gives `COMMAND_PENDING`, with `send` called once.
- The same key with another `meta.action` gives `COMMAND_PENDING`.
- Settling a TIMEOUT record leaves exactly one record, uncertain.

That is 3 sends.

### ② Fixed cases

The original behaviour assertions of the 121 cases are kept.

| # | Case | Mock calls |
| --- | --- | --- |
| C1 | Approve `TIMEOUT`, then a permission refresh forces `load()`, so the panel remounts. The reason is restored, reject disabled, and the retry has the same eventId. | approve 2, get 2 |
| C2 | Approve `TIMEOUT`, then 403, then success, all with the same eventId. Reject stays disabled. | approve 3 |
| C3 | Approve `TIMEOUT` on PO 8, approve on PO 9 with a new eventId, then back on PO 8 the retry uses the original eventId. | approve 3, get 3 |
| C4 | Approve held on PO 8, switch to PO 9, then it resolves. No notify and no extra GET. | approve 1, get 2 |
| C5 | Actor switch: user 2 sees no lock, and user 2's approve uses a new eventId. | approve 2 |
| C6 | Withdraw `TIMEOUT`, then `load({ keep: true })`. The banner stays and the retry has the same eventId. | withdraw 2, get 2 |
| C7 | Settings `TIMEOUT`, then `VERSION_CONFLICT`. No stale state, the toggle is disabled and the reason kept. The third call succeeds with the same eventId. | update 3, getSettings 2 |
| C8 | **Real `PurchaseOrderEditPage`**, save `TIMEOUT`. Variant a: a permission refresh, still with mgmt, shows the loading skeleton and the form remounts with the original values ("第一次"), locked; the retry body is equal. Variant b: the same-PO GET fails, the error banner shows, retry `load()` remounts the form, same result. | a: get 2, update 2; b: get 3 (ok, fail, ok), update 2 |
| C9 | Submit `TIMEOUT`, then `VERSION_CONFLICT`. The dialog stays, not stale. The third call succeeds with the same eventId. | submit 3 |
| C10 | Submit held, the form unmounts, then it resolves. No `submitted`. | submit 1 |
| C11 | **Null approval.** Approve `TIMEOUT`; the reload returns `approval: null` and CONFIRMED, so the panel is gone and the detached banner shows. Variant a, with approval permission: password, then "以原內容重試批准" sends the same body, eventId and PO id, succeeds, and the banner goes. Variant b, without approval: the blocked text shows, with no button and no call. | a: approve 2, get 3; b: approve 1, get 2 |
| C12 | **In flight across a remount.** Approve held; `load()` remounts the panel; clicking approve and reject on the new panel sends nothing. Resolve with `TIMEOUT`: reject stays disabled. | approve 1, reject 0, get 2 |
| C13 | **Leave and return to the same key.** Copy held on PO 8, go to PO 9, back to PO 8, then it resolves with success. No `router.push` and no notify; the route stays `/8`. | copy 1, get 3 |
| C14 | **Copy late after leaving.** Copy held, navigate to the list, so Detail unmounts, then it resolves. The route stays on the list, no notify. | copy 1 |
| C15 | **Save catch after a switch.** Edit PO 8, save held, the route goes to PO 9's edit page with leave confirmed, then the save rejects with 409. PO 9's form shows no error, no stale banner and no busy state. | update 1, get 2 |

**Existing cases that change**, all in `services/purchasing.test.js`:
- the `it.each` 結果未確定 (5 variants) and 明確結果之後: `uncertain.value` becomes `isUncertain()`;
- "reset 之後唔會再用舊 intent" is replaced by "keys are independent" (3 calls).

Other existing files are unchanged, because a form mounted without `commands` keeps owning its own.

### ③ Regression

`cd client && npm test -- <the 7 existing files with the ① and ② edits>`:
- the supported entrypoint, catalog pattern and default file workers, the same as CI;
- no single-worker variant, because the entrypoint rejects options and I will not bypass the catalog;
- then `npx vite build`, `npx eslint client/src/pages/purchasing client/src/components/purchasing client/src/composables/purchasing client/src/services/purchasing.js`, and `node .github/scripts/test-admission.mjs --static-only`;
- stop at the first failure.

### ⑥ Playwright

One batch, after the PM grants an exclusive slot. Nothing goes into `client/e2e`.

**Order:**
1. **Validator first:** the static admission and boundary validators on the exact candidate.
2. **Own DB:** a private mysqld on 127.0.0.1:33619, datadir `/private/tmp/m024c`, started with `--initialize-insecure` and then `--daemonize --skip-log-bin`. Then `npm run migrate`.
3. **Users:** `scripts/createUser.js`, with the password on stdin, plus `grantRole.js`.
4. **Env:** rebuilt from `ci.yml` test values. The deleted `ci023.env` is not assumed to exist. The shared bank keyring and JWT keys come from the same `ci.yml` test values.
5. **Legal device:** U3 logs in and the app creates the binding; `scripts/approveDevice.js <id>` approves it; U3 refreshes.

**Data:**
- U1: view and mgmt.
- U2: view and approval.
- U3: settings, with the registered device.
- 1 supplier, 1 SKU, and PO-A and PO-B, each with 1 line.

**Named business POSTs (11):**

| # | User | Request | Expected |
| --- | --- | --- | --- |
| 1 | U3 | settings update, wrong password | 403 |
| 2 | U3 | settings update, approval on | 200 |
| 3 | U1 | PO-A submit with U2 | 200 |
| 4 | U1 | PO-B submit with U2 | 200 |
| 5 | U1 | PO-B approval withdraw | 200 |
| 6 | U1 | PO-B resubmit | 200 |
| 7 | U2 | PO-A approve, wrong password | 403 |
| 8 | U2 | PO-A approve; `page.route` uses `route.fetch()`, and only after a real server 200 aborts the response | UI shows UNKNOWN |
| 9 | U2 | PO-A approve retry, wrong password | 403, still locked |
| 10 | U2 | PO-A approve retry | 200 replay |
| 11 | U2 | PO-B reject with reason | 200 |

**Other requests, all counted:**
- Login: `POST /api/v1/user/login` 3 times.
- `POST /api/v1/user/token/refresh` as they happen, budget 4.
- `POST /api/v1/device/bindings` once.

**Bounds:**
- API GETs: at most 40.
- OPTIONS and static assets are counted too.
- At most 150 HTTP requests in total.
- Allowed statuses: 200 and 403. A 409 is allowed only on request 10 if the server rejects the replay, and that stops the run.
- No 5xx.
- The console must show no error, and the network no unexpected failure.
- The focus order through reason, password, approve and reject is checked, along with the headings.

**Time:**
- Preparation, 15 minutes or less.
- Execution, 25 minutes or less.
- Cleanup, 10 minutes or less: stop the dev servers and mysqld, delete `/private/tmp/m024c`, confirm with `lsof` that the ports are free, close the browser, and report the release time.
- Stop and report at the first failure.

**Tools:**
- `@playwright/cli`, already installed.
- An inline script for request 8.

## Not changed

- The workflow, the global workers and the receipt wording.
- The trigger and concurrency contradiction stays as reported above.
- Receipt `4569e9a0…` is not used.
- The 8 and 3 private mutants, the old 121/68 results and the intermediate failures are kept as-is, not re-run and not retroactively claimed.
