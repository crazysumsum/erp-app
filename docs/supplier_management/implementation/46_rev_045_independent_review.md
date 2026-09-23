# REV-045 — TASK-035 Bank UI independent review (REV-044 remediation)

**Review:** REV-045 ・**Task:** TASK-035 (T35) ・**Phase:** PHASE-003 ・**Capability:** SUP-CAP-03
**Head reviewed:** `0379ccc9c955ec4c1de1e60d4c1f6f0870ae1e7c` (`claude/supplier-task-035`, PR #125).
**Remediation delta:** `4a876547e41f63f78f4333f188ab99dfbbcf7558..HEAD`. **Merge diff:** `main…HEAD` (`cc1d74b4…`).
**Worktree:** `/Users/sam/Documents/workspace/erp-app-worktrees/supplier-task-035`
**Reviewer:** independent agent (`agent-skills:security-auditor`); not the author. Author is Claude Opus 5.

**Verdict: CHANGES_REQUESTED** — 0 Critical, 1 High, 1 Medium, 1 Low, 3 Info.

The remediation is good work and I want to say so before the finding. **Every one of the author's seven
mutants reproduces exactly as his table claims** — I re-ran all seven rather than reading them, six
killed in jsdom and the seventh killed in the browser. The three assertions rewritten under M-2 now
discriminate on the mechanism instead of the markup, and I confirmed that with two mutants he did not
write. The L-2 ledger correction is accurate to the byte: I checked all four paths and all four stderr
logs. §5 of the report and the comment block in `SupplierBankPanel.vue` now say the true thing, at
some length, about the hook that was wrong. The self-report that four mutants survived his *first*
round of fixes is the kind of disclosure that makes a report worth reading.

What blocks is that **the H-1 fix and the M-1 fix do not compose**, and the gap between them is the
same leak REV-044 blocked on. The `gone` flag is set in exactly one place — `onUnmounted`. The new
`onBeforeRouteUpdate` guard clears the plaintext but does not set it. So a `reveal` that is in flight
when the route param changes re-holds supplier 7's account number **on supplier 8's screen, rendered,
with a fresh thirty-second countdown**. I reproduced that, and the same shape through the
session-expiry watch. This is the fifth round in this module where a remediation opened the next
finding, and it is the second consecutive round where the defect is a guard that does not fire on one
of the paths it was written for.

Everything below states what I ran. Anything reasoned about but not executed is marked **PLAUSIBLE**.
Every mutation and every probe file was reverted or deleted immediately; `git status --porcelain` was
empty before the review, after every revert, and immediately before this report was written. The head
never moved and nothing was committed.

---

## Summary

| | |
| --- | --- |
| Critical | 0 |
| **High** | **1** — the `gone` flag guards only unmount, so a late `reveal` defeats the new route-update guard and the session-expiry watch and re-renders the plaintext under another supplier's URL |
| **Medium** | **1** — the write-side plaintext (`form.accountNumber`, `form.password`, `revealDialog.password`) is cleared by two of the five triggers the report and the component header attribute to it |
| **Low** | **1** — the new deadline uses `Date.now()`, which is not monotonic; REV-044 prescribed `performance.now()` and gave this reason |
| Info | 3 |

**Baseline and CI — verified.** `gh run view 35681604530`: `headSha` `0379ccc9c955ec4c1de1e60d4c1f6f0870ae1e7c`,
`conclusion: success`, `status: completed`, `event: pull_request`, **`attempt: 1`**, workflow `CI`.
`gh run list --commit 0379ccc…` returns exactly that one run — no reruns. Four checks green: Build
frontend 19s, Dependency audit 24s, Lint 28s, Test (server + client, MySQL integration) 4m16s. PR #125
is `OPEN`, `MERGEABLE`, `mergeStateStatus: CLEAN`, base `main`, `headRefOid` equal to the reviewed
head. `origin/main` re-fetched: still `cc1d74b4…`, and `git merge-base origin/main HEAD` equals it, so
the target has not moved and `default_commit` is current. `revision` is **200** as stated. As in
REV-044, I did **not** recompute the harness source fingerprint or the DESIGN/PLAN digests; I read them
from the state file. That much is unverified by me. See I-3 on what `code_commit` points at.

**Suites at this head, run by me.** `npx vitest run --root client` → **585/585, 72 files** (582 at the
previous head; +3 new tests, all in `bank.test.js`, which is 13 → 16). `npx playwright test
--project=technical supplier-bank.spec.js` → **3/3, 34.4s**. `npx eslint` over the four changed source
and test files → clean, exit 0. All re-run after the last revert and still green.

---

## 1. The six claimed remediations, verified independently

### 1.1 H-1 — `onBeforeRouteUpdate` — **the hook is right, the test is real, and the hole is still open on the async path**

The mechanical part is correct and I verified it rather than reading it:

- **The mutant is killed.** Removing `onBeforeRouteUpdate(() => { forgetPlaintext(); });` →
  `1 failed | 15 passed`, at `clears the plaintext when only the :id changes and the panel is reused`,
  `AssertionError: supplier 7's account must not survive into supplier 8's page`.
- **The test genuinely exercises instance reuse, not a remount.** This is the thing worth checking and
  it checks out two ways. First, under the mutant the plaintext *survives* the navigation — if the
  panel had remounted, `onUnmounted` would have cleared it and the mutant would have lived. Second, I
  wrote a mutant the author did not (`X-4`): keep the guard registered but have it do something
  harmless (`revealed.remaining = 0`) instead of clearing. Red, same assertion. So the assertion is
  tied to the clearing, not to the mere presence of a guard.
- **The test's route shape matches the real application.** `/suppliers/:id` is declared on
  `SupplierDetailPage` (`client/src/pages/suppliers/SupplierDetailPage.vue:4`), the only
  `<router-view />` on that path (`client/src/framework/layout/AppShell.vue:55`) is **unkeyed** and not
  inside `<keep-alive>`, so the real app reuses the instance exactly as the test host does. The
  synthetic host is a fair model.
- **Other navigation shapes — I tried them.** `router.replace("/suppliers/8")`: plaintext cleared.
  Browser back between two ids (`router.back()` after a `replace`, landing on a different `:id`):
  plaintext cleared. An **aborted** navigation (a global `beforeEach` returning `false` for
  `/suppliers/9`): the URL stays at `/suppliers/7` and the plaintext stays — which is correct, the user
  never left. Nested routes do not exist under `/suppliers/:id`. `onBeforeRouteLeave` remains an
  equivalent mutant (removing it: 16/16 green) exactly as both the author and REV-044 state; it is
  redundant, it is documented as redundant, and redundant is not wrong.

**What is not closed: the same leak through the async path.** See F-H1. `onBeforeRouteUpdate` clears
the plaintext, but nothing stops the in-flight `reveal` from putting it straight back.

### 1.2 M-1 — the `gone` flag — **works for the case it was written for, and only that case**

Mutant `M-1` (drop `if (gone) return;`) → red:
`expected "setInterval" to not be called at all, but actually been called 1 times`. My own `X-3`
(register `onUnmounted` but never set `gone = true`) → red on the same assertion. So the flag is real
and the assertion is tied to it.

The three defeat conditions the brief asked about:

| Condition | Result |
| --- | --- |
| a `reveal` in flight when the route **updates** rather than unmounts | **DEFEATED** — F-H1 |
| a `reveal` in flight when the **session expires** | **DEFEATED** — F-H1 |
| two reveals racing | **HELD** — `if (revealDialog.busy) return;` admits exactly one call; I clicked 確認查看 twice with the promise pending and `reveal.mock.calls.length` stayed at 1. After both resolvers fired: exactly 1 plaintext node, 1 countdown node |
| a rejected `reveal` | **HELD** — no plaintext in the DOM, password field empty, `密碼不正確` shown |

### 1.3 M-2 — spying on `setInterval`/`clearInterval` — **sound here, and I checked it cannot pass for nothing**

Is spying on a global a sound way to assert this, or does it pin implementation shape? Both, and on
balance it is the right trade in this one place. The property being asserted *is* mechanical — "the
timer was actually cancelled, not merely orphaned by a removed node" — and REV-044 demonstrated that
every DOM-shaped form of that assertion is vacuous. The cost is real but small: a rewrite from
`setInterval` to a `setTimeout` chain or `requestAnimationFrame` would break three tests that no
behaviour change should break. I would accept that cost for a security control and would not accept it
for ordinary UI state.

Can the spies pass for unrelated reasons? I tested rather than assumed:

- `clearInterval` spy (unmount): mutant `M-2a` (drop `forgetPlaintext()` from `onUnmounted`) → **red**.
  My `X-2` (leave `onUnmounted` alone but stop `forgetPlaintext` from calling `clearInterval`) →
  **red**, same assertion. So nothing else in the mount tree calls `clearInterval` during unmount
  today, and the spy is discriminating. The residual coupling is I-1.
- `setInterval` spy (late reveal): it is a negative assertion, installed *after* unmount, so the failure
  mode would be a false red, not a false green. `M-1` and `X-3` both drive it red.
- The comment's stated reason for rejecting a timer **count** — "unmount clears Quasar's own batch too,
  so the count drops either way" — is the kind of sentence this module has been burned by, so I
  measured it: `vi.getTimerCount()` is **4 before unmount and 2 after**. Two timers go, only one of
  which is the countdown. The stated reason holds.
- The `forgetFormSecrets` assertion moved to the warning path: mutant `M-2b` → **red**,
  `expected '12345678901234' to be ''`. Correctly placed — that is the one path where the dialog stays
  open and `@hide` cannot do the clearing for it.

### 1.4 M-3 — per-row permission assertions — **VERIFIED, and built the right way round**

Mutant `M-3` (`<template v-if="canManage">` → `canReveal`) → red, `編輯 Test Bank needs bank.mgmt:
expected true to be false`. The assertion is two-sided — absent under `VIEW_BANK`, present under
`FULL` — which is what stops a mistyped `aria-label` from making the negative branch pass vacuously.
That second half is the part that is easy to leave out, and it is there.

### 1.5 L-1 — the countdown — **VERIFIED as a clock, with a clock that can run backwards**

Mutant `L-1` (restore the tick-decrementing body) → red, `a throttled tab must still clear once the
deadline has passed`. The test models throttling honestly (jump the clock 60s, allow exactly one tick).

Boundary behaviour, measured: t=0 shows `30`, t=29.0s shows `1`, t=29.9s shows `1`, t=30.1s the node is
gone. `Math.ceil` means the display floors at 1 and never reaches 0 or goes negative, and it cannot
stall while the clock advances. Good.

It cannot run backwards on the user *unless the system clock does*, and `Date.now()` follows the system
clock. See F-L1. `revealedAt` is still unused; I agree with leaving it unused — anchoring a client
deadline to a server timestamp imports clock skew for no benefit, and §2's `DEV-T34-EXPIRES-IN`
reasoning is sound.

### 1.6 L-2 — the ledger's reason for the four BLOCKED suites — **VERIFIED, exactly**

All four paths checked on disk:

| Suite | Path the profile names | On disk |
| --- | --- | --- |
| `supplier-client-ui` | `client/test/supplier-management.vitest.config.js` | **MISSING** |
| `supplier-server-integration` | `server/test/supplier-management` | **MISSING** |
| `supplier-bank-security` | `server/test/supplier-management/bank` | **MISSING** |
| `supplier-security` | `server/test/supplier-management/security` | **MISSING** |

And the recorded `stderr.log` of each registered run says precisely that — `failed to load config from
…supplier-management.vitest.config.js`, `Could not find 'server/test/supplier-management'`,
`…/bank`, `…/security`. The server supplier tests really do live at `server/test/supplier*.test.js`.
The new observation (`status: FAIL`, `subject: "Correction: four profile suites point at paths that do
not exist…"`) states the carried gap plainly, keeps the stage-mismatch fact without leading with it,
and says why it is not being fixed here. That is the correction REV-044 asked for, and it is complete.

---

## 2. Findings

### F-H1 (High) — a `reveal` in flight defeats the new route guard and the session watch, and re-renders the plaintext under another supplier's URL

**Location:** `client/src/components/suppliers/SupplierBankPanel.vue:58-80` (`holdPlaintext`, the `gone`
flag, `onUnmounted`) together with `:99` (`onBeforeRouteUpdate`) and `:102` (the `isAuthenticated`
watch); `confirmReveal` at `:125-144`.

**What is wrong.** The component has five clearing triggers and all five route through
`forgetPlaintext()`. The `gone` flag, which is what stops a late response from re-holding the
plaintext, is set in **one** of them:

```js
let gone = false;
onUnmounted(() => { gone = true; forgetPlaintext(); });
onBeforeRouteLeave(() => { forgetPlaintext(); });     // does not set gone
onBeforeRouteUpdate(() => { forgetPlaintext(); });    // does not set gone
watch(() => session.isAuthenticated, …);              // does not set gone
```

`confirmReveal` awaits the service call and then calls `holdPlaintext` with no check of its own beyond
`gone`. On the route-update path nothing ever unmounts, so `gone` stays `false` forever, and a response
that arrives after the guard has run walks straight past it.

**Impact.** Identical to the leak REV-044 blocked on, reached by a different door: supplier 7's account
plaintext is written into `revealed.accountNumber`, **rendered** on a page whose URL says supplier 8,
and a fresh thirty-second `setInterval` is armed. The plaintext is not merely resident in a closure —
it is on screen with `30 秒後自動隱藏` beside it.

**Proof of concept — executed, at this head.** Start a reveal, leave it pending, change the param,
then resolve:

```
P1 url after push:                     /suppliers/8
P1 secret in DOM before resolve:       false     ← onBeforeRouteUpdate did its job
P1 secret in DOM AFTER late resolve:   true      ← and then it was undone
P1 countdown armed on the reused panel: 1
P1 countdown text:                     30 秒後自動隱藏
```

The same through the session watch, with no navigation at all:

```
P10 secret in DOM after logout, before resolve:  false
P10 secret in DOM AFTER a late resolve post-logout: true
```

**Reachability — stated honestly.** Neither path is reachable from today's UI without help:

- *Route update.* Needs an in-app navigation from one `/suppliers/:id` to another while a reveal is in
  flight. No such control exists today — same bound REV-044 put on its own H-1, and the same
  "next supplier" button makes it live.
- *Session expiry.* `httpClient.onUnauthorized` (`client/src/main.js:62-68`) calls `session.clear()`
  and **then** `router.push({ name: "login" })`. The clear is synchronous, the navigation is not, so the
  window between the watch firing and the unmount is real but short — and the reveal dialog is
  `persistent`, so a user cannot click a logout control behind it. The realistic trigger is a *different*
  concurrent request 401-ing while the reveal itself succeeds. That the window is exploitable in a real
  browser is **PLAUSIBLE**; what I demonstrated is the code-level behaviour under fake timers, not a
  real race.

So this is latent, exactly as REV-044's H-1 was latent, with a narrower trigger (one HTTP round trip
rather than the whole thirty seconds). A reviewer applying a stricter reachability bar could reasonably
call it Medium. I am holding it at High for three reasons: the consequence is the identical
cross-supplier plaintext render that the previous round declined to merge; the `gone` flag exists
*specifically* to stop a late response re-holding the plaintext and it does so on one trigger out of
five; and the fix is one line in one place.

**Fix — applied, run, and reverted.** Do not add `gone = true` to each guard — that is four edits and
the next trigger added will miss one. Every clearing trigger already funnels through
`forgetPlaintext()`, so put the invalidation there:

```js
let revealGeneration = 0;
function forgetPlaintext() {
  revealGeneration += 1;
  if (countdown) { clearInterval(countdown); countdown = null; }
  …
}

// in confirmReveal:
const generation = revealGeneration;
const result = await supplierBankService.reveal(…);
if (generation !== revealGeneration) return;   // something cleared while we were in flight
holdPlaintext(result.id, result.accountNumber);
```

With that in place, at this head:

```
FIX route-update:    secret in DOM = false
FIX session-expiry:  secret in DOM = false
FIX ordinary reveal still shows plaintext = true
```

and `test/pages/suppliers/` is **80/80** green, including all 16 of `bank.test.js`. This subsumes the
`gone` flag (unmount bumps the generation too), so `gone` can go or stay; that is the author's call.

**Also required:** land both regression tests — the route-update one and the session-expiry one. Each is
about ten lines and both are red at this head. The reason the first H-1 reached REV-044 was that the
discriminating test did not exist; the reason this one reached REV-045 is the same.

### F-M1 (Medium) — the write-side plaintext is cleared by two of the five triggers the report attributes to it

**Location:** `SupplierBankPanel.vue:12-17` (the header comment), `:155-158` (`forgetFormSecrets`),
`:341` (`@hide="forgetFormSecrets"`); report §1.

**What is wrong.** The header comment and report §1 both open by naming **two** homes for the account
plaintext — `revealed.accountNumber` (read) and `form.accountNumber` (write) — and then say, of the
plaintext so defined:

> 清除有五個觸發點，全部指向同一個 `forgetPlaintext()`：手動收起、30 秒到、unmount、route change、session 失效。

`forgetPlaintext()` does not touch `form` at all. The write-side plaintext is cleared by exactly two
mechanisms: the dialog's `@hide`, and `forgetFormSecrets()` after a successful write. Neither
`onBeforeRouteUpdate` nor the session watch clears it, and on a route update nothing unmounts to
collect it either. This is the same error shape REV-044 raised as its High and the author names as his
third instance in this module: a mechanism asserted in a comment and a report section more broadly than
the code implements it.

**Impact — measured, at this head.** Session cleared with the create dialog open and filled:

```
P2 secret in DOM after session expiry:     true
P2 password in DOM after session expiry:   true
P2 account field value:                    12345678901234
P2 dialog still open:                      1
```

Route param changed with the same dialog open:

```
P3 url:                                    /suppliers/8
P3 secret in DOM after param change:       true
P3 account field value:                    12345678901234
```

And the reveal dialog behaves the same way — it survives a param change with its typed password still
rendered (`P12`).

The route-update case is the one with teeth, because nothing later cleans it up: the create dialog
stays open indefinitely under supplier 8's URL holding an account number typed for supplier 7, with
`form.editing` still pointing at supplier 7's row and its `version`. `writeBody()` sends that to
`props.supplierId`. Today `props.supplierId` is still 7, because `SupplierDetailPage` never watches
`route.params.id` — the bug the author records out of scope in §6. **Whoever fixes that §6 bug converts
this into a cross-supplier write of a typed account number.** The two are the same root cause and should
be noted in the same place. Server-side the write is still password- and device-gated and ownership is
pinned (TASK-034, and the `dc63777` cross-Supplier regression), so this is a wrong-target write by the
legitimate holder of the permission, not an escalation.

The session-expiry case is bounded by the login redirect unmounting the panel shortly afterwards, as in
F-H1, so its practical window is short.

**Fix.** Either make the route guards and the session watch call `forgetFormSecrets()` (and close the
dialogs) as well as `forgetPlaintext()` — one composite `forgetEverything()` is the honest shape, since
the five triggers all mean "this screen is no longer the screen the user was on" — or narrow the two
claims to what the code does. Do not do only the second. The assertion for it is the shape already used
on the warning path: `expect(field(body, "帳號").find("input").element.value).toBe("")` after the
trigger, plus the same for 密碼.

### F-L1 (Low) — the deadline uses `Date.now()`, which is not monotonic

**Location:** `SupplierBankPanel.vue:69` (`const deadline = Date.now() + REVEAL_SECONDS * 1000;`).

REV-044's L-1 fix was specific: "Take a deadline from `performance.now()` (**monotonic, so a
system-clock change cannot extend it either**)". The remediation took the deadline from `Date.now()`,
which follows the wall clock, and report §8 records the change as "改成對住時鐘計 deadline" without
noting the deviation or the trade it makes.

The throttled-tab problem is genuinely fixed — that was the larger of the two. What replaces it is
smaller and new: a backwards step of the system clock extends the window by the size of the step.
Measured at this head, a one-hour backwards jump:

```
P4 countdown at start:                              30 秒後自動隱藏
P4 secret still shown after a 1h backwards jump:    true
P4 countdown now:                                   3629 秒後自動隱藏
P4 secret after a further 60s of real ticks:        true
```

So the plaintext stays for an hour, and the UI announces it. Realistic triggers are an NTP step, a VM
or laptop resuming with a clock correction, or a user changing the system clock; that any of these
occurs inside a thirty-second window is unlikely, which is why this stays Low and why REV-044 rated the
original the same. It is worth fixing because the prescribed fix has neither failure mode.

**Cost, stated because it is not free.** `vi.setSystemTime` does not move `performance.now()`, so the
new `clears on wall-clock time, not on a count of ticks` test would need rewriting around
`vi.advanceTimersByTime` with a stubbed `performance.now`, or the throttling model expressed a
different way. The test is currently coupled to the non-monotonic choice. I did not write the
replacement.

---

## 3. Info

**I-1. The `clearInterval` spy asserts that *an* interval was cleared, not that the countdown was.**
`expect(cleared).toHaveBeenCalled()` discriminates today — I proved that two ways (M-2a, X-2) — but it
does so because nothing else in the mount tree happens to call `clearInterval` during unmount. That is
a property of the current Quasar build, not of this component, and P7 shows unmount does dispose of
other timers. Capturing the handle closes the gap without changing the approach: spy `setInterval` at
reveal time, keep its return value, and assert `expect(cleared).toHaveBeenCalledWith(handle)`.

**I-2. The thirty-second test lost its node-level assertion to the new one.** In the L-1 edit, the
trailing `// 唔可以淨係隱藏 …` comment and its `expect(document.body.innerHTML).not.toContain(SECRET)`
stayed attached to the *new* `clears on wall-clock time` test, which now asserts the same thing twice
in a row, while `reveals one row for thirty seconds …` now ends at `expect(body.text())`. No coverage
is actually lost — the `v-show` regression is a browser-suite matter either way — but one test has a
duplicated assertion and another lost the assertion its own comment was written for.

**I-3. `baseline.code_commit` names the previous head.** `code_commit` is `4a876547…` and both new
observations carry that same `code_commit` while describing work that exists only at `0379ccc…`. This
is the structural limit recorded in earlier rounds — a commit cannot contain its own hash — and it is
the same lag REV-044 reviewed under (`cc1d74b4…` while reviewing `4a87654…`). Recorded so the next
reader does not mistake it for drift. Not a finding against this task.

**Carried from REV-044, not addressed, not blocking.** The browser suite's thirty-second assertion is
still `toHaveCount(0)` rather than an occurrence count of the secret in `page.content()` (REV-044's
aside under F-M2 — its item 4 only required the open-dialog assertion, which was done).
`writeBody()` still does not trim `accountNumber` while trimming every other string field (REV-044
I-2). The tab-count asymmetry note for design §7.5 (REV-044 I-1) is not in the design.

---

## 4. What I attacked and what HELD

Executed, not reasoned about. I deliberately did not re-run what REV-044 already confirmed
(storage, URL, Pinia, toasts, Escape/backdrop, cancel-then-reopen, bfcache, tab switching, the service
layer); this is where I went instead.

- **The full author mutation table, all seven, reproduced.** `H-1`, `M-1`, `M-2a`, `M-2b`, `M-3`, `L-1`
  each applied alone and reverted → each **KILLED**, at the assertion the author names. The seventh,
  `v-if` → `v-show` (both halves mutated faithfully so the masked label still behaves), does not
  compile under jsdom as stated, and in the browser → **1 failed, 2 passed (51.2s)**, failing the
  thirty-seconds test. The table is accurate.
- **Four mutants the author did not write.** `X-1` drop `onBeforeRouteLeave` → **16/16 green**
  (still an equivalent mutant, as documented). `X-2` stop `forgetPlaintext` clearing the interval →
  red. `X-3` register `onUnmounted` but never set `gone` → red. `X-4` keep `onBeforeRouteUpdate`
  registered but clear nothing in it → red. The three that should discriminate, do.
- **Navigation shapes.** `router.replace` between two ids → cleared. History `back()` landing on a
  different `:id` → cleared. An aborted navigation → plaintext retained at the unchanged URL, which is
  correct. No nested routes exist under `/suppliers/:id`. The real `<router-view />` is unkeyed and not
  kept alive, so the test's reuse model matches the app.
- **Reveal races.** Two confirms with a pending promise → exactly **1** service call (`revealDialog.busy`
  holds), and after both resolvers fire, exactly 1 plaintext node and 1 countdown node. A rejected
  reveal → no plaintext, password field empty, mapped error shown, `revealed` untouched.
- **Countdown boundary.** 30 → 1 → 1 → cleared across 30.1s of fake clock; never 0, never negative,
  never stalled while the clock advances.
- **Timer accounting.** `vi.getTimerCount()` 4 → 2 across unmount, which is the evidence for the
  comment's claim that a total-count assertion cannot discriminate.
- **The four BLOCKED suites.** All four declared paths confirmed absent from the tree; all four recorded
  `stderr.log` files read and matched against the ledger sentence.
- **Lint** over the four changed source and test files: exit 0.
- **Tree discipline.** `git status --porcelain` empty before the review, after each of the eleven
  mutations, after the fix trial, and immediately before this report was written. `git rev-parse HEAD`
  still `0379ccc…`. Nothing committed.

## 5. Not covered by this review

- **The server side of the Bank capability.** Unchanged by this branch; REV-039…REV-043 covered it, and
  CI ran the server suites green at this head. I read `main.js` and `HttpClient.js` only to bound the
  session-expiry path in F-H1.
- **A real suspended machine, a real mobile background, a real NTP step.** F-L1's backwards-clock result
  is a fake-timer model of a system-clock change, not a system-clock change.
- **Production bfcache eligibility, devtools state inspection, and the contents of the four BLOCKED
  suites.** Same exclusions REV-044 recorded, for the same reasons.
- **The harness source fingerprint and the DESIGN/PLAN digests.** Read from the state file, not
  recomputed.
- **Whether the F-H1 session-expiry window is hittable in a real browser.** Marked PLAUSIBLE above; what
  I demonstrated is the component's behaviour, not the race.
- **`SupplierDetailPage`'s missing `route.params.id` watch.** Still out of this task's scope and I agree
  with that scoping — but it now has a second dependency on it (F-M1), not just one.

## 6. What it takes to turn this into APPROVED

1. Invalidate in-flight reveals from `forgetPlaintext()` itself — the generation counter above, or any
   equivalent that covers all five triggers rather than one — and land the route-update and
   session-expiry regression tests (F-H1). **This is the one I would not merge without.**
2. Either clear the write-side plaintext on route change and session expiry too, or narrow the header
   comment and report §1 to the two mechanisms that actually clear it. Assert whichever you choose
   (F-M1).
3. Move the deadline to `performance.now()`, and rework the throttling test around it — or, if
   `Date.now()` is kept deliberately, record the backwards-clock trade as a known bound in the comment
   instead of leaving the prescribed fix silently unimplemented (F-L1).
4. The three Info items are one-line each and belong in this pass rather than a later one.

Item 1 blocks. Items 2 and 3 are small and are in the same file.
