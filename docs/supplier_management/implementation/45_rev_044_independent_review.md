# REV-044 — TASK-035 Bank UI independent review

**Review:** REV-044 ・**Task:** TASK-035 (T35) ・**Phase:** PHASE-003 ・**Capability:** SUP-CAP-03
**Head reviewed:** `4a876547e41f63f78f4333f188ab99dfbbcf7558` (`claude/supplier-task-035`, PR #125).
**Diff base:** `main…HEAD` (`cc1d74b401613d854ccd1ef748c5cddf14ecc137`).
**Worktree:** `/Users/sam/Documents/workspace/erp-app-worktrees/supplier-task-035`
**Reviewer:** independent agent (`agent-skills:security-auditor`); not the author. Author is Claude Opus 5.

**Verdict: CHANGES_REQUESTED** — 0 Critical, 1 High, 2 Medium, 2 Low, 2 Info.

The capability is, on the whole, built the way the design asks. The plaintext really does live in two
component-local refs, it really is absent from Pinia, storage, the URL, the toast text and the error
panel, and I could not find a way to make it survive a close, a timeout, a tab switch, a cancel, a
back button or a real thirty seconds. I attacked all of those and they held; §5 lists what I tried.

What blocks is narrower and specific. **The one security control the author kept on the strength of a
scenario he could not test does not fire in that scenario.** `onBeforeRouteLeave` is the wrong hook for
component reuse — Vue Router calls `beforeRouteUpdate`, not `beforeRouteLeave`, when only the params
change — so the "`/suppliers/7` → `/suppliers/8`" hole the report describes in §5 is *open*, not
guarded. And the test the author concluded was unwritable is writable: it took eleven lines, it is red
at this head, and it goes green with one added line. Report §5 and the corresponding comment block in
`SupplierBankPanel.vue` both assert the opposite.

Around it, four mutants survived the suites, which means four assertions that pass on a broken
implementation. Everything below states what I ran. Anything reasoned about but not executed is marked
**PLAUSIBLE**. Every mutation was reverted immediately; `git status --porcelain` was empty before the
review, after every revert, and before this report was written. The head never moved and nothing was
committed.

---

## Summary

| | |
| --- | --- |
| Critical | 0 |
| **High** | **1** — the route guard does not fire on the path it was kept for, and the discriminating test the report calls unwritable is writable |
| **Medium** | **2** — a `reveal` that resolves after unmount re-holds the plaintext and arms a fresh 30s interval; three clearing assertions are DOM-shaped and do not discriminate |
| **Low** | **2** — the 30 seconds is 30 ticks, not 30 seconds of wall clock; the ledger's stated reason for three of the four BLOCKED suites is wrong |
| Info | 2 |

**Baseline and CI.** `gh run view 35680680048` reports `headSha` `4a876547…`, `conclusion: success`,
`status: completed`, `event: pull_request`, **`attempt: 1`**; `gh run list --commit 4a876547…` returns
exactly that one run, no reruns. All four checks green (Build frontend 21s, Dependency audit 18s, Lint
25s, Test + MySQL integration 4m38s). PR #125 is `OPEN`, `MERGEABLE`, `mergeStateStatus: CLEAN`, base
`main`, `headRefOid` equal to the reviewed head. `origin/main` was re-fetched and is still `cc1d74b4…`,
`git merge-base origin/main HEAD` equals it, so the target has not moved and `default_commit` is
current. I did **not** recompute the harness source fingerprint or the DESIGN/PLAN digests
independently; I read them from the state file. That much is unverified by me.

**Suites at this head, run by me.** `npx vitest run --root client` → **582/582, 72 files**.
`npx playwright test --project=technical supplier-bank.spec.js` → **3/3, 34.4s**. `npx eslint` over the
four changed source and test files → clean. All re-run after the last revert and still green.

---

## 1. The four claims the brief asked me to verify

### 1.1 `v-if` → `v-show` makes the browser test go red — **VERIFIED**, and it matters more than the report says

I mutated both halves of the pair faithfully (`v-if` → `v-show="revealed.id === row.id"`, and the
`v-else` → `v-show="revealed.id !== row.id"`, so the masked label still behaves) and ran the browser
suite: **1 failed, 2 passed (51.4s)**, failing at `supplier-bank.spec.js:142`, the
`toHaveCount(0)` assertion. The claim holds.

Two things the report does not say, both of which strengthen it:

- **The jsdom suite does not kill this mutant.** Under `v-show`, `test/pages/suppliers/bank.test.js` is
  **13/13 green**. Its assertion is `document.body.innerHTML` not containing the secret *after*
  `forgetPlaintext()` — and `forgetPlaintext()` empties the ref, so the retained `display:none` node
  renders empty and the assertion cannot see the difference. The browser suite earns its place here on
  evidence, not on argument.
- **The real leak the `v-if` prevents is not the one the report describes.** The report frames it as
  "the hidden node still holds the value after you collapse it". It does not — the value is gone by
  then. The actual leak is that the plaintext block sits inside the `v-for`, so under `v-show` *every
  other row* renders `revealed.accountNumber` into a hidden node while one row is revealed. I measured
  it: with two rows, `document.body.innerHTML.split(SECRET).length - 1` is **2** under the mutant and
  **1** at this head. That is a better sentence to put in the comment, and a better assertion than a
  node count (see F-M2).

### 1.2 `onBeforeRouteLeave` is an equivalent mutant no test can kill — **half true, and the half that is false is finding F-H1**

Removing the line and re-running: `bank.test.js` **13/13 green**, browser suite **3/3 green (34.4s)**.
So yes — *as a guard on the paths that exist today*, it is an equivalent mutant, exactly as reported.
`onUnmounted` already does the work on every route out of the page, including the sidebar link the
browser test clicks.

But the report does not stop there, and neither does the code comment. Both keep the line on the
strength of a specific scenario — Vue Router reusing the instance across `/suppliers/7` →
`/suppliers/8` — and both state that the line covers it. **It does not.** See F-H1. The author's
`history.pushState` probe was correctly diagnosed as non-discriminating and correctly deleted; the
error is stopping there and concluding the scenario is untestable, when `router.push()` drives the
real router and reproduces it in eleven lines.

### 1.3 The supplier detail endpoint never populates `bankAccounts` — **VERIFIED**

`toSupplierDetailResponse` (`server/src/modules/supplier/supplierProjections.js:16-34`) destructures
`bankAccounts = []` and copies it straight through. It has exactly two callers, both in
`SupplierAdminService.js` — line 269 passes `{ warnings }` only, line 790 passes
`{ addresses, contacts, identifiers, warnings }`. Neither passes `bankAccounts`. The field is
unconditionally `[]` on the wire, the old tab label `銀行資料 (${supplier.bankAccounts.length})` was
unconditionally `(0)`, and the old `detail.test.js` assertion was reading a row the test fixture had
invented. Removing the count and sourcing the panel's list from `supplierBankService.list` is the right
correction, and the replacement assertion (`toHaveBeenCalledWith(7)` plus
`reveal` not called) is stronger than what it replaced. Good find, correctly scoped, correctly fixed.

### 1.4 The four BLOCKED suites — **conclusion sound, stated reason wrong for three of them** (F-L2)

The conclusion is right and the disclosure posture is right: registering the four BLOCKED runs rather
than omitting them is the honest move, and `00_module_manifest.json` `required_suites.developer` is
`["lint", "client-build"]`, both of which pass. This task's developer gate is met. Declining to move
the PLAN baseline to repair someone else's suite is also right.

The *reason* recorded in the ledger does not survive checking:

| Suite | Ledger says | What the evidence says |
| --- | --- | --- |
| `supplier-client-ui` | points at a config that does not exist | **Correct.** `client/test/supplier-management.vitest.config.js` is absent; `stderr.log` reads `failed to load config from …` |
| `supplier-server-integration` | TECHNICAL/REGRESSION cases, T37 and later | `stderr.log`: `Could not find 'server/test/supplier-management'` |
| `supplier-bank-security` | same | `stderr.log`: `Could not find 'server/test/supplier-management/bank'` |
| `supplier-security` | same | `stderr.log`: `Could not find 'server/test/supplier-management/security'` |

All four `run.json` files record `"stage": "DEVELOPER"`, and all four suites declare
`"stages": ["DEVELOPER", "TECHNICAL", "REGRESSION"]` in `00_project_profile.json`. So the sentence
"they are TECHNICAL and REGRESSION stage cases belonging to TASK-037 and later" is describing the
*case* catalogue, not the suites, and it lands as an explanation of why the suites did not run. They
did not run because **all four point at paths that do not exist in this repository.** The server
supplier tests live at `server/test/supplier*.test.js` — which is what `supplier-phase-001-server`
actually globs, and why that one passes 395/395. There has never been a
`server/test/supplier-management/` directory.

This is not self-serving in the sense of hiding a failure — nothing is hidden, the runs are registered
and the exit codes are in the tree. It is self-serving in a smaller way: "those cases belong to a later
stage" implies the suites will run when that stage arrives, and they will not. Whoever picks up T37
inherits four suite definitions that cannot execute against this repository at all. That should be
stated plainly in the ledger so the gap is visible at the point someone can act on it.

---

## 2. Findings

### F-H1 (High) — the route guard does not fire on the path it was kept for, and the test the report calls unwritable is writable

**Location:** `client/src/components/suppliers/SupplierBankPanel.vue:64-82` (the comment block and
`onBeforeRouteLeave`); report §5; the same claim in the file comment.

**What is wrong.** Vue Router 4 calls `beforeRouteLeave` when the route *record* is left. When only the
params change and the component instance is reused — `/suppliers/7` → `/suppliers/8`, one record,
one instance — it calls **`beforeRouteUpdate`** instead. `onBeforeRouteUpdate` is not registered
anywhere in this component. The guard therefore does nothing on the only path the author kept it for,
and `onUnmounted` does not fire either, because nothing unmounts.

**Impact.** Supplier 7's account plaintext stays rendered, with its countdown still running, on a
screen whose URL, and eventually whose header, says supplier 8. This is precisely the failure the
report describes in its own words and believes it has closed. It is not reachable from today's UI —
there is no in-app link from a detail page to another `/suppliers/:id` — so it is latent, not live. It
becomes live the moment anyone adds a "next supplier" control, which is exactly the change the report
anticipates.

**Proof of concept.** Eleven lines, at this head, red:

```js
const Host = { setup() {
  const route = useRoute();
  const id = computed(() => Number(route.params.id));
  return () => h(SupplierBankPanel, { supplierId: id.value, supplierCode: `SUP-00${id.value}` });
} };
const router = createRouter({ history: createMemoryHistory(),
  routes: [{ path: "/suppliers/:id", component: Host }] });
// … push /suppliers/7, reveal, then:
await router.push("/suppliers/8");
await flushPromises();
expect(router.currentRoute.value.params.id).toBe("8");
expect(document.body.innerHTML).not.toContain(SECRET);
```

```
AssertionError: supplier 7 plaintext must not survive onto supplier 8's screen:
  expected '<div data-v-app=""><section aria-labe…' not to contain '12345678901234'
```

The received HTML in the failure contains `<span data-test="bank-plaintext">12345678901234</span>` and
`<span data-test="bank-reveal-countdown">30 秒後自動隱藏</span>` — still 30, because the interval was
never touched.

**Fix, verified.** One import and one line:

```js
import { onBeforeRouteLeave, onBeforeRouteUpdate } from "vue-router";
…
onBeforeRouteUpdate(() => { forgetPlaintext(); });
```

With that line the same test is green (`Tests 1 passed`). I applied it, ran it, and reverted it.

**Also required:** land the test. It is the discriminating test for a security control, and its absence
is what let the wrong hook survive review to this point. And correct §5 of the report and the comment
block — as written they tell the next reader that a hole is guarded when it is open. Keeping
`onBeforeRouteLeave` alongside is fine and costs nothing; the objection is not to the line, it is to
the claim attached to it.

**Note on §6 of the report.** The author records, out of scope, that `SupplierDetailPage` never watches
`route.params.id`, so the same reuse path would leave supplier 7's *masked* data under supplier 8's
URL. That is the same root cause, and it is the reason the reuse path is not hypothetical: whoever
fixes the stale-data bug will make this reachable. The two should be fixed together or the stale-data
bug should be filed where T37 will see it.

### F-M1 (Medium) — a `reveal` that resolves after unmount re-holds the plaintext and arms a fresh 30-second interval

**Location:** `client/src/components/suppliers/SupplierBankPanel.vue:100-118` (`confirmReveal` →
`holdPlaintext`).

**What is wrong.** `confirmReveal` awaits the service call and then calls `holdPlaintext(...)`
unconditionally. If the user confirms and immediately navigates away, `onUnmounted(forgetPlaintext)`
runs first, the response arrives afterwards, and `holdPlaintext` writes the plaintext into
`revealed.accountNumber` on a dead component and starts a new `setInterval` on it. AC-024's "cleared on
unmount" is inverted for that window: the value is *set* after unmount.

**Impact.** Bounded and not rendered — nothing displays it, and the new interval clears it 30 ticks
later. What it costs is a 30-second residency of the account number in a reachable closure after the
user has left the page, plus a timer on a destroyed component. Real but small; I am not claiming a
disclosure path from it.

**Proof of concept.** Deferred reveal promise, unmount before it settles, count timers:

```
AssertionError: a dead panel must not arm a new 30s interval: expected 3 to be 2
```

(`vi.getTimerCount()` immediately after `wrapper.unmount()` versus after the promise resolves.)

**Fix.** A mounted flag, or an `AbortController` cleared in `onUnmounted`:

```js
let live = true;
onUnmounted(() => { live = false; forgetPlaintext(); });
…
if (live) holdPlaintext(result.id, result.accountNumber);
```

The timer-count assertion above is the test.

### F-M2 (Medium) — three clearing assertions are DOM-shaped and pass on a broken implementation

Mutation battery against `bank.test.js` (13 tests). Each mutant applied alone and reverted:

| # | Mutation | Result | Why it survives |
| --- | --- | --- | --- |
| M4 | delete `onUnmounted(forgetPlaintext)` | **13/13 green** | the test asserts `document.body.innerHTML` after `wrapper.unmount()`; unmounting removes the DOM whether or not the ref was cleared |
| M6 | `@hide="forgetFormSecrets"` → no-op on the write dialog | **13/13 green** | Quasar destroys the dialog content on hide, so the DOM is clean either way; `form.accountNumber` and `form.password` survive in the reactive object and nothing looks |
| M9 | delete `forgetFormSecrets()` after a successful write | **13/13 green** | on the no-warning path `form.open = false` fires `@hide`, which clears the same two fields; the DOM assertion cannot separate the two mechanisms |
| M5 | delete the `session.isAuthenticated` watch | 1 failed | discriminates |
| M7 | `新增銀行帳戶` gated on `canReveal` instead of `canManage` | 1 failed | discriminates |
| M10 | keep `form.password` after a failed write | 1 failed | discriminates |

M9 is the one with a live consequence. On the **success-with-warnings** path `form.open` stays `true`,
so `@hide` never fires and `forgetFormSecrets()` is the only thing clearing the field. The
implementation is correct today — I verified it — but the existing duplicate-warning test walks
straight through that path and asserts only the banner, never the field. A discriminating assertion is
three lines and I confirmed it both ways:

```js
expect(body.find('[data-test="bank-duplicate-warning"]').exists()).toBe(true);
expect(field(body, "帳號").find("input").element.value,
  "a saved account number must not stay in an open dialog").toBe("");
```

Green at this head; under M9: `expected '12345678901234' to be ''`.

For M4 and M6 the fix is the same shape — assert the state, not the markup. Reading the panel's
`revealed`/`form` through the component instance, or the timer-count trick from F-M1, both work where
`innerHTML` cannot. The browser suite has the same shape of gap: its thirty-second assertion is
`toHaveCount(0)` on the node, so a `v-show` regression is caught for a structural reason rather than a
disclosure one. `expect((await page.content()).split(SECRET).length - 1).toBe(1)` after a reveal is the
assertion that says what is actually meant, and it is red under the `v-show` mutant (2 versus 1).

### F-M3 (Medium) — the per-row write controls have no permission assertion

**Location:** `client/src/components/suppliers/SupplierBankPanel.vue`, the `<template v-if="canManage">`
wrapping edit / set-default / deactivate.

Widening that gate to `canReveal` leaves `bank.test.js` **13/13 green**. The test
"offers no reveal without bank.view and no write controls without bank.mgmt" checks exactly one
control, `新增銀行帳戶` (M7 kills that one). The three row-level buttons — which are the ones that
open the dialogs that take a password and perform a signed write — are unasserted. A holder of
`supplier.view` + `bank.view` would be shown edit, set-default and deactivate, and no test would
notice.

The server still refuses the writes (AC-025, T34), so this is a UI-exposure and false-affordance
problem rather than a privilege escalation. The fix is one assertion in the `VIEW_BANK` branch of the
existing test:

```js
expect(result.body.find('[aria-label="編輯 Test Bank"]').exists(),
  "bank.view alone must not buy row write controls").toBe(false);
```

Worth noting that the gating itself is implemented correctly: `can()` defaults to `match: "all"`
(`client/src/framework/authorization/can.js`), and every gated control is `v-if`/`<template v-if>`, so
under `VIEW_BANK` the rendered markup contains `<!--v-if-->` placeholders and no button — genuinely
absent, not hidden. I confirmed that in the DOM dump.

### F-L1 (Low) — the thirty seconds is thirty ticks, not thirty seconds

**Location:** `SupplierBankPanel.vue:56-63` (`holdPlaintext`).

`REVEAL_SECONDS` is decremented by a `setInterval` and nothing compares against a clock. The server's
`revealedAt` is returned, and dropped on the floor. A page that is not ticking is not counting: OS
sleep, browser suspend, a frozen or discarded tab, a backgrounded mobile browser. Modelled with fake
timers — advance the wall clock an hour, fire no ticks:

```
AssertionError: an hour of wall clock passed; the account is still on screen
```

**Honest bounds.** That is a *model* of suspension, not a suspension. In Chromium a hidden but running
tab is throttled to ~1 Hz, which is the interval's own rate, so ordinary tab-switching does not extend
the window meaningfully — and I confirmed separately that switching to another Quasar tab unmounts the
panel and clears the value outright. The realistic exposure is a machine that sleeps inside the
30-second window, and a mobile browser that suspends the page. That the window extends indefinitely in
those cases is **PLAUSIBLE**; I did not suspend a real machine.

**Fix.** Take a deadline from `performance.now()` (monotonic, so a system-clock change cannot extend it
either) and derive `remaining` from it, clearing when it is past. Optionally also clear on
`visibilitychange`/`pagehide` — the value is no use to a user who is not looking at it.

I raise this as Low rather than higher because the report's reasoning about *why* the 30 seconds lives
on the client (`DEV-T34-EXPIRES-IN`: the server has no state that corresponds to an expiry, so a
server-supplied number would describe something that does not exist) is correct and well argued. The
objection is only to how the client counts.

### F-L2 (Low) — the ledger's reason for three of the four BLOCKED suites is wrong

Covered in §1.4. The observation appended to `00_harness_state.json` attributes three blocks to case
stage when the recorded cause is a missing path, and only names the missing-path cause for
`supplier-client-ui`. No gate is affected and nothing is concealed — the exit codes and stderr are in
the tree. Correct the observation text so that the carried gap (four suite definitions that cannot
execute against this repository) is stated where T37 will read it. No baseline move is needed to fix a
sentence.

---

## 3. Info

**I-1. The tab loses its count while its three siblings keep theirs.** `地址 (0)`, `聯絡人 (0)`,
`識別資料 (0)`, `銀行資料`. Correct — the other three counts come from fields the server does populate,
and inventing a count for bank would mean a second request from the page purely to label a tab. Worth a
line in §7.5 of the design so the asymmetry is not read as an oversight later.

**I-2. `writeBody()` does not trim `accountNumber`** while it trims every other string field. A pasted
value with trailing whitespace goes to the server as typed. The server normalises (T33), so this is
cosmetic; I mention it only because the trimming is visibly deliberate everywhere else in that function.

---

## 4. What I attacked and what HELD

Everything in this list was executed, not reasoned about.

- **Storage, URL, Pinia, notifications.** Real `localStorage`/`sessionStorage` entries in Chromium,
  `page.url()`, `session.$state`, and every `notifySuccess`/`notifyError` argument. Clean. The unit
  test's storage stub carries its own control assertion proving the stub records writes — that is the
  right shape and I checked the control fails when it should.
- **`Escape` and backdrop click on all three dialogs.** Both refused; the dialogs are `persistent`.
  `ESC_STILL_OPEN=true`, `BACKDROP_STILL_OPEN=true`.
- **Cancel, then reopen.** Typed the account number and the password into the create dialog, cancelled:
  `SECRET_AFTER_CANCEL=false`, `PASSWORD_AFTER_CANCEL=false` against `page.content()`. Reopened:
  both fields empty. Quasar destroys the dialog content on hide, and `openCreate`/`openEdit` reset
  regardless.
- **bfcache.** Revealed, performed a full cross-document navigation, pressed back.
  `performance.getEntriesByType("navigation")[0].type` is `back_forward` and the secret is absent from
  `page.content()`. Held. Under the dev server's headers; whether production headers change bfcache
  eligibility is **PLAUSIBLE** and untested.
- **Quasar tab panels / keep-alive.** Revealed, switched to 概覽, switched back. Occurrences of the
  secret in `page.content()`: 1 before, **0 while away, 0 on return**. The panel unmounts; nothing is
  kept alive.
- **Repeat and cross-row reveals.** Exactly one plaintext node after a reveal. Collapse, reveal again,
  wait 3s: countdown dropped by 3, so no stacked intervals — `holdPlaintext` calling `forgetPlaintext`
  first does its job. Revealing row B while row A is open clears A (asserted in the existing suite).
- **The service layer.** Three mutants, all killed by `test/services/supplierBank.test.js`: dropping
  `signed: true` from `update`; adding `signed: true` to `reveal`; smuggling the account number into a
  query string via `params`. `signed: true` is on exactly the four writes and absent from `reveal`, and
  the account number reaches the wire only in a POST body.
- **Failed-write handling.** Password cleared, account kept, submit re-disabled — all three asserted by
  the existing test, and M10 confirms the password clearing discriminates. Design §7.5 only requires
  clearing on success, so keeping the account number for correction is within the design.
- **Error text.** `form.error` comes from `error.code` mapping or `error.message`; `error.details` is
  deliberately unused, and `SupplierBankService.js:84-85` confirms the server's validation details
  carry the field name and never the value. No path puts an account number into a banner or a toast.
- **Permission gating.** `supplier.view` alone: no reveal button, no create button. `+bank.view`: reveal
  button, still no create button. `+bank.mgmt`: everything. Controls are absent from the DOM, not
  hidden. The row-level gap is F-M3; the gating itself is correct.
- **`aria-label` and tooltips.** Every `aria-label` interpolates `row.bankName` only. No `q-tooltip` in
  the component.
- **Autocomplete.** Account field `autocomplete="off" spellcheck="false"`; both password fields
  `type="password" autocomplete="current-password"`. Asserted by the existing suite.
- **Lint** over the four changed files: clean.

## 5. Not covered by this review

- **The server side of the Bank capability.** Unchanged by this branch; REV-039 through REV-043 covered
  it. I read `supplierProjections.js` and `SupplierAdminService.js` only to check claim 1.3, and
  `SupplierBankService.js` only to check that validation details omit the value. I did not run the
  server suites; CI ran them green at this head.
- **A real suspended machine or a real mobile background.** F-L1 is modelled, not reproduced.
- **Production bfcache eligibility.** Tested against the Vite dev server only.
- **Vue devtools state inspection.** Component-local refs are visible to devtools by construction, in
  this component as in any other. I did not treat that as a finding, and I did not attempt to read them
  through a devtools protocol.
- **The four BLOCKED suites' contents.** They cannot execute; I verified why, not what they would have
  asserted.
- **Whether `SupplierDetailPage`'s missing `route.params.id` watch is exploitable on its own.** Out of
  this task's scope by the author's own §6, and I agree with that scoping — but see the note under
  F-H1, because F-H1 and that bug share a root cause and whoever fixes one should know about the other.

## 6. What it takes to turn this into APPROVED

1. Register `onBeforeRouteUpdate(() => { forgetPlaintext(); })` and land the reuse test (F-H1).
2. Correct report §5 and the comment block in `SupplierBankPanel.vue` — the reuse path was open, and
   the test was writable (F-H1).
3. Guard `holdPlaintext` against a post-unmount resolve, with the timer-count assertion (F-M1).
4. Replace the three non-discriminating clearing assertions, at minimum the open-dialog one on the
   warning path (F-M2).
5. Assert the row-level write controls against `bank.mgmt` (F-M3).
6. Derive the countdown from a monotonic deadline (F-L1).
7. Correct the ledger observation's stated reason for the three server suites (F-L2).

Items 1 through 3 are the ones I would not merge without. Items 4 through 7 are small and belong in the
same pass rather than a later one.
