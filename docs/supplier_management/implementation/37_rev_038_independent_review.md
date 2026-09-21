# REV-038 — Independent re-review of TASK-033 (Bank domain service)

**Reviewer:** independent agent (not the author) · **Task:** TASK-033 / T33 · **Phase:** PHASE-003
**Branch:** `claude/supplier-task-033` · **Head reviewed:** `ef1ed7d7bcada024319fcea8bf060d13d9b6b33a`
**PR:** https://github.com/crazysumsum/erp-app/pull/118 · **Predecessors:** REV-035, REV-036, REV-037
**Verdict:** **APPROVED** — 0 Critical, 0 High, 1 Medium (non-blocking), 3 Note.

**Coverage: all five requested items completed.** Baseline at head: **61 tests, 61 pass, 0 fail**.
`npm run lint` passes. Every mutation applied alone and reverted, `git status --porcelain` asserted
clean after each; scratch files outside the repo.

**I found no production defect this round** — the first round of four where that is true. The one new
finding is in a test double, on a path no test reaches, and cannot affect the shipped service. It is
still worth fixing before merge, for the reason in §3.

---

## 1. REV-037 H-1 — **FIXED**, verified live and by mutation

`SupplierBankService.js:243-247` now takes a list and asks about each:

```js
const hit = constraints.find((constraint) => SupplierBankService.#violates(error, constraint));
```

with `create` at `:350-351` passing
`wantsDefault ? ["uq_supplier_bank_blind_index", "uq_supplier_bank_default"] : ["uq_supplier_bank_blind_index"]`,
and `update` (`:422`) / `setDefault` (`:468`) each passing their single applicable constraint.

**The live two-flag race, re-run.** This is the probe that gave `leaksDup: true` and a 500 last round.
Two concurrent same-Supplier `create` calls, same account number, production `MySqlDatabaseService`
and a production-shaped `assertActorFresh` so the REPEATABLE READ snapshot is stale:

```
A. isDefault NOT set:  BANK_ACCOUNT_DUPLICATE / 409 / leaksDup: false
B. isDefault: true:    BANK_ACCOUNT_DUPLICATE / 409 / leaksDup: false      <- was 500, leaksDup: true
```

`leaksDup` tests whether the driver's `Duplicate entry '…'` message — whose first component is the raw
blind index bytes — appears anywhere in the thrown error's chain. It does not. Closed.

**R-N1, re-run as its inverse.** Last round R-N1 took the broken implementation to the correct one and
survived. The code is now correct, so the equivalent check is to restore the broken form:

```diff
-{ constraints: wantsDefault ? ["uq_supplier_bank_blind_index", "uq_supplier_bank_default"] : [...] }
+{ constraints: wantsDefault ? ["uq_supplier_bank_default"] : [...] }
```
```
ℹ pass 60   ℹ fail 1
```

**RED.** The cell that was broken is now pinned, by the three-cell table at
`supplierBankService.test.js:624-648` whose comment names the missing cell explicitly.

---

## 2. The fourth layer, and whether there is a fifth

### 2.1 The direct answer

**Importing the real class closed the divergence in the error *value*. It did not close the class of
divergence, because the doubles still re-implement the *decisions* around that value — and one of
those re-implementations is wrong.**

That distinction is the whole of it. `MySqlDatabaseOperationError` is a value; importing it means a
change to the real class propagates to the double automatically, and drift on that axis is now
impossible. But `executorLike` still hand-writes *when* to wrap, *which* code to use, and the
transaction double still hand-writes the commit/rollback/passthrough policy. An import cannot fix a
copied branch. Copied branches drift, and this one already has.

### 2.2 What the import did close — verified

`supplierBank.integration.test.js:53-62` and `supplierBankService.test.js:49-60` now throw the real
class. Since `MySqlDatabaseOperationError extends ApplicationError`, it passes both doubles'
`instanceof ApplicationError` test and is rethrown as-is, so the chain depth now matches production:

```
production (probe C, live):  MySqlDatabaseOperationError(DATABASE_OPERATION_FAILED, 500) -> Error(ER_DATA_TOO_LONG)
```

two links, terminal code `DATABASE_OPERATION_FAILED` — and the unit suite's assertion at
`supplierBankService.test.js:584-590` was updated to match that shape rather than the double's old
three-link one. `executorLike` also picked up the real `instanceof MySqlDatabaseOperationError`
passthrough. Divergences (a), (c) and (o) from REV-037 §1.1–§1.2 are closed. (b) is closed in effect:
the constructor defaults to `DATABASE_OPERATION_FAILED`, so the double matches for every error except
`PROTOCOL_SEQUENCE_TIMEOUT`, which this service never branches on.

M-2(j) is closed: `supplierBank.integration.test.js:70-73` issues
`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ` before `beginTransaction`, which is where the real
path issues it, and `SET TRANSACTION` without a scope applies to the next transaction only — correct
placement.

### 2.3 The fifth layer — M-2(m) is not actually fixed

**Location:** `server/test/integration/supplierBank.integration.test.js:75-85`.

The real code sets its flag **before** awaiting the commit (`MySqlDatabaseService.js:513-514`):

```js
commitAttempted = true;
await raceWithSignal(connection.commit(), controller.signal);
```

The double sets it **after** (`:78-79`):

```js
const result = await work(executor);
await connection.commit();
committed = true;                 // never reached when commit() rejects
```

So when `commit()` rejects, the double enters its catch with `committed === false` and calls
`connection.rollback()` — the exact thing the new comment two lines above says it must not do.
Reproduced standalone against a connection whose `commit()` throws:

```
double   after a FAILED commit -> begin, commit, ROLLBACK
real     after a FAILED commit -> begin, commit
```

The comment at `:82-83` asserts a property the code does not have. That is worse than not having the
property: the next reader trusts the comment and stops checking.

**Nothing observes it.** Mutation **R-P4** moves the assignment to the faithful side of the await:

```diff
         const result = await work(executor);
-        await connection.commit();
-        committed = true;
+        committed = true;
+        await connection.commit();
```
```
ℹ pass 61   ℹ fail 0
```

**SURVIVING** — no test forces a commit failure, so the behaviour is unreachable from the suite. Which
is precisely why the ordering slipped.

**Fix:** the diff above. Two lines swapped.

### 2.4 The structural answer, and what would actually close the class

The remaining eleven divergences from REV-037 §1.1–§1.2 are unacted and recorded as such, which I
accept — reproducing signal handling, per-statement timeouts, the deadline AbortController, the
connection lifecycle and the context plumbing would mean reimplementing the executor, which is the
opposite of the goal.

But that framing is the trap. Every one of those divergences exists because the doubles *describe* the
production path instead of *being* it. Importing one class removed one description. §2.3 is what
happens to the descriptions that remain.

**The integration double does not need to be a double at all.** It already talks to real MySQL; the
only reason it hand-writes `withTransaction` is history. Replacing `executorLike` plus the hand-written
transaction with a real `MySqlDatabaseService` over a real `mysql.createPool` would make the executor
and the transaction logic the production ones, and would close (b), (d) through (i) and (j) through (p)
in a single move — including §2.3, which could not then be wrong, because there would be no second
copy to be wrong. I built exactly that harness for all four of my probes across REV-035 to REV-038; it
is about fifteen lines, and the config needs `transactionTimeoutMs` set or `positiveTimeout` throws.

The unit harness is a different case and should stay a double — its fake connection is the point. It
could still instantiate the real `MySqlDatabaseService` with a pool whose `getConnection()` returns the
fake, which would give it the real `run()` and the real `withTransaction`, but that is a larger change
and the unit double is currently faithful on every axis this service touches.

**So: this instance, not the class.** The class closes when the integration test stops owning a copy.

---

## 3. `find` / `findLast` — your reasoning is correct, and now has evidence beyond its own

Your claim: an `ER_DUP_ENTRY` names exactly one key, the regex anchors on the closing quote, so at most
one constraint in the list can match; `find` and `findLast` are therefore equivalent, and the survival
is an equivalent mutant rather than a gap.

I agree, and I checked the part that could have been wrong — that the list's later elements are
exercised at all. Three mutations:

| mutation | result | what it shows |
| --- | --- | --- |
| `find` → `findLast` | **GREEN** | consistent with equivalence |
| only ever consider `constraints[0]` | **RED**, 2 failures | the second element **is** exercised |
| reverse `create`'s list order | **GREEN** | order genuinely does not matter |

The middle one is the one that matters. An equivalent mutant and an untested branch both survive; what
separates them is whether a *non-equivalent* mutation on the same code goes red. It does. Your
conclusion stands on evidence, not just on argument.

Two supporting details I verified: `uq_supplier_bank_blind_index` and `uq_supplier_bank_default` are
not prefixes of one another, and the pattern anchors both ends (`for key '` … `'`), so no partial match
is possible either. And `ER_DUP_KEY` (1022), the other duplicate-key error, names a *table* rather
than a key — no constraint matches, `#violates` returns false, and it falls through untranslated as a
500, which is the right direction.

Separating "equivalent mutant" from "the tests cannot see it" is the right instinct, and the code
comment at `:240-242` saying so is the right place for it. Forcing a contorted test to kill an
equivalent mutant would have made the suite worse.

---

## 4. Anything new in the diff since `057f694`

Three source/test files and documentation. Everything in the diff traces to a REV-037 finding:

- `SupplierBankService.js` — the `constraints` list (§1), plus the comment recording that "first match"
  carries no ordering meaning.
- `supplierBankService.test.js` — `wrappedDuplicate` throws the real class; the unrelated-constraint
  assertion updated to production's two-link shape; the new three-cell table at `:624-648`.
- `supplierBank.integration.test.js` — `executorLike` throws the real class with the passthrough;
  isolation level set; the commit/rollback change (§2.3).

I re-checked the things a diff of this shape could quietly break: the wrapper still returns
`await work()` unchanged so the `affectedRows === 0` version checks still see the real result; the
`#violates` chain walk and anchored regex are untouched; the negative control on
`uq_supplier_bank_crypto_context` (`:579-590`) still asserts an unrelated constraint passes through.
Nothing outside the REV-037 findings moved.

## 5. Scope and ledger

**Scope clean.** Six branch-authored files against `main`, all inside `scope.allowed_write_paths`:
`SupplierBankCrypto.js`, `SupplierBankService.js`, `supplierErrors.js` and the three supplier test
files. The four non-merge commits (`fef38b2`, `9000bd5`, `d161a6a`, `6134836`) touch nothing else under
`server/` or `client/`. `00_project_profile.json` untouched. No migration, no `approval_required_paths`
entry, no `forbidden_paths` entry.

**Ledger revision 160**, `baseline.code_commit` `6134836` — and this time head is `ef1ed7d`, a
docs-only commit on top of it rather than a merge. Verified: `git diff 6134836 ef1ed7d -- server client`
is empty, so the pinned commit and the reviewed head carry identical source. Both REV-037 observations
are recorded, including the four-instance pattern.

---

## Notes

- **N-1** The integration double's `database.query` (non-transactional, used by `list`) is bound to the
  same connection the transaction uses, whereas production's `list` goes through the pool and gets a
  different one. Harmless — `list` is never called inside a transaction — but it is another place the
  double's shape differs, and it disappears if §2.4 is taken.
- **N-2** The unit harness's `withTransaction` has no commit step at all, so the commit policy lives
  only in the integration double. That is fine, but it means §2.3 had exactly one place to be right
  and it was not checked.
- **N-3** On §9's two standing practices: I think they are correct and worth carrying, with one
  amendment to the first. "A double reproduces the real class, wrapping depth and isolation level, and
  imports the real thing wherever it can" is right as far as it goes — but §2.3 is a counterexample
  discovered *inside the commit that wrote the rule*, and it is not a class or a depth or a level. It
  is a branch. I would add: **prefer deleting the double to improving it.** When the test already has
  the real dependency available — as the integration test has real MySQL — the faithful double is the
  production object, and every property the rule enumerates comes for free rather than being
  maintained. The enumerated form of the rule will always be one property short of the next defect;
  that is what four rounds of this task demonstrate.

  The second practice — mutate a new discriminator to the *correct* implementation and require red —
  I have nothing to add to. It is the one that caught REV-037 H-1, and ordinary mutation could not
  have.

---

## Verdict

**APPROVED** — 0 Critical, 0 High, 1 Medium (non-blocking), 3 Note.

REV-037 H-1 is fixed and I verified it two ways: the live two-flag race that previously leaked the
blind index into a 500 now returns a clean 409, and restoring the broken constraint choice goes red.
Everything carried from REV-035, REV-036 and REV-037 remains closed. I could not find a production
defect at this head.

On your main question, plainly: **importing the real class closed this instance, not the class.** The
error *value* can no longer drift. The *decisions* around it still can, and one already has — the
integration double sets its commit flag after the await instead of before, so it rolls back on a failed
commit, which is the precise behaviour M-2(m) was raised to remove, with a comment above it claiming
otherwise. Nothing tests it; R-P4 survives. It is a two-line fix and it cannot affect production code,
which is why it does not block — but I would fix it before this commit is cited as the worked example
of the §9 practice, since as it stands it is a counterexample to the rule it documents.

Your `find`/`findLast` reasoning is correct. I confirmed the part it depended on — that the list's
second element is genuinely exercised — with a mutation that goes red, which is what separates an
equivalent mutant from a blind spot.

**Head commit reviewed: `ef1ed7d7bcada024319fcea8bf060d13d9b6b33a`.**
Worktree restored and verified clean (`git status --porcelain` empty) after every probe and mutation;
the only file this review adds is itself.
