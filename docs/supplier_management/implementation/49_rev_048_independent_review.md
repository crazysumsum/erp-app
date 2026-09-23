# REV-048 — TASK-035 Bank UI independent review (REV-047 remediation)

**Review:** REV-048 ・**Task:** TASK-035 (T35) ・**Phase:** PHASE-003 ・**Capability:** SUP-CAP-03
**Head reviewed:** `6f424f916010861382d5342063a2b8d273161c3c` (`claude/supplier-task-035`, PR #125).
**Previous review head:** `68f8d4d6c7960438628871c1fdecd961d49c04d4`.
**Remediation diff:** `68f8d4d..HEAD` ・**Subject:** `origin/main…HEAD`, where
`git merge-base origin/main HEAD` is `fd615e539bc339ceada1b6541949db7046ed160c`.
**Worktree:** `/Users/sam/Documents/workspace/erp-app-worktrees/supplier-task-035`
**Reviewer:** independent agent (`agent-skills:security-auditor`); not the author. Author is Claude Opus 5.

**Verdict: CHANGES_REQUESTED** — 0 Critical, **0 High**, 1 Medium, 2 Low, 5 Info.

**REV-047's High is genuinely closed, and I reproduced the whole table rather than reading it.**
The watcher is gone. The host-bound test is gone. `onBeforeRouteUpdate` deleted now fails four
assertions; `forgetEverything` → `forgetPlaintext` on that guard now fails two. Both had survived
595/595 at the previous head. The replacement test in `detail.test.js` drives the real
`SupplierDetailPage` through a real router on the real route record, and I confirmed with my own
probe — not with the author's test — that the mechanism it names is the mechanism that runs.

**And the harder question the author did not ask has an answer, which is that his comment is
backwards in the author's favour.** `onBeforeRouteUpdate` is not defence-in-depth against a
composition that no longer exists. It fires, in the real page, on every param-only navigation, and it
fires **before** the teardown, not after it. Instrumented ordering on the real page:

```
["list:7","--push8--","guardUpdate:SupplierDetailPage","guardUpdate:SupplierBankPanel","list:8"]
```

The guard is the first thing that clears the plaintext; the unmount is the redundant second layer,
not the first. The comment in `bank.test.js` says the opposite (`unmount 已經清咗`), which understates
a live control as future-proofing — in a comment written specifically to stop the next person
deleting it.

**What keeps this from APPROVED is not the code.** It is one surviving mutant that the record claims
is dead, and a merge target that moved twenty-two commits — including a new CI job that makes this
branch's own browser spec a blocking per-PR gate — and was recorded but never merged. Neither is a
defect. Both are one step each, and I ran the union myself to show that step is safe.

Everything below states what I ran. Anything reasoned about but not executed is marked **PLAUSIBLE**.
Every mutation was reverted immediately and `git status --porcelain` was empty before the review,
after each of the nineteen mutations, after every probe file was deleted, after the throwaway union
worktree was removed, and immediately before this file was written. `git rev-parse HEAD` is still
`6f424f9…`. Nothing was committed, nothing staged, no branch moved.

---

## Summary

| | |
| --- | --- |
| Critical | 0 |
| High | 0 |
| **Medium** | **1** — the merge target moved 22 commits and was never merged in; the head's green CI is four checks against a target that now requires five, and the fifth is the browser suite containing this task's own spec |
| **Low** | **2** — `M-2b` survives and §11 records it as killed; the `bank.test.js` comment inverts the order in which the route guard and the teardown run |
| Info | 5 |

**Suites at this head, run by me.**

| Suite | Result |
| --- | --- |
| `npx vitest run --root client` | **597/597, 72 files** — at the start, after every revert, and again immediately before writing this |
| `npx playwright test --config client/e2e/supplier-management/playwright.config.js --project=technical` | **23/23, 49.1s** |
| `npx eslint` over the seven changed source, test and e2e files | clean, exit 0 |
| **The union with `origin/main`** (throwaway detached worktree) | **634/634 unit, 82 files ・23/23 browser, 51.6s ・`npm run lint` exit 0 ・`H-1` still KILLED** |

**Baseline and CI — verified on eight fields, and correct.** `gh run view 35693878002`: `headSha`
`6f424f916010861382d5342063a2b8d273161c3c`, `conclusion: success`, `status: completed`,
`event: pull_request`, **`attempt: 1`**, workflow `CI`. `gh run list --commit 6f424f9…` returns
exactly that one run — no reruns. Four checks green: Build frontend, Dependency audit, Lint, Test
(server + client, MySQL integration). PR #125 is `OPEN`, `MERGEABLE`, `mergeStateStatus: CLEAN`,
`isDraft: false`, base `main`, `headRefOid` equal to the reviewed head. `revision` is **210** as
stated. See I-5 for what `CLEAN` does and does not mean here.

As in the four previous rounds I did **not** recompute the harness source fingerprint or the
DESIGN/PLAN digests; I read them from the state file. That much is unverified by me.

---

## 1. The five claimed remediations, verified independently

### 1.1 F-H1 — the watcher, the masking, and the replacement test

**The watcher is deleted.** `watch(() => props.supplierId, …)` is gone from
`SupplierBankPanel.vue`; what stands in its place is a comment explaining why there is none. The
`watch` import survives legitimately — the session watch at `:141` still uses it.

**The host-bound test is deleted.** `refetches the masked list when the Supplier changes under it`
is gone from `bank.test.js`.

**`bank.test.js`'s host comment now states the divergence.** It says the host deliberately binds
`$route.params.id` to the prop and keeps the instance alive, while the real page tears the subtree
down. That is accurate, and it is the right thing to have written down. Its account of *why the
guard matters* is not accurate — see F-L2.

**The masking is gone. Both mutants, applied alone at this head, full suite:**

| Mutant | At `68f8d4d` (REV-047) | **At `6f424f9`** |
| --- | --- | --- |
| `H-1` — delete `onBeforeRouteUpdate(() => { forgetEverything(); });` | SURVIVED 595/595 | **KILLED — 4 failed / 593 passed** |
| `F-M1` — that guard → `forgetPlaintext()` only | SURVIVED 595/595 | **KILLED — 2 failed / 595 passed** |

`H-1` fails on `clears the plaintext when only the :id changes and the panel is reused`,
`drops a reveal that lands after the Supplier has changed`, `wipes a half-typed write dialog…` and
`wipes the confirm dialog's password…`. `F-M1` fails on the last two. These are the four assertions
REV-047's composite control `C1` predicted would fire once the masking was removed. They fire.

**The replacement test measures the program.** `detail.test.js`'s `mountPage` builds a real
`createRouter` over the real route record (`page.path`), mounts a real `RouterView`, and renders the
real `SupplierDetailPage`; the services are mocked at the module boundary and nothing else is
synthetic. Two checks that it is not a second harness:

- `NEW` — remove `void load();` from the page's `route.params.id` watcher → **KILLED, 4 failed /
  593 passed**, and the new test is one of the four
  (`shows the new Supplier's bank rows after the route id changes`).
- My own probe, which does **not** re-click the 銀行資料 tab after the navigation the way the
  author's test does, still records `list:8`. So the assertion is carried by the subtree rebuild, not
  by the second click; the second click is redundant, not load-bearing. (The page's watcher resets
  nine pieces of state but not `tab`, so the bank tab stays selected across the navigation — I
  measured that too.)

### 1.2 F-L1 — the reveal re-entrancy guard, and its negative control

`Y6` — remove `if (revealDialog.busy) return;` from `confirmReveal()` → **KILLED, 1 failed / 596
passed**, at `issues one reveal for a double-clicked confirm, because each one writes an audit row`.

That the mutant dies also proves the second click genuinely reaches `confirmReveal` — otherwise it
could not issue a second `reveal`. So the test is not passing for an unrelated reason.

**The author's account of his first attempt is correct, and I ran the control that shows it.** With
`Y6` applied **and** the test rewritten to `await` between the two clicks:

```
Y6 + await between clicks  → Test Files 72 passed (72) | Tests 597 passed (597)
```

Green. Quasar's `:loading` swallows the second click once Vue has re-rendered, and the test stops
discriminating. Firing both clicks in one tick is load-bearing, and the comment says so. This is a
properly discharged negative control — the assertion rejects the wrong answer (`Y6`) and the test's
construction is shown to be the reason it can.

### 1.3 F-L2 — `confirm.password` on the error path

`Y7` — remove `confirm.password = "";` from `submitConfirm`'s `finally` → **KILLED, 1 failed / 596
passed**, at `wipes the confirm password even when the dialog stays open on an error`. The test
reaches the `VERSION_CONFLICT` branch, asserts the dialog is still open (`[role="alert"]` exists —
`notify` is mocked, so no toast can satisfy it), and then asserts the typed password is not in
`document.body.innerHTML`. Correct corner, correctly pinned.

### 1.4 F-L3 — evidence, and §7

- The four new evidence records all carry `code_commit: c4efd7fcc793741cdbb331fffe28289704456a9f`
  and `source_fingerprint: f62d381a…`, matching `baseline`. `c4efd7f` is the remediation commit;
  `6f424f9`, the head, **touches only `docs/`** (I checked the full file list). So the registered
  evidence describes exactly the tree it was run against, and the structural lag REV-045, REV-046 and
  REV-047 each recorded is genuinely closed this round, not merely moved.
- `result: PASS`, `exit_code: 0` on all four. Client profile XML: `tests="99" failures="0" errors="0"`.
  Server XML present, 395 cases. `baseline.code_commit` refreshed as asked.
- **§7's stale numbers are removed.** `PASS 87/87` and `PASS 585/585` are gone; the rows now point at
  §11. §10's `590/590` is replaced by a pointer to §11. §11 states 597/597, 23/23, lint clean, all of
  which I reproduced.
- §11 exists and describes what the merge commit did and why it was wrong. Its one factual error is
  F-L1 below.

### 1.5 F-M2 — correctly excluded

`/suppliers/<non-numeric>` is on `origin/main` via PR #127 and is not in `origin/main…HEAD`. REV-047
said it should not block this PR; §11 records a follow-up task instead of a fix here. Right call, and
I did not re-verify the hang.

---

## 2. The disagreement, settled: `M-2b` survives

REV-047 listed `M-2b` (drop `forgetFormSecrets` from `forgetEverything()`) as surviving. §11 records
`M-2b drop forgetFormSecrets KILLED` and says, explicitly, *"REV-047 話 `M-2b` 都生還；我實測佢仍然
KILLED。照實記，唔跟。"* Both measurements are right about their own mutant. They are not the same
mutant, and the one that carries the claim is the one that survives.

| Mutant | Result at this head |
| --- | --- |
| Drop the **call** `forgetFormSecrets();` from `forgetEverything()` | **SURVIVED 597/597** |
| Gut the **body** of `forgetFormSecrets()` | KILLED — 1 failed, at `blocks a same-Supplier duplicate and makes a cross-Supplier duplicate an explicit confirmation` |

The body is pinned by the duplicate-warning test, which reaches `forgetFormSecrets` through the
dialog's `@hide`. The **call site inside `forgetEverything()` is pinned by nothing.**

**The discriminating control, because the first result alone does not say why.** I removed the call
**and** the `@hide="forgetFormSecrets"` binding together:

```
drop call + drop @hide  → Test Files 72 passed (72) | Tests 597 passed (597)
```

Still green. So `wipes a half-typed write dialog on a Supplier change and on session expiry` is not
satisfied by `forgetFormSecrets` at all, by either route. It is satisfied by `form.open = false`
unmounting the dialog, which removes the typed value from `document.body.innerHTML` regardless of
whether anything forgot it. The assertion names the mechanism and measures the rendering.

**What it means and what it does not.** Production is correct — the call is there, and
`form.accountNumber` and `form.password` are cleared on both paths. Nothing leaks today. What is
missing is the assertion: on a route change the panel unmounts and the residue is garbage anyway, but
on **session expiry** the panel stays mounted, and the only thing standing between an expired
session and a live component still holding a typed account number and a step-up password in memory is
a line that no test would notice going away. That is the same line REV-045 F-M1 was raised about.

This is a Low. It is recorded as one because the record says it is closed, and the review series it
belongs to exists because of claims of exactly that shape.

---

## 3. Findings

### F-M1 (Medium) — the merge target moved twenty-two commits, was recorded but never merged, and one of them makes this branch's own browser spec a blocking CI gate

**Location:** `docs/supplier_management/00_harness_state.json` (`baseline.default_commit`);
`git merge-base origin/main HEAD`; `.github/workflows/ci.yml` and
`client/e2e/supplier-management/playwright.config.js` on `origin/main`.

**Measured.** `git merge-base origin/main HEAD` is `fd615e53…` — unchanged since REV-047. `origin/main`
is now `38e1542e…`, twenty-two commits ahead. `baseline.default_commit` was updated this round to
`0633125c…`, which is neither the merge base nor the current target: the state file records a target
the branch never merged, and that record is already one commit stale.

CLAUDE.md §6 is not ambiguous: *"If it has moved, merge/rebase the target into the feature branch
first, resolve any conflicts there, and only then merge."* That has not been done.

**Why it is not merely bookkeeping this time.** Three of those twenty-two commits land inside this
branch's blast radius:

- **`.github/workflows/ci.yml`** gains a fifth job, `Browser tests (Playwright)`, running
  `npm run e2e:mocked` → `e2e:business-master && e2e:supplier-management`. That job runs this
  branch's `supplier-bank.spec.js`. CI at this head ran **four** checks, because the branch does not
  have the job. The head's green is a four-check green against a target that now demands five, and
  the fifth is the one that covers the new code.
- **`client/e2e/supplier-management/playwright.config.js`** switches `runDirectory` from a hardcoded
  `/private/tmp/…` to `os.tmpdir()`, with a comment saying the hardcoded path EACCESes on Linux and
  that nobody noticed because these suites had never run in CI. This branch's spec has never run on
  Linux either.
- **`client/src/framework/http/HttpClient.js`** changes `buildUrl`'s param handling. Harmless here —
  `supplierBank.js` passes no query params on any of its six methods, which I read — but it is a
  change to the transport under this branch's service layer, arriving unmerged.

**What I ran, so that this is a step and not a risk.** I created a throwaway **detached** worktree at
`HEAD`, merged `origin/main` into it, and ran the union. No branch moved, nothing was committed to
`claude/supplier-task-035`, and the worktree was removed afterwards (`git worktree list` back to its
original four entries, `git rev-parse HEAD` unchanged).

```
git merge origin/main        → clean, no conflicts
npx vitest run --root client → 82 files, 634 passed (634)
npx playwright test --config client/e2e/supplier-management/playwright.config.js
                             → 23 passed (51.6s)   [both projects; there are no @uat tests]
npm run lint                 → exit 0
H-1 applied on the union     → 1 failed | 81 passed (82) — 4 failed / 630 passed
```

So the union is green, merges cleanly, and the guard's coverage is not re-masked by anything on
`main`. **The combination is sound; it simply has not been performed on the branch, and the CI that
the target now requires has not run.**

**One false alarm of my own, recorded because the method matters.** My first union browser run showed
10 of 23 failing on `expect(problems).toEqual([])` with two 403s. That was my environment: I had
symlinked `node_modules` from the source worktree, so Vite's `server.fs.allow` rejected the Quasar
web fonts. Re-run with `node_modules` cloned into the union worktree: 23/23. The failures were mine,
not the union's, and they are not a finding.

**Fix.** `git fetch origin && git merge origin/main` on the branch, push, let CI run all five checks
including the new browser job, and update `baseline.default_commit` to whatever `origin/main` is at
that moment. If the Linux browser job fails, that is a real defect and it belongs to this PR — the
spec is this PR's.

### F-L1 (Low) — `M-2b` survives, and §11 records it as killed

**Location:** `SupplierBankPanel.vue:79-87` (`forgetEverything()`), `:415`
(`@hide="forgetFormSecrets"`); `bank.test.js`, `wipes a half-typed write dialog on a Supplier change
and on session expiry`; `44_task_035_bank_ui.md` §11.

Measured and controlled in §2 above. Dropping `forgetFormSecrets();` from `forgetEverything()`
survives 597/597; dropping it **and** the dialog's `@hide` also survives 597/597. The test is
satisfied by the dialog unmounting, not by the secrets being forgotten.

§11 states `Mutation：十三個，十三個殺到` and lists `M-2b drop forgetFormSecrets KILLED`, then
overrides REV-047 on precisely this entry. Twelve of the thirteen are killed; I reproduced every one
(§4). This one is not, and the reviewer it overrode was right about the mutant that matters.

**Impact.** No disclosure. The production line is present and correct. What is absent is any
assertion that route change and session expiry forget the typed account number and step-up password
in the component's own state rather than merely stopping rendering them. On session expiry the panel
is not unmounted, so that distinction is the whole control.

**Fix.** Two lines in the test that already exists: after each clear, assert on the component's state
rather than only on `document.body.innerHTML` — e.g. reopen the create dialog and assert the 帳號 and
密碼 inputs are empty, which fails when `forgetFormSecrets` is not called because `openCreate()` is
the only other thing that resets them and it would have to run first. Then correct §11 to twelve of
thirteen, or re-run and record thirteen honestly.

### F-L2 (Low) — the `bank.test.js` comment inverts the order of the guard and the teardown

**Location:** `client/test/pages/suppliers/bank.test.js:35-43`.

The comment reads: *"保住 instance 係為咗令 `onBeforeRouteUpdate` 嗰個 guard 有嘢測 —— 喺今日嘅頁面
組合入面佢係縱深防禦（unmount 已經清咗），但佢守住嘅係「有一日個 panel 真係被重用」。"*

Two claims, both measurable, and both wrong in the same direction.

**Executed, on the real `SupplierDetailPage` with the real router, with plaintext revealed and a
countdown running.** I wrapped `vue-router`'s `onBeforeRouteUpdate` / `onBeforeRouteLeave` to log the
registering component, then pushed `/suppliers/7` → `/suppliers/8`:

```
plaintext shown before:  true
LOG: ["list:7","--push8--","guardUpdate:SupplierDetailPage","guardUpdate:SupplierBankPanel","list:8"]
plaintext after:         false
```

The panel's guard **runs**, in the application, on every param-only navigation — and it runs before
the route is confirmed, therefore before `route.params.id` changes, therefore before the page's
watcher sets `loading = true` and tears the subtree down. The unmount is second. So:

- *"unmount 已經清咗"* — no. The guard cleared first; the unmount is the redundant layer.
- *"佢守住嘅係「有一日個 panel 真係被重用」"* — no. It guards today's param-change path, today.

I also checked what could still abort the navigation after the panel has cleared:
`client/src/framework/routing/router.js:18` registers one global `beforeEach` auth guard and no
`beforeResolve`, and `beforeEach` runs *before* component `beforeRouteUpdate`. So nothing can cancel
a navigation after the panel has already forgotten its plaintext. **HELD.**

**Impact.** Documentation only — but this is the comment whose whole job is to stop the next person
deleting the guard, and it currently tells them the guard is speculative. It is the same species as
the defect this round remediates: a statement about the program derived from reasoning about the
composition rather than from running it. The measurement takes twenty lines and I have included the
result above.

**Fix.** Two sentences: the guard fires first on the param-change path and is the primary clear; the
unmount is the second layer; the host keeps the instance alive so the guard can be asserted in
isolation from the teardown.

---

## 4. The mutation table, reproduced

Every mutant applied alone at this head, full suite run, reverted, `git status --porcelain` empty
before the next. Nineteen mutations in total.

| # | Mutant | Result |
| --- | --- | --- |
| 1 | `M-silent-discard` — drop `revealDialog.error = "畫面喺查看期間更新咗…"` | KILLED (1) |
| 2 | `X5` — drop `confirm.open/password` from `forgetEverything()` | KILLED (1) |
| 3 | `X11` — `performance.now()` → `Date.now()` | KILLED (2) |
| 4 | `X12` — `clearInterval(987654321)` | KILLED (1) |
| 5 | `F-H1` — `if (generation !== revealGeneration)` → `if (false)` | KILLED (3) |
| 6 | `F-H1b` — drop `revealGeneration += 1;` | KILLED (3) |
| 7 | **`F-M1`** — route-update guard → `forgetPlaintext()` only | **KILLED (2)** ← survived last round |
| 8 | `F-M1b` — session watch → `forgetPlaintext()` only | KILLED (2) |
| 9 | **`H-1`** — delete `onBeforeRouteUpdate` | **KILLED (4)** ← survived last round |
| 10 | `M-2a` — delete `onUnmounted(forgetEverything)` | KILLED (2) |
| 11 | **`M-2b`** — drop `forgetFormSecrets();` from `forgetEverything()` | **SURVIVED 597/597** |
| 11b | `M-2b` variant — gut the body of `forgetFormSecrets()` | KILLED (1), at an unrelated assertion |
| 11c | control — drop the call **and** `@hide="forgetFormSecrets"` | SURVIVED 597/597 |
| 12 | `M-3` — `<template v-if="canManage">` → `v-if="canReveal"` | KILLED (1) |
| 13 | `NEW` — drop `void load();` from the page's route watcher | KILLED (4) |
| 14 | `Y6` — drop `if (revealDialog.busy) return;` | KILLED (1) |
| 15 | `Y7` — drop `confirm.password = "";` from `submitConfirm`'s `finally` | KILLED (1) |
| 16 | control — `Y6` + `await` between the two clicks | SURVIVED 597/597 (see §1.2) |
| 17 | `H-1` **on the union with `origin/main`** | KILLED (4) |
| 18 | no-op control — a statement with no behavioural effect in `forgetEverything()` | SURVIVED 597/597 |

Twelve of the author's thirteen are killed. `M-2b` is not, and 11b/11c say why.

---

## 5. What I attacked and what HELD

Executed, not reasoned about. I did not re-run what earlier rounds confirmed — storage, URL, Pinia,
toasts, dialog close paths, bfcache, tab switching, the service layer, per-row permission gating, the
generation counter under six attacks and the four other async paths, and the four-way navigation
seam. This is where I went instead.

| Probe | Attack | Result |
| --- | --- | --- |
| Guard ordering | Does `SupplierBankPanel.onBeforeRouteUpdate` run in production, and when? | **It runs, and it runs first** — before the page's teardown. See F-L2 |
| Global guards | Can anything abort a navigation *after* the panel has cleared? | **HELD** — one global `beforeEach` (auth), no `beforeResolve`; `beforeEach` precedes component `beforeRouteUpdate` |
| Tab survival | Does the bank tab stay selected across a param change, so the panel really remounts unaided? | **HELD** — the page's watcher resets nine pieces of state, not `tab`; my probe records `list:8` with no second tab click |
| Write path | What does a successful `設為預設` cost, and what happens to revealed plaintext? | **2 × `list()`, 1 × `getById`, full subtree teardown, plaintext gone.** Correct; redundant. See I-3 |
| XSS sinks | `v-html`, `innerHTML`, `eval` in the changed source | **none** — every interpolation is `{{ }}`; the only `innerHTML` in the panel is inside a comment |
| Plaintext in transport | Does the account number ever reach a URL, query string or header? | **HELD** — all six service methods put it in the body; `list()` is the only `GET` and takes no params |
| Untrimmed `accountNumber` (REV-044 I-7, carried four rounds) | Is it actually harmful? | **HELD, and I would now close the note.** The server's `normalizeBankAccountNumber` does NFC, fullwidth→ASCII, ASCII-only uppercase and strips formatting before both the blind index and the seal, so whitespace cannot fork a duplicate check. A whitespace-only `accountNumber` on an edit is truthy client-side and *is* sent, but normalizes to empty and returns a clean `BANK_ACCOUNT_INVALID` 400 with `{ field: "accountNumber" }` and no value echoed |
| Autofill persistence (nobody has looked at this) | Can the browser persist the account number or the step-up password? | **HELD** — `autocomplete="off" spellcheck="false"` on the account number, `autocomplete="current-password"` on all three password inputs, and `openEdit()` deliberately never prefills the account number because the masked projection cannot express it |
| The union with `origin/main` | Does the combination hold? | **HELD** — clean merge, 634/634 unit, 23/23 browser, lint clean, `H-1` still killed. See F-M1 |

---

## 6. Info

**I-1. REV-046 I-1 / REV-047 §6.5 still unaddressed, and not declined either.**
`let revealGeneration = 0;` is at `:119`; `forgetPlaintext()` at `:64` reads and writes it. Safe today
— nothing is `immediate` and nothing calls these during setup — and one `{ immediate: true }` away
from a TDZ `ReferenceError` out of a security control at mount. One line. Asked for twice. §11 does
not mention it, so it is neither done nor recorded as declined.

**I-2. REV-046 I-2 still unaddressed.** `bank.test.js:166-168` still names
`advanceTimersToNextTimer()`; the code at `:179` is `vi.advanceTimersByTime(1000)`. Same effect at a
1000 ms period; the comment documents a shape the code does not have. Also asked for twice, also
unmentioned in §11.

**I-3. Every successful write costs two masked-list fetches and a full detail-subtree rebuild.**
Measured on the real page: after a `設為預設` succeeds, `list()` is called **twice** — once by
`submitConfirm`'s own `await load()`, then again by the panel that `emit("refresh")` → page `load()`
→ `loading = true` destroys and recreates. Plus one `getById` and one `completeness`. Functionally
correct (the tab survives, the plaintext is correctly gone), and a brief skeleton flash after every
bank write. The panel's own `await load()` is wasted work in today's composition — but it is the
composition-dependent assumption that has bitten this task twice, so I am recording it rather than
recommending the deletion.

**I-4. `mergeStateStatus: CLEAN` is not evidence that the browser job ran.** It reports that the
branch merges cleanly and that the checks GitHub knows about are green — four of them. The fifth job
exists only on the target. Whoever reads the gate should not read `CLEAN` as "CI covered the browser
suite"; at this head, nothing did except me, on macOS.

**I-5. Carried, not addressed, not blocking.** The browser suite's thirty-second assertion is still
`toHaveCount(0)` plus a `page.content()` substring check rather than an occurrence count (REV-044,
restated three times since). The tab-count asymmetry note for design §7.5 (REV-044 I-1) is still not
in the design. The 30-second boundary is still unpinned (REV-047 I-3; I did not re-run `Y8`). The four
BLOCKED DEVELOPER-stage profile suites are unchanged in this delta and I did not re-verify them.

---

## 7. Positive observations

- **The remediation is the most disciplined work in this task's record.** Every one of REV-047's five
  items was done, in the direction REV-047 recommended, and the one that mattered was done by
  deleting code rather than adding more. `H-1` and `F-M1` went from surviving to killing four and two
  assertions respectively.
- **The F-L1 test's negative control is exemplary.** The author found that his first attempt left the
  mutant alive, worked out why (a re-render between the clicks lets Quasar's `:loading` swallow the
  second), fixed the test's construction rather than the assertion, and wrote the reason into the
  comment. I reproduced both directions. That is the shape the previous seven rounds were asking for.
- **The replacement test drives the program.** Moving the assertion from `bank.test.js`'s host to
  `detail.test.js`'s real page is the correct structural answer, not a cosmetic one, and it is
  pinned by a mutant on the page that the panel does not control.
- **The evidence lag is genuinely closed,** for the first time in four rounds: the head is docs-only
  above the commit the evidence was run at, and every registered record's `code_commit` and
  `source_fingerprint` match the baseline.
- **§11 names the mistake precisely and generalises it correctly** — "度量咗一件真嘢，但係喺一個同程式
  唔同嘅宿主入面度" — and the `bank.test.js` host comment now warns the next reader about the
  divergence. That is the right lesson written in the right place, even though one sentence of it is
  backwards (F-L2).
- **Input handling at this boundary is better than it needed to be.** Autofill is suppressed on the
  account number, step-up passwords use `current-password`, the edit dialog structurally cannot
  prefill a plaintext it never receives, no service method can put the account number in a URL, and
  the server's error details carry field names and never values.

---

## 8. Not covered by this review

- **The server side of the Bank capability.** Unchanged by this branch; REV-039…REV-043 covered it,
  and CI ran the server suites green at this head. I read `SupplierBankCrypto.normalizeBankAccountNumber`
  and `SupplierBankService.normalizeBankInput` only to settle the carried trim note.
- **Whether the browser suite passes on Linux.** I ran it twice on macOS (23/23 at this head, 23/23
  on the union). **PLAUSIBLE** that it passes in the new CI job; there is no evidence either way,
  and that is the point of F-M1.
- **The twenty-two commits `origin/main` gained**, beyond the three files that touch this branch's
  blast radius. I read those three. The customer-management work I did not review at all.
- **Repeated browser runs under load.** Three clean runs plus one aborted environment-caused run; I
  did not stress for flake.
- **The harness source fingerprint and the DESIGN/PLAN digests.** Read from the state file, not
  recomputed.
- **The four BLOCKED profile suites.** Unchanged in this delta; not re-verified.
- **A real suspended machine, a real mobile background, a real NTP step.** The clock results remain a
  fake-timer model.

---

## 9. What it takes to turn this into APPROVED

1. **Merge `origin/main` into the branch and let CI run all five checks** (F-M1). The union is green
   locally — clean merge, 634/634, 23/23, lint clean, `H-1` still killed — so this is a step, not a
   risk. Update `baseline.default_commit` to the target as of that merge. If the new
   `Browser tests (Playwright)` job fails on Linux, that failure belongs to this PR.
2. **Assert `forgetFormSecrets` at its own mechanism, and correct §11's count** (F-L1). Two lines in
   a test that already exists; and either "twelve of thirteen" or a re-run that earns thirteen.
   REV-047 was right about this mutant.
3. **Correct the `bank.test.js` comment about the guard** (F-L2). It fires before the teardown, in
   production, today. Two sentences, and the ordering is measured above so nobody needs to re-derive
   it.
4. **The two one-liners carried from REV-046 and asked for again by REV-047 §6.5** (I-1, I-2) — or
   say in §11 that they are declined and why. Twice silently skipped is how a note becomes permanent.

Items 2–4 are small and all of them are in files already open. Item 1 is the one I would not merge
without, and it is a rule, not a judgement.

**Said plainly, because it should be.** Nothing I found is a defect in the Bank UI. The disclosure
class is still closed, the guard is real and now measured, the two mutants that survived last round
are dead, and the one test the author had to fight with is the best-constructed test in the file.
This is the first round in eight where the remediation did not introduce the next finding. What is
left is one unasserted line that the record claims is asserted, one comment that is backwards about a
control I measured, and a target that moved under the branch while it was being reviewed — which is
the same shape as the last two Highs, caught this time before it landed rather than after.
