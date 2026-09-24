# REV-053 — TASK-036 Bank key rotation, independent review of the REV-052 remediation

**Review:** REV-053 ・**Task:** TASK-036 (T36) ・**Phase:** PHASE-003 ・**Capability:** SUP-CAP-03
**Head reviewed:** `f0bc0de76e9837dac78607d9412e9db7e717f72e` (`claude/supplier-task-036`).
**Subject:** `main…HEAD`, merge-base `60c735c3fb79b9d4e550aa36e32c1ca4ec5102ca`.
**Delta since REV-052:** `28d974d..HEAD` — a merge of `main` (`eaeb6c9`) plus the remediation (`f0bc0de`).
**Worktree:** `/private/tmp/erp-rev-053` (detached, read-only by convention).
**Harness state:** revision 230; newest recorded observation is at `eaeb6c9`. **`f0bc0de` appears nowhere
in the ledger** — see I-1.
**Reviewer:** independent agent (`agent-skills:security-auditor`); not the author. Author is Claude Opus 5.

**Verdict: CHANGES_REQUESTED** — 0 Critical, 0 High, **4 Medium**, 9 Low, 5 Info.

**All six Mediums from REV-051 and REV-052 are closed or effectively closed, and I verified every one of
them by execution rather than by reading the diff.** Five are fully closed. One — REV-052 M-2, the SELECT
cursor — is **partially closed**, and the half that is still open is the half REV-052 itself named in the
same sentence.

I also re-ran the author's fourteen-mutant table. **All fourteen die.** That is the second consecutive
round in which the record's mutation table is accurate, and it is worth saying plainly, because it was
wrong in two of the first three rounds.

**What blocks is four things.**

The first is `ORDER BY id`. REV-052 M-2 said the double "hardcodes `r[column] === params[0] && r.id >
params[1]` **and sorts unconditionally**". The remediation taught the double to read the `WHERE` clause,
so `AND id > ?` is now genuinely pinned — removing it hangs the suite, which is the real symptom. It did
not touch the sort: `db.query` still ends in `.sort((a, b) => a.id - b.id)` with no reference to the
SQL's `ORDER BY`. So the *direction* of the cursor is still supplied by the test double rather than by
the code under test. I changed `ORDER BY id` to `ORDER BY id DESC` and **both suites stayed green** —
15/15 unit and 4/4 against real MySQL. Then I ran the same mutant against real MySQL with five
permanently-failing rows and watched it attempt three of the five and attempt one of them twice.

The second is `remainingRows` for the lookup kind. It is the function that decides
`safeToRemoveFromKey`, and **nothing anywhere tests its lookup branch.** A one-token change —
`const column = "encryption_key_id"` instead of the ternary — makes a half-finished lookup rotation
report `remaining: 0, safeToRemoveFromKey: true` on real MySQL **while three rows are still on the old
lookup key**, and every test in both suites still passes. That is precisely the state the whole task
exists to make impossible, and it is unobserved.

The third is the leak scan in the F-M1 test. Its three assertions are checks that cannot fail. In a
mutant run they never execute at all — the `constraint` equality assertion fires first and aborts the
test. And against a genuine MySQL leak, two of the three are structurally incapable of matching, because
the double's `duplicateKeyError()` fabricates a message shape MySQL does not emit. I produced a real
`ER_DUP_ENTRY` leak and confirmed the assertion that was written specifically to catch it returns
`false`. That is the fifth fidelity gap on this task, and it is inside the helper the REV-051
remediation added.

The fourth is `--limit=0`. It is accepted by a validator that deliberately rejects negatives, it is
documented nowhere, `parseArguments` is exported and has **zero tests**, and on the real CLI it rotates
the entire table. Its sibling `--batch-size=0` does the opposite — nothing. Same literal, opposite
meanings, on the one flag whose stated purpose is to bound the blast radius of a cautious probe.

None of the four is a security hole in the shipped code. All four are places where the thing that
matters is asserted by something other than the code under test, which is the failure mode this task
has now produced five times.

---

## Summary

| | |
| --- | --- |
| Critical | 0 |
| High | 0 |
| **Medium** | **4** (M-1 … M-4) |
| Low | 9 (L-1 … L-9) |
| Info | 5 (I-1 … I-5) |
| REV-051 Mediums | F-M1 **CLOSED** ・F-M2 **CLOSED** ・F-M3 **CLOSED** |
| REV-052 Mediums | M-1 **CLOSED** ・M-2 **PARTIALLY CLOSED** ・M-3 **CLOSED** |
| Author's 14-mutant table | 14 re-run, **14 confirmed dead** |
| Disposition | **CHANGES_REQUESTED** |

### What I ran, and on what

Everything below was executed in `/private/tmp/erp-rev-053` at `f0bc0de`.

| | |
| --- | --- |
| `test/supplierBankKeyRotation.test.js` | **15 / 15 pass** |
| `test/integration/supplierBankRotation.integration.test.js` | **4 / 4 pass**, real MySQL 26.7.0 |
| Profile suite `supplier-phase-001-server` (exact argv from `00_project_profile.json`) | **414 tests / 414 pass / 0 fail / 0 skipped** |
| Full server suite (`npm test`, `SUPPLIER_BANK_*` set) | **1995 tests / 1689 pass / 0 fail / 306 skipped** |
| `npm run lint` | **exit 0** |
| Real CLI, both entry scripts | partial run, resume, all-failing run, `--limit`, `--batch-size`, typo `--from`, unknown flag |

**On "it cannot be tested here".** It can. The repo has no MySQL on 3306 and the system instance needs
`sudo`, so I initialised a private `mysqld` (26.7.0) on a scratch datadir, port 3399, bound to
`127.0.0.1`, created `erp_dev` / `erp_user` exactly as `.github/workflows/ci.yml` does, ran
`npm run migrate --workspace server` (exit 0, 48 migrations), and set `DB_INTEGRATION_TESTS=1`. Every
"real MySQL" claim in this document is a command I ran against that instance. The instance is stopped
and its datadir removed.

> One correction to my own process, recorded because it matters: my first `mysqld` lost the port race to
> another agent's `erp-inventory-p0` instance already listening on 3307/IPv4, and my
> `CREATE DATABASE erp_dev` / `CREATE USER erp_user` landed on **that** instance. I detected it
> immediately (`SHOW DATABASES` returned `erp_inventory_p0`), confirmed the database I had created held
> zero tables and that the pre-existing account was `erp_inventory_p0@127.0.0.1`, and dropped both
> objects. That instance is back to exactly the state I found it in. No other worktree was touched.

### Restoration

Every production mutation in this review was applied with a script that runs `git checkout -- .` in a
`finally` block. `git status --porcelain` at `f0bc0de` shows only this file.

---

## 1. Verification of the six prior Mediums

### 1.1 REV-051 F-M1 — a blind index leaking through MySQL's `ER_DUP_ENTRY` text. **CLOSED.**

REV-052 verified this on real MySQL. I did not take that on trust, because REV-052's check and the unit
test share a blind spot (M-3 below). I built the collision from scratch: one row left on `look-old`, and
a second row that a live app had already written under `look-new` carrying the exact index the first row
would compute. The rotation then drives a genuine `ER_DUP_ENTRY` on
`uq_supplier_bank_blind_index`.

```
REPORT: {"processed":0,"failed":1,
         "failures":[{"id":87,"reason":"DUPLICATE_KEY","constraint":"uq_supplier_bank_blind_index"}],
         "remaining":1,"safeToRemoveFromKey":false}
LEAK CHECKS: {"contains_escaped_index_prefix":false,"contains_hex_index_prefix":false,
              "contains_Duplicate_entry":false,"index_hex_prefix_for_reference":"8F93D8A162CD7E02"}
```

The constraint name comes through, the value does not, and the run correctly refuses to authorise
removing the key.

**Negative control, because a scan that cannot fail proves nothing.** I applied the F-M1 mutant
(`constraint: String(duplicate.sqlMessage ?? …)`) and re-ran the identical scenario:

```
"constraint":"Duplicate entry '26-look-new-W\\x9B\\xADl\\xDE<\\xB0\\xD9N\\xE9\\xB9\\xC1\\xE3R\\x8B\\xD2\\xB'
              for key 'supplier_bank_accounts.uq_supplier_bank_blind_index'"
LEAK CHECKS: {... "contains_Duplicate_entry":true ...}
```

The scan discriminates. The fix holds.

**That output is also the evidence for M-3.** Look at what MySQL actually emits: the quoted value is the
whole composite key, so it opens with `26-look-new-` (the `supplier_id` and the `blind_index_key_id`),
and the index bytes that follow are rendered **literally where they are printable** — `W`, `l`, `<`,
`N`, `R` — and `\xNN`-escaped only where they are not. The unit test's double emits something else
entirely. See §4.

### 1.2 REV-051 F-M2 — `--limit` bounded successes, not work. **CLOSED.**

Mutant `room = limit > 0 ? limit - processed : batchSize` → **KILLED**.

End to end on the real CLI, on a table where every row's `encryption_key_id` lies about its ciphertext
so every decrypt fails:

```
$ node scripts/rotateSupplierBankEncryption.js --from=ci-enc-0 --to=ci-enc-1 --limit=2 --json
{"processed": 0, "attempted": 2, "failed": 2, "remaining": 5, "safeToRemoveFromKey": false}
reasons: ['BANK_ACCOUNT_TAMPERED', 'BANK_ACCOUNT_TAMPERED']
```

Two attempted, five rows present, no full-table scan. This is the exact scenario F-M2 described and it
now behaves.

### 1.3 REV-051 F-M3 — the concurrency guard was pinned by nothing. **CLOSED.**

Both guard mutants die, in both kinds:

```
[F-M3  encryption guard vacuous  (WHERE id = ? AND 1 = 1)]  KILLED exit=1
[F-M3b lookup     guard vacuous  (WHERE id = ? AND 1 = 1)]  KILLED exit=1
```

The double now parses `WHERE` and returns row copies rather than live references, which is what makes
these two observable. Both parametrised tests (`encryption:` / `lookup:`) exercise the guard.

One residue, filed as L-2 rather than against F-M3: the guard's *only* observable effect in production
is `affectedRows: 0`, and nothing reads it.

### 1.4 REV-052 M-1 — `--from` validated against nothing. **CLOSED.**

Mutant `if (!ring.includes(from))` → `if (false)` → **KILLED**.

On the real CLI, the exact scenario REV-052 described:

```
$ node scripts/rotateSupplierBankEncryption.js --from=TYPO --to=ci-enc-1
Error: --from key id TYPO is not in the encryption ring (ci-enc-1);
       refusing to report a rotation that cannot have happened
exit=1
```

Previously this returned `safeToRemoveFromKey: true` and exit 0. It no longer can. The unit test also
pins the cross-ring case (an encryption key id offered as a lookup source), which is the variant that
would otherwise still slip through.

The error arrives as a raw Node stack trace rather than a usage message — L-8, not a reopening of M-1.

### 1.5 REV-052 M-2 — the SELECT cursor supplied by the double. **PARTIALLY CLOSED.**

**The half that is closed.** `AND id > ?` is now pinned by the code under test. The double parses the
`WHERE` clause predicate by predicate. Removing the clause no longer passes:

```
[M-2 drop cursor clause]  HUNG (no termination in 90s)
```

That is the real symptom — a rotation that re-reads the same batch forever — reproduced in the unit
suite. Good. The sibling mutant "advance the cursor only on success" (move `lastId = Number(row.id)`
inside the `try`) also hangs. Both are genuinely observed now.

**The half that is not.** REV-052's own sentence was: the double *"hardcodes `r[column] ===
params[0] && r.id > params[1]` **and sorts unconditionally**"*. The remediation addressed the hardcoded
predicate. The sort is untouched — `server/test/supplierBankKeyRotation.test.js`, the `query` double:

```js
return [table.filter((r) => tests.every((matches) => matches(r)))
  .sort((a, b) => a.id - b.id).slice(0, limit).map((r) => ({ ...r }))];
```

Nothing in that expression consults the SQL's `ORDER BY`. This is M-1 below, with the evidence.

### 1.6 REV-052 M-3 — every crypto failure reported `UNKNOWN`. **CLOSED.**

Mutant (strip `code: "BANK_ACCOUNT_TAMPERED"` from `SupplierBankCrypto.js`) → **KILLED**.

Reproduced on the real CLI, on exactly the record's §5 scenario — five rows whose `encryption_key_id`
was hand-set to the old id while the ciphertext is under the new key:

```
"failures": [ { "id": 69, "reason": "BANK_ACCOUNT_TAMPERED" },
              { "id": 70, "reason": "BANK_ACCOUNT_TAMPERED" }, … ],
"remaining": 5, "safeToRemoveFromKey": false        exit=1
```

Classified, not `UNKNOWN`. Fail-closed, per row, exit 1.

I checked the one way this fix could have reopened F-M1: `requireAccount` now attaches
`code: \`BANK_ACCOUNT_${rejection}\``, and if `rejection` carried any part of the input, the fix would
have put plaintext straight into the report. It does not — `bankAccountRejection` returns one of three
frozen constants (`EMPTY`, `UNREPRESENTABLE`, `TOO_LONG`). Clean.

The record's §5, however, still quotes the pre-M-3 output. That is L-4.

---

## 2. [MEDIUM] M-1 — `ORDER BY id` is still supplied by the double, and the mutant survives real MySQL

**Where:** `server/src/modules/supplier/bankKeyRotation.js`, `selectBatch()`; and
`server/test/supplierBankKeyRotation.test.js`, the `query` double.

```js
      WHERE ${column} = ? AND id > ?
      ORDER BY id
      LIMIT ${Number(batchSize)}
```

The resume argument in both the module header and §2 of the record is *"揀 id 大過 `after` … 順住 id
做"* — pick rows with id greater than the cursor, **in id order**. The `id > ?` half is now pinned. The
"in id order" half is not: the double sorts ascending by `id` whatever the SQL says.

**The mutant survives everything.**

```
[SURV-1 ORDER BY id DESC] unit:  SURVIVED exit=0
[SURV-1 ORDER BY id DESC] integ: SURVIVED exit=0
```

15/15 unit and 4/4 real MySQL, green, with the cursor running backwards.

**What it does on real MySQL.** Five rows (ids 59–63), every one permanently failing, `batchSize: 2`.
Correct code:

```
{"verdict":"terminated","attempted":5,"failed":5,"order":[59,60,61,62,63]}
```

With `ORDER BY id DESC`:

```
{"verdict":"terminated","attempted":3,"failed":3,"order":[63,62,63]}
```

Three of five rows attempted; ids 59, 60, 61 **never looked at**; id 63 attempted twice. The run exits
reporting `attempted: 3, failed: 3` and says nothing about the two rows it skipped.

**Why this is Medium and not High.** `remaining` is computed by a separate `COUNT(*)`, so
`safeToRemoveFromKey` stays honest — the mutant cannot authorise removing a key that is still in use. It
degrades a single run into a partial one that under-reports its own coverage, and an operator would have
to notice `remaining` not falling to zero across repeated runs. Real, bounded, not a breach.

**Why it blocks.** This is the same defect class as REV-052 M-2, one level down, in the same method, in
the same double, after a remediation that was explicitly aimed at it — and REV-052 named it in the same
sentence. That is the pattern the author himself recorded twice: the fix closes the named instance and
leaves its sibling.

**Fix.** Make the double honour the direction instead of sorting unconditionally — parse
`ORDER BY (\w+)( DESC)?` from the SQL and sort accordingly, the same way it now parses `WHERE`. Then
add an assertion that the ids arrive ascending, and one that a failing-row run attempts every row
exactly once (the existing "cursor advances" test already collects `batches`, so it is two lines).

---

## 3. [MEDIUM] M-2 — `remainingRows` has no test for the lookup kind, and the gap authorises removing a live key

**Where:** `server/src/modules/supplier/bankKeyRotation.js`, `remainingRows()`.

```js
export async function remainingRows(database, kind, keyId) {
  const column = kind === ROTATION_KINDS.ENCRYPTION ? "encryption_key_id" : "blind_index_key_id";
```

This one ternary is the whole of `safeToRemoveFromKey`. **Nothing tests the `blind_index_key_id`
branch.** I went looking for a test that asserts a non-zero `remaining` on a lookup rotation and there
is not one:

- the lookup rotation test rotates every row → `remaining` is 0 either way;
- the lookup guard test ends with both rows on the new key → 0 either way;
- the duplicate test (the one lookup case with a row left behind) asserts `failed`, `reason` and
  `constraint`, and never looks at `remaining` or `safeToRemoveFromKey`;
- the integration lookup test rotates both rows; the half-rotated integration test counts old-key rows
  with its own raw SQL and never reads the report.

**The mutant survives both suites.**

```
[SURV-3 remainingRows always encryption_key_id] unit:  SURVIVED exit=0
[SURV-3 remainingRows always encryption_key_id] integ: SURVIVED exit=0
```

**What it does on real MySQL.** Five rows on `look-old`, `--limit=2`.

Correct code:

```
{"processed":2,"failed":0,"remaining":3,"safeToRemoveFromKey":false,"rows_still_on_look_old":3}
```

Mutant:

```
{"processed":2,"failed":0,"remaining":0,"safeToRemoveFromKey":true,"rows_still_on_look_old":3}
```

`safeToRemoveFromKey: true` with three rows still on the old lookup key. An operator following the
runbook removes `look-old` from the ring, and those three rows' blind indexes can no longer be matched
by the duplicate check — the exact `SELECT ... FOR` path design §5.8 relies on. Exit code is 0, so a
CI job or runbook sees success.

Note the shape of the mutation: it is a copy-paste, not an exotic edit, and it is *self-consistent with
the double* — the double picks its column by `sql.includes("encryption_key_id")`, so a mutated SQL
string that says `encryption_key_id` makes the double agree with the mutant. That is a sixth instance
of the double confirming the code rather than checking it.

**Fix.** One assertion on the existing duplicate test would do it:

```js
assert.equal(report.remaining, 1);
assert.equal(report.safeToRemoveFromKey, false);
```

and one line in the half-rotated integration test asserting the report's `remaining` matches the raw
`COUNT(*)` it already runs. Then the mutant dies in both suites.

---

## 4. [MEDIUM] M-3 — the three leak assertions in the F-M1 test are checks that cannot fail

**Where:** `server/test/supplierBankKeyRotation.test.js`, the test
`"a duplicate key failure reports the constraint, never the index MySQL echoes back"`, and its helper
`duplicateKeyError()`.

```js
  const escaped = [...index].map((byte) => `\\x${byte.toString(16).toUpperCase().padStart(2, "0")}`).join("");
  assert.ok(!serialised.includes(escaped.slice(0, 24)), "no escaped index bytes may reach the report");
  assert.ok(!serialised.includes("Duplicate entry"), "no driver message may be forwarded verbatim");
  assert.ok(!serialised.includes(index.toString("hex").slice(0, 16)), "nor the index in hex");
```

These three lines are the only thing in the repository that claims to detect the REV-051 F-M1 leak.
Two separate problems.

**(a) In the failing case they never execute.** I applied the F-M1 mutant and looked at which assertion
fires:

```
✖ a duplicate key failure reports the constraint, never the index MySQL echoes back
  AssertionError: the constraint name is schema, not data, and it is what an operator needs
    actual: "Duplicate entry '\\xEF\\xB2\\x11\\xDD… ' for key 'supplier_bank_accounts.uq_supplier_bank_blind_index'"
    expected: 'uq_supplier_bank_blind_index'
```

The `assert.equal` on `constraint` is earlier in the test and aborts it. The three leak assertions
never run in the only scenario in which they could have anything to find. They pass exclusively in the
clean run, where there is nothing to detect.

**(b) Against real MySQL, two of the three cannot match a genuine leak.** The assertions are calibrated
to `duplicateKeyError()`, which builds the message by escaping **every** byte:

```js
const escaped = [...indexBytes].map((byte) => `\\x${byte.toString(16)…}`).join("");
`Duplicate entry '${escaped}' for key 'supplier_bank_accounts.uq_supplier_bank_blind_index'`
```

MySQL does not do that. From the genuine leak I produced in §1.1:

```
Duplicate entry '26-look-new-W\x9B\xADl\xDE<\xB0\xD9N\xE9\xB9\xC1\xE3R\x8B\xD2\xB' for key '…'
```

Two differences, both fatal to the assertions:

1. The quoted value is the **whole composite key**, so it opens with `supplier_id` and
   `blind_index_key_id` (`26-look-new-`). The index bytes never start at position 0, which is where
   `escaped.slice(0, 24)` looks.
2. Printable bytes are rendered **literally** (`W`, `l`, `<`, `N`, `R`), only non-printable ones become
   `\xNN`. `escaped.slice(0, 24)` is the first six bytes *all* escaped; that requires six consecutive
   non-printable bytes at a fixed offset. The `hex` assertion is worse — MySQL never emits contiguous
   hex at all.

The live proof is in §1.1's negative control: with the leak genuinely present on real MySQL,
`contains_escaped_index_prefix` and `contains_hex_index_prefix` both returned **`false`**. The only
thing that would have caught it is `contains_Duplicate_entry` — a literal match on one English driver
string.

**Why this is Medium.** The shipped code does not leak; §1.1 proves that. What is broken is the
regression barrier. F-M1 was a Medium found in production code that the author's own base64 scan missed
because *"掃唔到 base64 唔等於冇祕密"*. The test written to stop it recurring repeats the identical
error one layer up: it scans for a shape it invented rather than the shape MySQL emits. If a future
change reforwards driver text in any form other than a message containing the literal
`"Duplicate entry"` — a different driver, a wrapped error, `sqlState` plus the value, MySQL 5.7's
`for key 'uq_…'` format — this test passes.

**Fix.** Two changes, both small:

1. Make `duplicateKeyError()` produce MySQL's real shape: the composite prefix
   (`${supplier_id}-${blind_index_key_id}-`), printable bytes literal, non-printable `\xNN`-escaped.
   The real message from §1.1 is a usable fixture.
2. Move the leak assertions ahead of the `constraint` equality assertion, or split them into their own
   test, so they run in the mutant case. Then drop the `slice(0, 24)` / `slice(0, 16)` prefixes and
   assert on the full serialised report against the raw bytes in every encoding the module already
   knows about — latin1, hex, upper hex, base64, `\xNN`.

The module's own ledger entry says it: *negative controls must discriminate.* This one does not.

---

## 5. [MEDIUM] M-4 — `--limit=0` rotates everything, `--batch-size=0` rotates nothing, and `parseArguments` has no tests

**Where:** `server/scripts/supplierBankRotationCli.js`, `parseArguments()`.

```js
  for (const [name, value] of [["--batch-size", options.batchSize], ["--limit", options.limit]]) {
    if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
      throw new Error(`${name} must be a non-negative integer`);
    }
  }
```

The validator deliberately admits `0` for both flags. In `runRotation`, `limit = 0` means *no limit* and
`batchSize = 0` means *select nothing*. On the real CLI, same table, same five rows:

```
$ node scripts/reindexSupplierBankBlindIndexes.js --from=ci-look-0 --to=ci-look-1 --limit=0
{"processed": 5, "attempted": 5, "remaining": 0, "safeToRemoveFromKey": true}

$ node scripts/reindexSupplierBankBlindIndexes.js --from=ci-look-0 --to=ci-look-1 --batch-size=0
{"processed": 0, "attempted": 0, "remaining": 5, "safeToRemoveFromKey": false}
```

An operator who types `--limit=0` intending "do nothing, just show me" rewrites every bank row in the
database and is told the old key is safe to remove. `--limit` is the flag whose entire purpose, per
F-M2, is *"一個謹慎嘅試探性 run"* — a cautious probe.

Three things compound it:

- **There is no `--help`.** Neither entry script's doc comment mentions `--limit`, `--batch-size`,
  `--json` or `--transition-started`; they document only `--from` and `--to`.
- **`parseArguments` is exported and has zero tests.** I grepped the whole of `server/test`: nothing
  imports `supplierBankRotationCli.js`. The entire operator-facing surface — flag parsing, the exit-code
  contract, the progress printer, the pool wiring — is verified only by the record's §6 manual run.
  That is the surface on which REV-052 M-1 lived.
- Two more parsing quirks fall out of the same untested function (L-9): `--to=e2=x` silently truncates
  to `to: "e2"` because `split("=")` is destructured two-wide, and `--json=false` sets `json: true`.

**Fix.** Reject `0` for `--limit` with a message naming the alternative (`omit --limit to rotate
everything`), or make `0` mean zero rows for both flags. Either way, add a test file for
`parseArguments` — it is a pure function taking an array, so the whole table above is about fifteen
lines — and add `--limit`/`--batch-size`/`--json`/`--transition-started` to the two entry doc comments.

---

## 6. The author's fourteen-mutant table, re-run

I applied every one of the fourteen myself against `test/supplierBankKeyRotation.test.js` and restored
after each. **I accept all fourteen.**

| Mutant (record §9) | My result |
| --- | --- |
| M-1 drop the `--from` ring check | KILLED exit=1 |
| M-2 drop the cursor clause | **HUNG** — no termination in 90 s |
| M-3 crypto loses its `code` | KILLED exit=1 |
| F-M1 forward the driver message | KILLED exit=1 |
| F-M2 limit counts successes | KILLED exit=1 |
| F-M3 encryption guard vacuous | KILLED exit=1 |
| F-M3b lookup guard vacuous | KILLED exit=1 |
| drop the from-key filter | KILLED exit=1 |
| ring limit `>` becomes `>=` | KILLED exit=1 |
| drop the lookup half of warnings | KILLED exit=1 |
| `safeToRemove` ignores failures | KILLED exit=1 |
| `--to` not validated | KILLED exit=1 |
| transition limit off by one | KILLED exit=1 |
| reindex: key id not written | KILLED exit=1 |

The record's `KILLED（掛死）` annotation on M-2 is honest and I am not disputing it — a suite that
never finishes is a signal. But see L-6: `node --test` carries no default timeout, so in CI that is not
a failure, it is a six-hour job.

**Mutants the record does not contain.** Four of mine, run against both suites:

| Mutant | unit | real MySQL |
| --- | --- | --- |
| `ORDER BY id` → `ORDER BY id DESC` | **SURVIVED** | **SURVIVED** → M-1 |
| `remainingRows` column always `encryption_key_id` | **SURVIVED** | **SURVIVED** → M-2 |
| drop `crypto_context` from the SELECT projection | **SURVIVED** | KILLED (all 4) → I-5 |
| cursor advances only on success (`lastId` inside the `try`) | **HUNG** | — |
| AAD: re-encrypt under a fresh `crypto_context` | KILLED | — |
| AAD: re-encrypt under `supplierId: 0` | KILLED | — |
| `assertSource`: drop the `from === to` check | KILLED | — |
| `remainingRows`: drop the `WHERE` clause entirely | KILLED | — |

The two AAD mutants dying is the one that matters most and it is worth stating explicitly: the claim in
§2 of the record that re-encryption cannot silently rebind a row to a different Supplier or a different
`crypto_context` is **genuinely pinned**, in both the unit suite and the integration suite.

---

## 7. Claims I attacked and that held

### 7.1 No key material on any surface. **HELD, with a discriminating control.**

```
json      leaksB64=false leaksHex=false leaksLatin1=false -> "[REDACTED SupplierBankCrypto]"
inspect   leaksB64=false leaksHex=false leaksLatin1=false -> [REDACTED SupplierBankCrypto]
encIds    leaksB64=false leaksHex=false leaksLatin1=false -> ["e1"]
lookIds   leaksB64=false leaksHex=false leaksLatin1=false -> ["l1"]
NEGCTRL   leaksB64=true
```

Record §8 is correct. The two new getters return ids, never material, in base64, hex or latin1. The
scan finds a planted key, so it is not a check that cannot fail.

### 7.2 `remaining === 0` is a complete condition. **HELD.**

I looked for a second table carrying `encryption_key_id` or `blind_index_key_id` — an archive, a
history table, an audit payload holding ciphertext — because if one existed, `remaining === 0` over
`supplier_bank_accounts` would be an incomplete basis for removing a key. There is exactly one:
`supplier_bank_accounts` (migration `0037`, `SupplierBankService.js`). Nothing else stores a row
encrypted under these rings.

### 7.3 Idempotence and re-running. **HELD.**

A second full run after a completed rotation selects nothing (`processed 0, remaining 0`), because the
`from` filter no longer matches. A rerun cannot mangle already-rotated rows. Verified on the real CLI
and in the resume test.

### 7.4 No SQL injection in the two interpolations. **HELD.**

`${column}` is chosen from two frozen constants by a `kind` that `runRotation` validates against
`ROTATION_KINDS` before anything else runs. `LIMIT ${Number(batchSize)}` passes through `Number()`,
which yields a number or `NaN`; both stringify to something MySQL rejects as syntax rather than
executes. Neither is reachable from request data in any case.

### 7.5 The profile needs no change. **HELD, exactly.**

Record §1 claims the two existing globs already cover the new files. They do:
`server/test/supplier*.test.js` matches `supplierBankKeyRotation.test.js`, and
`server/test/integration/supplier*.integration.test.js` matches
`supplierBankRotation.integration.test.js`. I confirmed by running the profile's exact argv — the
recorded XML at `eaeb6c9` contains 15 cases from `supplierBankKeyRotation.test.js`.

### 7.6 The lookup command needs the encryption ring. **HELD.**

`plaintextOf` decrypts before recomputing the index, so both commands need both rings intact. A missing
encryption key fails every row with `BANK_KEY_NOT_IN_RING` and refuses to authorise removal — fail
closed, and now named rather than `UNKNOWN`.

### 7.7 `safeReason` matches the service's duplicate detection. **HELD.**

`safeReason`'s chain walk and errno-1062 test are character-for-character the logic
`SupplierBankService.#violates` arrived at through REV-036 H-1 and M-3. The author did not re-derive a
weaker version. See I-2 for the duplication.

---

## 8. Low findings

### L-1 — `endedAt` is always `startedAt`

`runRotation`'s `now = Date.now()` is a parameter default, evaluated once. `startedAt = now` and
`endedAt: now` are therefore the same value, always. Two real CLI runs:

```
"startedAt": 1790213352315, "endedAt": 1790213352315
"startedAt": 1790213352418, "endedAt": 1790213352418
```

A report that carries a start and an end and whose elapsed time is structurally zero is worse than one
that carries neither — a runbook that logs duration will log 0 ms for a four-hour rotation. Either take
a second reading at the end (`endedAt: Date.now()`, keeping `now` for the deterministic warning
arithmetic) or drop the pair.

### L-2 — `processed` counts rows the UPDATE did not write

`rotateRow` never inspects `affectedRows`. When the F-M3 guard fires — the row's key id changed, or the
row is gone — the UPDATE matches nothing, no error is thrown, and `processed` is incremented anyway.
Real MySQL, three rows, a second connection hard-deleting the first between `SELECT` and `UPDATE`:

```
{"deleted_row":74,"processed":3,"attempted":3,"failed":0,"remaining":0,
 "safeToRemoveFromKey":true,"rows_left":[[75,"enc-new"],[76,"enc-new"]]}
```

`processed: 3`, two rows written. `safeToRemoveFromKey` stays correct because `remaining` is
authoritative, so this is reporting only — but it discards the single signal that tells an operator the
concurrency guard fired at all, which is the thing F-M3 was about. Neither F-M3 test asserts
`processed`, so both pass either way. Read `affectedRows` and either count it separately or record a
`GUARD_DECLINED` entry.

### L-3 — the progress printer emits one line per row whenever nothing succeeds

```js
onProgress: options.json ? () => {} : ({ processed, lastId }) => {
  if (processed % 100 === 0) process.stdout.write(`processed=${processed} lastId=${lastId}\n`);
}
```

`processed` stays 0 while rows fail, and `0 % 100 === 0`. Real CLI, five failing rows:

```
processed=0 lastId=69
processed=0 lastId=70
processed=0 lastId=71
processed=0 lastId=72
processed=0 lastId=73
```

On a table where the rotation is failing at scale — precisely when an operator is watching — this emits
one stdout line per row. It also never fires at all for a clean run under 100 rows, so the "not a black
box" argument in the doc comment does not hold for the common case either. Gate on `attempted % 100`,
which is monotonic.

### L-4 — record §5 quotes output the code can no longer produce

§5 presents the fail-closed demonstration as:

```
processed 0 | failed 5 | remaining 5 | safeToRemove false   exit=1
failure reason: Supplier bank account failed authentication:
                the row, its context or its ciphertext was altered
```

Neither line is producible at `f0bc0de`. The CLI prints a JSON report, not a pipe-delimited summary, and
after the M-3 remediation `safeReason` emits `{"reason": "BANK_ACCOUNT_TAMPERED"}` with no message at
all. I reproduced the scenario in §1.6; the actual output is there. §9 M-3 explicitly points back at §5
as the path it repaired, which makes the stale quote in §5 the one that most needs updating.

### L-5 — the record's suite counts contradict the ledger

§6 claims `352/352`, §7 `356/356`, §9 `359/359` for `supplier-phase-001-server`. The harness's own
`run.json` for the corresponding runs records:

| run | `code_commit` | recorded counts |
| --- | --- | --- |
| `20260923T055825` | `1a47b655` | 407 testcases |
| `20260923T062434` | `18c16dac` | 411 testcases |
| `20260924T010133` | `eaeb6c92` | `{"total": 414, "passed": 414, "failed": 0, "skipped": 0}` |

My own run of the profile's exact argv at `f0bc0de` gives **414 / 414 / 0 fail / 0 skipped**. The
suite is genuinely green — the substance of the claim holds — but the three numbers in the record are
each 55 below what the ledger recorded for the same run, and I could not reproduce 359 from any
combination (414 with MySQL, 336 pass + 78 skipped without it, 303 for the non-integration glob alone).
Quote the ledger's `counts` object rather than a hand-copied figure.

### L-6 — two mutants hang instead of failing, and the suite has no timeout

`npm test` is `node --test --import ./test-support/testEnv.js`, with no `--test-timeout`, and
`node:test`'s default is infinite. Both non-termination mutants in this file (drop the cursor clause;
advance the cursor only on success) therefore hang indefinitely rather than fail. On a GitHub Actions
runner that is a job that burns to the default 360-minute limit before anyone sees a red cross. Either
pass `--test-timeout` in the `test` script, or — better, and local to this file — give the
"cursor advances" test a bound: it already collects `batches`, so
`assert.ok(batches.length <= 5, "the rotation must not re-read")` inside the `query` wrapper turns the
hang into an immediate, legible assertion failure.

### L-7 — `after` is a public parameter with no caller and no test

`runRotation({ …, after = 0 })` is documented ("`after`" appears in the resume comment) and feeds
`lastId = Number(after) || 0`. No CLI flag sets it, no test passes it, and the resume design explicitly
argues that external progress state is unnecessary. It is untested surface on the function that decides
which rows get rewritten. Per CLAUDE.md §2, delete it — the resume path is proven without it, in both
suites and on the real CLI.

### L-8 — operator-facing errors are raw Node stack traces

Every rejection from `main()` — a bad flag, a typo'd `--from`, a `--to` that is not active — reaches
the operator as an unhandled rejection:

```
file:///…/scripts/supplierBankRotationCli.js:27
    else throw new Error(`unknown argument ${argument}`);
               ^
Error: unknown argument --oops
    at parseArguments (…:27:16)
    at main (…:42:19)
    …
```

The exit code is right (1) and no secret is in the trace, but for a tool whose failure modes are
operator input this is the wrong affordance: wrap the body of `main` in a `try`/`catch` that writes
`error.message` plus a one-line usage string to stderr and returns 2. Note also that
`unknown argument ${argument}` echoes raw argv — if an operator ever mistypes a key *value* onto the
command line it lands in stderr and in shell history. Echo the flag name only.

### L-9 — two silent argument-parsing quirks

From the same untested `parseArguments`:

```
["--from=e1","--to=e2=x"]        => {"from":"e1","to":"e2"}      // truncated at the second '='
["--from=e1","--to=e2","--json=false"] => {"json":true, …}        // '=false' ignored
```

`const [flag, rawValue] = argument.slice(2).split("=")` discards everything past the second `=`. Base64
key material contains `=` padding, so an operator who pastes a key where an id belongs gets a silently
truncated value rather than an error — it is caught downstream by `assertSource`/`assertTarget` today,
but only by luck of those two guards. Use `split("=")` with a limit-aware join, and treat
`--json=<anything>` as an error rather than as `true`.

---

## 9. Info

### I-1 — no harness observation exists at the merge candidate

The newest run in `docs/supplier_management/evidence/` is `20260924T010133-a52a8b81b018`, recorded at
`code_commit: eaeb6c92ab63c5505463c9e40bb27308f512780e` — that is `HEAD~1`. `f0bc0de` appears nowhere in
`00_harness_state.json`. The same holds one round back (`18c16dac` for the run that preceded `28d974d`)
and two rounds back, so this is the module's known structural property — recording moves HEAD — not an
omission by the author. Stating it so the next reader does not mistake a green ledger for a green
candidate: **the ledger's evidence does not cover the remediation commit.** My own runs at `f0bc0de` do,
and are listed in the Summary.

### I-2 — `safeReason` duplicates `SupplierBankService.#violates`

Both walk `[error, error?.cause, error?.cause?.cause]`, both test `errno === 1062 || code ===
"ER_DUP_ENTRY"`, both anchor a `for key '(?:[^'.]*\.)?…'` regex. The service's version carries the
REV-036 H-1 comment explaining why the chain has to be walked at all
(`MySqlDatabaseExecutor.run()` wraps each statement). The rotation's copy does not, and it is the copy
that will be read next time someone wires `runRotation` to a `MySqlDatabaseService` rather than the
CLI's raw pool wrapper — at which point three links may not be enough. Extract one helper, or at least
carry the comment across.

### I-3 — the SELECT projection is unpinned by the unit double

Dropping `crypto_context` from `selectBatch`'s column list survives the unit suite, because the double
returns `{ ...r }` — the whole row — regardless of what the SQL asks for. The integration suite kills it
(all four tests). I am filing this as Info rather than folding it into M-1/M-2 precisely because the
real-MySQL layer catches it: it is the one place where the existing division of labour works as
designed. Worth knowing when reasoning about what the unit suite does and does not establish.

### I-4 — the `--limit` inner break and `attempted` accounting are correct

I checked the interaction that F-M2 created: `room = limit - attempted`, the inner
`if (limit > 0 && attempted >= limit) break`, and the outer `if (room <= 0) break`. There is no path on
which the outer loop issues another `SELECT` after the limit is reached, and none on which `room` can go
negative and be passed to `Math.min`. `--limit` below `batchSize`, `--limit` above the row count, and
`--limit` with every row failing all behave. No finding; recorded because it is the arithmetic REV-051
F-M2 changed and it deserves to be signed off.

### I-5 — `crypto_context` uniqueness still carries the AAD argument

Rotation never writes `crypto_context`, so `uq_supplier_bank_crypto_context` — which migration `0037`
identifies as *"「同一個 Supplier 兩行密文對調唔到」嘅唯一理由"* — is untouched by either command, and
the two AAD mutants in §6 confirm the binding survives re-encryption. The design's claim that a rotation
cannot rebind a row to another Supplier holds for the right reason.

---

## 10. What I could not check

Stated rather than implied, because "it cannot be tested here" has been wrong in this module before and
I would rather be precise about the residue.

- **The client suite.** Record §9 claims `646/646`. I did not run it. The change touches no client file
  (`git diff --stat` confirms: `server/`, `docs/`, `server/package.json` only), so I have no reason to
  doubt it, but I have not executed it.
- **CI on GitHub.** I ran the same commands CI runs, with the same MySQL configuration and the same
  `SUPPLIER_BANK_*` test keys from `.github/workflows/ci.yml`, on macOS with MySQL 26.7.0 rather than
  Ubuntu with `mysql:8.0`. Anything version-specific — in particular MySQL 5.7-vs-8.0 `ER_DUP_ENTRY`
  message formats, which M-3 depends on — I verified on 26.7.0 only.
- **`npm run test:coverage` and the per-file floors.** I ran `npm test`, not the coverage variant.
  `checkCoverageFloors.js` does not list any file from this change, and the new `server/scripts/` files
  are never loaded by the suite, so neither the global thresholds nor the per-file floors see the CLI at
  all. That is consistent with how the repo treats `scripts/`, and it is part of why M-4 matters, but I
  did not measure the resulting global coverage delta.
- **The boundary validator.** Record §1's claim of *"啱啱三條 `OUTSIDE_MODULE`, all in
  `server/scripts/`"* is the same claim REV-052 verified and I did not re-run the validator. The three
  files are where the record says they are.
- **A real concurrent rotation under load.** I simulated the SELECT/UPDATE race with a second connection
  at a single, deterministic interleaving (L-2). I did not run the rotation against sustained concurrent
  application writes.

---

## 11. Residual risk I would accept, if the four Mediums were closed

The shipped logic is sound and I want that on the record separately from the findings. The resume design
— the filter *is* the progress — is the right call and it is now genuinely pinned in the dimension that
matters most (`id > ?`). One transaction per row is the right trade. `--to` as a confirmation rather
than a selector was right in REV-051 and `--from` against the ring closes the symmetric hole. The
`remaining === 0 && failures.length === 0` condition for removing a key is correct and, unusually, the
second clause is tested for the right reason (`failAfterWrite`). AAD binding survives re-encryption,
proven by mutation in both suites. No key, no plaintext, no ciphertext and no blind index reaches the
report, the progress callback, stdout, stderr or a thrown stack, verified on real MySQL against a real
`ER_DUP_ENTRY` with a control that discriminates. Nothing in this change is reachable from a request.

What I would carry forward after the four Mediums close: L-2 (the guard's only signal is discarded),
I-2 (the duplicated chain walk, which is the next thing to break when the database wrapper changes), and
the standing recommendation from REV-034/REV-038 that the integration double be rebuilt on a real
`MySqlDatabaseService` — five fidelity gaps on one task is the argument for it, not against it.

---

## 12. Verdict

**CHANGES_REQUESTED** — 0 Critical, 0 High, **4 Medium**, 9 Low, 5 Info.

Five of the six prior Mediums are closed, verified by reproduction. REV-052 M-2 is partially closed. The
four Mediums that block are M-1 (`ORDER BY id`'s direction supplied by the double, mutant survives real
MySQL), M-2 (`remainingRows`' lookup branch untested, mutant reports `safeToRemoveFromKey: true` with
three rows still on the old key), M-3 (the F-M1 leak assertions cannot fail, proven against a real
leak), and M-4 (`--limit=0` rotates everything, on a CLI with no tests).

All four are test-side. None of them is a defect in the shipped rotation logic, and I want that
distinction to be clear in whatever decision follows: this candidate does not leak, does not corrupt,
and does not authorise removing a key that is still in use. What it does not yet have is a test suite
that would notice if it started to.
