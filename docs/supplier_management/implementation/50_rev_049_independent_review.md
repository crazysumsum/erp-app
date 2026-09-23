# REV-049 — TASK-035 Bank UI independent review (REV-048 remediation)

**Review:** REV-049 ・**Task:** TASK-035 (T35) ・**Phase:** PHASE-003 ・**Capability:** SUP-CAP-03
**Head reviewed:** `85611a23bd50b06bacb37c1427effc01d31a9171` (`claude/supplier-task-035`, PR #125).
**Previous review head:** `6f424f916010861382d5342063a2b8d273161c3c`.
**Remediation diff:** `6f424f9..HEAD` (REV-048 remediation plus a 24-commit merge of `origin/main`).
**Subject:** `origin/main…HEAD`. `git merge-base origin/main HEAD` is now `38e1542e…`, which **is**
`origin/main` — the branch is zero behind, ten ahead, and the subject diff is supplier-only for the
first time in three rounds.
**Worktree:** `/Users/sam/Documents/workspace/erp-app-worktrees/supplier-task-035`
**Reviewer:** independent agent (`agent-skills:security-auditor`); not the author. Author is Claude Opus 5.

**Verdict: CHANGES_REQUESTED** — 0 Critical, **0 High**, 1 Medium, 3 Low, 6 Info.

**REV-048's blocking Medium is fully and verifiably closed, and better than it asked for.** The merge
is in, all **five** checks ran green on the real head, and the fifth one — `Browser tests
(Playwright)` on `ubuntu-latest` — executed this task's own `supplier-bank.spec.js`. REV-048 could
only mark Linux **PLAUSIBLE**; the CI log now names each of the three bank tests by line number and
ends `23 passed (59.8s)`. That question is answered with evidence, not inference.

**What keeps this from APPROVED is not the code either, and for the eighth round running there is no
defect in the Bank UI.** It is that REV-048's item 2 was closed with an assertion that cannot fail
for the reason its own comment gives, and that the comment gives a reason the code contradicts — in
the same commit whose message states the correct reason. And while measuring that, I found the same
DOM-only pinning covering **two more secret fields nobody has named in nine rounds**: the reveal
dialog's and the confirm dialog's typed step-up passwords.

Everything below states what I ran. Anything reasoned about but not executed is marked **PLAUSIBLE**.
Twenty-one mutations were applied this round, each alone, each reverted immediately, with
`git status --porcelain` asserted empty before the next one (the loop asserts it and aborts
otherwise). Four probe files were written and deleted. `git status --porcelain` was empty before the
review, after every mutation, after every probe, and immediately before this file was written.
`git rev-parse HEAD` is still `85611a2…`. Nothing committed, nothing staged, no branch moved.

---

## Summary

| | |
| --- | --- |
| Critical | 0 |
| High | 0 |
| **Medium** | **1** — REV-048 item 2 is recorded as resolved and is not: the added assertion is satisfied by `openCreate()`, the comment justifying it states the opposite of what `openCreate()` does, and the ledger's "the property is pinned, the mechanism is not" is refuted by measurement |
| **Low** | **3** — the same DOM-only pinning leaves both step-up passwords unasserted at state level (new); `holdPlaintext`'s leading `forgetPlaintext()` is unasserted and the two-sequential-reveals path has no test at all (new); the evidence lag REV-048 declared closed has reopened |
| Info | 6 |

**Suites at this head, run by me.**

| Suite | Result |
| --- | --- |
| `npx vitest run --root client` | **634/634, 82 files** — at the start, after every revert, and again before writing this |
| `npm run e2e:supplier-management` (the script CI now runs) | **23/23, 49.4s** |
| `npm run lint` | exit 0 |
| CI run `35706518907` at `85611a2` | **five checks, all `success`, attempt 1, single run** |

---

## 1. REV-048's four-item list, checked

### 1.1 Item 1 — merge the target and let all five checks run. **DONE, and it closes the Linux question.**

Verified on nine fields, not read from the record:

- `git fetch origin` → `origin/main` is `38e1542eed8ac6fe98ce307868390b6e98181788`. **It has not moved
  again.** `git merge-base origin/main HEAD` is the same sha, so the target is fully merged, not
  merely recorded. `git rev-list --left-right --count origin/main...HEAD` → `0  10`.
- `baseline.default_commit` is `38e1542e…` — the merge base, the current target, and the sha CI ran
  against as a base. Consistent for the first time in four rounds. `revision` is **213** as stated.
- `gh run view 35706518907`: `headSha` `85611a23bd50b06bacb37c1427effc01d31a9171` — the actual head,
  not the merge commit below it — `conclusion: success`, `status: completed`, `event: pull_request`,
  **`attempt: 1`**, workflow `CI`. `gh run list --commit 85611a2…` returns exactly that one run.
- **Five jobs, all `success`:** Build frontend, Dependency audit, Lint, Test (server + client, MySQL
  integration), **Browser tests (Playwright)**.
- PR #125: `OPEN`, `MERGEABLE`, `mergeStateStatus: CLEAN`, `isDraft: false`, base `main`,
  `headRefOid` equal to the reviewed head, and the check rollup lists all five by name.

**And the part REV-048 could not check.** I pulled the browser job's log. It is `ubuntu-latest`,
`npx playwright install --with-deps chromium`, `npm run e2e:mocked`, and the log enumerates this
branch's own spec:

```
[9/23]  supplier-bank.spec.js:98   @technical the masked list never fetches plaintext by itself
[10/23] supplier-bank.spec.js:108  @technical a revealed account lives only in the DOM, and only for thirty seconds
[11/23] supplier-bank.spec.js:148  @technical leaving the page clears the account immediately
...
23 passed (59.8s)
```

So the `os.tmpdir()` config change does what its comment claims, the thirty-second test survives a
slower Linux runner, and the new gate passes on the code it was introduced alongside. REV-048 said
"if the new job fails on Linux, that failure belongs to this PR." It does not fail. **HELD, measured
in the environment that matters rather than on macOS.**

I also re-ran the suite locally (23/23, 49.4s) and reproduced 634/634 and lint-clean myself.

### 1.2 Item 3 — the `bank.test.js` guard comment. **DONE and correct; I reproduced the measurement.**

I did not take REV-048's ordering on trust either. I wrapped `vue-router`'s `onBeforeRouteUpdate` and
`onBeforeRouteLeave` to log the registering component, drove the **real** `SupplierDetailPage` through
a real router on the real route record with plaintext revealed and a countdown running, and pushed
`/suppliers/7` → `/suppliers/8`:

```
ORDER: ["list:7","--push8--","update:SupplierDetailPage","update:SupplierBankPanel","list:8"]
plaintext after: false
panel guard fired: 1 times
```

Identical to REV-048's independent measurement, and to the author's. The corrected comment now says
the guard fires first, before the route is confirmed and therefore before the page's teardown, that
the unmount is the redundant second layer, and that `framework/routing/router.js` has one global
`beforeEach` and no `beforeResolve` so nothing can cancel the navigation after the panel has cleared.
**Every clause of that matches what I measured.** The comment also now carries the measured ordering
inline, so the next reader does not have to re-derive it. This is the right fix, done the right way.

### 1.3 Item 4 — the two carried one-liners. **Both done.**

- `let revealGeneration = 0;` is now at `:54`, above `forgetPlaintext()` at `:70`, with a comment
  naming the TDZ hazard and the three rounds that asked for it. Read and confirmed.
- `bank.test.js:179` comment now names `advanceTimersByTime(1000)` and explains the 1000 ms period.
  Matches the code at `:182`.

### 1.4 Item 2 — `forgetFormSecrets` at its own mechanism. **NOT done.** See F-M1.

---

## 2. F-M1 (Medium) — the assertion added for REV-048 F-L1 cannot fail for the reason it names, and the comment that justifies it says the opposite of what the code does

**Location:** `client/test/pages/suppliers/bank.test.js:334-342`;
`client/src/components/suppliers/SupplierBankPanel.vue:248-254` (`openCreate`), `:84-92` (the new
comment on `forgetEverything`); `44_task_035_bank_ui.md` §12; `00_harness_state.json` the REV-048
`MANUAL_TEST` ledger entry.

### 2.1 What was shipped

The remediation added this to `wipes a half-typed write dialog on a Supplier change and on session
expiry`:

```js
// REV-048 F-L1：淨係睇 DOM 唔夠 —— 閂咗個 dialog 就會令佢成立，所以拆走
// `forgetFormSecrets()` 個 call 都照綠。要斷言嘅係 component 自己嗰份 state
// 冇咗啲祕密：重開個 dialog（`openCreate()` 唔會清，佢淨係設 open）再睇欄位。
await byText(body, "新增銀行帳戶").trigger("click");
expect(field(body, "帳號").find("input").element.value,
  "the account number must be gone from form state, not merely unrendered").toBe("");
expect(field(body, "密碼").find("input").element.value).toBe("");
```

### 2.2 `openCreate()` does clear, and the same commit says so twice in both directions

`SupplierBankPanel.vue:248`:

```js
function openCreate() {
  Object.assign(form, {
    open: true, editing: null, busy: false, error: "", warnings: [],
    ... accountNumber: "", isDefault: false, reason: "", password: ""
  });
}
```

It unconditionally resets both fields. So the two new `expect(...).toBe("")` calls are satisfied by
the act of reopening the dialog, whatever happened on the Supplier change. The comment's
parenthetical — *「`openCreate()` 唔會清，佢淨係設 open」* — is false.

It is false against the author's own record, three times over, in the same commit:

- the commit message: *「我第一次嘅修法「重開 dialog 再睇欄位」一樣分辨唔到，因為 `openCreate` 自己會重設」*
- `44_task_035_bank_ui.md` §12: *「一樣分辨唔到，因為 `openCreate()` 自己就會重設」*
- the new comment on `forgetEverything` at `SupplierBankPanel.vue:86`: *「同埋 `openCreate()` 每次開嗰陣重設」*

Three statements say `openCreate` resets. The fourth, standing next to the assertion that depends on
it, says it does not — and that fourth one is the one a maintainer reads when deciding whether the
assertion still matters.

### 2.3 Measured: the assertion does not discriminate

Full suite each time, mutant applied alone, reverted, porcelain asserted empty.

| Mutant | Result |
| --- | --- |
| drop `forgetFormSecrets();` from `forgetEverything()` **and** `@hide="forgetFormSecrets"` | **SURVIVED 634/634** |
| drop `openCreate()`'s `accountNumber`/`password` reset only | SURVIVED 634/634 |
| drop all three | KILLED — 1 failed, **at the new assertion** |

The first row is the one that matters. Those are the **two path-covering mechanisms** — the only two
that run on a Supplier change or a session expiry. With both gone, the suite is still completely
green, including the assertion added to catch exactly this.

The third row shows where the new assertion's discriminating power actually comes from: it is killed
only when `openCreate()` stops resetting. The assertion's message says *"the account number must be
gone from form state, not merely unrendered."* What it measures is that `openCreate()` resets the
form. Those are different properties, and the mechanism named in the message is not the one being
pinned.

### 2.4 The state-level assertion the record says is impossible

§12 and the ledger both record that the author tried this and it could not discriminate. The reason
it could not is the choice to read the value back **through the DOM after reopening the dialog**. Read
it from the component instead and it discriminates exactly. Six lines, in the harness that already
exists:

```js
const panel = wrapper.findComponent(SupplierBankPanel);
// ... type the secrets, then push /suppliers/8 (or clear the session)
expect(panel.vm.form.accountNumber).toBe("");
expect(panel.vm.form.password).toBe("");
```

I wrote that as a throwaway probe and ran it both ways:

```
at HEAD                                    → 2 passed
drop the call + @hide (suite still 634/634) → 2 failed
   AssertionError: STATE level after session expiry:  expected '12345678901234' to be ''
   AssertionError: STATE level after Supplier change: expected '12345678901234' to be ''
```

**That is the negative control the round needed and it discriminates cleanly.** `wrapper.vm` on a
`<script setup>` component exposes the reactive `form`; nothing exotic is required. The probe was
deleted; porcelain empty.

### 2.5 Why this is Medium and not Low

The production code is correct. `forgetFormSecrets()` is called, the `@hide` is bound, nothing leaks
today, and I am recording no disclosure. What is wrong is the record and the artefact:

- REV-048's item 2 is listed as done and is not. A reviewer or maintainer reading §12 will believe
  the control is asserted at its own mechanism. It is not, and I measured that removing both real
  mechanisms leaves the suite green while an account number and a step-up password stay live in a
  mounted component's memory after the session has expired.
- The ledger entry (`00_harness_state.json`, REV-048 `MANUAL_TEST`) states *"the property is pinned
  and the mechanism is not."* The property — "on a Supplier change and on session expiry the form
  loses the secrets" — is **not** pinned. §2.3 row 1 is the counter-example. The mechanical claim
  underneath it ("any two of the three suffice") happens to be true, because removing any one leaves
  at least one of the two path-covering mechanisms standing; but that arithmetic does not make the
  property pinned, and the ledger draws exactly that conclusion from it.
- The comment is the fifth unexecuted mechanism statement written as fact in this task, and §12
  itself counts the fourth. It is in a comment whose only job is to justify an assertion, which makes
  it the worst place for it.

**Fix.** Three things, all small. Replace the two DOM reads with the two `panel.vm.form.*` assertions
above (the probe is reproduced in §2.4 and kills the mutant that survives today). Delete the false
parenthetical about `openCreate()` and say instead that the DOM cannot distinguish "forgotten" from
"unrendered", which is why the assertion reads component state. Correct §12 and the ledger sentence
from "the property is pinned" to what is actually true: the property is not pinned by the suite, the
three mechanisms are individually equivalent mutants, and the state-level assertion is what pins it.

---

## 3. F-L1 (Low) — the same DOM-only pinning leaves **both step-up passwords** unasserted at state level

**Location:** `SupplierBankPanel.vue:98-101` (`forgetEverything`), `:404` and `:481` (the reveal and
confirm dialogs' `@hide` handlers).

All three secret-bearing dialogs have the identical three-mechanism shape: a statement in
`forgetEverything()`, an `@hide` on the `q-dialog`, and a full reset in the `open*` function. Nine
rounds have examined that shape only for the write form. I ran the other two.

| Mutant (applied alone, full suite) | Result |
| --- | --- |
| **Z16** — drop `@hide="revealDialog.password = ''"` **and** `revealDialog.password = "";` from `forgetEverything()` | **SURVIVED 634/634** |
| **Z17** — drop `@hide="confirm.password = ''"` **and** `confirm.password = "";` from `forgetEverything()` | **SURVIVED 634/634** |

Both are the reveal/confirm analogue of the form case, and neither has ever been raised. REV-046's
`X5` killed a mutant that dropped `confirm.open` **and** `confirm.password` together — the dialog
then stays open and the password renders, so `document.body.innerHTML` catches it. Drop the password
statement while leaving `confirm.open = false` and the dialog closes, the DOM is clean, and the
assertion is satisfied while the password is still in memory.

**Measured, not inferred.** A state-level probe against the reveal dialog, at HEAD and under Z16:

```
at HEAD  → 2 passed
under Z16 (suite 634/634 green)
  AssertionError: STATE level after Supplier change:  expected 'Correct-Horse-1!' to be ''
  AssertionError: STATE level after session expiry:   expected 'Correct-Horse-1!' to be ''
```

**Impact.** No disclosure today; the production statements are present and correct, and I verified
the probe passes at HEAD. What is absent is any assertion distinguishing "the password left the
component" from "the dialog stopped rendering it." On a **session expiry the panel is not unmounted**,
so for these two fields that distinction is the entire control — and the field in question is the
user's own account password, typed for a step-up.

**Fix.** The same two lines each, in the two tests that already exist
(`wipes the confirm dialog's password…`, and a reveal-dialog equivalent that does not yet exist):
assert `panel.vm.revealDialog.password` and `panel.vm.confirm.password` are `""`, not only that the
body's HTML no longer contains them.

---

## 4. F-L2 (Low) — `holdPlaintext`'s leading `forgetPlaintext()` is unasserted, because revealing a second row is not tested at all

**Location:** `SupplierBankPanel.vue:106-107`.

```js
function holdPlaintext(id, accountNumber) {
  forgetPlaintext();      // ← Z10: drop this line → SURVIVED 634/634
```

That call is the only thing that clears the previous row's `setInterval` before a new one replaces
the `countdown` handle. Revealing a second row while a first is revealed is reachable in the UI —
the 查看完整帳號 button is rendered on every row whose id is not the revealed one — and **no test in
the suite ever does it.**

**Measured consequence, with a probe, under fake timers:** reveal Alpha, advance 5 s, reveal Beta,
advance 26 s (so 31 s since Alpha, 26 s since Beta).

```
at HEAD    → t=31s from A, 26s from B:  B visible = true    (probe passes)
under Z10  → t=31s from A, 26s from B:  B visible = false   (probe fails)
```

Alpha's orphaned interval survives its replacement, reaches its own deadline, and calls
`forgetPlaintext()` — cutting Beta's thirty seconds down to twenty-five and bumping
`revealGeneration`. Worse, `forgetPlaintext()` clears only the *current* `countdown` handle, so the
orphan is never cleared at all: it keeps firing once a second for the life of the component, wiping
any later reveal within a second of it being shown.

**Impact.** None in production — the line is there and I measured HEAD behaving correctly. This is a
coverage note on an interaction path that six rounds of review and two suites have never exercised,
protecting a security control (the single-timer invariant) that a refactor could remove silently.

**Fix.** One test: reveal row A, reveal row B, assert A's plaintext is gone and B's survives its own
full thirty seconds. The probe above is that test; it kills Z10 and passes at HEAD.

---

## 5. F-L3 (Low) — the evidence lag REV-048 declared closed has reopened

**Location:** `docs/supplier_management/00_harness_state.json` (`baseline.code_commit`).

`baseline.code_commit` is `61c9079d…`, the merge commit. The head is `85611a2`, one commit above it,
and that commit is **not docs-only**:

```
client/src/components/suppliers/SupplierBankPanel.vue
client/test/pages/suppliers/bank.test.js
docs/…
```

So the four registered `DEVELOPER` evidence records (`tests="99" failures="0"`, server 395 cases,
lint and build, all `PASS`/`exit_code: 0`) were captured against a tree that does not contain the
`revealGeneration` move, the three new comments, or the new test assertions. REV-048's standard for
calling this closed was precisely *"the head touches only `docs/` above the commit the evidence was
run at"*, which was true at `6f424f9` and is not true here.

**Why it is Low and not more.** The external gate does not lag: CI run `35706518907` ran all five
checks at `85611a2` itself, and I re-ran the unit suite, the browser suite and lint at `85611a2` by
hand. The substance is covered; the harness's own ledger is one commit behind it. Last round showed
the shape that avoids this — run the evidence, then commit docs only on top.

---

## 6. The mutation table

Twenty-one mutations, each applied alone at this head, full `npx vitest run --root client` each time,
reverted immediately, porcelain asserted empty before the next.

| # | Mutant | Result |
| --- | --- | --- |
| 1 | drop `forgetFormSecrets();` call **+** `@hide="forgetFormSecrets"` | **SURVIVED 634/634** ← F-M1 |
| 2 | drop `openCreate()`'s `accountNumber`/`password` reset only | SURVIVED 634/634 |
| 3 | drop all three form-secret mechanisms | KILLED (1), at the new assertion — see §2.3 |
| 4 | re-run of 3, to identify the failing assertion | KILLED at `the account number must be gone from form state` |
| 5 | `Z1` — countdown boundary `left <= 0` → `left < 0` | SURVIVED 634/634 (I-1) |
| 6 | `Z2` — `REVEAL_SECONDS` 30 → 300 | KILLED (4) |
| 7 | `Z3` — row guard `revealed.id === row.id` → `true` | KILLED (4) |
| 8 | `Z4` — drop the `v-else` on the masked label | SURVIVED 634/634 (I-2) |
| 9 | `Z5` — `create` `signed: true` → `false` | KILLED (1) |
| 10 | `Z6` — `update` `signed: true` → `false` | KILLED (1) |
| 11 | `Z7` — `deactivate` `signed: true` → `false` | KILLED (1) |
| 12 | `Z8` — `reveal` → `signed: true` | KILLED (1) |
| 13 | `Z9` — `list()` sends a query param | KILLED (1) |
| 14 | `Z10` — drop `forgetPlaintext()` from `holdPlaintext()`'s head | **SURVIVED 634/634** ← F-L2 |
| 15 | `Z11` — drop `revealDialog.password = "";` from `forgetEverything()` | SURVIVED 634/634 |
| 16 | `Z12` — drop `form.open = false;` from `forgetEverything()` | SURVIVED 634/634 (I-3) |
| 17 | `Z13` — drop the `forgetPlaintext()` call from `forgetEverything()` | KILLED (4) |
| 18 | `Z14` — drop `revealDialog.open = false;` | SURVIVED 634/634 (I-3) |
| 19 | `Z15` — drop `confirm.open = false;` | SURVIVED 634/634 (I-3) |
| 20 | **`Z16`** — reveal dialog: drop `@hide` **+** `revealDialog.password = ""` | **SURVIVED 634/634** ← F-L1 |
| 21 | **`Z17`** — confirm dialog: drop `@hide` **+** `confirm.password = ""` | **SURVIVED 634/634** ← F-L1 |

Rows 9–13 are the result I would lead with if the verdict were only about the code. **Every
auth-strength and transport decision in the service layer is individually pinned**, by one test that
names all five at once (`signs the four writes with the device and does not sign reveal`) and one
that pins URL abstinence (`reads the masked list without asking for plaintext`). Flipping any single
`signed` flag in either direction turns the suite red. That is not common, and nobody had mutated it
before.

---

## 7. What I attacked and what HELD

Executed, not reasoned about. I did not re-run what six rounds confirmed — storage/URL/Pinia/toast,
dialog close paths, bfcache, tab switching, the service layer's shape, per-row permission gating, the
generation counter against six attacks and four async paths, the four-way navigation seam, or the
guard ordering except to reproduce it once. This is where I went instead.

| Probe | Attack | Result |
| --- | --- | --- |
| **The device signer** (nobody has looked at this) | The write body carries the plaintext account number and the step-up password, and `HttpClient` hands it to `signRequest`. Does the signer retain or transmit it? | **HELD.** `deviceKey.js:209` computes `sha256Base64url(body)` and puts only the digest in the signing input; the emitted headers are `X-Device-Id`, `-Timestamp`, `-Nonce`, `-Signature`. The access token is hashed too, for the stated reason that signing inputs reach logs. No plaintext leaves the function |
| **The merged `buildUrl` change** | `origin/main` changed param handling under this branch's transport | **HELD.** The change only adds `searchParams.append` for array values; the cross-origin guard at `:238` is untouched. All six `supplierBank` methods pass no params, and `Z9` proves that is pinned — adding one turns the suite red |
| **Auth strength per route** | Can any write silently drop the device signature, or `reveal` silently acquire one? | **HELD** — `Z5`–`Z8`, all four killed, in both directions |
| **Plaintext in the URL** | Can `list()` be made to carry a query param? | **HELD** — `Z9` killed |
| **Per-row plaintext binding** | Can the revealed value bleed onto other rows? | **HELD** — `Z3` killed on four assertions |
| **Reveal duration** | Is the thirty seconds pinned, or only the mechanism? | **HELD** — `Z2` (30 → 300) killed on four assertions. The exact boundary is not pinned; see I-1 |
| **Two sequential reveals** (nobody has looked at this) | Does revealing a second row orphan the first row's interval? | **Behaviour HELD at HEAD** (probe passes; B keeps its full thirty seconds) — **but nothing asserts it.** See F-L2 |
| **The reveal dialog's step-up password** (nobody has looked at this) | Does it leave component state on a Supplier change and on session expiry? | **Behaviour HELD at HEAD** (probe passes) — **but nothing asserts it.** See F-L1 |
| **The confirm dialog's step-up password** | Same question, one level deeper than `X5` | **Behaviour HELD; `Z17` survives.** See F-L1 |
| **Guard ordering on the real page** | Reproduce REV-048's measurement independently rather than read it | **HELD** — identical log, guard fires once, before the teardown |
| **The new CI browser gate on Linux** | Does this branch's own spec pass in the job that now blocks its PR? | **HELD** — three bank tests named in the log, `23 passed (59.8s)` on `ubuntu-latest` |

---

## 8. Info

**I-1. The countdown boundary is still unpinned, now measured.** `Z1` (`left <= 0` → `left < 0`)
survives 634/634. The consequence is one extra second of plaintext at expiry. REV-047 I-3 raised this
and REV-048 did not re-run it; it is recorded here as measured rather than carried. Not worth a test
on its own.

**I-2. `Z4` is an equivalent mutant for security purposes.** Removing the `v-else` on the masked
label renders the masked and revealed values side by side. Cosmetic; no disclosure. Recorded so the
next round does not spend a run on it.

**I-3. Three more individually-unasserted statements in `forgetEverything()`.** `Z12`
(`form.open = false`), `Z14` (`revealDialog.open = false`) and `Z15` (`confirm.open = false`) each
survive alone, because the corresponding secret statement has already emptied the field so nothing
renders. The residual hazard is not disclosure but **cross-entity**: with `Z12` the write dialog for
supplier 7 stays open over supplier 8's page, still holding the typed holder name, bank name and
reason, and `writeBody()` posts against `props.supplierId`, which is now 8. Of the seven statements
in `forgetEverything()`, only `forgetPlaintext()` (`Z13`, killed on four assertions) is pinned alone.
I am not asking for six more tests; one state-level assertion per dialog (F-M1, F-L1) plus one
"the write dialog is closed after a Supplier change" would cover the class.

**I-4. The reason fields are not in the forget set.** `form.reason` and `revealDialog.reason` are
user-typed free text that can name a third party or an invoice, and neither is cleared by
`forgetEverything()` — only by the next `open*`. Not secrets by design, and I am not calling it a
finding; recorded because it is the same residue class and nobody has stated it.

**I-5. `client/e2e/customer-management/` is not in any npm script.** The merge brought a
`playwright.config.js` and a `customer-root.spec.js` for customer-management, but `e2e:mocked` is
`e2e:business-master && e2e:supplier-management`, so the new CI job does not run it. That belongs to
`main` and to the customer module, not to this PR. Flagged only so it is not lost.

**I-6. Carried, not addressed, not blocking.** The browser suite's thirty-second assertion is still
`toHaveCount(0)` plus a `page.content()` substring check rather than an occurrence count (REV-044,
restated four times). The tab-count asymmetry note for design §7.5 (REV-044 I-1) is still not in the
design. REV-048's I-3 (two masked-list fetches and a full subtree rebuild after every write) is
unchanged and not recorded in §12. The four BLOCKED DEVELOPER-stage profile suites are unchanged in
this delta and I did not re-verify them.

---

## 9. Positive observations

- **Item 1 was not merely done, it was done in the direction that produced evidence.** The merge
  landed, CI ran all five checks at the real head, and the branch's own browser spec passed on Linux
  in the job that now gates it. The single biggest unknown in this task's record — "does this suite
  survive outside macOS" — is closed with a log, not an argument.
- **The guard comment is now the best comment in the file.** It states the measured ordering, names
  the global-guard fact that makes the ordering safe, and explains why the test host differs from the
  application. A future reader has no reason to delete the guard and no need to re-derive anything.
- **The author overturned his own record against himself, twice, after re-running it.** §12 corrects
  "thirteen killed" to twelve and withdraws an explicit override of REV-047, and corrects a comment
  he wrote to the opposite of what he had claimed. Both corrections were verified before being
  accepted rather than taken on the reviewer's word. That is the right procedure, and it is the
  reason the residue this round is as small as it is.
- **The two silently-skipped one-liners were finally done, and recorded as having been skipped
  twice.** Not quietly closed — named, with the rounds that asked.
- **The service layer is mutation-tight in exactly the places that matter.** Five `signed` decisions
  and the URL-abstinence rule are each individually pinned. I went looking for a hole there and did
  not find one.
- **The device signer never sees plaintext leave.** Body hashing, token hashing, and the stated
  reason for both (signing inputs reach logs) are correct and were correct before anyone asked.

---

## 10. Not covered by this review

- **The server side of the Bank capability.** Unchanged by this branch; REV-039…REV-043 covered it,
  and CI ran the server suite green at this head. I read `deviceKey.signRequest` and `buildUrl` only.
- **The 24 merged commits**, beyond `HttpClient.js`, `ci.yml`, `menu.js` and the two Playwright
  configs. The customer-management work I did not review at all; it is out of `origin/main…HEAD`.
- **The harness source fingerprint and the DESIGN/PLAN digests.** Read from the state file, not
  recomputed — as in the five previous rounds.
- **Repeated browser runs under load.** One clean local run plus the CI run; I did not stress for
  flake.
- **The four BLOCKED profile suites.** Unchanged in this delta; not re-verified.
- **A real suspended machine, a real mobile background, a real NTP step.** The clock results remain a
  fake-timer model. **PLAUSIBLE** that the monotonic-clock reasoning holds on real hardware.
- **Whether `wrapper.vm.form` stays reachable** if the component is later compiled with
  `defineExpose` semantics that hide setup state. It works today on every case I ran; a future Vue or
  build-config change could require `defineExpose`. Worth one line of comment if the fix in §2.4 is
  taken.

---

## 11. What it takes to turn this into APPROVED

1. **Replace the two DOM reads in `bank.test.js` with the two `panel.vm.form.*` assertions** (F-M1).
   The exact probe is in §2.4; it survives at HEAD and kills the mutant that is green today. Delete
   the false parenthetical about `openCreate()` and say what is true: the DOM cannot distinguish
   forgotten from unrendered.
2. **Correct §12 and the REV-048 ledger entry** (F-M1). "The property is pinned and the mechanism is
   not" is measurably false — §2.3 row 1. Say instead that the three mechanisms are individually
   equivalent mutants and that the state-level assertion is what pins the property.
3. **Two lines each for the two step-up passwords** (F-L1), in the confirm test that exists and in a
   reveal-dialog test that does not. `Z16` and `Z17` are green today.
4. **One test for two sequential reveals** (F-L2). The probe in §4 is that test.
5. **Re-run the evidence at the final head, or commit docs only above it** (F-L3).

Items 1–4 are roughly a dozen lines across two files that are already open, and every one of them has
a runnable probe in this document that fails against the current code's mutants and passes against
the current code. Item 5 is bookkeeping.

**Said plainly, because it should be.** There is no defect in the Bank UI, and there has not been one
for three rounds. The merge is in, the target has not moved, all five CI checks are green at the real
head, the new Linux browser gate passes on this branch's own spec, and the two things REV-048 asked
for in code — the guard comment and the two one-liners — are done correctly and I reproduced the
measurement behind the first one rather than reading it. What blocks is one assertion that cannot
fail, one comment that contradicts the code and the commit message that ships with it, and a ledger
sentence claiming a coverage property I measured to be absent — plus the same absence on two more
secret fields that this is the first round to name. None of that risks a disclosure today. All of it
is the difference between a control that is protected against the next refactor and one that only
looks protected, which is the distinction this task's entire review history has been about.
