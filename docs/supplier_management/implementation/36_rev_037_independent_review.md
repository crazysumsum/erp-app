# REV-037 — Independent re-review of TASK-033 (Bank domain service)

**Reviewer:** independent agent (not the author) · **Task:** TASK-033 / T33 · **Phase:** PHASE-003
**Branch:** `claude/supplier-task-033` · **Head reviewed:** `057f694237ac958ea8d86f02d191415b6432c91c`
**PR:** https://github.com/crazysumsum/erp-app/pull/118 · **Predecessors:** REV-035, REV-036 (both CHANGES_REQUESTED)
**Verdict:** **CHANGES_REQUESTED** — 1 High, 2 Medium, 3 Note.

Baseline at head: **60 tests, 60 pass, 0 fail**. `npm run lint` passes. Every mutation applied alone
and reverted, `git status --porcelain` asserted clean after each; probes outside the repo.

**Summary.** REV-036's H-1 is genuinely fixed — I confirmed the translation now fires against real
MySQL, and my R-M5 mutation is now RED. M-1, M-2 and M-3 are all properly closed. But the M-2 fix
introduced a **new hole of the same shape**: `create` now names exactly one constraint, and its INSERT
can violate either of two. A `create` with `isDefault: true` losing a duplicate race is still a 500
carrying the blind index — and, once again, no test can tell.

---

## 1. Is the fake faithful now, or is there a fourth layer?

You asked for everything the real stack does to an error, a connection or a result that the doubles do
not, whether or not anything depends on it. Here is the diff.

### 1.1 Statement level — `MySqlDatabaseExecutor.run` vs `executorLike` / `wrappedDuplicate`

`MySqlDatabaseService.js:178-223` against `supplierBank.integration.test.js:50-61` and
`supplierBankService.test.js:49-57`.

| # | The real `run()` | The doubles | Depends on it today |
| --- | --- | --- | --- |
| a | Throws **`MySqlDatabaseOperationError`**, which `extends ApplicationError` (`:18-30`), so it carries `statusCode: 500`, `publicCode: "INTERNAL_SERVER_ERROR"`, `publicMessage`, `name` | Throw a **plain `Error`** with only `.code` and `.cause` | **No** — see 1.3 |
| b | Maps `PROTOCOL_SEQUENCE_TIMEOUT` → `DATABASE_QUERY_TIMEOUT`; `OVERLOADED_CODES` → 503 / `SERVICE_UNAVAILABLE` | Always `DATABASE_OPERATION_FAILED` | No |
| c | `if (error instanceof MySqlDatabaseOperationError) throw error` — never double-wraps | Wrap unconditionally | No |
| d | Validates SQL is a non-empty string, and `positiveTimeout()` — two bare `TypeError` paths, deliberately **not** wrapped | Neither check exists | No |
| e | Pre-flight `if (activeSignal?.aborted) throw abortError(...)`, and `raceWithSignal` around the statement | No signal handling at all | No |
| f | Calls `target[method]({ sql, timeout }, parameters)` — options-object shape | Call `(sql, params)` | No |
| g | Emits `logger.debug("database.operation.completed", …, { requestId, operationName, durationMs })` per statement | Silent | No |
| h | Third `options` argument (`timeoutMs`, `signal`, `operationName`) | Dropped | No |
| i | The transaction executor is a full `MySqlDatabaseExecutor` — has `withTransaction`, `target`, `config`, `context`, `signal` | `executorLike` returns only `{ query, execute }`; a nested `connection.withTransaction(...)` would be a `TypeError` in test and would work in production | No |

`wrappedDuplicate` additionally only ever fires for one matched statement, so **no non-duplicate
database error is exercised anywhere in the unit suite**.

### 1.2 Transaction level — `withTransaction` vs the two doubles

`MySqlDatabaseService.js:413-568` against `supplierBankService.test.js:88-99` and
`supplierBank.integration.test.js:66-83`.

| # | The real path | The doubles | Depends on it today |
| --- | --- | --- | --- |
| j | `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ` before `beginTransaction` | Neither sets it; the integration double inherits the server default | **Indirectly** — the duplicate-race reasoning rests on REPEATABLE READ snapshot timing, which is now taken on trust |
| k | Calls `work(transaction, { signal })` — two arguments | Both pass one | No |
| l | `AbortController` + deadline `setTimeout` aborting with `DATABASE_TRANSACTION_TIMEOUT`; parent-signal propagation; abort destroys the connection | Neither has any of it | No |
| m | `commitAttempted` — after a commit attempt it **refuses to rollback**, destroys the connection, and may raise `DATABASE_TRANSACTION_INDETERMINATE` | Unit double has no commit at all; the integration double calls `rollback()` after a failed `commit()`, which the real one explicitly forbids | **No, and that is the problem** — see below |
| n | `updateContext({ databaseTransaction })`, restored in `finally` | Neither touches context | No |
| o | Discriminates with `error instanceof ApplicationError` | Unit: same. Integration: `if (error?.statusCode)` | Interacts with (a) |
| p | `finally`: clearTimeout, remove listeners, restore context, `connection.release()` unless destroyed | Connection lifetime left to the test | No |

### 1.3 The interaction — this is the fourth layer

Divergence (a) and discriminator (o) combine. Because the doubles' statement wrapper is a plain
`Error` with no `statusCode` and no `ApplicationError` in its prototype chain, **both doubles fail
their ApplicationError test and re-wrap**. Production does not, because
`MySqlDatabaseOperationError` *is* an `ApplicationError`:

```
production (confirmed live, probe C):
  MySqlDatabaseOperationError(DATABASE_OPERATION_FAILED, 500)  ->  Error(ER_DATA_TOO_LONG)
                                                                      2 links

both doubles:
  Error(DATABASE_TRANSACTION_FAILED)  ->  Error(DATABASE_OPERATION_FAILED)  ->  driver
                                                                      3 links
```

The terminal code differs too: production surfaces `DATABASE_OPERATION_FAILED` for an untranslated
statement failure, the doubles surface `DATABASE_TRANSACTION_FAILED`.

**Nothing currently observes it.** Mutation **R-N2** gives both doubles' statement error a
`statusCode: 500` — the faithful shape — and the suite stays **60/60 green**. `#violates` walks three
levels and runs at the statement boundary, where both stacks are two deep, so the translation is
unaffected.

But the new integration test (`supplierBank.integration.test.js:427-434`) asserts the driver message
is absent by inspecting `thrown.cause?.message` **and** `thrown.cause?.cause?.message`. That it
happens to cover both depths is luck, not design — production puts the driver at depth 1 and the
double at depth 2. The next assertion written against one depth will be wrong about the other.

**Recommended fix, and it removes the whole class rather than one instance:** the doubles are in the
same repository as the thing they imitate, so stop re-describing it —

```js
import { MySqlDatabaseOperationError } from "../src/services/mysqldatabase/MySqlDatabaseService.js";
// wrappedDuplicate / executorLike:
throw new MySqlDatabaseOperationError(`MySQL database ${method} failed`,
  { code: "DATABASE_OPERATION_FAILED", cause: driver });
```

That closes (a), (c) and (o) at once and cannot drift, because a change to the real class changes the
double. Divergences (b), (d)–(i) and (j)–(p) remain, and I would leave them: they are unreachable
from this service and reproducing them would mean reimplementing the executor. They are named here so
the next person does not have to rediscover them.

### 1.4 The one I would act on beyond the error shape

Divergence **(m)**. The indeterminate-commit path is load-bearing: REV-035 verified `reveal`'s
invariant — the audit is committed before plaintext is returned, and an indeterminate commit must
fail *safe* (audit possibly written, caller gets nothing) — and I verified it by reading
`MySqlDatabaseService.js:534-545`, because **no test can reach it**. The integration double does the
opposite of what the real code does after a failed commit. If `reveal`'s ordering is going to be
defended by anything other than a source reading, that path needs a double that models it.

---

## 2. Findings

### H-1 — `create` names one constraint, but its INSERT can violate either; `isDefault: true` re-opens REV-036 H-1

**Location:** `server/src/modules/supplier/SupplierBankService.js:341`.

```js
), { constraint: wantsDefault ? "uq_supplier_bank_default" : "uq_supplier_bank_blind_index" });
```

An INSERT carrying `is_default = 1` can violate **both** `uq_supplier_bank_blind_index` (a duplicate
account) and `uq_supplier_bank_default` (the slot is taken). The constraint is chosen from the
caller's *intent*, but which constraint actually fires is decided by the *data*. With `wantsDefault`
true, `#violates` is only ever asked about the default slot, so a blind-index collision does not match,
falls through, and arrives as the untranslated 500 that REV-036 H-1 was raised to remove.

**CONFIRMED against real MySQL.** Two concurrent same-Supplier `create` calls with the same account
number, using production's `assertActorFresh` so the snapshot is stale:

```
A. isDefault NOT set:
   conn0: REJECTED { code: "BANK_ACCOUNT_DUPLICATE", publicCode: "BANK_ACCOUNT_DUPLICATE",
                     status: 409, leaksDup: false }          <- correct

B. identical race, isDefault: true:
   conn0: REJECTED { name: "MySqlDatabaseOperationError", code: "DATABASE_OPERATION_FAILED",
                     publicCode: "INTERNAL_SERVER_ERROR", status: 500,
                     causeCode: "ER_DUP_ENTRY", leaksDup: true }
```

`leaksDup: true` means the driver's `Duplicate entry '…'` message — whose first component is the raw
blind index bytes — is present in the error chain. That is the exposure REV-035 first flagged and
REV-036 tracked; it is back for this shape.

**Reachability.** A supplier's *first* bank account is normally created with "make default" ticked, so
`create({ isDefault: true })` is the common shape of `create`, not an exotic one. The pre-check still
means only a lost race gets this far, so it is rare in absolute terms — but it is precisely the case
the translation exists for.

**Why the suite cannot see it.** The two existing unit cells are
`supplierBankService.test.js:486` (`isDefault` unset, blind-index constraint) and `:499-501`
(`isDefault: true`, default-slot constraint). The cross cell — `isDefault: true` with a blind-index
violation — is the broken one and is not asserted. Mutation **R-N1** implements the correct behaviour:

```diff
-  static async #translatingDuplicates(work, { constraint }) {
-      if (!SupplierBankService.#violates(error, constraint)) throw error;
-      if (constraint === "uq_supplier_bank_blind_index") {
+  static async #translatingDuplicates(work, { constraint, alternate = null }) {
+      const hit = SupplierBankService.#violates(error, constraint) ? constraint
+        : (alternate && SupplierBankService.#violates(error, alternate) ? alternate : null);
+      if (!hit) throw error;
+      if (hit === "uq_supplier_bank_blind_index") {
```
```
ℹ tests 60   ℹ pass 60   ℹ fail 0
```

**SURVIVING.** Correct and broken are indistinguishable to the suite — the same shape as R-M5 last
round and the vacuous `crypto_context` assertion before it.

**Fix.** Take a list, report the first that matches:

```js
static async #translatingDuplicates(work, { constraints }) {
  try { return await work(); } catch (error) {
    const hit = constraints.find((c) => SupplierBankService.#violates(error, c));
    if (!hit) throw error;
    throw hit === "uq_supplier_bank_blind_index"
      ? supplierConflict("BANK_ACCOUNT_DUPLICATE", "這個供應商已有相同的銀行帳戶")
      : supplierConflict("BANK_ACCOUNT_DEFAULT_RACE", "預設銀行帳戶剛被其他人變更，請重新載入");
  }
}
// create:
{ constraints: wantsDefault
    ? ["uq_supplier_bank_blind_index", "uq_supplier_bank_default"]
    : ["uq_supplier_bank_blind_index"] }
```

and add the missing cell: `statementFails: { on: "INSERT", constraint: "uq_supplier_bank_blind_index" }`
with `isDefault: true`, expecting `BANK_ACCOUNT_DUPLICATE`. `update` and `setDefault` are correct as
they stand — each of their statements can violate only the one constraint named.

---

### M-1 — The doubles' statement error is not an `ApplicationError`, so chain depth and terminal code diverge from production

Mechanism, evidence and fix in §1.3. Nothing depends on it today (R-N2 green), which is why it is M
and not H — but it is the third layer in a row where a double's shortcut hid something, and the fix is
an import.

### M-2 — Neither double models the isolation level or the commit/abort rules

Enumerated at (j)–(p). Two worth acting on:

- **(j)** No `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`. The duplicate-race behaviour this task
  has now spent three reviews on depends on REPEATABLE READ snapshot timing — specifically that
  `assertActorFresh`'s reads open the snapshot before `suppliers FOR UPDATE`. The integration double
  inherits whatever the server is configured for, so that dependency is unpinned. One line.
- **(m)** The integration double `rollback()`s after a failed `commit()`, which the real code
  deliberately refuses to do, and neither double can produce `DATABASE_TRANSACTION_INDETERMINATE`. See
  §1.4 — this is the path `reveal`'s safety argument rests on.

---

## 3. What is fixed, verified

### REV-036 H-1 — **FIXED**

`#violates` (`SupplierBankService.js:255-260`) walks `[error, error.cause, error.cause.cause]`, matches
`errno === 1062 || code === "ER_DUP_ENTRY"`, and confirms the constraint with an anchored
`/for key '(?:[^']*\.)?<constraint>'/` against `sqlMessage ?? message`. Live confirmation: probe A,
two concurrent creates → `BANK_ACCOUNT_DUPLICATE / 409`, no driver message in the chain.

**R-M5 re-run** (walk only the top-level error): **RED, 3 failures** — previously surviving, now
pinned by a dedicated test at `supplierBankService.test.js:565-575` whose comment states exactly why it
exists. There is also a negative control at `:579` using `uq_supplier_bank_crypto_context`, asserting
an unrelated constraint is *not* translated — that is the right shape and I would not have thought to
ask for it.

### REV-036 M-3 — **FIXED**

The anchored regex ends the prose-scanning: the duplicated value can no longer be matched as if it
were the key name, and `(?:[^']*\.)?` absorbs the 5.7/8.0 format difference. `errno === 1062` is the
primary discriminator, with `code` as fallback.

### REV-036 M-2 — **FIXED** (and see H-1)

`update`'s UPDATE (`:397`) and `setDefault`'s promoting UPDATE (`:454`) are wrapped with their own
constraints, covered at `supplierBankService.test.js:545-560`. The constraint named is correct for
each. The residual defect is in `create` alone.

### REV-036 M-1 — **FIXED**

`SupplierBankService.js:558` now passes `(event, message, context)`. The test at `:600-613` asserts
arity 3, the event name, and that `context.reason` matches `/failed authentication/` and reads
differently from the missing-key case. That is the first test in this task that looks at a log line,
and it pins the exact property the 422 exists to deliver.

### The new integration test — **good, with one caveat**

`supplierBank.integration.test.js:379-437` makes real MySQL raise the real violation and asserts
`error.code === "ER_DUP_ENTRY" && Number(error.errno) === 1062` from the driver itself, so the numbers
`#violates` keys on are established from the database rather than assumed. It then asserts the
service's 409 carries no `Duplicate entry` and no plaintext. The caveat is §1.3: the depth at which it
looks for the driver message is the double's depth, not production's.

---

## 4. Notes

- **N-1** `BANK_ACCOUNT_DEFAULT_RACE` remains unreachable, and the comment at `:246-250` now says so
  plainly and gives the reason (`suppliers FOR UPDATE` serialises its writers) plus why it is kept
  (future writers — rotation scripts, imports — may not take that lock). That is the right disposition.
  Fixing H-1 does not change it: even with both constraints tried, the default-slot branch stays
  unreachable from today's callers.
- **N-2** `create`'s constraint is derived from `wantsDefault`, i.e. from the caller's intent, when
  what is being classified is which constraint the *data* violated. That conflation is the root of
  H-1 and is worth a sentence in the code after the fix, so the list is not later "simplified" back.
- **N-3** Ledger revision 158 pins `baseline.code_commit` `d161a6a`, which again predates the merge
  head. I verified the supplier source is byte-identical between `d161a6a` and `057f694`
  (`git diff d161a6a 057f694 -- server/src/modules/supplier server/test/supplierBank*` empty), and the
  observation you recorded from my REV-036 note covers the pattern. Consistent and honest.

**Scope, re-checked across both merges as asked.** This branch authors six files against `main`, all
inside `scope.allowed_write_paths`: the three supplier sources and the three supplier test files. The
three branch-authored non-merge commits (`fef38b2`, `9000bd5`, `d161a6a`) touch nothing else under
`server/` or `client/`. The two merges brought `docs/items_management/**`,
`server/src/modules/item/itemRecoveryAcceptance.js` and `server/test/itemRecoveryAcceptance.test.js`;
all three trace to commit `138ea7b`, which I confirmed is an ancestor of `main`, so they arrived from
item-management and are not authored here. `00_project_profile.json` untouched. No migration, no
`approval_required_paths` entry.

---

## 5. Attacks that failed

1. **Does the translation actually fire in production now?** Yes — probe A, real MySQL, real
   `MySqlDatabaseService`, production-shaped `authorize`. 409, no leak. The REV-036 finding is closed
   for every shape except the one in H-1.
2. **Can the anchored regex be fooled by the duplicated value?** No. `for key '(?:[^']*\.)?<name>'`
   requires the literal `for key '` prefix and a closing quote; a blind index byte sequence cannot
   supply that structure, and the value is single-quoted before it. The REV-036 M-3 hazard is gone.
3. **Does `#violates` mis-fire on an unrelated constraint?** No — the suite's own negative control
   (`uq_supplier_bank_crypto_context`, `:579`) covers it, and I re-read the regex construction: the
   constraint name is interpolated into the pattern, and all three names are literal identifiers with
   no regex metacharacters.
4. **Is the 422 still oracle-free after the logger change?** Yes. The public code and message remain
   identical for tampering and for a missing key; only `context.reason` differs, and that is
   server-side.
5. **Does the widened `#translatingDuplicates` swallow an `ApplicationError`?** No — `#violates`
   returns false for anything without `errno 1062` / `ER_DUP_ENTRY` in its first three links, and the
   pre-check's own 409 is thrown outside the wrapper.
6. **Did wrapping `update` and `setDefault` change their success paths?** No — the wrapper returns
   `await work()` unchanged, and `[updated] = await …` destructures the same result. The
   `affectedRows === 0` version-conflict check still runs on the real result.

---

## 6. Verdict

**CHANGES_REQUESTED** — 0 Critical, **1 High**, 2 Medium, 3 Note.

The remediation is good work. `#violates` is now the right shape — structured `errno`, anchored
constraint match, chain walk — and I confirmed it fires against real MySQL rather than only against a
double. R-M5 is RED. The negative control on an unrelated constraint, and the first test in this task
that asserts on a log line, are both better than what I asked for.

What blocks is that the M-2 fix introduced a new instance of the defect it was closing: `create`
decides which constraint to recognise from the caller's intent, while the database decides from the
data, so `create({ isDefault: true })` losing a duplicate race is still a 500 with the blind index in
its chain. R-N1 going green is the fourth time in this task that correct and broken were
indistinguishable to the suite.

On your direct question — **the doubles are much closer but not faithful.** The statement wrapper is a
plain `Error` where production throws an `ApplicationError` subclass, which makes both doubles re-wrap
where production passes through: three links and `DATABASE_TRANSACTION_FAILED` in test, two links and
`DATABASE_OPERATION_FAILED` in production. Nothing depends on it today and R-N2 proves it, but it is
the same kind of gap as the previous three, and the fix is to import the real
`MySqlDatabaseOperationError` instead of re-describing it. Beyond that, thirteen further divergences
are named in §1.1–§1.2; the two I would act on are the missing isolation level and the commit/abort
rules, because the first underpins the race reasoning this task keeps revisiting and the second
underpins `reveal`'s safety argument.

**Head commit reviewed: `057f694237ac958ea8d86f02d191415b6432c91c`.**
Worktree restored and verified clean (`git status --porcelain` empty) after every probe and mutation.
