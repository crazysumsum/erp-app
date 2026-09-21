# REV-032 — TASK-031 independent review (PHASE-002 SUP-CAP-02 acceptance exit)

**Review:** REV-032 · **Task:** TASK-031 · **Phase:** PHASE-002 · **Capability:** SUP-CAP-02
**Branch:** `codex/supplier-task-031` · **Head reviewed:** `8953514569af7be0ab13b2c5fe970b1b5498d820`
**Base:** main `860183a` · **PR:** https://github.com/crazysumsum/erp-app/pull/115
**Plan baseline:** `a0d41e31…` · **Design baseline:** `e4083319…`
**Reviewer:** independent; not the author of `28_task_031_phase_002_exit.md`.

**Verdict: APPROVED** — with four M findings, none of which blocks the merge of this
branch's *code*. Two of the four are ledger accuracy, not test quality, and one of those
(M-1) should be fixed before this is called DONE because it makes a closed defect look open
and then drops it from the field a resuming agent reads.

---

## 0. What I actually ran

Everything below was executed against the worktree at `8953514`, against the real
`erp_dev@127.0.0.1:3306`. Every mutation was applied alone, reverted in a `finally`, and
`git status --porcelain` was asserted empty between mutations by the runner itself — the
runner aborts if the tree is dirty. The tree was clean at the start and is clean now. All
scratch files live in the session scratchpad; nothing was written into the repo except this
document.

| What | Result |
| --- | --- |
| `supplierApproval` + `supplierSettings` integration, as shipped | 25/25 PASS |
| Full `supplier-phase-001-server` argv from `00_project_profile.json`, ×3 | 314/314 PASS, 0 skipped, no flake |
| `npm test --workspace client -- test/pages/suppliers test/services/supplier.test.js` | 71/71 PASS |
| `npm run lint` | PASS |
| `npx playwright test --config client/e2e/supplier-management/playwright.config.js` | 17 passed (13.8s) |
| Author's 12 mutations, re-run independently | **12/12 RED**, same tests red as claimed |
| **6 further mutations I invented** | 5 RED, **1 GREEN — see M-3** |
| Instrumented concurrency probe on the double-approve race | genuine overlap, winner alternates |
| DB residue sweep after ~20 runs incl. ~15 deliberately failing ones | 0 rows everywhere |

---

## 1. Findings

### M-1 — DEF-020 is recorded OPEN with no closure evidence, and then dropped from `next_safe_action`

`docs/supplier_management/00_harness_state.json` (defect record `DEF-020`; `next_safe_action`).

The ledger at revision 138 still carries:

```json
{ "id": "DEF-020", "severity": "LOW", "status": "OPEN",
  "source_ids": ["client/src/pages/suppliers/SupplierCreatePage.vue",
                 "client/src/components/suppliers/SupplierApprovalPanel.vue",
                 "REV-031", "TASK-030"],
  "closure_evidence": [], "risk_approval_id": null }
```

`git diff main...HEAD -- docs/supplier_management/00_harness_state.json` touches no defect
record at all. Meanwhile §5 of `28_task_031_phase_002_exit.md` reports DEF-020 as
「順手收埋」, and I confirmed the fix is real and discriminating (see §2, R6b/R7/R7b all RED).

Worse than the stale status: revision 136's `next_safe_action` named DEF-020 explicitly —
"DEF-020, the approver field-error wiring that renders but has no test … worth closing in the
next supplier task rather than letting it age". Revision 138's replacement does not mention
DEF-020 at all. So the defect is simultaneously *recorded as open* and *invisible in the
field that tells a resuming agent what is open. Both halves are wrong in the same direction:
the record no longer matches the code, and nothing points at the mismatch.

**Why it matters.** AC bullet 3 ends 「SUP-CAP-02無P0／P1 defect」. DEF-020 is LOW so it does
not falsify that bullet, but the ledger is the artefact the Phase gate is judged on. A defect
that is fixed, verified, and still reads OPEN will be carried into PHASE-003's carried-forward
list forever, and the next agent has no way to tell it from a genuinely open one.

**Fix.** Either (a) set `DEF-020.status` to the closed state this schema uses and populate
`closure_evidence` with `evidence/20260918T093502-b4be748ad34f/run.json` plus
`client/test/pages/suppliers/create.test.js:201-203`; or (b) if closure is gated on merge,
leave it OPEN and put it back in `next_safe_action` with "fix landed on
codex/supplier-task-031, closes on merge". Silent disappearance is the one option that is not
acceptable.

**Confirmed** — read from the committed JSON at `8953514`; the R6b/R7/R7b mutations run below.

---

### M-2 — `next_safe_action` at revision 138 drops the entire carried-forward risk list

`docs/supplier_management/00_harness_state.json` (`next_safe_action`).

Revision 136's value ended with a long tail that T31 did not resolve and did not touch:

> Carried forward, none introduced here: 0035 and 0036 are also claimed by the unmerged
> codex/customer-management-phase-001 branch, so it must renumber; DEF-016 OPEN; DEF-013 OPEN
> for TASK-038; DEF-004 deferred under APPROVAL-HD-017-RISK; six SCOPE approvals already
> stale; Purchasing pins the Supplier provided contract at 983f351f against the actual
> a9f64493; permission-catalogue drifted in four manifests; DEF-003/004/005/006/007/008/010/012
> remain DEFERRED; DEF-014 and DEF-015 remain open.

Revision 138's value covers T31's own state and DEF-019's expected CI redness, and stops.
Every item above is still true. The migration-numbering collision on `0035`/`0036` in
particular is a merge-ordering hazard against another live branch, and it has now dropped out
of the only field that carries it forward.

**Why it matters.** This is the same class as M-1 but larger: `next_safe_action` is the
resume surface. Nothing else in the ledger aggregates these. Dropping them does not close
them; it just makes the next agent rediscover them, or not.

**Fix.** Re-append the carried-forward paragraph, minus DEF-020 if M-1 is fixed by closing it.

**Confirmed** — both strings read from `git diff main...HEAD`.

---

### M-3 — `updateSettings`'s own `FOR UPDATE` is uncovered; the toggle side of AC bullet 1 is proved only by a hand-written stand-in

`server/test/integration/supplierSettings.integration.test.js:128` (pre-existing) and `:302` (new);
`server/src/modules/supplier/SupplierSettingsService.js:135-137`.

The acceptance bullet is:

> - [ ] Settings toggle與activation並發產生deterministic順序；已Pending不被OFF自動批准。

The second clause is now genuinely covered (M8 RED — see §2). The first clause is covered on
**one side only**. Both lock tests drive the *activation* side through the real
`getActivationPolicy`, but neither drives the *toggle* side through `updateSettings`. Both use a
hand-written `SELECT … FROM supplier_settings WHERE id = 1 FOR UPDATE` in the test body as a
stand-in for the writer (`:141` and `:307`). So `updateSettings`'s own pessimistic lock is
asserted by nothing.

I ran the mutation:

```js
// SupplierSettingsService.js:135 -- updateSettings drops FOR UPDATE on the singleton
-  `SELECT * FROM supplier_settings WHERE id = ${SETTINGS_ROW_ID} FOR UPDATE`
+  `SELECT * FROM supplier_settings WHERE id = ${SETTINGS_ROW_ID}`
```

```
### X5 updateSettings drops FOR UPDATE on supplier_settings
    ℹ pass 25 / ℹ fail 0  => *** GREEN -- MUTATION SURVIVES ***
```

Twenty-five of twenty-five green with the toggle's lock removed.

**Why it matters, and why it is M and not H.** The version guard
(`WHERE id = 1 AND version = ?`) still prevents a lost update, and the `UPDATE` statement
still takes its own X lock, so removing `FOR UPDATE` does not open a correctness hole today —
it removes the *read-side* ordering that makes an in-flight activation win against a settings
write. That is precisely the property the AC bullet names, and precisely what no test sees.
It is also the exact shape this module has been bitten by before: a rule that holds by
accident of a neighbouring mechanism, with the assertion pointed somewhere else.

**Fix.** One of the two lock tests should drive the writer through
`SupplierSettingsService.updateSettings` instead of raw SQL. The pre-existing test at `:128`
is the natural one — its writer is already the "settings write" in the AC's language.

**Confirmed** — mutation and green run shown above.

---

### M-4 — T31's Description requires HTTP verification; nothing in this module issues a real HTTP request against the approval service

`docs/supplier_management/05_development_tasks.md:1163`.

> **Description：** 用真MySQL與**HTTP**／UI flow驗證settings race、雙approver、stale snapshot、
> permission撤銷及audit一致性，作為SUP-CAP-02獨立驗收出口。

The nine new tests are service-level against real MySQL. I checked what the other two layers
actually do:

- `server/test/supplierApprovalHandlers.test.js` — 15 tests, all **declarative**: the route
  table matches design 6.4, every decision route demands `supplier.view` AND
  `supplier.approval`, every request schema is closed, approve/reject/reassign re-confirm the
  password, the queue pages server-side, no response names a bank field. It asserts the
  registry. It never starts a server and never issues a request.
- `client/e2e/supplier-management/*.spec.js` — both specs call
  `page.route("http://localhost:3000/api/v1/**", …)` and fulfil every response from a fixture.
  The API is fully mocked.

So no layer in `supplier_management` exercises dispatcher → handler → service → MySQL over the
wire. The repo has the pattern and it is already in this suite's argv:
`server/test/business-master/http.integration.test.js` builds a real app with
`createApplication({ … port: 0 })` and drives it with `fetch`.

**Why it is M and not H.** The three **Acceptance criteria** checkboxes do not say HTTP, and
`05_development_tasks.md` §2.3 is explicit that the binding items are "task段落的實際
Acceptance Criteria或Verification" — and the Verification block lists exactly the two
integration files, the two client vitest files, and lint/build, all of which pass. The
Description is narrative. The residual risk is also genuinely low: the declarative handler
tests pin the permission pairs and schema closure, and the generic dispatcher tests
(`apiDispatcher.test.js`, `security.test.js`, `requestValidator.test.js`) cover enforcement.

What is not acceptable is §7 of the exit report claiming 「三條 acceptance 全部有同 baseline
嘅實際證據」 without naming this. A reader of that sentence will believe the HTTP flow in the
Description was exercised.

**Fix.** Either add one HTTP-level case for the decision path modelled on
`business-master/http.integration.test.js`, or state the gap explicitly in the exit report and
in the ledger observation, with the reasoning above. I would accept the second for T31 and
schedule the first.

**Confirmed** — read both test layers; `grep -c "page.route"` returns 1 per spec.

---

### L-1 — `seedRole` leaks `roles` rows if it throws after its own INSERT

`server/test/integration/supplierApproval.integration.test.js:606-616`.

`t.after` registration order is **correct** in all seven new approval tests — it is registered
immediately after `mysql.createConnection`, before any seeding, and the cleanup closure reads
`let` variables. I verified this holds under real failure: across roughly fifteen deliberately
failing mutation runs, the residue sweep found zero leftover users, roles, suppliers, orphan
requests or audit rows. That is a real strength and I could not break it from the outside.

The one hole is *inside* `seedRole`. It inserts into `roles`, then into `role_permissions`,
then returns; `roleId` in the test body is only assigned on return. A throw between the two
inserts leaves the role row with nothing tracking it. I forced it:

```js
// after `const roleId = Number(role.insertId);`
if (process.env.REV032_LEAK_PROBE === "1") throw new Error("REV-032 probe: seedRole fails after the roles INSERT");
```

```
ℹ pass 14   ℹ fail 3
leaked_roles       3
leaked_users       0
leaked_suppliers   0
```

Three orphaned `roles` rows in `erp_dev`. (I deleted them; the sweep is clean now.)

**Why it is L.** It needs `seedRole` itself to fail partway, the role name carries a random
suffix so a leak does not cascade into the next run, and `roles` has no unique pressure. But
`erp_dev` is shared, and `roleManagement.integration.test.js` runs in the same suite.

**Fix.** Return the role id to the caller before the dependent insert, or take the id via an
out-parameter the test assigns before `role_permissions` is written:

```js
async function seedRole(connection, suffix, sink) {
  const [role] = await connection.execute(/* … */);
  const roleId = Number(role.insertId);
  if (sink) sink.roleId = roleId;          // visible to t.after from here on
  await connection.execute("INSERT INTO role_permissions …", [roleId, permission.id]);
  return roleId;
}
```

The same shape applies to `seedActors`, where a failure on the second user leaks the first —
but that is pre-existing, so per §3 of the house rules I am noting it, not asking for it.

**Confirmed** — probe and row counts shown.

---

### L-2 — `joiningDatabase.withTransaction` does not roll back on error

`server/test/integration/supplierSettings.integration.test.js:199-204`.

```js
function joiningDatabase(connection) {
  return {
    query: (sql, params) => connection.query(sql, params),
    async withTransaction(work) { return work(connection); }
  };
}
```

The wrapper itself **is sound for its stated purpose**, and I want to be explicit about that
because the coordinator asked. `SupplierSettingsService.updateSettings` and
`SupplierApprovalService.#decide` both call `this.database.withTransaction(...)` and neither
begins or commits on its own, so joining the caller's open transaction is the correct shape.
Calling `beginTransaction()` inside an already-open transaction would implicitly commit the
outer one and publish this test's intermediate settings value to every parallel file — the
comment at `:193-198` reasons this out correctly, and the enclosing `try/finally` at `:245/:299`
guarantees the rollback.

The gap is that `withTransaction` swallows the failure semantics: if `work` throws, the real
wrappers (`serviceOn` at `:31`, `realAuthServiceOn` at `:580`) roll back, and this one does
not. Inside this test the outer rollback covers it, so nothing is lost today — but a future
test that reuses `joiningDatabase` and expects a failed command to leave no partial write
would be quietly wrong.

**Fix.** Two lines, and it documents the intent:

```js
async withTransaction(work) {
  const savepoint = `rev032_${Math.random().toString(36).slice(2, 10)}`;
  await connection.query(`SAVEPOINT ${savepoint}`);
  try { return await work(connection); }
  catch (error) { await connection.query(`ROLLBACK TO SAVEPOINT ${savepoint}`); throw error; }
}
```

**Confirmed by reading**; I did not force a mid-command failure, so the *consequence* is
PLAUSIBLE rather than demonstrated.

---

### L-3 — the 300ms sleep in the racing test is not load-bearing, and the comment says it is

`server/test/integration/supplierApproval.integration.test.js:740-741`.

```js
// 俾批准方真係塞喺 suppliers 鎖度，唔係喺佢開始之前就完咗事。
await new Promise((resolve) => { setTimeout(resolve, 300); });
```

The coordinator asked whether the sleep is load-bearing and whether a slow CI runner breaks
it. Measured answer: **no, and no.** The editor takes `SELECT … FROM suppliers … FOR UPDATE`
*before* the approve is launched, so the approver is blocked for the whole window regardless.
And `#decide` issues its `BEGIN` synchronously before the first `await`, so the approve's
consistent-read snapshot is always taken before the editor commits — which is the part that
actually carries the discrimination.

I set the sleep to 0 and re-ran:

```
=== Control: sleep 300 -> 0 (no service mutation) ===
✔ an approve racing a significant edit yields one terminal result, not both (33.78ms)
ℹ pass 1 / ℹ fail 0

=== X-A: drop FOR UPDATE from the request read in #decide, sleep still 0, ×3 ===
✖ an approve racing a significant edit … (×3)
    actual: 'STATUS_TRANSITION_INVALID'  expected: 'APPROVAL_REQUEST_NOT_OPEN'
```

So with the sleep at zero the test still passes as shipped *and* still kills the
snapshot-read mutation. The 300ms buys nothing and costs 300ms on every run.

On the flake question: `APPROVAL_REQUEST_NOT_OPEN` is the only reachable code on a legitimate
run. Whether the approve blocks on the lock or starts after the editor commits, it reads
`status = 'invalidated'`, which is neither `command.status` nor `OPEN_STATUS`. The only other
outcome is `ER_LOCK_WAIT_TIMEOUT`, and `@@global.innodb_lock_wait_timeout` is 50 against a
~300ms hold. No flake path. I ran the file 18+ times across the campaign and never saw one.

**Fix.** Drop to `setTimeout(resolve, 0)` and correct the comment to say what actually orders
the two — the editor already holds the lock, and `#decide`'s `BEGIN` is dispatched
synchronously.

**Confirmed** — runs shown.

---

### L-4 — `cleanup()`'s `OR request_id IN ('req-int', 'req-race')` is an unscoped global sweep

`server/test/integration/supplierApproval.integration.test.js:109`.

```js
await connection.execute(
  "DELETE FROM supplier_audit_logs WHERE supplier_id = ? OR request_id IN ('req-int', 'req-race')",
  [supplierId]);
```

Pre-existing, so not this task's to fix — but T31 substantially deepens the dependence on it.
Seven of the nine new tests assert exact `supplier_audit_logs` counts via `countAudit`, and
they all write with `requestId: "req-int"` or `"req-race"`. The `OR` arm is not scoped to this
supplier, this test, or this run: it deletes every audit row in `erp_dev` carrying those two
literals.

I checked whether anything else can collide. It cannot, today:
`grep -rn 'requestId: "req-int"' server/test/integration/` outside these two files returns
nothing, every other integration file uses a per-suffix id (`req-${suffix}`, `life-${suffix}`,
`lookup-${suffix}`), and the settings file's `req-int` writes are inside a transaction that
always rolls back.

**Why it still matters.** The safety is accidental and undocumented. The next test author who
writes `requestId: "req-int"` in a committing path in a parallel file gets a non-deterministic
audit-count failure with no obvious cause.

**Fix.** Make the id unique per test (`req-${suffix}`) and scope the sweep to it, or drop the
`OR` arm and let the `supplier_id` predicate plus the orphan sweep do the work.

**Confirmed** — the grep; the sweep is read from the committed source.

---

### L-5 — the new settings lock test is mutation-equivalent to the pre-existing one

`server/test/integration/supplierSettings.integration.test.js:302`, vs `:128`.

The exit report §2 frames this as closing a real gap:

> **缺口一：次序只證咗一半。** … 兩邊夾埋先算係一個次序：淨係得一邊嘅話，個答案仍然可以
> 喺另一個方向被人喺中途換走。

I do not think that holds. Both tests exercise exactly one piece of product code —
`getActivationPolicy`'s `FOR SHARE` clause. The "other direction" is S-vs-X incompatibility,
which is a MySQL guarantee, not application behaviour: given a shared lock exists, the
symmetry follows. Empirically, no mutation separates them. M7 (drop `FOR SHARE`) kills **both**:

```
### M7 drop FOR SHARE from getActivationPolicy
    ℹ pass 23 / ℹ fail 2  => RED
      ✖ an in-flight activation read blocks a concurrent settings write until it finishes
      ✖ an in-flight settings write blocks a concurrent activation read until it finishes
```

and X5 (M-3 above, the toggle's own lock) kills **neither**. I could not construct a mutation
that separates them, because the only product code either one touches is the same three words.

This is a Nit, not a defect — a redundant test is not a wrong test, and it costs one second.
But it should not be described as closing half a gap when the half that *is* open is M-3.

**Fix.** Either repoint this test's writer at `updateSettings` — which would close M-3 and
make the pair genuinely non-redundant — or keep it and soften the claim in §2.

**Confirmed** — mutation results shown.

---

### N-1 — the ~1s cross-file stall on the settings singleton is pre-existing, and the new test does not add to it

I expected the new test to worsen this and measured that it does not. Recording the numbers
because the conclusion is the opposite of the intuition.

`createSupplier really does read the policy before the currency lock`
(`supplierApproval.integration.test.js:296`) runs in **8.4ms** when its file runs alone, and
**~1020ms** when the two files run together — a parallel `getActivationPolicy` queues behind a
pending X-lock request on `supplier_settings` id=1.

| Configuration | that test's time |
| --- | --- |
| both lock tests enabled (as shipped) | 1020ms |
| only the **new** `:302` test disabled | 1019ms |
| only the **pre-existing** `:128` test disabled | 1021ms |
| **both** lock tests disabled | **9.5ms** |

Either one alone produces the full stall; they do not stack. So the new test introduces a
second independent window but no measurable additional cost today. Not a finding against T31 —
noted so the next person does not "fix" it by deleting the wrong test.

### N-2 — `two concurrent approves` does not discriminate on the `suppliers` `FOR UPDATE`

Dropping `FOR UPDATE` from the suppliers read in `#decide` turns the *racing-edit* test and a
pre-existing deadlock test red, but leaves `two concurrent approves` green:

```
### X2 drop FOR UPDATE from the suppliers read in #decide
    ℹ pass 23 / ℹ fail 2  => RED
      ✖ an approve interleaved with an editing transaction does not deadlock
      ✖ an approve racing a significant edit yields one terminal result, not both
```

The property is covered, just not by the test whose name suggests it. Worth knowing before
someone deletes one of the other two.

### N-3 — required CI is not green yet on the reviewed head

`gh pr view 115`: head `8953514`, `mergeStateStatus: UNSTABLE`. Lint, Build frontend and
Dependency audit are SUCCESS on run 35330466164; `Test (server + client, MySQL integration)`
is `IN_PROGRESS`. The exit report's §7 and the revision 138 `next_safe_action` both already
say CI green is still outstanding, so this is a gate item rather than a finding. It must be
re-observed on `8953514`, not on `a25e295`.

### N-4 — the ledger's `code_commit` is `a25e295`, one commit behind the head

Expected and not a misstatement: `8953514` is docs-only (verified — 16 files, all under
`docs/supplier_management/`), so the recorded `source_fingerprint`
`9b14766b…` is still valid at the head and nothing is stranded. Design and plan hashes are
unchanged from main. This is the known "recording CI moves HEAD" shape, handled correctly.

### N-5 — the "policy off" test cannot see an auto-approve that happens after commit

`supplierSettings.integration.test.js:241`. Because `joiningDatabase` never commits, an
implementation that auto-approved pending requests in an after-commit hook, a queued job, or a
projection layer would leave this test green. The test proves the DB truth inside the
transaction, which is the right thing to assert and the strongest thing available without
committing to a shared singleton. Noting the boundary of the claim, not asking for a change.

---

## 2. Mutation campaign — re-run, plus six of my own

The author reports twelve mutations, all RED. I re-ran all twelve independently rather than
taking the table on trust, and every one reproduced, killing the tests the author says it
killed.

| # | Mutation | Result | Tests turned red |
| --- | --- | --- | --- |
| M1 | remove the replay branch in `#decide` | **RED** | concurrent approve; resend |
| M2 | remove the decide-time `supplier.approval` check | **RED** | revocation; disabled |
| M3 | `assertEligibleApprover` drops `AND status = 'active'` | **RED** | disabled |
| M4 | remove the cross-Supplier scope guard | **RED** | IDOR |
| M5 | treat a NULL assignment as "anyone may decide" | **RED** | unassigned |
| M6 | remove `APPROVAL_REQUEST_NOT_OPEN` (targeted at `#decide` only) | **RED** | approve vs edit |
| M7 | drop `FOR SHARE` from `getActivationPolicy` | **RED** | both lock directions |
| M8 | make turning the policy off approve pending requests | **RED** | non-retroactivity |
| R6b | create page stops passing `:field-error` | **RED** | DEF-020 case |
| R7 | panel drops `:error` | **RED** | DEF-020 case |
| R7b | panel drops `:error-message` | **RED** | DEF-020 case |
| N1 | diff row drops `:data-field` | **RED** | REV-030 H-1 case |

One correction to the record: the author's M6 anchor matches **twice** — `#decide` and
`reassignRequest` share the text. My runner refused to apply an ambiguous anchor, so I
re-cut it against `#decide` alone; it is RED there. The author's table does not say which
occurrence was mutated. Not a finding, but the campaign is only meaningful if each mutation
is the one it claims to be.

Six mutations the author did not run:

| # | Mutation | Result | Tests turned red |
| --- | --- | --- | --- |
| X1 | `assertActorFresh` stops filtering `users.status` | **RED** | disabled |
| X2 | drop `FOR UPDATE` from the suppliers read in `#decide` | **RED** | racing edit; deadlock (not concurrent-approve — see N-2) |
| X3 | reassign looks the target up **before** checking the actor | **RED** | disabled |
| X4 | the replay branch writes a **second** decision audit row | **RED** | concurrent approve; resend |
| X5 | `updateSettings` drops `FOR UPDATE` on the singleton | **GREEN — SURVIVES** | — (M-3) |
| X6 | reassign reports the old approver instead of the new one | **RED** | unassigned (recovery half) |

**X1 is the one that answers the coordinator's question 1.4 directly.** In
`a disabled user can neither receive a reassignment nor decide`, the `user_roles` row is
deliberately left in place and only `users.status` is flipped — so the actor's permission set
collapses to `[]` *only* because `assertActorFresh` filters on `status = 'active'`. Removing
that predicate turns the test red. There is no stub short-circuit: `realAuthServiceOn`
(`:579-604`) deliberately omits both `authorize` and `loadPermissions`, taking the constructor
defaults `assertActorFresh` and `loadPermissionNamesForUser` from
`server/src/modules/authorization/directoryLookups.js`. The three tests that use it really do
ride the real role → permission → user chain.

**X4 answers "is `exactly one decision audit` a real assertion or decoration?"** It is real:
making the replay path emit a second audit row — leaving every status and version identical —
turns both audit-count tests red. That was the specific vacuity shape the coordinator flagged
from REV-029/030, and it does not apply here.

**X6 covers the recovery half of the unassigned test**, which no mutation in the author's
table reached. It is not vacuous either.

---

## 3. The four things I was asked to attack, and what happened

### 3.1 Is `two concurrent approves` actually concurrent?

**Yes — measured, not assumed.** I wrote an instrumented replica (scratchpad, not in the repo)
that logs `BEGIN`/`COMMIT` around each transaction:

```
--- RUN 1 ---            --- RUN 3 ---
[+  19ms] A BEGIN        [+  16ms] A BEGIN
[+  19ms] B BEGIN        [+  16ms] B BEGIN
[+  22ms] A COMMIT       [+  21ms] B COMMIT
[+  24ms] B COMMIT       [+  23ms] A COMMIT
A => replayed:false      A => replayed:true
B => replayed:true       B => replayed:false
```

Both transactions are open before either commits, so the second genuinely contends for the
`suppliers` row lock, and **the winner alternates across runs** (A won runs 1–2, B won run 3).
That is the author's claim 「邊邊贏唔固定」 confirmed by observation.

"Does it still hold if the timing goes the other way?" — yes, and that is by design rather
than luck: the loser blocks on `suppliers FOR UPDATE`, so by the time it reads the request the
status is already `approved` and it takes the replay branch at `#decide`'s line 501, *before*
the version check at 508. `exactly one applied / exactly one replayed` is therefore the
outcome under full serialisation too. There is no schedule that yields `VERSION_CONFLICT`, so
`outcomes.every(o => o.ok)` is not an over-strict assertion that can flake. Zero flakes in
18+ runs.

The limit of the test is N-2: it is an outcome assertion, not a lock assertion.

### 3.2 Is `joiningDatabase` sound, and could the policy-off test pass on a system that auto-approves?

Sound — see L-2 for the full reasoning and the one gap (no rollback on error). It is the
correct shape for joining a caller's transaction, and the reason given for not calling
`beginTransaction()` is right: MySQL would implicitly commit the outer transaction and publish
this test's intermediate settings value to every parallel file.

"Does the test prove anything a much simpler assertion would not?" — yes. A bare
`status === 'pending'` check would be satisfied by an implementation that left the row alone
but broke the *decision path* while the policy is off. The test also proves the assignment
still binds (`APPROVAL_NOT_ASSIGNED` for a non-assignee) and that the assigned approver can
still decide, which together say "the existing queue is untouched, not frozen". M8 confirms
the row assertions discriminate; the two decision assertions are what separate "not approved"
from "not decidable".

"Could it pass on a system that DOES auto-approve?" — yes, in one way: after commit. See N-5.

### 3.3 Is the 300ms sleep load-bearing, and is `APPROVAL_REQUEST_NOT_OPEN` the only code?

Not load-bearing, and yes it is the only code. See L-3 for the measurements.

### 3.4 Do the `assertActorFresh` tests really exercise the real lookup?

Yes. See X1 above.

---

## 4. Test isolation on the shared database

`t.after` registration order is correct in all nine new tests — checked individually, and
demonstrated under real failure. After roughly fifteen deliberately-failing runs plus the
forced-leak probe, the sweep is clean:

```
settings_version        1
users_t31               0     (supplier-t31-it-%, supplier-approval-it-%, supplier-settings-it-%)
roles_t31               0
suppliers_apr_set_prb   0     (APR-%, SET-%)
orphan_requests         0
audit_reqint_race       0
```

The settings singleton does not leak: every settings test that writes `id = 1` sits inside a
transaction that always rolls back, and `version` is still 1.

The two real isolation findings are L-1 (the `seedRole` window) and L-4 (the global audit
sweep). Neither fires today.

---

## 5. Module boundary

Clean. All twenty changed paths fall under `docs/supplier_management/**`, `server/test/**` or
`client/test/**`, all of which are in `scope.allowed_write_paths`. Nothing touches
`scope.approval_required_paths` or `scope.forbidden_paths`. `00_project_profile.json` is
**unchanged**, so the PLAN hash is intact and no baseline-bound record is stranded — and the
author is right that no profile edit was needed: `supplier-phase-001-server`'s argv already
globs `server/test/integration/supplier*.integration.test.js`, so the new cases enter the
suite automatically.

```
$ git diff main...HEAD --name-only | grep -vE '^(docs/supplier_management/|server/test/|client/test/|client/e2e/)'
(none outside)
```

No production code changed, as claimed.

---

## 6. DEF-020 and REV-031 N-1

**DEF-020 (`client/test/pages/suppliers/create.test.js:197-203`).** The three added lines are
exactly the fix REV-031 specified, and all three mutations are red:

```
### R6b create page stops passing :field-error => RED   (1 failed | 8 passed)
### R7  panel drops :error                     => RED   (1 failed | 8 passed)
### R7b panel drops :error-message             => RED   (1 failed | 8 passed)
```

Nothing else in that case was weakened: the diff is purely additive — four comment lines,
three assertions, one blank. The pre-existing summary assertion
`expect(body.text()).toContain("請先選擇審批人")` at `:195` is untouched, and the
`approver.vm.$emit("update:modelValue", 2)` continuation at `:205` is unchanged. The ledger
record is the problem, not the fix — M-1.

**REV-031 N-1 (`client/test/pages/suppliers/approvals.test.js:106-109`).**
`body.find('[data-field="supplierName"]')` is correct: `:data-field="row.field"` is rendered on
the `<tr>` at `client/src/pages/suppliers/SupplierApprovalsPage.vue:256`, it is the only
`data-field` in `client/src`, and `row.field` is unique per diff row so `find` cannot match the
wrong one. It fails loudly — not with a silent `undefined` or an opaque `TypeError`:

```
Error: Cannot call text on an empty DOMWrapper.
 ❯ test/pages/suppliers/approvals.test.js:108:18
    106|     const named = body.find('[data-field="supplierName"]');
    108|     expect(named.text()).toContain("已變更");
```

The negative half is equally protected: `coded.text()` throws the same way if
`data-field="supplierCode"` disappears, so the `.not.toContain` assertion cannot degrade into
vacuous truth. This is a strict improvement over the substring-on-`FIELD_LABEL`-ordering
selector it replaces.

---

## 7. Coverage honesty against the three acceptance bullets

> - [ ] Settings toggle與activation並發產生deterministic順序；已Pending不被OFF自動批准。

**Partially closed.** 「已Pending不被OFF自動批准」 is genuinely closed — M8 turns
`turning the approval policy off does not decide an already pending request` red, and the test
asserts the request row, the request version, the Supplier status, the assignment binding and
the approver's continuing ability to decide. 「Settings toggle…deterministic順序」 is closed on
the activation side (M7 red, both directions) and **open on the toggle side** — M-3, X5 green.
The exit report's §2 claim that the second lock test closes 「缺口一」 does not hold; see L-5.

> - [ ] 雙approve／approve-vs-update只有一個合法terminal結果及一筆decision audit；重送idempotent。

**Closed, and it survives attack.** Double approve: genuinely concurrent (§3.1), M1 and X4 red.
approve-vs-update: M6 and X2 red, single terminal result asserted on the request row, the
Supplier row, and both audit actions. Resend: M1 red, deterministic, asserts the replayed
version is the stored one rather than `input.version + 1`. "Exactly one decision audit" is a
load-bearing assertion, not decoration — X4 proves it.

> - [ ] JWT後撤權、disabled approver、IDOR及unassigned reassign全部安全失敗／恢復，SUP-CAP-02無P0／P1 defect。

**Closed.** Revocation: two distinct guards, both proved, on the real `assertActorFresh`
(M2 + X1). Disabled approver: three paths — cannot be assigned, cannot decide, and reassign
checks the actor before the target so it cannot be used as an account-existence oracle
(M3 + X1 + X3). IDOR: M4, and the assertion compares `publicMessage` as well as `publicCode`
because the code is shared with "request not found" — that is the right call. Unassigned:
safe-fail and recovery both covered (M5 + X6). On 「無P0／P1 defect」: the only in-module open
defect is DEF-020, LOW, and fixed on this branch — which is exactly why M-1 needs fixing
before this is called DONE.

The one thing the report should not claim as-is is §7's 「三條 acceptance 全部有同 baseline 嘅
實際證據」, for the M-3 and M-4 reasons.

---

## 8. Ledger and evidence

**Evidence files — all four verified, not taken on trust.**

| Run | Suite | `result` | exit | counts | artifacts |
| --- | --- | --- | --- | --- | --- |
| `20260918T093455-840b9265baaa` | `supplier-phase-001-server` | PASS | 0 | 314 / 314 / 0 / **0 skipped** | 3, all sha256 match |
| `20260918T093502-b4be748ad34f` | `supplier-phase-001-client` | PASS | 0 | 71 / 71 / 0 / 0 | 3, all sha256 match |
| `20260918T093507-4a2ef643ea2a` | `lint` | PASS | 0 | — | 2, all sha256 match |
| `20260918T093510-90542a511e10` | `client-build` | PASS | 0 | — | 2, all sha256 match |

All four paths in `evidence_files` exist, all are module-relative `…/run.json`, and every
declared artifact's sha256 still matches its file on disk. The server junit XML contains all
nine new test names exactly once each, zero `<failure>`, zero `<skipped>`, 314 `<testcase>`.
`skipped: 0` is the important one: it proves the recorded run really had
`DB_INTEGRATION_TESTS=1` — otherwise `integrationTest` degrades to `test.skip` and the nine
new cases would have been recorded as skipped. The 305→314 claim checks out against the prior
run `20260918T073310-f2a9fb35c09e` (305 at `00900fe`). The suite's `min_tests: 157` /
`max_skipped: 0` gates are satisfied.

I independently reproduced 314/314 three times with no flake, and 71/71 and lint clean.

**Observations — accurate, with one framing caveat.**

- The **mutation-campaign observation** is accurate. Twelve mutations, all RED, and the tests
  it names as turning red are the ones that turn red. The self-reported process failure (the
  broken `eval`-with-pipe restore path that left four client mutations applied) is recorded
  honestly and in enough detail to audit, and the tree is in fact clean now — I verified
  `git status --porcelain` empty at `8953514` and again after every one of my own eighteen
  mutations. The one thing the observation overstates is by omission: "all nine new server
  tests … discriminate" is true at test granularity, and the campaign did not probe whether
  each test's *individual* assertions discriminate. X4 and X6 show two that do; X5 shows a
  neighbouring rule that nothing covers.
- The **browser observation** is accurate: I reproduced `17 passed` in 13.8s against the
  claimed 14.0s, both specs, and the decision to record it as MANUAL_TEST rather than
  DEVELOPER suite evidence is correct — `supplier-uat-browser` is a UAT-stage suite. The
  claim 「零 console 問題」 rests on each spec's own `collectConsole` assertion, which is a
  reasonable basis and is stated as such.
- The **TASK-031 opening observation** and the PHASE-002 scope correction are correct.
  `05_development_tasks.md:222` does scope PHASE-002 as TASK-025–TASK-031, and revision 136's
  `next_safe_action` did understate the phase by one task. Good catch by the author, correctly
  recorded.

**Ledger problems:** M-1 and M-2.

---

## 9. What I tried and could not break

Recording these so the APPROVED is not a rubber stamp.

- **Eighteen mutations**, twelve re-run from the author's table and six of my own. Seventeen
  RED. The one survivor (X5) is a neighbouring rule, not one of the new tests' own claims.
- **Tried to show the double-approve race never happens.** It happens: both transactions open
  before either commits, and the winner alternates across runs.
- **Tried to make the racing-edit test flaky by removing its sleep.** It stayed green as
  shipped and stayed red under mutation. No flake path exists — the only alternative outcome
  needs a 50-second lock timeout against a 300ms hold.
- **Tried to find a stub short-circuiting `assertActorFresh`.** There isn't one; X1 proves the
  real `users.status` predicate is load-bearing in the disabled test.
- **Tried to show the audit-count assertions are decoration.** X4 says they are not.
- **Tried to make the cleanup leak by failing tests mid-flight.** Fifteen failing runs, zero
  residue. `t.after` is registered before seeding in all nine tests. The only leak I could
  force required injecting a throw inside `seedRole` itself (L-1).
- **Tried to blame the new settings test for the 1-second cross-file stall.** Measured: the
  stall is pre-existing and the new test does not add to it (N-1). My initial hypothesis was
  wrong and the measurement is what corrected it.
- **Tried to find a scope violation.** None; `00_project_profile.json` untouched.
- **Tried to find a cross-file `req-int` collision that would corrupt the audit counts.** None
  today (L-4) — but only by accident.

---

## 10. Verdict

**APPROVED** at head `8953514569af7be0ab13b2c5fe970b1b5498d820`.

The nine new server tests are real tests. Every one of them dies under at least one mutation
of the rule it names, the three security tests ride the real authorization lookups rather than
a stub, the double-approve race is genuinely concurrent, and the audit-count assertions —
the exact shape that was vacuous three times in REV-029/030 — are load-bearing here. The two
client changes are correct, additive, and discriminating. The diff stays inside the module and
does not touch the PLAN baseline. The evidence is real, hash-verified, and the recorded run
genuinely had the integration tests enabled.

Before this is called DONE:

1. **M-1** — reconcile DEF-020 in the ledger, or put it back in `next_safe_action`. This is
   the one I would hold the DONE transition on.
2. **M-2** — restore the carried-forward risk list in `next_safe_action`.
3. **M-4** — qualify §7 of the exit report so 「三條 acceptance 全部有…實際證據」 does not
   read as covering the Description's HTTP flow, which nothing exercises.
4. **M-3** — repoint one lock test's writer at `updateSettings`. Small, and it closes both
   M-3 and L-5.

L-1 through L-5 and N-1 through N-5 are the author's call.

Independent of this review: required CI must be observed green on `8953514` itself (N-3), and
per the module's own history, the recording of that observation will move HEAD again — so the
CI observation should name the commit it was run against explicitly rather than relying on
`baseline.code_commit`.
