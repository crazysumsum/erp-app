# REV-046 — TASK-035 Bank UI independent review (REV-045 remediation)

**Review:** REV-046 ・**Task:** TASK-035 (T35) ・**Phase:** PHASE-003 ・**Capability:** SUP-CAP-03
**Head reviewed:** `11caf87806d58e687ec5856d8d9de2baa4e9da98` (`claude/supplier-task-035`, PR #125).
**Remediation delta:** `0379ccc9c955ec4c1de1e60d4c1f6f0870ae1e7c..HEAD`. **Merge diff:** `main…HEAD`.
**Worktree:** `/Users/sam/Documents/workspace/erp-app-worktrees/supplier-task-035`
**Reviewer:** independent agent (`agent-skills:security-auditor`); not the author. Author is Claude Opus 5.

**Verdict: CHANGES_REQUESTED** — 0 Critical, **0 High**, 1 Medium, 3 Low, 7 Info.

**The disclosure class is closed.** That is the headline and it is earned. I attacked the new
generation counter from six directions — two reveals racing, a rejected reveal, a reveal landing after
a route update, after a session expiry, after a manual collapse, after a countdown expiry, and the
four other async paths (`create`, `update`, `setDefault`, `deactivate`, `load`) that the brief flagged
as the obvious place this class would still be open. **Not one of them puts plaintext on the wrong
Supplier's screen.** Five consecutive rounds found a leak that the previous round's remediation
opened; this round's remediation does not open one. The counter-in-`forgetPlaintext` shape is the
right shape and it closes the class rather than the instance, exactly as it claims.

**All nine of the author's mutants reproduce.** I re-ran every one rather than reading the table.
Nine applied alone, nine killed, each at the assertion §9 names. The clock measurement in §9 is
correct to the millisecond — I measured it. The two new clock tests each fail for the reason they
claim.

What stops this being APPROVED is smaller than any previous round and is not a disclosure. **This
round's fix introduced one new defect, and it is the sixth consecutive round in which that sentence
is true** — but this one fails *closed*: an unrelated countdown expiring inside a reveal's round trip
silently discards a legitimate reveal that the server has already performed and audited, leaving an
audit record of a disclosure that never reached the screen, with no error shown. Alongside it,
**five of the seven statements in the new `forgetEverything()` are individually untested, and one of
them is load-bearing** — removing it leaks a typed password across a Supplier change with all 19
tests green. That is the same "assertions that pass for nothing" failure that produced REV-044 M-2
and the four survivors of the author's own first round, reappearing inside the fix for it.

Everything below states what I ran. Anything reasoned about but not executed is marked **PLAUSIBLE**.
Every mutation was reverted immediately; `git status --porcelain` was empty before the review, after
each of the twenty-two mutations, after every probe, and immediately before this file was written.
`git rev-parse HEAD` is still `11caf87…`. Nothing was committed.

---

## Summary

| | |
| --- | --- |
| Critical | 0 |
| **High** | **0** — I could not reach a cross-Supplier plaintext render on any path |
| **Medium** | **1** — a countdown expiring mid-flight silently discards a reveal the server already performed and audited |
| **Low** | **3** — the `Date.now()` fallback restores the rejected F-L1 behaviour and the new clamp hides its only symptom; five statements in `forgetEverything()` are untested and one is load-bearing; REV-045 I-1 is unaddressed and the test comment now overclaims |
| Info | 7 |

**Baseline and CI — verified, with one correction.** `gh run view 35682570635`: `headSha`
`11caf87806d58e687ec5856d8d9de2baa4e9da98`, `conclusion: success`, `status: completed`,
`event: pull_request`, **`attempt: 1`**, workflow `CI`. `gh run list --commit 11caf87…` returns
exactly that one run — no reruns. Four checks green: Build frontend, Dependency audit, Lint, Test
(server + client, MySQL integration). PR #125 is `OPEN`, `MERGEABLE`, `mergeStateStatus: CLEAN`, base
`main`, `headRefOid` equal to the reviewed head. `revision` is **203** as stated.

**The correction: `origin/main` has moved.** It is now `bd8cc2170689ea05480d1439ad3b02cda6135a80`,
while `git merge-base origin/main HEAD` and `baseline.default_commit` are both still `cc1d74b4…`.
The new commits are PR #126 (`codex/item-management-uat-closeout`) and touch only
`docs/items_management/**` — I diffed the two file lists and the intersection with this branch is
**empty**, so there is no conflict and `mergeStateStatus: CLEAN` is truthful. But CLAUDE.md §6
requires the target to be re-checked before merge, and `default_commit` is now stale. See I-4.

As in REV-044 and REV-045, I did **not** recompute the harness source fingerprint or the DESIGN/PLAN
digests; I read them from the state file. That much is unverified by me.

**Suites at this head, run by me.**

| Suite | Result |
| --- | --- |
| `npx vitest run --root client` | **588/588, 72 files** — run at the start and again after the last revert |
| `client/test/pages/suppliers/bank.test.js` alone | **19/19** (16 at the previous head; +3) |
| `npx eslint` over the five changed source, test and e2e files | clean, exit 0 |
| `npx playwright test --project=technical supplier-bank.spec.js` | **3/3, 34.3s — reproduced once, cleanly. Later repeats are NOT ESTABLISHED; see I-7.** |

---

## 1. The three claimed remediations, verified independently

### 1.1 F-H1 — the generation counter — **VERIFIED, and I could not defeat it**

The mechanism: `forgetPlaintext()` bumps `revealGeneration`; `confirmReveal` captures the value before
its `await` and compares after. Every clearing trigger already routes through `forgetPlaintext()`, so
all five are covered by construction rather than by remembering to set a flag in each one.

**The author's four new mutants, re-run, not read:**

| Mutant | Result | Killed at |
| --- | --- | --- |
| `F-H1` drop `if (generation !== revealGeneration) return;` | **KILLED** | `…must not be painted onto supplier 8's screen` **and** `a late reveal must not arm a countdown on a dead component` |
| `F-H1b` remove `revealGeneration += 1` from `forgetPlaintext` | **KILLED** | same two assertions |
| `F-M1` route update → `forgetPlaintext()` only | **KILLED** | `a half-typed account must not survive a Supplier change` |
| `F-M1b` session watch → `forgetPlaintext()` only | **KILLED** | `nor a session expiry` |

**Three mutants of my own on the same mechanism:**

- `X14` move the check to *after* `holdPlaintext(...)` → **KILLED**, both assertions. The ordering is
  pinned.
- `X8` capture the generation after the await instead of before → **KILLED**, but for the wrong
  reason (it makes `generation` undeclared, so every positive path throws). Not a useful mutant;
  recorded so the next reader does not count it.
- `X6b` move the bump up one level — out of `forgetPlaintext()`, into `forgetEverything()` →
  **SURVIVED, 19/19 green.** This is the interesting one. See F-M1 below: it means the design choice
  that *causes* the Medium is unasserted in both directions.

**Attacks on the counter itself — all executed, all HELD:**

| Attack | Result |
| --- | --- |
| Two reveals racing (`確認查看` twice with the promise pending) | **HELD** — `revealDialog.busy` admits exactly 1 service call; after both resolvers fire, exactly 1 plaintext node and 1 countdown node |
| A reveal that rejects | **HELD** — no plaintext in the DOM, password field emptied, `密碼不正確` shown, and a retry immediately afterwards still works, so the error path does not poison the counter |
| A reveal resolving during / after `forgetEverything()` | **HELD** — `forgetEverything` is synchronous and single-threaded; nothing resolves inside it, and a resolve after it is dropped |
| Re-entrancy: `holdPlaintext` itself calls `forgetPlaintext` and so bumps the counter | **HELD** — the bump happens after the check, on the landing path only |

**The other async paths — the place the brief said this class would still be open. It is not.**

| Path | Probe | Result |
| --- | --- | --- |
| `create` in flight across a route change | P6 | **HELD** — account plaintext gone at the route change and *not* restored by the late resolve; the warning banner does not render (the dialog is closed); `supplierCodes` from a cross-Supplier duplicate warning never reach the DOM |
| `deactivate` in flight across a session expiry | P7 | **HELD** — typed password gone before the resolve and not restored |
| `setDefault` / `update` | same code paths as above (`submitConfirm` / `submitWrite`) | **HELD** by the same probes |
| `load` | P6/P7 | **HELD** for plaintext — `list()` returns masked rows only. Two cosmetic residues, I-5 and I-6 |

None of these five writes plaintext into a rendered field, which is why none of them needs the
counter. That is worth saying plainly because it was the brief's prime suspect: the asymmetry is
real and it is correct. `reveal` is the only call whose *response* carries plaintext.

### 1.2 F-M1 — the two clearing layers — **VERIFIED in behaviour, thin in assertion**

`forgetEverything()` does genuinely close all three dialogs and wipe both secret fields. I checked
each by probe at this head, not by reading:

```
P5 confirm-dialog password in DOM before route change:  true
P5 confirm-dialog password in DOM after  route change:  false
P6 form account plaintext after route change:           gone, and not restored by a late create
P7 confirm-dialog password after session expiry:        gone
```

**And §1 of the report now matches the code exactly.** I checked the rewritten §1 clause by clause
against the source: `forgetPlaintext()` is attributed to manual collapse and countdown expiry;
`forgetEverything()` to unmount, both route guards and the session watch. That is precisely what
lines 112, 130, 131 and 134 do. The over-broad sentence is gone and nothing has replaced it with a
new over-broad sentence. This is the specific thing REV-045 asked for and it is done properly.

The assertion side is where it is thin — F-L2 below.

### 1.3 F-L1 — the monotonic deadline — **VERIFIED, with a caveat the report does not carry**

Mutant `F-L1` (`clock` → `Date.now()`) → **KILLED**, both clock tests, at
`a throttled tab must still clear once the deadline has passed` and `a backwards clock step must not
hold the account open`. Correct.

`X13` (`REVEAL_SECONDS` 30 → 300) → **KILLED**, three tests. The window itself is pinned, not just
the mechanism.

The caveat: the `?? Date.now()` fallback and the new clamp interact badly. See F-L1 below.

### 1.4 The two new clock tests — **the measurement is exact and each test fails for its stated reason**

The brief asked me to verify the measured behaviour rather than take §9's word. Measured at this head
under `vi.useFakeTimers({ shouldAdvanceTime: true })`:

```
P9 advance(5000):            perf +5000   date +5000
P9 setSystemTime(+60000):    perf +0      date +60000
P9 setSystemTime(-3600000):  perf +0      date -3600000
P9 performance.now is faked by vi.useFakeTimers: YES
```

§9 states "advance 5000 → perf +5000／date +5000；setSystemTime +60000 → perf +0／date +60000".
**Exactly right.** The conclusion drawn from it — that the throttling test and the backwards-clock
test cannot share one mechanism — follows.

- *Throttling test* (`clears on elapsed time even if the tab was throttled to one tick`): stubs
  `performance.now` to `real() + 60_000`, releases one tick. Under `F-L1` (system clock) it goes red
  because `Date.now()` did not move. It fails for the reason it claims.
- *Backwards-clock test* (`is not extended by the system clock jumping backwards`): `setSystemTime`
  −1h then advance 31s. Monotonic clock advanced 31s → deadline passed → cleared. Under `F-L1`,
  `Date.now()` is 3599s short of the deadline → plaintext held → red. It fails for the reason it
  claims.

One inaccuracy, Info only: the throttling test's doc comment says it uses
`advanceTimersToNextTimer()`; the code is `vi.advanceTimersByTime(1000)`. Same effect here (the
interval period is 1000ms), but it is a comment describing a mechanism the code does not use — I-2.

---

## 2. Findings

### F-M1 (Medium) — a countdown expiring mid-flight silently discards a reveal the server has already performed and audited

**Location:** `client/src/components/suppliers/SupplierBankPanel.vue:64-70` (`forgetPlaintext` bumps
the generation), `:102-106` (the `tick` calls `forgetPlaintext()` when the deadline passes),
`:169` (`if (generation !== revealGeneration) return;`).

**What is wrong.** The counter is deliberately coarse — "close the class, not the instance" — and
that is the right instinct. But `forgetPlaintext()` is not only reached from the five *screen-is-gone*
triggers. It is also reached from the two *this-one-row-is-done* triggers: the manual `收起` button
(`:328`) and the countdown tick itself (`:104`). Those two bump the generation as well, and a reveal
of a **different row** that is in flight at that moment is discarded as though the screen had changed.

The reveal button for every non-revealed row stays visible while another row is open
(`v-if="canReveal && revealed.id !== row.id"`, `:334`), so opening a second reveal while a first row's
countdown is running is ordinary use, not a contrived sequence.

**Impact.** Not a disclosure — it fails closed, and that matters. What it costs:

1. **The audit record is wrong.** `POST /suppliers/:id/bank-accounts/:bankId/reveal` has already run
   server-side and TASK-034 has already written the disclosure record. The client then throws the
   response away. The log says a user viewed a full bank account number; they did not. That log is
   the compensating control this whole feature leans on — §2 of the task record argues the 30 seconds
   is a client-side number precisely *because* the server keeps no reveal state, which leaves the
   audit row as the only server-side artefact of a disclosure.
2. **Silent failure.** No error, no toast, no state change the user can see.

**Proof of concept — executed, at this head.** Reveal row 41; at t=28s open row 42's reveal and
confirm; let row 41's 30s expire while row 42's request is in flight; then resolve it:

```
P1 row41 plaintext shown:                                  true
P1 row41 cleared by its own countdown:                     true
P1 row42 plaintext shown after its reveal resolved:        false   ← silently dropped
P1 reveal dialog still open:                               true
P1 any error message shown:                                false
P1 reveal service calls (audit rows written server-side):  2
```

The same shape through the manual `收起` button (`P2`: row 42's plaintext = `false`). That one is not
reachable in a real browser — the reveal dialog is `persistent` and modal, so `收起` cannot be
clicked behind it — so the countdown path is the reachable one. **PLAUSIBLE** but untested by me:
that the window is hit in practice depends on one HTTP round trip overlapping the expiry instant, so
it is narrow. A reviewer applying a stricter reachability bar could call this Low. I am holding it at
Medium because the consequence lands in an audit log, which cannot be un-written, and because it is
new in this round.

**Nothing tests this, in either direction.** `X6b` — move `revealGeneration += 1` out of
`forgetPlaintext()` and into `forgetEverything()`, which would fix this exactly — passes **19/19**.
So the code has a choice between two behaviours, one of which has this defect, and the suite is
silent on which one is in effect.

**Fix.** Do not weaken the counter; it is right that a late response cannot land. Make the drop
visible instead — one line at `:169`:

```js
if (generation !== revealGeneration) {
  revealDialog.error = "畫面已更新，請重新查看完整帳號。";
  return;
}
```

On the four screen-is-gone triggers the dialog has already been closed by `forgetEverything()`, so
this is invisible there; on the countdown and manual-collapse paths the dialog is open and the user
is told. If the phantom audit row is judged unacceptable on its own, the alternative is `X6b`'s
shape — bump only in `forgetEverything()` and have `holdPlaintext` compare `revealed.id` — but that
re-opens the question of whether a manual collapse should be able to be undone by a late response,
and I would not make that trade. **Whichever is chosen, assert it**: the probe above is ten lines.

### F-L1 (Low) — the `Date.now()` fallback restores the rejected behaviour, and the new clamp removes its only symptom

**Location:** `SupplierBankPanel.vue:100` (`const clock = () => (globalThis.performance?.now?.() ?? Date.now());`)
and `:105` (`revealed.remaining = Math.min(left, REVEAL_SECONDS);`).

**What is wrong.** Two small things that are fine alone and not fine together — the shape this module
keeps hitting.

- The fallback. `X11` (force the fallback by replacing the optional chain with `undefined`) →
  **KILLED**, both clock tests, at the same two assertions as the `F-L1` mutant itself. That is the
  proof: *the fallback path is bit-for-bit the behaviour REV-044 and REV-045 both rejected.* A
  backwards system-clock step holds the plaintext for the size of the step.
- The clamp. `X7` (`Math.min(left, REVEAL_SECONDS)` → `left`) → **SURVIVED, 19/19.** The clamp is
  untested, and with a monotonic clock it is unreachable — `left` starts at 30 and only decreases.
  Its *only* observable effect is on the fallback path, where it replaces REV-045's measured
  `3629 秒後自動隱藏` with a serene `30 秒後自動隱藏` while the account stays on screen for an hour.
  The clamp does not extend the window, but it deletes the one signal a user had that something was
  wrong.

**Reachability — stated honestly.** `globalThis.performance?.now` is present in every browser this
application targets and in jsdom; I could not identify a supported environment in which the fallback
executes, so today this is dead code. That it is unreachable in every supported browser is
**PLAUSIBLE** — I reasoned about it from platform support, I did not enumerate the browser matrix.
It stays Low for that reason. It is worth fixing because the prescribed fix has neither failure mode
and because dead code that silently restores a twice-rejected behaviour is a trap for the next
reader — the comment above it says the deadline is monotonic, without qualification.

**Fix.** Drop the fallback: `const clock = () => performance.now();`. Both clock tests stay green (I
did not run this variant — **PLAUSIBLE**, though `X11` establishes that only the fallback branch
changes behaviour). If the fallback is kept deliberately, remove the clamp so the absurd number shows,
and say in the comment that the fallback is non-monotonic. Do not keep both.

### F-L2 (Low) — five of the seven statements in `forgetEverything()` are untested, and one of them is load-bearing

**Location:** `SupplierBankPanel.vue:79-87`.

**What is wrong.** Each statement removed alone, suite re-run:

| Mutant | Statement removed | Result |
| --- | --- | --- |
| `X1` | `forgetFormSecrets()` | **SURVIVED 19/19** |
| `X2` | `form.open = false` | **SURVIVED 19/19** |
| `X3` | `revealDialog.open = false` | **SURVIVED 19/19** |
| `X4` | `revealDialog.password = ""` | **SURVIVED 19/19** |
| `X5` | `confirm.open = false` **and** `confirm.password = ""` | **SURVIVED 19/19** |

The first four survive because each is covered by its partner: closing a dialog fires its
`@hide` handler, which clears the same fields, and clearing the fields makes the open dialog
harmless. Mutually-covering pairs, neither individually pinned. Untidy, but nothing leaks.

**`X5` is different, and this is the finding.** The confirm dialog (set-default / deactivate) has no
partner assertion at all. I ran my `P5`/`P7` probes with `X5` applied:

```
X5-applied  P5 confirm-dialog password in DOM after route change:  true
X5-applied  P7 confirm-dialog password gone after logout:          false
```

So those two statements are genuinely load-bearing — remove them and a typed password survives a
Supplier change *and* a session expiry, rendered under the new URL — **and the whole suite stays
green.** The F-M1 remediation is pinned only at the composite level, by the `F-M1`/`F-M1b` mutants
which both happen to kill via the *write* dialog. The third dialog is covered by nothing.

This is the same failure mode as REV-044's M-2 and as the four mutants that survived the author's own
first round of REV-044 fixes: a clearing mechanism whose assertion is satisfied by something other
than the mechanism. It has now recurred inside the fix for it.

**Fix.** One assertion in the existing
`wipes a half-typed write dialog on a Supplier change and on session expiry` test: open
`停用 Test Bank`, type a password, push `/suppliers/8`, assert the password is not in
`document.body.innerHTML`. Four lines. The write dialog's own mutual-cover (X1/X2, X3/X4) is worth a
sentence in §1 rather than more assertions — it is belt-and-braces and saying so is enough.

### F-L3 (Low) — REV-045 I-1 is not addressed, and the test's comment now claims what its assertion does not do

**Location:** `client/test/pages/suppliers/bank.test.js`, `clears the plaintext on unmount and on session expiry`.

REV-045 I-1 asked for the `clearInterval` spy to capture the handle. It was not done — item 4 of
REV-045 §6 ("the three Info items are one-line each and belong in this pass") is unimplemented, and
§9 does not mention the Info items at all. The assertion is still
`expect(cleared, "unmount must clear the countdown, not just remove the node").toHaveBeenCalled()`,
while the comment immediately above it reads:

> 要盯住嘅係**嗰一個** handle 有冇被 `clearInterval` 收過。

It is not watching that handle. **`X12`** — change `clearInterval(countdown)` to
`clearInterval(987654321)`, so the real countdown interval leaks and keeps ticking on the unmounted
component with the account number in its closure → **SURVIVED, 19/19 green.** The assertion means "an
interval was cleared", which is true because Quasar clears its own during teardown.

This is a comment asserting a mechanism more precisely than the code implements it — the author names
this as his recurring failure three times in §5 and §8, and this is a fourth instance, in the test
written to fix the third.

**Fix.** As REV-045 wrote it: spy `setInterval` at reveal time, keep the return value, assert
`expect(cleared).toHaveBeenCalledWith(handle)`. Or correct the comment. Not both-and-neither.

---

## 3. Info

**I-1. `revealGeneration` is declared below the two functions that mutate it.** `let revealGeneration = 0;`
is at `:111`; `forgetPlaintext()` (`:64`) reads and writes it and `forgetEverything()` (`:79`) calls
`forgetPlaintext`, `forgetFormSecrets` (`:192`) and the `form`/`revealDialog`/`confirm` reactives
(`:185`, `:151`, `:269`) — all declared *after* it. This is safe today only because nothing invokes
either function before setup reaches `:111`: the guards and `onUnmounted` merely register, and the
session `watch` is not `immediate`. Add `{ immediate: true }` to that watch, or call
`forgetEverything()` anywhere in setup, and it throws a TDZ `ReferenceError` — from a security
control, at mount, in production. Moving the declaration above `forgetPlaintext` is one line and
removes the trap. Not a finding against behaviour at this head.

**I-2. The throttling test's comment names a helper the test does not use.** It says
`advanceTimersToNextTimer()`; the code is `vi.advanceTimersByTime(1000)`. Equivalent here because the
interval period is exactly 1000ms, but the comment is the documentation of *why* the test is shaped
that way, and it describes a different shape.

**I-3. §7's self-test table is one round stale.** It still reads `supplier-phase-001-client` **PASS
87/87** and `成個 client vitest` **PASS 585/585**. The registered evidence at this head
(`evidence/20260922T031624-a7aae1d777b5/run.json`) is `counts: {total: 90, passed: 90}`, and §9
correctly says 588/588. The four new evidence records are internally consistent — `result: PASS`,
`exit_code: 0`, artefact digests present, client XML `tests="90" failures="0"` — so this is the
prose, not the ledger.

**I-4. `baseline.default_commit` is stale; `origin/main` is now `bd8cc21…`.** The new commits are
`docs/items_management/**` only and the file-list intersection with this branch is empty, so there is
no conflict and nothing to rebase for correctness. But CLAUDE.md §6 is explicit that the target is
re-checked before merge and that a moved target is merged into the feature branch first. Whoever
merges should either fast-forward the branch or record why they did not, and `default_commit` should
be refreshed.

**I-5. A success toast fires under the new Supplier's URL after a write that was in flight across a
route change.** `P6`: `供應商 SUP-007 的銀行帳戶「Test Bank」已新增` renders after
`router.push("/suppliers/8")`. It names only the Supplier code and bank name — never the account
number — so this is cosmetic. `P7` shows the same after a session expiry.

**I-6. `load()` re-fires after the session has been cleared.** `P7`: `list()` is called a second time
after `useSessionStore().user = null`, i.e. the panel issues `GET /suppliers/7/bank-accounts` from a
screen that has already been wiped. It will 401 into `httpClient.onUnauthorized` and be harmless, but
it is a request that should not be made. Masked data only. One `if (gone) return` equivalent before
`await load()` in `submitWrite`/`submitConfirm` would close it.

**I-7. The browser suite — reproduced once, cleanly; repeats NOT ESTABLISHED, and the cause is mine.**
`npx playwright test --project=technical supplier-bank.spec.js` → **3 passed (34.3s)** on a clean tree
at this head, which corroborates §9's 3/3. Every subsequent attempt failed, and every failure is
self-inflicted: my first runs overlapped mutation runs that hot-reloaded `SupplierBankPanel.vue` into
the live Vite server; two of my runs shared one `outputDir` and raced each other's trace files; I then
deleted `client/node_modules/.vite`; and finally this sandbox SIGTERMs (`code 143`) any dev server I
start, so Playwright's own `webServer` dies mid-run and every test fails with
`net::ERR_CONNECTION_REFUSED`. I could not restore an environment in which to repeat the run. I am
recording this as an environment limitation of *this review*, not as a finding against the branch —
but it means I have one observation of the browser suite, not several, and the `v-if` → `v-show`
mutant that only the browser suite can kill is therefore **unverified by me this round** (REV-045
verified it at the previous head, and that code is unchanged in the delta).

**Carried, not addressed, not blocking.** `writeBody()` still does not trim `accountNumber` while
trimming every other string field (REV-044 I-2). The browser suite's thirty-second assertion is still
`toHaveCount(0)` rather than an occurrence count over `page.content()` (REV-044, restated by REV-045).
The tab-count asymmetry note for design §7.5 (REV-044 I-1) is still not in the design.
`baseline.code_commit` names the previous head (`0379ccc…`) and both new observations carry it while
describing work that exists only at `11caf87…` — the structural lag REV-045 recorded as its I-3, not
drift. `SupplierDetailPage` still has no `route.params.id` watch (§6, out of scope) — I confirmed it
binds `:supplier-id="supplier.id"`, not the route param, so in the real application `props.supplierId`
does **not** change on a param-only navigation, whereas the test host binds
`Number(this.$route.params.id)` and it does. The test host is therefore *more* aggressive than
production on this point and nothing in the suite depends on the difference; worth knowing before
anyone fixes §6.

---

## 4. What I attacked and what HELD

Executed, not reasoned about. I deliberately did not re-run what earlier rounds confirmed — storage,
URL, Pinia, toasts, Escape and backdrop closing, cancel-then-reopen, bfcache, tab switching, the
service layer, the two-sided per-row permission gating. This is where I went instead.

- **The author's full mutation table, all nine, reproduced.** `F-H1`, `F-H1b`, `F-M1`, `F-M1b`,
  `F-L1`, `H-1`, `M-2a`, `M-2b`, `M-3` each applied alone and reverted → each **KILLED**, at the
  assertion §9 implies. The table is accurate.
- **Thirteen mutants the author did not write.** `X1`–`X5` (each statement of `forgetEverything`),
  `X6b` (bump moved up a level), `X7` (clamp), `X9`/`X10` (`onBeforeRouteLeave` dropped, and narrowed
  to `forgetPlaintext`), `X11` (force the `Date.now()` fallback), `X12` (clear a bogus handle),
  `X13` (`REVEAL_SECONDS` widened), `X14` (check moved after `holdPlaintext`). Six survived and each
  survival is reported above; `X9`/`X10` survive as documented equivalents, consistent with REV-044
  and REV-045.
- **The generation counter under attack.** Two reveals racing → 1 service call, 1 plaintext node,
  1 countdown node. A rejected reveal → no plaintext, password emptied, mapped error shown, and a
  retry immediately afterwards succeeds. A reveal landing after a route update → dropped. After a
  session expiry → dropped. After a manual collapse → dropped. After a countdown expiry → dropped
  (F-M1). Nothing landed plaintext where it should not.
- **The four other async paths.** `create` in flight across a route change → no plaintext restored,
  no warning banner, no `supplierCodes` in the DOM. `deactivate` in flight across a session expiry →
  password gone and not restored. `load` → masked rows only. The residues are I-5 and I-6.
- **The clock.** `advanceTimersByTime` vs `setSystemTime` measured against both clocks; §9's figures
  reproduce exactly. `performance.now` confirmed faked by `vi.useFakeTimers`. Both new tests fail for
  the reasons they claim.
- **Report-versus-code.** §1's two-layer description checked clause by clause against lines 112, 130,
  131 and 134 — it matches. §7's numbers do not (I-3).
- **Baseline and CI.** Run `35682570635` verified by `gh` on four fields plus `attempt: 1` and a
  single-run `gh run list`; PR #125 state, mergeability and `headRefOid` verified; `origin/main`
  re-fetched and found moved (I-4); the four new evidence records opened and their counts matched
  against the JUnit XML.
- **Lint** over the five changed source, test and e2e files: exit 0.
- **Tree discipline.** `git status --porcelain` empty before the review, after each of the
  twenty-two mutations, after every probe file was deleted, and immediately before this file was
  written. `git rev-parse HEAD` still `11caf87…`. Nothing committed.

## 5. Not covered by this review

- **The server side of the Bank capability.** Unchanged by this branch; REV-039…REV-043 covered it,
  and CI ran the server suites green at this head. I read `SupplierDetailPage.vue` only to establish
  how `supplierId` is bound.
- **Repeated browser-suite runs, and the `v-if` → `v-show` mutant.** One clean 3/3 observed; see I-7
  for why I could not repeat it and what that leaves unverified.
- **A real suspended machine, a real mobile background, a real NTP step.** The clock results are a
  fake-timer model of a system-clock change, not a system-clock change. Whether `performance.now()`
  freezes across system suspend on the target platforms — which would pause the countdown rather than
  extend it — I did not test.
- **Whether any supported browser lacks `performance.now`.** Marked PLAUSIBLE in F-L1.
- **Whether the F-M1 countdown window is hit in practice.** Marked PLAUSIBLE; what I demonstrated is
  the component's behaviour under fake timers, not a real race.
- **The harness source fingerprint and the DESIGN/PLAN digests.** Read from the state file, not
  recomputed.
- **The contents of the four BLOCKED profile suites.** REV-045 verified the ledger's account of them
  path by path and stderr by stderr; they are unchanged in this delta and I did not re-verify.

## 6. What it takes to turn this into APPROVED

1. Make the dropped reveal visible — one line at `:169` — and assert it (F-M1). This is the one I
   would not merge without, not because it leaks but because it writes a disclosure record for a
   disclosure that did not happen.
2. Assert the confirm dialog's clearing (F-L2). Four lines in the test that already exists.
3. Resolve the clock fallback one way or the other: drop `?? Date.now()`, or drop the clamp and say
   in the comment that the fallback is not monotonic (F-L1).
4. Either capture the interval handle or correct the comment that says you did (F-L3), and move the
   `revealGeneration` declaration above its first use (I-1). Both are one line.
5. Refresh `default_commit` and confirm the moved `origin/main` before merging (I-4); correct §7's
   87/87 and 585/585 (I-3).

Item 1 blocks. Items 2–5 are small and four of the five are in files already open.

**Said plainly, because it should be:** the thing this review existed to check — whether five rounds
of "the fix opened the next hole" would become six — came out well. The disclosure class is closed,
the fix is the right shape, the mutation table is honest, and the report finally describes the code it
sits next to. What is left is one fail-closed defect and three gaps in what the tests can tell you.
That is a materially better position than any of the last five rounds.
