# REV-050 — TASK-035 Bank UI independent review (REV-049 remediation)

**Review:** REV-050 ・**Task:** TASK-035 (T35) ・**Phase:** PHASE-003 ・**Capability:** SUP-CAP-03
**Head reviewed:** `51bcff85555a80ae483f62a3f7fb3e1441a2ee73` (`claude/supplier-task-035`, PR #125).
**Previous review head:** `85611a23bd50b06bacb37c1427effc01d31a9171`.
**Remediation diff:** `85611a2..HEAD` — three commits, one of which (`c83ae86`) is the only one that
touches code, and it touches `client/test/pages/suppliers/bank.test.js` and nothing else.
**Subject:** `origin/main…HEAD`.
**Worktree:** `/Users/sam/Documents/workspace/erp-app-worktrees/supplier-task-035`
**Reviewer:** independent agent (`agent-skills:security-auditor`); not the author. Author is Claude Opus 5.

**Verdict: APPROVED** — 0 Critical, 0 High, **0 Medium**, 4 Low, 5 Info.
**One merge-time precondition, not a code change:** `origin/main` has moved two commits since CI ran.
See F-L4 and §9.

**Every one of REV-049's five items is done, and I verified each by execution rather than by reading
the record.** All four rows of §13's mutation table are real: I reproduced each mutant myself and each
one is killed, at the assertion the record names. The suite is 636/636, the browser suite is 23/23 in
49.3s, lint exits 0 — I ran all three and read the process exit status directly, which is the thing
§13 itself discloses getting wrong earlier in the session. The evidence lag REV-049 raised as F-L3 is
properly closed: `baseline.code_commit` is `c83ae86` and the head above it is docs-and-evidence-only.

**For the fourth round running there is no defect in the Bank UI, and this is the first round in which
the author's record is accurate on every claim I could check.** What I found instead is one place where
the shipped assertion is weaker than the one REV-049 specified and the record does not say so (F-L1);
one comment that the new tests have just made false, in a direction that *understates* the control the
author built (F-L2); and one entitlement-ending trigger that ten rounds have not named, which is
measured, bounded, and arguably not this task's to fix (F-L3). None of these is a defect and none is
worth a seventh round.

Everything below states what I ran. Anything reasoned about but not executed is marked **PLAUSIBLE**.
Eight mutations were applied this round, each alone, each reverted immediately, with
`git status --porcelain` asserted empty before and after each by the harness that applied them (it
aborts otherwise). Four probes were appended to `bank.test.js`, run, and reverted. `git status
--porcelain` was empty before the review, after every mutation, after every probe, and immediately
before this file was written. `git rev-parse HEAD` is still `51bcff8…`. Nothing committed, nothing
staged, no branch moved.

---

## Summary

| | |
| --- | --- |
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| **Low** | **4** — the `holdPlaintext` test pins "some `clearInterval` ran", not the invariant, and the record says the spy was necessary when the reviewer's own probe was sufficient and stronger (new); the panel's "three redundant mechanisms, any two suffice" comment is now measurably false, and the new assertions are stronger than §13 claims (new); a sixth entitlement-ending trigger is unwired and the header comment claims the set of five is complete (new); `origin/main` has moved two commits again |
| Info | 5 |

**Suites at this head, run by me.**

| Suite | Result |
| --- | --- |
| `npx vitest run --root client` | **636/636, 82 files** — at the start, after every revert, and again before writing this |
| `npm run e2e:supplier-management` (the script CI runs) | **23/23, 49.3s** |
| `npm run lint` | **exit 0**, read as the process's own status, not a pipeline's |
| CI run `35804916810` at `51bcff8` | **five checks, all `success`, attempt 1, single run** |
| PR #125 | `OPEN`, `MERGEABLE`, `mergeStateStatus: CLEAN`, not a draft, base `main`, `headRefOid` = reviewed head |

---

## 1. REV-049's five items, checked by execution

### 1.1 Item 1 — replace the two DOM reads with `panel.vm.form.*`. **DONE, and it kills the mutant that was green.**

The test now captures `wrapper.findComponent(SupplierBankPanel).vm` and asserts `form.accountNumber`
and `form.password` on **both** paths — after `router.push("/suppliers/8")` and after
`useSessionStore().user = null`. The session-expiry half also now types the password, which the old
version did not.

I applied REV-049's own §2.3 row-1 mutant — drop `forgetFormSecrets();` from `forgetEverything()`
**and** `@hide="forgetFormSecrets"` — which survived 634/634 last round:

```
=== M1 form secrets: drop call + @hide ===
 Tests  1 failed | 635 passed (636)
 FAIL  bank.test.js > wipes a half-typed write dialog on a Supplier change and on session expiry
 AssertionError: the account number must be gone from form state, not merely unrendered:
   expected '12345678901234' to be ''
```

**KILLED, at the assertion whose message names the property.** The false parenthetical about
`openCreate()` is gone and the replacement comment says what is true.

### 1.2 Item 2 — correct §12 and the ledger. **DONE, in the right shape.**

§12 now carries an inline `> **更正（REV-049）。**` block that states all three errors without
softening them, including that the "three together turn it red" argument went red because the
mutation also stopped `openCreate()` resetting — i.e. that the wrong mechanism had been pinned.

The REV-048 ledger entry was **not** edited in place; a new REV-049 `MANUAL_TEST` entry retracts it
explicitly ("my argument for that settlement was itself wrong"). For an append-only observation
ledger that is the correct shape, not an evasion: an observation records what was believed at a
point in time, and the retraction is the next observation. I checked that the retraction is
discoverable from the entry it retracts — it names REV-049, the same subject and the same three
errors — and it is.

One clause in that correction is imprecise and I measured it; see F-L2.

### 1.3 Item 3 — two lines each for the two step-up passwords. **DONE, and both mutants die.**

A new test, `forgets both step-up passwords from component state, not just from the DOM`, covers the
reveal dialog on a Supplier change and the confirm dialog on a session expiry. The reveal-dialog test
REV-049 said "does not yet exist" now exists.

```
=== Z16 reveal password: drop forgetEverything line + @hide ===
 Tests  1 failed | 635 passed (636)
 AssertionError: a Supplier change must forget the reveal password:
   expected 'Reveal-Password-1!' to be ''

=== Z17 confirm password: drop forgetEverything line + @hide ===
 Tests  1 failed | 635 passed (636)
 AssertionError: a session expiry must forget the confirm password:
   expected 'Confirm-Password-1!' to be ''
```

Both **KILLED**, each at its own named assertion. Z16 and Z17 survived 634/634 one round ago.

### 1.4 Item 4 — one test for two sequential reveals. **DONE; the mutant dies, but not for the property.** See F-L1.

### 1.5 Item 5 — re-run the evidence at the final head, or commit docs only above it. **DONE.**

`baseline.code_commit` is `c83ae86f…`. The head `51bcff8` is one commit above it and I listed its
contents: `00_harness_state.json` plus four `evidence/20260923T0105*` directories. **Docs and evidence
only** — no `client/` path. That is exactly the shape REV-048 named and REV-049 asked for, and it is
the first round in which it was actually adopted. The four `DEVELOPER` records all carry
`exit_code: 0`, `code_commit: c83ae86f…`, and the client XML reports `tests="101" failures="0"`
(the `test/pages/suppliers` + `test/services/supplier.test.js` subset, as in previous rounds — the
full 636 is covered by CI and by my own run). `revision` is **216** as stated.

---

## 2. F-L1 (Low) — the new `holdPlaintext` test pins "some `clearInterval` ran", not the single-timer invariant, and the record says the spy was necessary

**Location:** `client/test/pages/suppliers/bank.test.js`, `replaces the first row's countdown when a
second row is revealed`; `44_task_035_bank_ui.md` §13 mutation table; `00_harness_state.json` the
REV-049 `MANUAL_TEST` entry.

### 2.1 The mutant it was written for does die

```
=== Z10 drop forgetPlaintext() from holdPlaintext head ===
 Tests  1 failed | 635 passed (636)
 FAIL  bank.test.js > replaces the first row's countdown when a second row is revealed
 AssertionError: revealing a second row must clear the first row's countdown:
   expected "clearInterval" to be called at least once
```

**KILLED.** I also checked the specific worry that the spy might be passing for an unrelated reason —
there are other `clearInterval` calls in the environment, and the flow between installing the spy and
asserting it includes a Quasar dialog open and close. Under Z10 the spy records **zero** calls, so
nothing else in that window touches `clearInterval`. That concern is empirically closed.

### 2.2 But the assertion is satisfied with the defect live

`toHaveBeenCalled()` pins that *a* `clearInterval` happened, not that the first row's handle was the
one cleared. Mutant **Z10b**: orphan the first row's interval, but still call `clearInterval` on
nothing.

```js
function holdPlaintext(id, accountNumber) {
  clearInterval(undefined);        // ← instead of forgetPlaintext()
  revealGeneration += 1;
```

```
=== Z10b orphan the first interval but still call clearInterval() ===
 Test Files  82 passed (82)
      Tests  636 passed (636)          ← SURVIVED, new test included
```

So the exact defect REV-049 F-L2 described — Alpha's interval outliving its replacement, firing for
the life of the component and cutting Beta's thirty seconds down — is reachable with the whole suite
green.

### 2.3 REV-049's own recommended probe kills both, and I ran it

REV-049 §4 specified the test: *"reveal row A, reveal row B, assert A's plaintext is gone and B's
survives its own full thirty seconds."* I wrote exactly that (reveal Alpha, advance 5 s, reveal Beta,
advance 26 s) and ran it three ways:

| | shipped spy test | REV-049's §4 behavioural probe |
| --- | --- | --- |
| at HEAD | passes | passes |
| under **Z10** | **fails** | **fails** (`B must survive its own full thirty seconds`) |
| under **Z10b** | passes | **fails** |

The behavioural assertion is strictly stronger and costs the same four lines.

### 2.4 The record's reason is true about a different assertion

§13 and the ledger both say: *「我第一次寫嘅斷言（睇 `revealed.remaining`）捉唔到 —— 兩個 interval 各自
由自己個 deadline 計，同一個 tick 內後寫嗰個贏 …… 改成 spy 住 `clearInterval` 先至殺到」* / "asserting
the countdown value cannot see an orphan … so it now spies the clearInterval call."

**The first half is correct and I verified it.** I wrote the `revealed.remaining` probe and it survives
Z10 — the number reads ~29 for a freshly revealed Beta whether or not Alpha's interval was orphaned,
exactly as described.

**The second half does not follow.** REV-049 never proposed asserting `revealed.remaining`; §4 proposed
the behavioural assertion above, and reproduced its measured output in the document. The record
therefore closes an item by reporting that an assertion could not be written, having refuted a
different assertion than the one the reviewer wrote down and ran.

This is the same shape as the last three rounds — REV-049's §13 point 1 was *「我之前假設 `<script
setup>` 攞唔到內部 state —— 冇試過」* — one round later and one mechanism over. It is milder: the
author did try something, did report the negative result honestly, and did ship a test that kills the
named mutant. But the conclusion "only the spy kills it" was not tested against the thing it was
answering.

**Impact.** None in production. `forgetPlaintext()` is at the head of `holdPlaintext` and I measured
HEAD behaving correctly on the full behavioural probe. This is a coverage-strength note on a security
invariant (one plaintext, one timer) plus a record claim that overstates what was ruled out.

**Fix.** Replace the spy with — or add beside it — the behavioural assertion from §2.3. Four lines,
already written and run in this document. Then correct the §13 row and the ledger sentence to say what
is true: the countdown-value assertion cannot discriminate; the behavioural one can; the spy is a
weaker third option.

---

## 3. F-L2 (Low) — the "three redundant mechanisms, any two suffice" comment is now false, and the new assertions pin something stronger than §13 claims

**Location:** `client/src/components/suppliers/SupplierBankPanel.vue:84-92`; `44_task_035_bank_ui.md`
§12 correction block and §13; `00_harness_state.json` REV-049 entry.

### 3.1 What the comment and the record say

`SupplierBankPanel.vue:84-92`, untouched by this remediation:

> 寫入 form 嗰兩個祕密有**三個**互相冗餘嘅清除機制 …… **任何兩個**都夠，所以單獨拆走其中一個係一個
> equivalent mutant，測試分辨唔到 …… 三個一齊拆走，測試就會紅 —— 即係 …… 呢個**性質**係釘住咗嘅

§12's correction block and §13 both say the path is covered by two mechanisms: *「真正覆蓋呢條路嘅只有
兩個（`forgetEverything` 入面個 call 同 dialog 個 `@hide`）」* / "Only two mechanisms actually cover
that path."

### 3.2 Measured: single-statement drops, one at a time

| Mutant (applied alone, full suite) | Result |
| --- | --- |
| **m1a** — drop only `forgetFormSecrets();` from `forgetEverything()`, keep the `@hide` | **KILLED** (635/636, at `the account number must be gone from form state`) |
| **m1b** — drop only `@hide="forgetFormSecrets"` | SURVIVED 636/636 |
| **z16a** — drop only `revealDialog.password = "";`, keep the `@hide` | **KILLED** (at `a Supplier change must forget the reveal password`) |
| **z16b** — drop only the reveal dialog's `@hide` | SURVIVED 636/636 |

So "dropping one alone is an equivalent mutant the tests cannot tell apart" is false at this head for
two of the three statements, and the `@hide` is the one that is individually unasserted — the opposite
of what the comment implies.

### 3.3 Why, measured rather than inferred

I instrumented the reveal dialog under `z16a` and traced the password through the leave transition:

```
HIDEPROBE (z16a)  t0 = "Reveal-Password-1!"  open=false | +400ms = "" | +1000ms = "" | +5000ms = ""
HIDEPROBE (HEAD)  t0 = ""                    open=false | +400ms = "" | +1000ms = "" | +5000ms = ""
```

`@hide` **does** fire — Quasar runs it after the dialog's leave transition, about 400 ms after
`forgetEverything()` sets `open = false`. It is a real second layer in a real browser. It is simply not
a *synchronous* one, and the test asserts immediately after `flushPromises()`.

### 3.4 The part nobody has stated, and it is the good news

The three new state-level assertions therefore pin a **stronger** property than the record claims for
them. They do not merely pin "the secret left component state." They pin that it left **synchronously,
inside `forgetEverything()`**, with no reliance on a dialog transition completing. On a session expiry
— where the panel is not unmounted — that is the difference between a step-up password leaving memory
at once and sitting there for a further leave transition while the session is already dead. That is the
right property to pin, and the author pinned it. The comment and the record both undersell it.

**Impact.** No defect; every statement is present and correct and I verified HEAD passes all three
assertions. What is wrong is that `:84-92` is now the last surviving copy of the argument §12 formally
retracted, and it tells the next maintainer the tests cannot distinguish a single deletion when two of
the three deletions now turn the suite red. A maintainer acting on it would be caught by CI, so it
self-corrects — but it misstates the security meaning of what is there.

**Fix.** Rewrite `:84-92` to what is measured: on a route change and a session expiry the statement in
`forgetEverything()` is the only synchronous clear; the dialog's `@hide` is a delayed second layer that
fires after the leave transition; `openCreate()` covers neither path and only guards a reopen. Correct
the same clause in §13 and in the ledger entry. Roughly three lines of comment and one sentence each.

---

## 4. F-L3 (Low) — a sixth entitlement-ending trigger is unwired, and the header comment claims the set of five is complete

**Location:** `SupplierBankPanel.vue:14-17` (the header comment) and `:156` (the session watch);
`client/src/stores/session.js:71` (`refresh`); `client/src/framework/auth/sessionWatchdog.js:72`;
`client/src/main.js:90`.

`SupplierBankPanel.vue:17` states the clearing triggers as a closed set:

> 清除有五個觸發點，全部指向同一個 `forgetPlaintext()`：手動收起、30 秒到、unmount、route change、
> session 失效。

The panel's only session-driven trigger is:

```js
watch(() => session.isAuthenticated, (authenticated) => { if (!authenticated) forgetEverything(); });
```

`isAuthenticated` is `state.user !== null`. But `session.refresh()` does `this.user = result.user`, and
its own comment states the purpose plainly: *「後端每次續期都會重讀 roles/permissions，所以權限變更會喺
一次續期（最多 15 分鐘）之內反映到畫面上，唔使等重新登入。」* It is driven automatically by
`sessionWatchdog.js:72` through `main.js:90` — no user action required. `user` goes from one object to
another, never to `null`, so `isAuthenticated` never changes and the watch never fires.

**Measured**, with a probe that reveals a row, half-types a write dialog, then lands a refresh that has
dropped `supplier.bank.view` and `supplier.bank.mgmt`:

```
isAuthenticated=true | revealed.id=41 | plaintext_in_dom=true | reveal_button_present=false
| form.open=true | form.accountNumber="FORM-SECRET-9" | form.password="Form-Password-1!"
| form_secret_in_dom=true
```

The permission-gated **controls** react correctly — `canReveal` flips and the 查看完整帳號 button
disappears, which is the per-row gating six rounds have confirmed. What does not react is the
**already-disclosed plaintext**: the revealed account number stays rendered with its countdown running,
and the write dialog stays open with the typed account number and the user's step-up password live in
component state and in the DOM.

**Impact, stated honestly, which is why this is Low and not more.** Nothing is disclosed to anyone who
did not already have it: this is the same user, looking at data they legitimately revealed seconds
earlier, on their own screen, with their own password. The plaintext window is still bounded by the
thirty-second timer, so the marginal exposure is under thirty seconds. A submit from the stale write
dialog is rejected server-side, so there is no privilege escalation. The write dialog's unbounded
residue is the typed account number, which the user typed.

**And it is arguably not this task's to fix.** No page in this application re-evaluates authorization on
a token refresh — `framework/auth/routeGuard.js` is a `beforeEach`, so it only runs on navigation. The
general property "a revoked permission does not retract what is already on screen until the next
navigation" belongs to the session and authorization framework, not to the Bank panel. I am recording
it here because this panel is the one place in the module where the on-screen data is a secret with an
explicit, enumerated clearing contract — and because that enumeration says "five triggers" and is
incomplete.

**Fix, if taken.** One watcher beside the existing one, clearing on loss of entitlement rather than only
on loss of session, plus correcting the header comment's count. **PLAUSIBLE** that the cleanest shape is
`watch(canReveal, (v) => { if (!v) forgetPlaintext(); })` and `watch(canManage, (v) => { if (!v)
forgetEverything(); })` — I did not implement or test it, and the module-level question (whether this
belongs in the framework) should be answered before the panel-level one.

---

## 5. F-L4 (Low) — `origin/main` has moved two commits again; `baseline.default_commit` is stale

**Location:** `docs/supplier_management/00_harness_state.json` (`baseline.default_commit`); the branch.

Verified rather than assumed, and the brief's premise no longer holds:

```
origin/main  = 1ba8fb63bd06d0409ee29b27315cd12a76cb16f2
merge-base   = 38e1542eed8ac6fe98ce307868390b6e98181788
git rev-list --left-right --count origin/main...HEAD  →  2   12
```

`baseline.default_commit` is `38e1542…`, which is the merge base and was `origin/main` when CI ran. It
is not `origin/main` now. That is the exact field REV-048 blocked on.

**Why this is Low and not the Medium REV-048 raised.** The two commits are `6042336` and its merge
`1ba8fb6`, and between them they touch **one file**: `client/vite.config.js`, adding `fs.allow` entries
so the dev server can read hoisted `node_modules`. This branch does not touch that file, there is no new
or changed CI job among them, and PR #125 reports `MERGEABLE` / `mergeStateStatus: CLEAN`. Nothing here
can change this PR's gate outcome the way REV-048's 24 commits could — those carried a new blocking
browser job and the Playwright `os.tmpdir()` fix.

**It is still a merge precondition, not a nothing.** The project rule is to fetch the target, merge it
into the feature branch, and let CI re-run before merging the PR — `mergeStateStatus: CLEAN` means "no
conflicts", not "up to date". Do that and `baseline.default_commit` should be refreshed to match. It is
one command and one CI run, and it is the standing process for any PR rather than a change to this one's
content — which is why it does not hold the verdict.

---

## 6. The mutation table

Eight mutations, each applied alone at this head, full `npx vitest run --root client` each time,
reverted immediately, porcelain asserted empty before and after each by the applying harness.

| # | Mutant | Result |
| --- | --- | --- |
| 1 | **M1** — drop `forgetFormSecrets();` **+** `@hide="forgetFormSecrets"` (REV-049 §2.3 row 1, green last round) | **KILLED** at `the account number must be gone from form state` |
| 2 | **m1a** — drop only the `forgetFormSecrets();` call | **KILLED** — see F-L2 |
| 3 | **m1b** — drop only `@hide="forgetFormSecrets"` | SURVIVED 636/636 — see F-L2 |
| 4 | **Z16** — reveal dialog: drop the `forgetEverything()` line **+** `@hide` | **KILLED** at `a Supplier change must forget the reveal password` |
| 5 | **z16a** — drop only `revealDialog.password = "";` | **KILLED** — see F-L2 |
| 6 | **z16b** — drop only the reveal dialog's `@hide` | SURVIVED 636/636 — see F-L2 |
| 7 | **Z17** — confirm dialog: drop the `forgetEverything()` line **+** `@hide` | **KILLED** at `a session expiry must forget the confirm password` |
| 8 | **Z10** — drop `forgetPlaintext()` from `holdPlaintext()`'s head | **KILLED** at the `clearInterval` spy |
| 9 | **Z10b** — orphan the first interval but still call `clearInterval()` | **SURVIVED 636/636** ← F-L1 |

Rows 1, 4, 7 and 8 are §13's four claimed kills. **All four are real, and each fails at the assertion
the record names.** Rows 2, 3, 5, 6 and 9 are new this round.

---

## 7. What I attacked and what HELD

Executed, not reasoned about. I did not re-run what nine rounds confirmed — storage/URL/Pinia/toast,
dialog close paths, bfcache, tab switching, the service layer and its `signed` decisions, per-row
permission gating, the generation counter, the four-way navigation seam, guard ordering, or the device
signer. This is where I went instead.

| Probe | Attack | Result |
| --- | --- | --- |
| **The `clearInterval` spy's specificity** (the brief's own question) | Is the new assertion passing for an unrelated reason, or can it pass with the bug live? | **Not unrelated** — under Z10 the spy records zero calls, so nothing else in that window touches `clearInterval`. **But satisfiable without the control** — Z10b survives 636/636. See F-L1 |
| **The author's "`remaining` cannot discriminate" claim** | Reproduce it rather than read it | **HELD** — the `revealed.remaining` probe survives Z10, for the reason given. The conclusion drawn from it does not; see F-L1 |
| **REV-049's §4 behavioural probe** | Was the assertion the reviewer specified actually impossible? | **No** — it kills Z10 *and* Z10b, in four lines, at this head |
| **`@hide` timing** (nobody has looked at this) | Does the dialog's `@hide` cover the route-change path, as three documents claim? | **Only after ~400 ms.** Traced through the leave transition: at t0 the password is still present, at +400 ms it is empty. The direct statement is the only synchronous clear. See F-L2 |
| **Single-statement drops, one at a time** | Is "any two suffice, dropping one alone is an equivalent mutant" still true? | **No** — `m1a` and `z16a` are now killed; `m1b` and `z16b` survive. The new assertions are stronger than advertised. See F-L2 |
| **Permission revocation without session loss** (nobody has looked at this) | `session.refresh()` replaces `user` in place and `isAuthenticated` never changes — does anything clear? | **Nothing clears.** Plaintext stays rendered with its countdown, the write dialog stays open holding the account number and step-up password. Bounded and same-user; see F-L3 |
| **Evidence lag** | Is the head above `baseline.code_commit` docs-only, as REV-048's standard requires? | **HELD** — `51bcff8` touches only `00_harness_state.json` and four evidence directories |
| **CI at the real head** | Five checks, one attempt, one run, on `51bcff8` itself? | **HELD** — `35804916810`, all five `success`, `attempt: 1`, and `gh run list --commit 51bcff8` returns exactly that one run |
| **The target** | Is `origin/main` still `38e1542` and equal to the merge base, as the brief states? | **It is not** — moved two commits. See F-L4 |
| **The three suite claims in §13** | 636/636, 23/23, lint clean | **HELD** — all three reproduced, lint read as the process's own exit status |

---

## 8. Info

**I-1. The `clearInterval` spy is restored only on the happy path.** `cleared.mockRestore()` sits after
the assertion it guards, so a failure leaks the spy out of the test. It does not leak *across* tests,
because `afterEach(() => vi.useRealTimers())` reinstalls the timer globals wholesale and the next
`beforeEach` reinstalls the fakes — so the cleanup is real but incidental. If the spy survives the fix
in F-L1, a `try`/`finally` or `vi.restoreAllMocks()` in `afterEach` would make it deliberate. Not worth
a round on its own.

**I-2. §11's mutation block still reads 「十三個，十三個殺到」.** The parenthetical two paragraphs above it
concedes `M-2b` and §12 corrects the count to twelve, so the narrative is right and only the heading and
the table row are stale. REV-048 and REV-049 both handled this at the narrative level; recorded so the
next reader is not surprised by a table that disagrees with the text on the same page.

**I-3. Neither `reason` field is in the forget set** (REV-049 I-4, unchanged). `form.reason` and
`revealDialog.reason` are user-typed free text that can name a third party or an invoice, and
`forgetEverything()` does not touch either — only the next `open*` does. Not secrets by design. Same
residue class as F-L3's write-dialog finding, and the same answer: bounded, same-user, not a disclosure.

**I-4. `revealDialog.row`, `confirm.row` and `form.editing` retain a previous Supplier's row object**
after `forgetEverything()`. They hold masked projections, not plaintext, and every `open*` replaces them
before the corresponding dialog can be shown again, so nothing stale is reachable. Recorded because it
completes the residue inventory and nobody has stated it.

**I-5. Carried, not addressed, not blocking.** The browser suite's thirty-second assertion is still
`toHaveCount(0)` plus a `page.content()` substring check rather than an occurrence count (REV-044,
restated five times) — though I re-read the spec this round and note it also pins `cache-control:
no-store`, URL abstinence, both real storages, and a *falling* countdown rather than merely a present
one, which is stronger than the carried note suggests. The tab-count asymmetry note for design §7.5
(REV-044 I-1) is still not in the design. REV-048's I-3 (two masked-list fetches and a full subtree
rebuild after every write) is unchanged. `client/e2e/customer-management/` is still in no npm script
(REV-049 I-5); that belongs to `main`. The four BLOCKED DEVELOPER-stage profile suites are unchanged in
this delta and I did not re-verify them. REV-049's I-1 (the `left <= 0` boundary, one extra second at
expiry) and I-2 (`Z4` equivalent) are unchanged and I did not re-run them.

---

## 9. Positive observations

- **Every factual claim in §13 that I could check is true, and this is the first round in which that is
  so.** Four mutation rows, four reproduced kills, each at the assertion named. Three suite results,
  three reproduced. One evidence-shape claim, verified by listing the commit. After three consecutive
  rounds in which the record overstated what had been verified, this one does not — and the one place it
  reaches too far (F-L1) reaches for a conclusion, not for a result.
- **The shell trap is disclosed rather than buried.** §13 ends by recording that `cmd | tail; echo $?`
  reports `tail`'s status and that lint was briefly recorded as clean while it had a `no-unused-vars`
  error — twice in one session. Writing down the near-miss that *would* have produced the next false
  record is worth more than the fix.
- **The evidence-lag shape was actually adopted, not just acknowledged.** Run the gates, then commit docs
  and evidence on top. REV-048 named it, REV-049 asked for it, and this round is the first where the head
  above `baseline.code_commit` contains no code.
- **The retraction is in the ledger as an append, which is the right thing for an append-only record.**
  The REV-048 entry stands as what was believed then; the REV-049 entry says plainly that it was wrong
  and why. An in-place edit would have destroyed the more useful artefact.
- **The two step-up passwords went from unasserted to killed in one round**, including writing a
  reveal-dialog test that did not exist, and both die at their own named assertion rather than
  incidentally.
- **The new assertions are stronger than their author claims** — they pin synchronous clearing inside
  `forgetEverything()`, not merely eventual clearing. That is the correct property for a control that has
  to hold on a session expiry where nothing unmounts. See F-L2; the only thing missing is saying so.
- **No defect in the Bank UI for the fourth consecutive round**, and this round I went looking in three
  places nobody had — the spy's specificity, the `@hide` transition timing, and the permission-refresh
  path — and found no disclosure in any of them.

---

## 10. Not covered by this review

- **The server side of the Bank capability.** Unchanged by this branch; REV-039…REV-043 covered it, and
  CI ran the server suite green at this head. I did not read it this round.
- **The two unmerged `origin/main` commits.** I read their diff (`client/vite.config.js` only) and
  confirmed no overlap with this branch, but I did not run this branch's suites against a merged tree.
  **PLAUSIBLE** that the merge is clean and the gates stay green; F-L4 asks for it to be executed rather
  than assumed.
- **The harness source fingerprint and the DESIGN/PLAN digests.** Read from the state file, not
  recomputed — as in the six previous rounds.
- **Repeated browser runs under load.** One clean local run plus the CI run; I did not stress for flake,
  and I did not re-pull the CI browser job's log (REV-049 did, at the previous head).
- **The four BLOCKED profile suites.** Unchanged in this delta; not re-verified.
- **A real suspended machine, a real mobile background, a real NTP step.** The clock results remain a
  fake-timer model. **PLAUSIBLE** that the monotonic-clock reasoning holds on real hardware.
- **F-L3's fix.** I measured the gap and did not implement or test a watcher for it; the shape I suggest
  is **PLAUSIBLE** only. The prior question — whether permission revocation should retract already-rendered
  data application-wide — is a module- or framework-level decision I did not make.
- **`wrapper.vm` durability.** REV-049 flagged that a future Vue or build-config change could require
  `defineExpose` to keep setup state reachable. Four tests now depend on it. It works today on every case
  I ran; I did not test it against a different Vue version, and no comment yet records the dependency.

---

## 11. Residual risk I am accepting

Stated plainly, because an APPROVED after six CHANGES_REQUESTED owes it.

1. **The single-timer invariant is pinned by a weaker assertion than the one available** (F-L1). A
   refactor that clears the wrong handle, or clears nothing while calling `clearInterval` on something
   else, passes 636/636. The behavioural probe that catches it is written and run in §2.3 and costs four
   lines; I am accepting its absence because the production line is present, correct, and measured
   correct at HEAD, and because revealing a second row is a rare path whose worst outcome is plaintext
   disappearing *early*.
2. **A comment that undersells the control it guards** (F-L2). The risk is a future maintainer deleting
   a statement on the strength of "any two suffice". CI now catches two of the three such deletions, so
   the failure mode is a red build and not a leak.
3. **Permission revocation does not retract rendered plaintext** (F-L3). Bounded at thirty seconds,
   same user, same screen, no escalation. I am accepting it because it is a framework-level property that
   no page in this application has, and because holding this task to a standard nothing else meets would
   be manufacturing a finding.
4. **The branch is two commits behind its target** (F-L4). Accepting this as a merge-time action rather
   than a code change, on the measured basis that the delta is one dev-server config file this branch
   does not touch and carries no CI change.
5. **Everything in §10** — in particular that I verified the merged tree only by reading the incoming
   diff, and that the clock behaviour remains a fake-timer model.

What I am **not** accepting as unknown: there is no defect in the Bank UI. Nine rounds plus this one have
attacked the disclosure surface from every direction anyone has proposed, and the last four found
nothing in the product code. The two probes I ran this round that no round had run — the `@hide`
transition timing and the permission-refresh path — both came back with the production behaviour intact.

---

## 12. Verdict

**APPROVED.** 0 Critical, 0 High, 0 Medium, 4 Low, 5 Info.

All five REV-049 items are done and each was verified by execution. The four mutants the record claims
to kill are killed, at the assertions named. The suites, the lint exit status, the CI run, the PR state
and the evidence shape all check out against the code rather than against the record. Three of the four
Lows are record-and-coverage quality on controls that are correct in production; the fourth is a merge
step that is the standing process for any PR.

**The one thing to do before pressing merge**, which is process and not a change to this PR's content:
merge `origin/main` (`1ba8fb6`, two commits, `client/vite.config.js` only), let CI re-run on the merge
commit, and refresh `baseline.default_commit` to match. `mergeStateStatus: CLEAN` means no conflicts, not
up to date.

**The four Lows are follow-ups, not blockers.** F-L1 and F-L2 are roughly seven lines across two files
and both have a runnable probe in this document; they would be well spent in whatever round closes
TASK-035's record. F-L3 should be raised at module level before it is raised at panel level. F-L4 is one
command.

Six rounds of real findings did not obligate a seventh, and I did not write one. The record is accurate,
the code is clean, the gates are green on the real head, and what is left is the difference between a
control that is protected against the next refactor and one that is protected against this one.
