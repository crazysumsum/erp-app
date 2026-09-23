# REV-047 — TASK-035 Bank UI independent review (REV-046 remediation + the `main` merge)

**Review:** REV-047 ・**Task:** TASK-035 (T35) ・**Phase:** PHASE-003 ・**Capability:** SUP-CAP-03
**Head reviewed:** `68f8d4d6c7960438628871c1fdecd961d49c04d4` (`claude/supplier-task-035`, PR #125).
**Previous review head:** `11caf87806d58e687ec5856d8d9de2baa4e9da98`.
**Merge diff:** `origin/main…HEAD`, where `origin/main` is `fd615e539bc339ceada1b6541949db7046ed160c`
and is also `git merge-base origin/main HEAD` — the branch is level with the target.
**Worktree:** `/Users/sam/Documents/workspace/erp-app-worktrees/supplier-task-035`
**Reviewer:** independent agent (`agent-skills:security-auditor`); not the author. Author is Claude Opus 5.

**Verdict: CHANGES_REQUESTED** — 0 Critical, **1 High**, 2 Medium, 3 Low, 7 Info.

**Every one of the five REV-046 remediations is real, and I killed a mutant on each.** The discarded
reveal now speaks, and it says the right thing about the audit row; the confirm dialog's password is
cleared *and* asserted; `?? Date.now()` is gone entirely rather than kept behind a comment; the
`Math.min` clamp is gone; the `clearInterval` spy watches the countdown's own handle. I wrote four
mutants of my own against those five and all four died. The disclosure class REV-046 declared closed
is still closed: I could not put plaintext on the wrong Supplier's screen on any path I tried,
including three new ones through the real `SupplierDetailPage` that no previous round has driven.

**The seam the brief pointed at is sound where it matters.** All four handlers fire in the right
order, a declined `window.confirm` leaves the panel completely untouched, a reveal in flight across a
declined navigation still lands correctly with no misleading error, and the page's `superseded()`
guard cannot separate page from panel because the panel is bound to `supplier.id`, not to the route
param. Six attacks on that seam, six HELD.

**What breaks the round is the fix itself, and it is the seventh consecutive time that sentence is
true.** The new `watch(() => props.supplierId, …)` added in the merge commit does not run in the real
application — I removed it and the real page still refetches Supplier 8's list and still never shows
Supplier 7's rows. The bug it was written for does not occur where the report says it occurs. And
because it *does* run in `bank.test.js`'s synthetic host, it now performs the clearing that three of
the author's own twelve mutants existed to detect: **`F-M1`, `H-1` and `M-2b` all survive 595/595 at
this head.** `onBeforeRouteUpdate` can be deleted from `SupplierBankPanel` — the guard REV-044 found
missing, that took two rounds to get right — with the entire suite green. §10's "twelve mutants,
twelve killed" is true at `551e249`. It is not true at the commit being merged.

Everything below states what I ran. Anything reasoned about but not executed is marked **PLAUSIBLE**.
Every mutation was reverted immediately and `git status --porcelain` was empty before the review,
after each of the twenty-two mutations, after every probe file was deleted, and immediately before
this file was written. `git rev-parse HEAD` is still `68f8d4d…`. Nothing was committed.

---

## Summary

| | |
| --- | --- |
| Critical | 0 |
| **High** | **1** — the new `props.supplierId` watcher is unreachable in the application and masks three of the twelve claimed kills; the Bank panel's route-update guard is now wholly unasserted |
| **Medium** | **2** — an unguarded `load()` inside that watcher re-opens the exact defect it was written to close; `/suppliers/<non-numeric>` never leaves the loading skeleton |
| **Low** | **3** — the reveal re-entrancy guard is unasserted; `confirm.password` clearing in `submitConfirm` is unasserted; the ledger's freshest evidence predates both the remediation and the merge |
| Info | 7 |

**Baseline and CI — verified on seven fields, and correct.** `gh run view 35685495391`: `headSha`
`68f8d4d6c7960438628871c1fdecd961d49c04d4`, `conclusion: success`, `status: completed`,
`event: pull_request`, **`attempt: 1`**, workflow `CI`. `gh run list --commit 68f8d4d…` returns
exactly that one run — no reruns. Four checks green: Dependency audit, Build frontend, Lint, Test
(server + client, MySQL integration). PR #125 is `OPEN`, `MERGEABLE`, `mergeStateStatus: CLEAN`,
`isDraft: false`, base `main`, `headRefOid` equal to the reviewed head. `revision` is **207** as
stated.

**REV-046's I-4 is addressed.** `baseline.default_commit` is now `fd615e53…`, and at review time
`origin/main` and `git merge-base origin/main HEAD` are both `fd615e53…`. The target has not moved
since the merge; CLAUDE.md §6 is satisfied at this instant. Note that `origin/main` already contains
PR #127, so the `SupplierDetailPage` route watcher, `onBeforeRouteUpdate(confirmDiscard)`, the
`superseded()` guard and `supplier-detail-route-reuse.spec.js` are **not** part of this branch's
subject — `origin/main…HEAD` is seven client files, 1352 insertions.

As in the three previous rounds I did **not** recompute the harness source fingerprint or the
DESIGN/PLAN digests; I read them from the state file. That much is unverified by me.

**Suites at this head, run by me.**

| Suite | Result |
| --- | --- |
| `npx vitest run --root client` | **595/595, 72 files** — run at the start, after every revert, and again immediately before writing this |
| `npx eslint` over the seven changed source, test and e2e files | clean, exit 0 |
| `npx playwright test --project=technical supplier-bank.spec.js` | **3/3, 34.6s** |
| `npx playwright test --project=technical` (whole project, both specs plus approvals and settings) | **23/23, 49.0s** |

---

## 1. The five claimed remediations, verified independently

Each was checked by mutation at this head, not by reading §10.

| # | REV-046 item | Mutant I applied | Result |
| --- | --- | --- | --- |
| 1 | Discarded reveal sets `revealDialog.error` instead of returning silently | restore the bare `return` | **KILLED** — `says so when a reveal is discarded, because the server already audited it` |
| 2 | Confirm dialog's password cleared **and** asserted (X5) | drop `confirm.open = false; confirm.password = "";` from `forgetEverything()` | **KILLED** — `wipes the confirm dialog's password on a Supplier change and on session expiry` |
| 3 | `?? Date.now()` removed entirely | `const clock = () => Date.now();` | **KILLED** — both clock tests |
| 4 | `Math.min` clamp removed | read at `:108-113`; the clamp is gone and the comment now explains why a number above 30 is a real signal | verified by inspection; mutant 3 establishes the fallback branch is the only one that changed behaviour |
| 5 | `clearInterval` spy watches the countdown's own handle (X12) | `clearInterval(987654321)` | **KILLED** — `clears the plaintext on unmount and on session expiry` |

**Four mutants of my own against the same five, none of which the author wrote:**

- `Y4` — replace the discard message with a generic `"操作失敗。"` → **KILLED**. The assertion is
  `toMatch(/稽核|重新查看/u)`, so the *content* is pinned, not merely the presence of an alert. The
  message is accurate about what happened server-side: the reveal was decrypted and a
  `supplier.bank.reveal` row was written, and the text says so.
- `Y5` — keep the message but also close the dialog (`revealDialog.open = false`) → **KILLED**. The
  dialog state after a discard is pinned, not incidental.
- `Y10` — `setInterval(tick, 1000)` without assigning to `countdown`, so the real interval leaks →
  **KILLED**. This is the negative control for remediation 5: X12 proves the assertion rejects a
  *wrong* handle, Y10 proves it rejects *no* handle. Both were needed; REV-045's I-1 is now properly
  discharged.
- `Y8` — `if (left <= 0)` → `if (left < 0)` → **SURVIVED**. See I-3; the boundary of the 30-second
  window is not pinned, only its order of magnitude.

The dialog state after a discard is coherent: the dialog stays open, the password is cleared in the
`finally`, `busy` is released, and a retry immediately afterwards works (I re-ran REV-046's retry
probe). The user is told the disclosure was recorded and asked to look again — which is the right
thing to say, because the audit row cannot be un-written.

---

## 2. Findings

### F-H1 (High) — the new `props.supplierId` watcher does not run in the application, and in the test host it masks three of the twelve claimed kills

**Location:** `client/src/components/suppliers/SupplierBankPanel.vue:157-167`;
`client/src/pages/suppliers/SupplierDetailPage.vue:434` (`:supplier-id="supplier.id"`),
`:119` / `:312` (`loading` gates the whole `v-else-if="supplier"` subtree);
`client/test/pages/suppliers/bank.test.js:271-290` (the new test) and `:44-46` (the host's binding).

This is one root cause with three consequences. I am reporting it as one finding because fixing the
cause fixes all three, and fixing any one of them separately will not.

#### (a) The watcher is unreachable in the real application

`SupplierBankPanel` is bound to `supplier.id`, not to `route.params.id`. On a param-only navigation
the page's own `route.params.id` watcher calls `load()`, whose first statement is
`loading.value = true`; `loading` gates `<q-skeleton v-if="loading">` against
`<template v-else-if="supplier">`, so the entire tab-panel subtree — including the Bank panel —
is torn down before `supplier.id` is ever reassigned. `props.supplierId` therefore never changes on a
live instance.

**Executed, through the real `SupplierDetailPage` with the real router (probe `P-A`):**

```
P-A panel mounted:            true   uid: 53
P-A list calls:               [[7]]
   → router.push("/suppliers/8")
P-A after: panel exists:      true   uid: 91      ← a different instance
P-A list calls after:         [[7],[8]]
P-A body has Bank Eight: true   has Bank Seven: false
```

The uid changes. The panel is destroyed (`onUnmounted(forgetEverything)`) and a fresh one mounts
(`onMounted(load)`). That is what refetches the list.

**The discriminating run.** I removed the watcher entirely (`Y1`) and re-ran `P-A` against the real
page:

```
Y1 applied  P-A list calls after: [[7],[8]]
Y1 applied  P-A body has Bank Eight: true   has Bank Seven: false
```

Identical. **Supplier 7's masked rows do not survive onto Supplier 8's page with the watcher removed.**
The defect the merge commit describes —

> 揾到嘅方法係**去試個組合**，唔係讀兩份綠色報告：`list()` 叫咗一次 7，由頭到尾冇叫過 8。

— is a measurement of `bank.test.js`'s host, not of the application. That host renders
`h(SupplierBankPanel, { supplierId: Number(this.$route.params.id), … })`, which keeps the instance
alive across the param change. REV-046 flagged that exact divergence in its carried notes and wrote
"the test host is therefore *more* aggressive than production on this point… worth knowing before
anyone fixes §6". The follow-up was built on the host's behaviour rather than the application's.

The watcher is therefore dead code at this head. (**PLAUSIBLE**, not exhaustively enumerated: I
grepped `client/src` and `SupplierBankPanel` has exactly one mount site, and there is no `keep-alive`
anywhere in `client/src`, so I know of no configuration in which it fires.)

#### (b) It masks three of the author's twelve mutants

Because `forgetEverything()` now also runs from the watcher, and the watcher *does* fire in
`bank.test.js`, the assertions that used to reach the route-update guard are satisfied without it.
Each applied alone at this head, full suite re-run:

| Mutant (author's own, §10) | At `551e249` / `11caf87` | **At `68f8d4d`** |
| --- | --- | --- |
| `F-M1` — `onBeforeRouteUpdate` → `forgetPlaintext()` only | KILLED | **SURVIVED 595/595** |
| `H-1` — drop `onBeforeRouteUpdate` entirely | KILLED | **SURVIVED 595/595** |
| `M-2b` — drop `forgetFormSecrets()` from `forgetEverything()` | KILLED | **SURVIVED 595/595** |

The other nine reproduce and are killed at the assertions §10 implies:
`M-silent-discard`, `X5`, `X11`, `X12`, `F-H1`, `F-H1b`, `F-M1b`, `M-2a`, `M-3`.

**The discriminating controls — this is the part that matters, so I ran both directions.**

```
C1  H-1 (drop onBeforeRouteUpdate)  +  watcher's forgetEverything() removed
    → 4 failed / 591 passed
      × clears the plaintext when only the :id changes and the panel is reused
      × drops a reveal that lands after the Supplier has changed
      × wipes a half-typed write dialog on a Supplier change and on session expiry
      × wipes the confirm dialog's password on a Supplier change and on session expiry

C2  F-M1 (update guard → forgetPlaintext only)  +  watcher → forgetPlaintext only
    → 2 failed / 593 passed
```

So the four assertions are alive and they are pointed at the wrong mechanism. Remove the masking and
they fire; leave it and the guard is free.

**Impact.** No disclosure at this head — production still clears on the unmount, which I confirmed in
`R3` below. What is lost is coverage: `onBeforeRouteUpdate` in the Bank panel, the control whose
absence was REV-044's finding and whose wrong shape was REV-045's, now has **no test at all**. In
production it is one of two layers; the other is the page's teardown. That teardown is a rendering
detail of a *different* component — replace the loading skeleton with an overlay spinner, a change no
one would think to review against this panel, and the guard becomes the only layer, untested.

This is the same failure the author names as his recurring one in §5 and §8 of the task record, and
that REV-046 recorded as F-L2 and F-L3: an assertion satisfied by something other than the mechanism
it names. It has now recurred inside the fix for it, for the seventh consecutive round.

#### (c) The mutation table of record is false at the merge candidate

§10 states `Mutation：十二個，十二個殺到` and the commit message repeats it. That is true at
`551e249`, where it was measured. The merge commit added production code afterwards and the table was
not re-run. Nine of twelve hold at the head that is being merged.

**Fix.** Delete the watcher. `Y1` shows the real page is unaffected; deleting it restores `F-M1`,
`H-1` and `M-2b` to KILLED, and the new `refetches the masked list when the Supplier changes under it`
test goes with it (it asserts host behaviour, not application behaviour). If the watcher is kept —
and there is a defensible reason to keep it, namely that it is the correct thing to do if the binding
is ever changed to the route param — then it must not be the thing that satisfies the route-guard
assertions. Bind the test host to `supplier.id` the way the application does, or drive the new test
through `SupplierDetailPage` as `detail.test.js` already can, and add an assertion that names the
guard. Whichever is chosen, **re-run the twelve and record the result at the merged head.**

### F-M1 (Medium) — the watcher's `load()` has no supersede guard, so it re-opens the exact defect it was written to close

**Location:** `SupplierBankPanel.vue:144-154` (`load()`), `:167` (the watcher).
Compare `SupplierDetailPage.vue:114-136`, where the sibling `load()` written into the same seam
carries `const superseded = () => id !== Number(route.params.id);` and checks it three times.

`load()` assigns `rows.value = await supplierBankService.list(props.supplierId)` with nothing
recording which Supplier the request was for. Two `load()`s can be in flight, and the last one to
resolve wins regardless of which Supplier it asked about.

**Proof of concept — executed, at this head (probe `R1`, in the host where the watcher fires):**

```
R1 after nav to 8                         → Bank Eight: true
R1 after the slow list(7) lands           → Bank Seven: true | Bank Eight: false | url: /suppliers/8
```

Supplier 7's rows, under Supplier 8's URL — which is, word for word, the defect the merge commit says
it fixed, reproduced inside the fix, in the same host the fix's own test runs in. Masked data only, so
this is not a disclosure.

**Reachability.** Not reachable in the application today, for the same reason as F-H1(a): the watcher
does not fire there. It becomes live the moment the binding changes, and F-H1's alternative fix
("bind the test host the way the application does") does not close it — it only hides it again. The
page solved this problem properly seventeen lines away, in the same navigation, in code the author
merged in this commit; the panel did not.

**Fix.** If the watcher is deleted per F-H1, this goes with it. If it is kept, give `load()` the same
guard the page has — capture `props.supplierId` before the `await` and drop the response if it no
longer matches — and assert it with the ten lines of `R1`.

### F-M2 (Medium) — `/suppliers/<non-numeric>` never leaves the loading skeleton

**Location:** `SupplierDetailPage.vue:117-135`.

`const id = Number(route.params.id)` is `NaN` for a non-numeric param, and
`superseded()` is `NaN !== NaN`, which is **always true**. So the success branch returns before
setting `supplier`, the catch branch returns before setting `error`, and the `finally` never clears
`loading`.

**Executed (probe `P-B`):**

```
P-B getById called with:   [[NaN]]
P-B skeleton present:      true
P-B error banner text:     供應商詳情          ← no banner, no 重試, no 返回供應商列表
```

Before PR #127 this path rendered `載入供應商失敗` with a retry button. It now renders a skeleton
forever, with no way out but the browser's back button. The Bank panel is a child of the branch that
never renders, so this is also "the Bank panel can never mount".

**Attribution, stated plainly:** this code is already on `origin/main` (PR #127) and is **not** in
`origin/main…HEAD`. It is not a defect of this merge candidate and I would not block PR #125 on it.
I am recording it because the brief asked me to attack this seam, because the detail page is the Bank
panel's only host, and because it is a regression that entered `main` from this task's own follow-up
with three browser tests and four unit tests that all pass around it.

**Fix (for a follow-up, not this PR).** `if (!Number.isFinite(id))` → set `error` and return before
the fetch, or define `superseded` as `String(id) !== String(route.params.id)` so a `NaN` param
compares equal to itself.

### F-L1 (Low) — the reveal re-entrancy guard is unasserted, and losing it produces the phantom audit row the Medium was just fixed for

**Location:** `SupplierBankPanel.vue:177-179`.

`Y6` — remove `if (revealDialog.busy) return;` → **SURVIVED 595/595.**

REV-046 probed this ("two reveals racing… HELD — `revealDialog.busy` admits exactly 1 service call")
and reported it as held, but nothing asserts it. With the guard gone, a double-click on `確認查看`
issues two `POST …/reveal` calls, and TASK-034 writes **two** `supplier.bank.reveal` audit rows for
one intended disclosure. That is the same consequence — an audit log that overstates what was
disclosed — that the author just spent this round fixing from the other direction. The two halves of
the same concern should not have one assertion between them.

**Fix.** Four lines in the existing reveal test: stub `reveal` with a pending promise, click `確認查看`
twice, assert `supplierBankService.reveal` has been called exactly once.

### F-L2 (Low) — `confirm.password = ""` in `submitConfirm`'s `finally` is unasserted

**Location:** `SupplierBankPanel.vue:324-327`.

`Y7` — remove `confirm.password = "";` from the `finally` → **SURVIVED 595/595.**

The new X5 test covers the *route change* and *session expiry* paths, which go through
`forgetEverything()`. The success path is covered by the dialog's `@hide="confirm.password = ''"`.
What neither covers is the **error** path: on a `VERSION_CONFLICT` the dialog stays open, and without
this line the typed step-up password stays in a rendered `<input>` until the user closes the dialog.
Mutual cover again, with one uncovered corner — the same shape as REV-046's F-L2, one dialog over.

**Fix.** Extend the existing conflict test on `設為預設`: after the error banner appears, assert
`document.body.innerHTML` does not contain the password.

### F-L3 (Low) — the ledger's freshest evidence predates both the remediation and the merge

**Location:** `docs/supplier_management/00_harness_state.json`,
`docs/supplier_management/evidence/20260922T0340*/run.json`, and §7 / §10 of `44_task_035_bank_ui.md`.

- The four newest evidence records were **added by commit `551e249`** but carry
  `code_commit: bef992cc5f` — the *merge main* commit that precedes the REV-046 remediation. So the
  registered evidence describes a tree from before the fixes it is filed under, and there is no
  registered evidence at `551e249` or at `68f8d4d` at all.
- `baseline.code_commit` is `551e2492…`, one commit behind the head on the PR.
- §10 closes with `590/590 client vitest`. The head is 595.
- **§7 is unchanged and REV-046's I-3 is unaddressed**: it still reads `PASS 87/87` and
  `PASS 585/585`. The registered client profile count is now 92 and the full suite is 595.
- There is no §11. The task record contains no description of the production change the merge commit
  makes; the only account of `watch(() => props.supplierId, …)` is the commit message.

Nothing here is drift — the numbers move in the right direction and the artefacts are internally
consistent (`result: PASS`, `exit_code: 0`, client XML `tests="92" failures="0"`, server 395/395).
It is the structural lag REV-045 recorded as its I-3, now one commit wider, plus an Info item that was
asked for and not done.

---

## 3. Info

**I-1. `revealGeneration` is still declared below the functions that mutate it (REV-046 I-1,
unaddressed).** `let revealGeneration = 0;` is at `:119`; `forgetPlaintext()` at `:64` reads and
writes it. The merge added a *second* setup-time registration below it — the `props.supplierId` watch
at `:167`, which closes over `forgetEverything`, `form`, `revealDialog` and `confirm`, all declared
later still. It remains safe only because nothing is `immediate` and nothing calls these during
setup. One `{ immediate: true }` anywhere and this is a TDZ `ReferenceError` from a security control
at mount. Moving the declaration above `forgetPlaintext` is one line.

**I-2. The throttling test's comment still names `advanceTimersToNextTimer()` (REV-046 I-2,
unaddressed).** The code is `vi.advanceTimersByTime(1000)`. Same effect at a 1000ms period; the
comment documents a shape the code does not have.

**I-3. The 30-second boundary is not pinned.** `Y8` (`left <= 0` → `left < 0`) → **SURVIVED
595/595**. The plaintext is then held for one extra tick — about 31 seconds. Harmless in itself; it
means the clock tests pin the *mechanism* (monotonic, throttle-proof, not extendable by a backwards
step) but not the *edge*. The browser assertion uses a 45-second timeout, so it does not pin it
either. Worth one assertion if the exact window is ever argued to be a control rather than a
convenience.

**I-4. The two browser specs coexist cleanly — this is answered, not assumed.** Whole-project run:
`--project=technical` → **23/23 in 49.0s**, single worker, `fullyParallel: false`. Both specs mock at
the network layer (`page.route`) inside per-test browser contexts, both set their own
`localStorage` via `addInitScript`, neither touches a database, and they share only the Vite dev
server on 5203. `supplier-detail-route-reuse.spec.js` never opens the 銀行資料 tab, so
`SupplierBankPanel` never mounts inside it and its catch-all 404 is never reached by a bank request.
No interference of any kind. One thing to know: the harness's registered browser evidence for T35 is
scoped to `supplier-bank.spec.js` (3 tests); the `technical` project now contains 23. Whoever reads
the gate should know which number it is reading.

**I-5. The `v-if` → `v-show` mutant, verified by me this round.** REV-046 could not run it
(environment). Applied at this head: `vitest` cannot compile `bank.test.js` at all (72 files → 71,
595 → 534 collected), and the browser suite reports **3 failed**. Reverted, browser suite **3/3,
34.6s**. The author's §10 claim reproduces.

**I-6. The param-only navigation is still unreachable from any UI.** `grep` over `client/src` finds
one link into the detail route, from `SuppliersPage` (`:to="/suppliers/${row.id}"`), which always
comes from a different route record and therefore always unmounts. Nothing produces `/suppliers/7` →
`/suppliers/8` directly, so browser back/forward cannot produce it either. Both the page's and the
panel's handling of it remain prospective, exercised only by a synthetic `router.push` from
`page.evaluate`. Both components' comments say this honestly, which is to their credit — it is the
reason F-H1 could go unnoticed, since there is no real traffic to contradict the test host.

**I-7. Carried, not addressed, not blocking.** `writeBody()` still does not trim `accountNumber`
while trimming every other string field (REV-044 I-2). The browser suite's thirty-second assertion is
still `toHaveCount(0)` plus a `page.content()` substring check rather than an occurrence count
(REV-044, restated by REV-045 and REV-046). The tab-count asymmetry note for design §7.5 (REV-044
I-1) is still not in the design. The four BLOCKED DEVELOPER-stage profile suites are unchanged in this
delta and I did not re-verify them; REV-045 verified the ledger's account of them path by path.

---

## 4. What I attacked and what HELD

Executed, not reasoned about. I deliberately did not re-run what earlier rounds confirmed — storage,
URL, Pinia, toasts, dialog close paths, bfcache, tab switching, the service layer, the two-sided
per-row permission gating, the generation counter under six attacks, and the four other async paths.
This is where I went instead.

**The seam, through the real `SupplierDetailPage` — six attacks, six HELD.** No previous round drove
the real page; every earlier probe used `bank.test.js`'s host.

| Probe | Attack | Result |
| --- | --- | --- |
| `Q3` | Ordering of the four handlers on one accepted navigation | **HELD** — `page.confirmDiscard` → `page.getById(8)` → `panel.load(8)`. The page's `onBeforeRouteUpdate` is registered first (parent setup precedes child mount, same matched record, same insertion-ordered guard set), so it always gets to ask before the panel does anything |
| `Q1` | A **declined** `window.confirm` on the draft prompt, with plaintext revealed and a countdown running | **HELD** — navigation aborted at the page's guard; the panel's guard never runs; plaintext still shown, countdown still running, `list()` still `[[7]]`, URL still `/suppliers/7`. The panel does not clear or refetch for a Supplier the user never went to |
| `Q2` | A **reveal in flight** when the draft prompt is declined | **HELD** — the reveal lands and paints normally; no generation bump, no `畫面喺查看期間更新咗` error for a screen that did not update. This was the reachable version of REV-046's F-M1 and it is closed by the guard ordering |
| `R3` | A reveal in flight across a real **accepted** navigation | **HELD** — plaintext appears nowhere in `document.body.innerHTML` afterwards, no stray alert, Supplier 8's rows render |
| `R2` | `list()` **rejects** for the new Supplier during the change | **HELD** — `載入銀行資料失敗` renders under `/suppliers/8`; Supplier 7's rows are gone, not stale |
| `P-A` | `superseded()` leaving page and panel describing different Suppliers | **HELD, by construction** — the panel is bound to `supplier.id`, which the page only assigns after `superseded()` has passed, so the two cannot disagree. The URL can lead `supplier.value` briefly, but only while `loading` is true, during which the panel does not exist |

**The twenty-two mutations.** The author's twelve (nine KILLED, three SURVIVED — F-H1(b)); ten of my
own: `Y1` (watcher removed), `Y3` (watcher clears but does not reload → KILLED), `Y4`, `Y5`, `Y6`,
`Y7`, `Y8`, `Y10`, plus the two composite controls `C1` and `C2`, plus the `v-if` → `v-show` browser
mutant. Six survived and every survival is reported above.

**Baseline and CI.** Run `35685495391` verified by `gh` on seven fields including `attempt: 1` and a
single-run `gh run list`; four named checks read individually; PR #125 state, mergeability, draft
status and `headRefOid` verified; `origin/main` re-fetched and found equal to `merge-base`; the four
newest evidence records opened and their `code_commit` compared against the commit that added them.

**Lint** over the seven changed source, test and e2e files: exit 0.

**Tree discipline.** `git status --porcelain` empty before the review, after each of the twenty-two
mutations, after every probe file was deleted, and immediately before this file was written.
`git rev-parse HEAD` still `68f8d4d…`. Nothing committed, nothing staged, no branch moved.

## 5. Not covered by this review

- **The server side of the Bank capability.** Unchanged by this branch; REV-039…REV-043 covered it and
  CI ran the server suites green at this head.
- **PR #127's own contents beyond the seam.** It is already on `main` and is not this PR's subject. I
  read `SupplierDetailPage.vue` in full and drove it in three probes, but I did not review its tests
  or its browser spec as a change; `supplier-detail-route-reuse.spec.js` I judged only for
  interference (I-4) and for what it does and does not cover (it does not open the bank tab).
- **Whether F-M2 is worth a task of its own.** I confirmed the hang; I did not survey how a user
  reaches a non-numeric `:id` in practice, nor whether any other `Number(route.params.…)` in the
  codebase has the same shape. **PLAUSIBLE** that it does elsewhere; I did not grep for it.
- **A real suspended machine, a real mobile background, a real NTP step.** The clock results remain a
  fake-timer model, as in REV-046.
- **Repeated browser runs under load.** Two clean runs (3/3 and 23/23) plus one mutant run; I did not
  stress for flake.
- **The harness source fingerprint and the DESIGN/PLAN digests.** Read from the state file, not
  recomputed.
- **The four BLOCKED profile suites.** Unchanged in this delta; not re-verified.

## 6. What it takes to turn this into APPROVED

1. **Resolve the watcher (F-H1).** Delete it — `Y1` shows the application does not need it — and
   delete the test that pins the host with it. Or keep it and stop it standing in for the route
   guard. Then **re-run the twelve mutants at the merged head and record that result**, because the
   table in §10 is currently a measurement of a different commit. This is the one I would not merge
   without, not because anything leaks but because a disclosure control the last three rounds were
   about now has no test, and the document says the opposite.
2. If the watcher is kept, give its `load()` the supersede guard the page already has, and assert it
   (F-M1). If it is deleted, this goes away.
3. Assert the reveal re-entrancy guard (F-L1) and the confirm dialog's error-path password clearing
   (F-L2). Four lines each, in tests that already exist.
4. Refresh `baseline.code_commit`, correct §7's `87/87` and `585/585` (REV-046 I-3, still open), fix
   §10's `590/590`, and add a §11 describing what the merge commit changed in production (F-L3).
5. One-liners carried from REV-046 and unaddressed: move the `revealGeneration` declaration above its
   first use (I-1) and correct the throttling test's comment (I-2).
6. **Separately, not in this PR:** file F-M2 against `main`.

Item 1 blocks. Items 2–5 are small and all of them are in files already open.

**Said plainly, because it should be.** The remediation work in `551e249` is the best of this task:
five items asked for, five delivered, each one pinned by an assertion that rejects both the wrong
answer and no answer. I tried hard to break it and could not. What went wrong happened afterwards, in
the merge, and it went wrong in the module's signature way — a fix written against the test harness
rather than the application, which then quietly stood in front of three assertions that were guarding
the previous round's fix. The streak is not six rounds of carelessness; it is six rounds of a specific
habit: measuring in the host instead of in the program. `Y1` is one line and would have caught it.
