# REV-054 — TASK-036 Bank key rotation, independent review of the REV-053 remediation

**Review:** REV-054 ・**Task:** TASK-036 (T36) ・**Phase:** PHASE-003 ・**Capability:** SUP-CAP-03
**Head reviewed:** `98c72f4d32559759dfdc07650956e3ae91b0451a` (`claude/supplier-task-036`).
**Subject:** `main…HEAD`, merge-base `c0ea960b9ca061b26cfee037163b4e5e7c42a1d0`.
**Delta since REV-053:** the REV-053 remediation plus a merge of `origin/main` (`c0ea960` — the whole
`customer` module, the `CUSTOMER_BANK_*` CI variables, migrations 0049–0054). Everything the merge
brought in is out of scope **as a review target**; it is emphatically not out of scope as an
*interaction*, and §2 is about exactly that.
**Worktree:** `/private/tmp/erp-rev-054` (detached, read-only by convention).
**Harness state:** `98c72f4` appears nowhere in `00_harness_state.json` — see I-4. The newest recorded
observation is still at `eaeb6c9`.
**Reviewer:** independent agent; not the author. Author is Claude Opus 5.

**Verdict: CHANGES_REQUESTED** — 0 Critical, **1 High**, 4 Medium, 8 Low, 5 Info.

**The REV-053 remediation is the best of the four so far, and I want that stated before the findings.**
All sixteen mutants in the record's §10 table die, none hangs, and I re-ran every one of them myself.
`--limit=0` is refused with a message that says what to do instead. `--help` exists. `parseArguments`
has a test file. The `declined` counter is real — I raced a second MySQL connection against a live
rotation and watched the guard fire, `declined: 1`, `processed: 2`, `safeToRemoveFromKey` still honest.
The fail-closed demonstration in §5 of the record is now reproducible verbatim. Two of REV-053's four
Mediums are fully closed.

**What blocks is five things, one of them new in kind.**

The first is not a test-quality finding, and it is the reason this round has a High. `main` arrived in
this merge carrying a rule that did not exist when REV-053 signed off: `validateApplicationConfiguration`
now requires *"Customer and Supplier bank capabilities must use the same key rings"*, byte for byte,
including the same `activeKeyId`. `customer_bank_accounts` carries its own `encryption_key_id` and
`blind_index_key_id`. `remainingRows` counts one table. So `safeToRemoveFromKey: true` — the report
field whose documented meaning is *"舊 key ... 先可以由 ring 度剷走"* — is now computed over half the
rows that key protects. I seeded one Customer bank row on `ci-enc-0`, ran the real supplier CLI to
completion, and got `remaining: 0, safeToRemoveFromKey: true, exit 0` with that row still on the old
key. Removing `ci-enc-0` as instructed makes it permanently undecryptable, and the operator cannot keep
the key in the Customer ring alone because the configuration validator rejects a mismatch. REV-053 §7.2
checked this exact property (*"I looked for a second table carrying `encryption_key_id`"*) and found
exactly one table. The merge the author performed as part of this candidate invalidated that check, and
nothing re-ran it.

The second is `ORDER BY`. REV-053 M-1 said the *direction* was supplied by the double. The remediation
taught the double to parse `ORDER BY (\w+)( DESC)?` — so `DESC` now dies. The **column** does not.
`ORDER BY supplier_id` survives the real-MySQL suite 4/4, and it is killed in the unit suite only
because a test-harness wrapper happens to sniff the literal string `"ORDER BY id"`. On real MySQL with
six rows across three suppliers it attempts four of six and never looks at two. Same method, same
double, one level down, after a remediation aimed at it. That is the fourth consecutive round in which
the fix closes the named instance and leaves its sibling.

The third is the leak scan, and it is the same error a third time. REV-053 M-3 said the scan was
calibrated to a shape the author invented rather than the shape MySQL emits. `duplicateKeyError()` now
emits MySQL's real shape — composite prefix, printable bytes literal, 64-character truncation. But the
scan compares those un-escaped bytes against `JSON.stringify(report)`, and `JSON.stringify` doubles
every backslash. Over 20 000 random index values, with a full `ER_DUP_ENTRY` leak present in the report,
the scan reports **nothing 55.2 % of the time**. Against the same message unescaped it misses 0.0 %. The
fixture is deterministic, so today's test is not flaky and does kill both `safeReason` mutants — but the
property it claims to establish is not established.

The fourth and fifth are both `main()`. REV-053 M-4's sentence named four unobserved surfaces — *"flag
parsing, the exit-code contract, the progress printer, the pool wiring"*. The remediation tested the
first one. `main` is still imported by no test in the repository: I reverted the REV-053 L-3 fix (the
progress gate back to `processed % 100`) and all 25 tests stayed green. And the new top-level catch
covers `parseArguments` at one end and `runRotation` at the other, but not the twelve lines between them
— `dotenv.config`, three dynamic imports, `normalizeSupplierConfig`, `new SupplierBankCrypto`,
`createMySqlDatabasePool`. A malformed key ring, which is the single most likely operator error *during
a key rotation*, still prints a raw Node stack trace and exits **1** — the code the CLI's own contract
now reserves for "the rotation ran and some rows failed".

None of these is a remote vulnerability. H-1 is a data-destruction path that an operator reaches by
following the tool's own instruction.

---

## Summary

| | |
| --- | --- |
| Critical | 0 |
| **High** | **1** (H-1) |
| **Medium** | **4** (M-1 … M-4) |
| Low | 8 (L-1 … L-8) |
| Info | 5 (I-1 … I-5) |
| REV-053 Mediums | M-1 **PARTIALLY CLOSED** ・M-2 **CLOSED** ・M-3 **PARTIALLY CLOSED** ・M-4 **PARTIALLY CLOSED** |
| Author's 16-mutant table | 16 re-run, **16 confirmed dead, none hanging** — table accepted in full |
| Disposition | **CHANGES_REQUESTED** |

### What I ran, and on what

Everything below was executed in `/private/tmp/erp-rev-054` at `98c72f4`, against the MySQL 26.7.0
instance on `127.0.0.1:3421` migrated to `0054`, with `/tmp/env53.sh` (CI's exact variables).

| | |
| --- | --- |
| `test/supplierBankKeyRotation.test.js` | **17 / 17 pass** |
| `test/supplierBankRotationCli.test.js` | **8 / 8 pass** |
| `test/integration/supplierBankRotation.integration.test.js` | **4 / 4 pass**, real MySQL |
| Profile suite `supplier-phase-001-server` (exact argv from `00_project_profile.json`) | **426 / 426**, 0 fail, 0 skipped |
| Full server suite (`npm test`, one run) | **2160 tests / 2155 pass / 2 fail / 3 skipped** — see L-2 |
| `npm run lint` | **exit 0** |
| Real CLI, both entry scripts | full run, resume, all-failing run, `--limit`, `--batch-size`, `--limit=0`, `--help`, typo `--from`, `--to` not active, unknown flag carrying a secret value, DB unreachable, malformed key ring |
| Mutation | 16 from the record + 21 of my own; 3 of mine against real MySQL as well |
| Live concurrency | a second connection racing a live rotation, to exercise `declined` on real MySQL |
| 20 000-sample statistical probe | sensitivity of the F-M1 leak scan (M-2) |

I did **not** run `npm run test:coverage` (out of scope for this review by instruction) or the client
suite. I did not stand up a MySQL instance; I used the one provided, and left it running.

### Restoration

Every production mutation was applied by a harness that runs `git checkout -- <the one mutated path>` in
a `finally` block — a single path, never `.`, because a sweep that runs `git checkout -- .` eats
uncommitted work. `git status --porcelain` at `98c72f4` now shows only this file and the pre-existing
`node_modules` symlink. All rows I created in `erp_dev` (`REV054%` suppliers, supplier bank accounts,
customers, customer bank accounts) are deleted; those four tables are back to zero rows.

---

## 1. Verification of REV-053's four Mediums

Each verified by execution, not by reading the diff.

### 1.1 REV-053 M-1 — `ORDER BY id` supplied by the double. **PARTIALLY CLOSED.**

**The half that is closed.** The double now reads the direction out of the SQL:

```js
const order = /ORDER BY (\w+)( DESC)?/u.exec(sql);
if (!order) throw new Error("the double cannot run a SELECT with no ORDER BY");
const [column, descending] = [order[1], Boolean(order[2])];
```

Both of REV-053's mutants die:

```
[M-1  ORDER BY id DESC] unit: exit=1   25 tests, 23 pass, 2 fail
[M-1b drop ORDER BY]    unit: exit=1   25 tests, 10 pass, 15 fail
```

**The half that is not.** The *column* is still unpinned. See M-1 below, with the real-MySQL evidence.

### 1.2 REV-053 M-2 — `remainingRows`' lookup branch untested. **CLOSED.**

Two assertions were added to the duplicate test (`remaining: 1`, `safeToRemoveFromKey: false`) and one
to the half-rotated integration test (`half.remaining === Number(still.n)`). The mutant now dies in
**both** suites, which is what REV-053 asked for:

```
[M-2 remainingRows always encryption_key_id] unit:  exit=1   24 pass, 1 fail
[M-2 remainingRows always encryption_key_id] integ: exit=1    3 pass, 1 fail    (real MySQL)
```

The integration assertion is the one that matters, because the unit double picks its column by
`sql.includes("encryption_key_id")` and is therefore self-consistent with the mutant. Tying the report
to the test's own raw `COUNT(*)` breaks that self-consistency. Correct fix, at the correct level.

*(The scope of what `remainingRows` counts is a separate matter, and it is H-1.)*

### 1.3 REV-053 M-3 — the F-M1 leak assertions cannot fail. **PARTIALLY CLOSED.**

Three of the four things REV-053 asked for were done, and done well:

- the scan moved into **its own test**, so it now runs in the mutant case instead of being aborted by an
  earlier `assert.equal` on `constraint`;
- `duplicateKeyError()` emits MySQL's real shape — composite `${supplier_id}-${key_id}-` prefix,
  printable bytes literal, `\xNN` only for non-printables, hard truncation at 64 characters;
- an explicit **negative control** was added, asserting the scan returns `["mysql"]` on a report that
  genuinely leaks.

Both leak mutants die, and the second is a good mutant that the old three-line scan could not have
caught:

```
[M-3  safeReason forwards the driver message]   unit: exit=1   23 pass, 2 fail
[M-3b safeReason forwards a 30-character slice] unit: exit=1   23 pass, 2 fail
```

What is not closed is the property those assertions claim to establish. See M-2 below.

### 1.4 REV-053 M-4 — `--limit=0`, and `parseArguments` untested. **PARTIALLY CLOSED.**

The `--limit=0` half is closed outright, on the real CLI:

```
$ node scripts/rotateSupplierBankEncryption.js --from=ci-enc-0 --to=ci-enc-1 --limit=0
--limit must be a positive integer; omit it to rotate every remaining row

Usage: --from=<keyId> --to=<activeKeyId> [options]
  …
exit=2
```

`--help` exists and prints the same `USAGE`; both entry doc comments now name every flag and warn in as
many words that `--limit=0` is not a dry run. Both mutants die:

```
[M-4  --limit accepts 0 again] unit: exit=1   24 pass, 1 fail
[M-4b --json accepts a value ] unit: exit=1   24 pass, 1 fail
```

The test file is genuinely good. The `--oops=super-secret` test asserts the *value* is absent from the
message rather than merely that the flag name is present — a control that discriminates.

What is not closed is the other three quarters of REV-053 M-4's sentence. See M-3 and M-4 below.

---

## 2. [HIGH] H-1 — `safeToRemoveFromKey` authorises removing a key that Customer bank rows are still encrypted under

**Where:** `server/src/modules/supplier/bankKeyRotation.js`, `remainingRows()` and the
`safeToRemoveFromKey` field; interacting with
`server/src/framework/configuration/applicationConfiguration.js`, `checkSharedBankKeyRings()`, which
arrived in this merge.

```js
export async function remainingRows(database, kind, keyId) {
  const column = kind === ROTATION_KINDS.ENCRYPTION ? "encryption_key_id" : "blind_index_key_id";
  const [[row]] = await database.query(
    `SELECT COUNT(*) AS remaining FROM supplier_bank_accounts WHERE ${column} = ?`, [keyId]
  );
```

One table. And `scripts/rotateSupplierBankEncryption.js` tells the operator what that number licenses:

> 舊 key 只有喺 row count 為 0 而且今次 run 冇失敗行之後先可以由 ring 度剷走 —— report 個
> `safeToRemoveFromKey` 就係嗰個判斷。

**What the merge changed.** `c0ea960` brought in a cross-module configuration rule:

```js
function checkSharedBankKeyRings(customer, supplier, details) {
  …
  if (!sameKeyGroup(customer.bankEncryption, supplier.bankEncryption) ||
      !sameKeyGroup(customer.bankLookup, supplier.bankLookup)) {
    details.push({ section: "customer",
      message: "Customer and Supplier bank capabilities must use the same key rings with owner-separated AAD" });
  }
}
```

and `sameKeyGroup` compares `activeKeyId`, the set of key ids, **and the revealed material of every
key**. `customer_bank_accounts` carries its own `encryption_key_id varchar(64)` and
`blind_index_key_id varchar(64)` (confirmed against the live schema at `0054`). So at this merge
candidate the Supplier ring and the Customer ring are, by configuration law, one ring protecting two
tables — and only one of them is counted.

**Reproduced on real MySQL.** One Customer bank row on `ci-enc-0`, three Supplier bank rows on
`ci-enc-0`, the real CLI, no flags:

```
$ node scripts/rotateSupplierBankEncryption.js --from=ci-enc-0 --to=ci-enc-1 --json
{"kind":"encryption","from":"ci-enc-0","to":"ci-enc-1","processed":3,"attempted":3,"declined":0,
 "failed":0,"failures":[],"lastId":446,"remaining":0,"safeToRemoveFromKey":true,"warnings":[],
 "startedAt":1790297769820,"endedAt":1790297769831}
exit=0

mysql> SELECT … WHERE encryption_key_id='ci-enc-0';
tbl                       rows_on_ci_enc_0
supplier_bank_accounts    0
customer_bank_accounts    1
```

`safeToRemoveFromKey: true`, exit 0, no warning, with a Customer bank account still encrypted under
`ci-enc-0`.

**What happens if the operator believes it.** Removing `ci-enc-0` from the ring, as instructed:

```
customer row 51 -> Error: Customer bank account encryption key is unavailable
```

The row is unreadable. Its blind index is also unmatchable, so the Customer duplicate check silently
stops seeing it. If the key material is discarded — which is the entire point of removing a key from a
ring — this is unrecoverable loss of a bank account number.

**And the operator cannot avoid it by keeping the key in the Customer ring only:**

```
$ SUPPLIER_BANK_ENCRYPTION_KEYS='{"ci-enc-1":"…"}' node -e 'validateApplicationConfiguration(defaultConfigurationSource())'
- customer: Customer and Supplier bank capabilities must use the same key rings with owner-separated AAD
```

The application refuses to start. The two rings move together or not at all, which means the two tables
must be drained together, which means neither tool alone can authorise the removal.

**Why this is High and not Critical.** It is not remotely reachable and it is not automatic: it needs an
operator to act on the report. But the report *is* an explicit authorisation, it is emitted with exit
code 0, and the action it authorises destroys customer bank data irreversibly. There is no compensating
control anywhere — no warning, no cross-check, no second confirmation.

**Why the existing suites cannot see it.** Both suites construct a `SupplierBankCrypto` directly and
never go through `validateApplicationConfiguration`, so the rule coupling the rings is invisible to
them; and no test in this change touches `customer_bank_accounts`. The mutant that would have caught it
— "`remainingRows` counts only one table" — is not a mutant, it is the shipped code.

**Note on the sibling tool.** `scripts/rotateCustomerBankEncryption.js` →
`CustomerBankMaintenanceService` reports `{ processed, lastId, remaining }` and makes **no**
`safeToRemoveFromKey` claim. The supplier tool is the only thing in the repository that issues an
authorisation to remove a key from the ring, and it is the one with the narrower view.

**Fix.** Three options, in my order of preference:

1. Scope the condition to the ring, not to the module: `safeToRemoveFromKey` requires zero rows on the
   old key in **every** table bound to that ring. At this candidate that is `supplier_bank_accounts` and
   `customer_bank_accounts`. The cheapest honest version is a second `COUNT(*)` plus a
   `blockedBy: ["customer_bank_accounts"]` entry in the report.
2. If reaching across the module boundary is unacceptable (HD-034 already had to accept one
   `OUTSIDE_MODULE` for this task), then **stop making the claim**: rename the field to something that
   only says `supplierRowsRemaining === 0`, drop the imperative sentence from both entry doc comments,
   and have the report carry an explicit *"this does not account for other tables sharing this key
   ring"* warning. A tool that does not authorise cannot mis-authorise.
3. Fail closed: refuse to emit `safeToRemoveFromKey: true` while `checkSharedBankKeyRings` is in force,
   unless an explicit `--ring-scope-confirmed` flag is passed.

Whichever is chosen, REV-053 §7.2 needs re-running as part of it, and its conclusion needs to become a
property a test checks rather than a fact a reviewer once observed — because the thing that invalidated
it was a merge, and the next merge can do it again.

---

## 3. [MEDIUM] M-1 — the `ORDER BY` **column** is still supplied by the double, and the mutant survives real MySQL

**Where:** `server/src/modules/supplier/bankKeyRotation.js`, `selectBatch()`; and
`server/test/supplierBankKeyRotation.test.js`, the `query` double.

REV-053 M-1 was `ORDER BY id` → `ORDER BY id DESC`, and that now dies. `ORDER BY id` →
`ORDER BY supplier_id` does not, in the dimension that counts:

```
[X1 ORDER BY supplier_id] unit:  exit=1   24 pass, 1 fail
[X1 ORDER BY supplier_id] integ: exit=0   4 / 4 pass, real MySQL
```

**The unit kill is an accident, not an assertion.** The one failing test is
`"the cursor advances, so a rotation terminates instead of re-reading the same batch"`, and this is how
it fails:

```
✖ the cursor advances, so a rotation terminates instead of re-reading the same batch
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
    actual:   [],
    expected: [ 1, 2, 3, 4, 5 ],
```

`actual: []` — the batch list is *empty*. That is not the cursor misbehaving; it is the test's own
wrapper:

```js
if (sql.includes("ORDER BY id")) batches.push(result[0].map((r) => r.id));
```

The wrapper stopped recognising the SELECT. Every behavioural assertion in the test passed. Change that
literal to `ORDER BY supplier_id` and the mutant survives the unit suite too.

The double itself is honest — it sorts by `r[column]` using the column it parsed — so the reason nothing
notices is the fixture: **every row in both suites has the same `supplier_id`**
(`seed(c, { id, supplierId = 7 })` in the unit tests; one `seedSupplier` per test in the integration
tests), so sorting by `supplier_id` is a stable no-op.

**What it does on real MySQL.** Six rows across three suppliers, ids `403…408` belonging to suppliers
`420, 421, 422, 420, 421, 422`, every row permanently failing (`BANK_ACCOUNT_TAMPERED`),
`--batch-size=2`.

Correct code:

```
{"processed":0,"attempted":6,"declined":0,"failed":6,
 "failures":[{"id":403},{"id":404},{"id":405},{"id":406},{"id":407},{"id":408}],
 "lastId":408,"remaining":6,"safeToRemoveFromKey":false}   exit=1
```

With `ORDER BY supplier_id`:

```
{"processed":0,"attempted":4,"declined":0,"failed":4,
 "failures":[{"id":403},{"id":406},{"id":407},{"id":408}],
 "lastId":408,"remaining":6,"safeToRemoveFromKey":false}   exit=1
```

Four of six attempted. Ids **404 and 405 are never looked at**, and the run says nothing about them: it
reports `attempted: 4` as though four were all there were. The mechanism is the one REV-053 described
for `DESC` — a cursor that assumes `id` order applied to a result set ordered by something else — and it
is live for any ordering column whose order is not a refinement of `id`'s.

**Why this is Medium and not High.** `remaining` is a separate `COUNT(*)`, so `safeToRemoveFromKey`
stays honest within its (narrow — see H-1) scope, and the mutant alone cannot authorise removing a key
that supplier rows still use. The damage is a run that under-reports its own coverage and a resume that
never converges.

**Why it blocks.** This is the fourth consecutive round in which a remediation closes the named instance
and leaves the sibling named in the same breath: REV-052 M-2 named the hardcoded `WHERE` *and* the
unconditional sort; REV-053 M-1 got the sort's direction; the sort's column is still the double's. There
is no reason to expect the next round to differ unless the fixture changes.

**Fix.** Two lines, in the fixture rather than in the double:

1. Give the unit rows more than one `supplier_id` — `supplierId: id % 2 ? 7 : 3` in the cursor test is
   enough, and then sorting by `supplier_id` genuinely reorders and the existing
   `assert.deepEqual(seen, [1, 2, 3, 4, 5])` fires for the right reason.
2. Give the "interrupted rotation resumes" integration test two suppliers rather than one, so real MySQL
   sees the same thing.

While there: replace the wrapper's `sql.includes("ORDER BY id")` with a predicate that cannot silently
stop matching (`sql.includes("FROM supplier_bank_accounts") && !sql.includes("COUNT(*)")`), so a future
SQL edit produces a red assertion instead of an empty array.

---

## 4. [MEDIUM] M-2 — the leak scan misses a genuine `ER_DUP_ENTRY` leak 55 % of the time, because it scans JSON-escaped text with un-escaped needles

**Where:** `server/test/supplierBankKeyRotation.test.js`, `leakedEncodings()` and the test
`"no encoding of the blind index may reach the report, whatever MySQL echoed back"`.

```js
  const serialised = JSON.stringify(report);
  assert.deepEqual(leakedEncodings(serialised, index), [], "the index must not appear in any encoding");
```

and, inside `leakedEncodings`, the `mysql` encoding — the one that exists specifically to model what
MySQL emits:

```js
  const rendered = [...indexBytes]
    .map((byte) => (byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte)
                                                 : `\\x${byte.toString(16).toUpperCase().padStart(2, "0")}`))
    .join("");
```

`rendered` contains real backslash characters. `JSON.stringify` doubles every one of them. An
eight-character window of `rendered` containing a backslash anywhere except at its very edges therefore
**cannot** appear in `serialised`, whatever the report contains.

**Measured.** 20 000 random 32-byte indexes, each formatted into MySQL's real message shape
(`Duplicate entry '<supplier_id>-<key_id>-<rendered>' for key '…'`, truncated at 64 characters) and
placed in a report as a fully forwarded `reason`:

```
haystack = JSON.stringify(report)  -> missed 11037/20000 (55.2%)
haystack = the raw message string  -> missed     0/20000 ( 0.0%)
```

With the leak completely present, the scan reports **no leak at all** more often than not. The only
difference between those two lines is the escaping.

**Why today's test still passes and still kills the mutants.** The fixture is deterministic — fixed
`KEY_C`, fixed `ACCOUNT`, `supplierId: 7` — so the index is always
`efb211dd511c6edd7a536ad05a5118767db320717998da67faee3ba576ff4eec`, and it happens to contain two
qualifying windows:

```
mysql      ["\xDDzSj\", "\xB3 qy\"]
latin1     []      hex []      HEX []      base64 []      base64url []
```

Two windows out of roughly twenty-five, both of which survive escaping only because their backslashes
sit exactly at the edges. **There is no flake risk** — the fixture never changes on its own, and that is
why the negative control returns `["mysql"]` and why `M-3`/`M-3b` die. What there is, is a barrier whose
sensitivity is a coin flip and which nobody measured, standing in front of the one finding (REV-051
F-M1) the test exists to prevent.

**Why this is Medium.** The shipped code does not leak — REV-053 §1.1 proved that against a real
`ER_DUP_ENTRY` and I have no reason to re-litigate it. This is the regression barrier, and it is the
*third* iteration of the identical mistake: F-M1 escaped because the base64 scan looked for a shape the
author invented; REV-053 M-3 was that error one layer up; this is that error one layer up again, with a
new intermediary (`JSON.stringify`) nobody accounted for. The module's own standard is *negative
controls must discriminate* — and this one discriminates for one value of one fixture, which is weaker
than it reads.

**Fix.** One helper, and it makes the scan stronger than anything asked for so far. Do not scan the JSON
text; scan the report's string content:

```js
function stringsIn(value) {
  if (typeof value === "string") return [value];
  if (value && typeof value === "object") return Object.values(value).flatMap(stringsIn);
  return [];
}
const serialised = stringsIn(report).join("\u0000");
```

Then `leakedEncodings` compares like with like and the miss rate goes to 0.0 %. Keep
`assert.ok(!JSON.stringify(report).includes("Duplicate entry"))` as the cheap second check. And make the
negative control non-fixture-dependent — run it over three different account numbers and require a hit
on each.

---

## 5. [MEDIUM] M-3 — `main()` is still imported by no test, and a REV-053 fix inside it can be reverted with every suite green

**Where:** `server/scripts/supplierBankRotationCli.js`, `main()`; and
`server/test/supplierBankRotationCli.test.js`, which imports `parseArguments` and `USAGE` and nothing
else.

REV-053 M-4 listed four unobserved surfaces in one sentence: *"flag parsing, the exit-code contract, the
progress printer, the pool wiring"*. The remediation delivered a test file for the first.

**The progress printer is the demonstration, because a REV-053 fix landed there.** The remediation moved
the gate from `processed % 100` (which fires on *every row* while rows fail, since `processed` stays 0
and `0 % 100 === 0`) to the monotonic `attempted % 100`. I reverted exactly that:

```js
-        if (attempted % 100 === 0) {
+        if (processed % 100 === 0) {
```

```
[X6 progress gate back to processed] unit: exit=0   25 tests, 25 pass, 0 fail
```

The regression the author repaired this round can be reintroduced with the full unit suite green and the
full integration suite green. The same is true of the exit-code contract (`0` / `1` / `2`), the `--help`
short-circuit at the `main` level, the `--json` branch that silences progress, and the `database`
adapter built around `pool.getConnection()`.

**Why this is Medium rather than Low.** It is the same finding REV-053 filed as a Medium, with three of
its four parts untouched, and it now has a concrete live example rather than an argument. The
operator-facing layer of a key-rotation tool is not an unusual place for a defect: REV-052 M-1 lived
there, REV-053 M-4 lived there, and M-4 below lives there now.

**Fix.** `main` is already a pure function of `(kind, argv)` in everything except its imports. Inject
them — a `deps` parameter defaulting to what it does today — and the whole surface becomes testable
without MySQL:

```js
export async function main(kind, argv = process.argv.slice(2), deps = loadDependencies) { … }
```

Four tests cover the sentence: `--help` returns 0 and writes `USAGE` to stdout; a bad flag returns 2 and
writes to stderr, not stdout; a report with `failed > 0` returns 1 and one with `failed === 0` returns
0; and a 250-row run in which every row fails emits exactly two progress lines — the assertion that
kills X6. None of them needs a database.

---

## 6. [MEDIUM] M-4 — the new top-level catch does not cover config, crypto or pool construction, and the uncovered path exits 1

**Where:** `server/scripts/supplierBankRotationCli.js`, lines 95–125 — everything between the
`parseArguments` try/catch and the `runRotation` try/catch.

```js
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${USAGE}\n`);
    return 2;                                                  // ← parseArguments is covered
  }
  …
  dotenv.config({ path: … });                                  // ┐
  const [{ default: supplierConfig }, …] = await Promise.all(…) // │
  const supplier = normalizeSupplierConfig(supplierConfig);     // │  not covered
  const crypto = new SupplierBankCrypto({ … });                 // │
  const pool = createMySqlDatabasePool(normalizeDatabaseConfig(databaseConfig));  // ┘
  …
  try { const report = await runRotation({ … }); … }
  catch (error) { process.stderr.write(`${error.message}\n`); return 2; }   // ← runRotation is covered
```

REV-053 L-8 asked for *"a `try`/`catch` that writes `error.message` plus a one-line usage string to
stderr and returns 2"* around **the body of `main`**. Both ends got one. The middle did not.

**Reproduced — the two sides of the boundary, same command, same instance:**

```
$ DB_PORT=1 node scripts/rotateSupplierBankEncryption.js --from=ci-enc-0 --to=ci-enc-1
connect ECONNREFUSED 127.0.0.1:1
exit=2                                                            ← covered, correct

$ SUPPLIER_BANK_ENCRYPTION_KEYS='{"ci-enc-1":' node scripts/rotateSupplierBankEncryption.js --from=ci-enc-0 --to=ci-enc-1
file:///…/server/src/modules/supplier/normalizeSupplierConfig.js:32
      throw new Error(`Supplier config "${name}.keyRing" must be a valid JSON object`);
            ^
Error: Supplier config "bankEncryption.keyRing" must be a valid JSON object
    at parseKeyRing (…/normalizeSupplierConfig.js:32:13)
    at normalizeKeyGroup (…/normalizeSupplierConfig.js:65:19)
    at normalizeSupplierConfig (…/normalizeSupplierConfig.js:99:37)
    at main (…/scripts/supplierBankRotationCli.js:105:20)
    at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
    at async file:///…/scripts/rotateSupplierBankEncryption.js:19:20

Node.js v26.6.0
exit=1                                                            ← not covered
```

**Two things are wrong, and the second is the worse.**

The raw stack trace is the cosmetic half — the part of REV-053 L-8 that was not fixed. The **exit code**
is the half that is new this round. Before the remediation everything failed with 1. Now `2` means "the
operator gave me something I cannot work with" and `1` means *"`report.failed !== 0`"* — the rotation
ran, some rows are still on the old key, do not remove it. A malformed key ring now reports the second.
A runbook or CI job branching on the exit code — which is the whole reason the contract was introduced —
will read "partial rotation, re-run and investigate the failed rows" when in fact the tool never opened
a connection.

And a half-edited key ring is not an exotic failure for *this* program. Editing
`SUPPLIER_BANK_ENCRYPTION_KEYS` **is** the rotation procedure; the CLI is run immediately afterwards, by
hand, by someone who has just pasted base64 into an environment file. It is the most likely error this
tool will ever see.

**No secret reaches either path — I checked.** I enumerated every error that can reach the covered
`runRotation` catch: `assertTarget` and `assertSource` (key **ids** and the ring's id list — non-secret,
they are written per row in the database; the CLI prints `(ci-enc-0, ci-enc-1)`), `unknown rotation
kind`, and driver errors from `selectBatch` / `remainingRows`. The `ER_DUP_ENTRY` path that embeds a
blind index is caught per row and passed through `safeReason`, and cannot reach here. On the uncovered
path, `normalizeSupplierConfig`'s six throw sites name a *section* and a *key id* and never the
material, and Node's stack-trace source line is the `throw` statement itself. Clean in both cases.

**Fix.** Move the construction inside the existing `try`, with the pool, and guard the `finally`:

```js
  let pool;
  try {
    …imports and construction…
    pool = createMySqlDatabasePool(normalizeDatabaseConfig(databaseConfig));
    const report = await runRotation({ … });
    …
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 2;
  } finally {
    await pool?.end();
  }
```

and pin it with one of the `main` tests from M-3.

---

## 7. The author's sixteen-mutant table, re-run

I applied every one of the sixteen myself against `test/supplierBankKeyRotation.test.js` and
`test/supplierBankRotationCli.test.js`, restoring after each. **I accept all sixteen. Sixteen die, none
hangs**, exactly as §10 of the record claims.

| Mutant (record §10) | My result |
| --- | --- |
| M-1 `ORDER BY id DESC` | KILLED exit=1 (23/25) |
| M-1b drop `ORDER BY` | KILLED exit=1 (10/25) |
| M-2 `remainingRows` always `encryption_key_id` | KILLED exit=1 (24/25) — **and** KILLED on real MySQL (3/4) |
| M-3 `safeReason` forwards the message | KILLED exit=1 (23/25) |
| M-3b `safeReason` forwards a 30-char slice | KILLED exit=1 (23/25) |
| M-4 `--limit` accepts 0 again | KILLED exit=1 (24/25) |
| M-4b `--json` accepts a value | KILLED exit=1 (24/25) |
| REV-052 M-1 drop the `--from` ring check | KILLED exit=1 (24/25) |
| L-9 `split("=")` truncates again | KILLED exit=1 (24/25) |
| L-8 unknown flag echoes argv | KILLED exit=1 (24/25) |
| L-2 `rotateRow` always claims the write | KILLED exit=1 (24/25) |
| L-1 `endedAt` is `startedAt` | KILLED exit=1 (24/25) |
| drop `AND id > ?` | KILLED exit=1 (19/25) — **no longer hangs** |
| F-M3 encryption guard vacuous | KILLED exit=1 (24/25) |
| F-M3b lookup guard vacuous | KILLED exit=1 (24/25) |
| `safeToRemove` ignores failures | KILLED exit=1 (24/25) |

**The `HUNG` → `KILLED` conversion is real and deserves its own line.** REV-053 L-6 was that `node --test`
has no default timeout, so the two non-terminating mutants burned a CI job to its limit instead of going
red. The cap now lives in the double, not in a test:

```js
if (sql.includes("ORDER BY") && (selects += 1) > 50) {
  throw new Error("the rotation is not terminating: the double refuses a 51st SELECT");
}
```

Placing it in the double rather than in one test is right for the reason the comment gives — the first
test to hit a non-terminating mutant is not necessarily one with a wrapper — and I confirmed it fires:
`drop AND id > ?` now produces six legible assertion failures in under a second, where REV-053 recorded
no termination in 90 s. That is the single best change in this remediation.

### Mutants of my own

Twenty-one, against both suites wherever the answer could differ.

| Mutant | unit | real MySQL |
| --- | --- | --- |
| `ORDER BY id` → `ORDER BY supplier_id` | killed **by a harness string-sniff, not an assertion** | **SURVIVED 4/4** → M-1 |
| progress gate `attempted % 100` → `processed % 100` | **SURVIVED 25/25** | — (no test loads `main`) → M-3 |
| drop `Math.min(batchSize, room)` | **SURVIVED 25/25** | — → I-1 |
| drop the inner `attempted >= limit` break | **SURVIVED 25/25** | — → I-1 |
| drop **both** of the two above | KILLED (23/25) | overshoots: `--limit=2` rotates 5 of 5 |
| drop `crypto_context` from the SELECT projection | **SURVIVED 25/25** | KILLED (0/4) → I-2 |
| `remainingRows` drops its `WHERE` | KILLED (23/25) | — |
| `declined` never counted | KILLED (23/25) | — |
| `declined` counted as `processed` | KILLED (23/25) | — |
| `attempted` counts only successes | KILLED (23/25) | — |
| `lastId` advances only when nothing has failed | KILLED (19/25) | — |
| AAD: re-encrypt under a fresh `crypto_context` | KILLED (24/25) | KILLED (3/4) |
| AAD: re-encrypt under `supplierId: 0` | KILLED (24/25) | — |
| `assertSource` drops the `from === to` check | KILLED (24/25) | — |
| the double's select cap raised 50 → 5000 | SURVIVED — expected; it is a safety net, not a behaviour | — |

The two AAD mutants dying in both suites is worth restating, because it is the claim with the largest
consequence if it were wrong: re-encryption cannot silently rebind a row to a different Supplier or a
different `crypto_context`, and that is pinned by executable tests rather than by argument.

---

## 8. Claims I attacked and that held

### 8.1 `declined` is real on MySQL, not an artefact of the double. **HELD.**

This is the REV-053 L-2 remediation, and the one I was most prepared to fault, because `declined` comes
from `affectedRows` and nothing in the integration suite exercises it. I raced a second live connection
against a running rotation, moving the first selected row off the old key between `SELECT` and `UPDATE`:

```
raced row: 447
{"processed":2,"attempted":3,"declined":1,"failed":0,"remaining":0,"safeToRemoveFromKey":true}
```

The guard fired on real MySQL, the row was not overwritten, it was counted as `declined` rather than
`processed`, and `safeToRemoveFromKey` stayed correct (the raced row left the old key by the other
writer's hand, so `remaining` is genuinely 0).

I also checked the one way `affectedRows` could produce a false `declined` — an UPDATE that matches a
row but writes values identical to the ones already there:

```
no-op UPDATE that matches one row -> affectedRows = 1  changedRows = 0
```

The connection reports **matched** rows, not changed rows, so a no-op write is never mistaken for a
guard decline. (It could not arise anyway: encryption rotation writes a fresh random IV every time, and
lookup rotation always changes `blind_index_key_id` because `from === to` is refused. But it is measured
rather than argued.)

### 8.2 `processed + declined + failed === attempted`. **HELD**, structurally.

Exactly one of the three counters is incremented per `attempted += 1`, on every path including a commit
that fails after the write landed. Three mutants that break the identity all die. No test states the
identity outright — see L-6.

### 8.3 Idempotence, and a rerun after a completed rotation. **HELD.**

Real CLI, immediately after a clean full run:

```
{"processed":0,"attempted":0,"declined":0,"failed":0,"failures":[],"lastId":0,
 "remaining":0,"safeToRemoveFromKey":true}   exit=0
```

Nothing is selected, because rotated rows no longer carry the `from` key id. A rerun cannot mangle
already-rotated rows.

### 8.4 The fail-closed demonstration in record §5. **HELD, and now reproducible.**

REV-053 L-4 was that §5 quoted output the code could no longer produce. The record now quotes a JSON
report with `declined` and distinct `startedAt` / `endedAt`. I reproduced the scenario (rows whose
`encryption_key_id` lies about their ciphertext) on the real CLI:

```
{"kind":"encryption","from":"ci-enc-0","to":"ci-enc-1","processed":0,"attempted":6,"declined":0,
 "failed":6,"failures":[{"id":403,"reason":"BANK_ACCOUNT_TAMPERED"}, … {"id":408,…}],
 "lastId":408,"remaining":6,"safeToRemoveFromKey":false,"warnings":[],
 "startedAt":1790297449452,"endedAt":1790297449460}   exit=1
```

Same shape, same reasons, `endedAt > startedAt`, exit 1. L-4 is closed.

### 8.5 No key material, plaintext, ciphertext or blind index on any CLI surface. **HELD.**

Every stdout and stderr line I produced across twelve real CLI invocations carries only key **ids**, row
**ids**, counts, reason codes and a constraint name. The one place raw operator input could have been
echoed now prints the flag name only, and the test asserts the value is absent rather than asserting the
name is present:

```
$ node scripts/rotateSupplierBankEncryption.js --from=… --to=… --oops=R4EVice6+okHiRFgg4gm0rYpYKWA8HMxCVjxOlS9RQg=
unknown argument --oops
exit=2
```

### 8.6 The profile needs no change. **HELD.**

`server/test/supplier*.test.js` matches both `supplierBankKeyRotation.test.js` and the new
`supplierBankRotationCli.test.js`; `server/test/integration/supplier*.integration.test.js` matches the
integration file. I ran the profile's exact argv: 426 cases, all passing.

### 8.7 No SQL injection in the two interpolations. **HELD** (unchanged from REV-053 §7.4).

---

## 9. Low findings

### L-1 — record §10 claims 424/424 for the profile suite; the merge candidate is 426/426

The record's verification table gives `Profile suite supplier-phase-001-server — 424/424`. At `98c72f4`
the same argv gives **426 / 426 / 0 fail / 0 skipped**. The two extra cases come from the merge the
author performed as part of this candidate:

```
$ git diff --stat HEAD^1 HEAD -- server/test/configuration.test.js
 server/test/configuration.test.js | 59 +++++++++++++++++++++++++++++++++++++++
```

— the two new Customer/Supplier shared-key-ring configuration tests, and `configuration.test.js` is in
the profile's argv. The suite is genuinely green either way, so this is bookkeeping; but it is REV-053
L-5 recurring in a new form: the number in the record describes a commit that is not the one being
submitted. Record the count for the head you are asking to merge, or quote the ledger's `counts` object.

### L-2 — record §10 claims the full server suite is 2002/1/2; the merge candidate is 2160/2155/2/3

One run of `npm test` at `98c72f4` with CI's variables:

```
ℹ tests 2160    ℹ pass 2155    ℹ fail 2    ℹ skipped 3
```

The two failures:

- `TC-016 adapter verifies a separately restored schema through a read-only transaction` — wants
  `DB_ADMIN_USER` / `DB_ADMIN_PASSWORD`, known-local, fails identically on unmodified code.
- `TC-059 real MySQL Customer precheck persists evidence without changing Customer aggregates` —
  `Error: Deadlock found when trying to get lock; try restarting transaction`, thrown at
  `src/modules/customer/CustomerImportService.js:152`. It **passes in isolation** (`1/1`), so it is a
  deadlock under the parallel full-suite run, inside the `customer` module this merge brought in. The
  rotation touches only `supplier_bank_accounts` and cannot be its counterparty. I did not run the full
  suite at `c0ea960` to prove it pre-exists — see §11.

Same point as L-1: the figure in the record is from before the merge.

### L-3 — `--batch-size` has a lower bound and no upper bound, while its sibling in the same directory has both

```
$ node -e '…parseArguments(["--from=a","--to=b","--batch-size=1e9"])'
{"batchSize":1000000000,"transitionStarted":null,"json":false,"from":"a","to":"b"}
```

That is `LIMIT 1000000000` on a projection including `account_ciphertext VARBINARY(512)` — a run that
pulls the whole table's ciphertext into the Node heap at once. `scripts/rotateCustomerBankEncryption.js`,
ten files away, does:

```js
!Number.isSafeInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 1000
```

This was the round that tightened this parser; the upper bound belonged in it. Cap at 1000 and say so in
`USAGE`.

### L-4 — `--from=` with an empty value reports the wrong problem

```
$ node -e '…parseArguments(["--from=","--to=b"])'
both --from and --to are required
```

`--from` *was* supplied; its value was empty. The message sends the operator looking for a missing flag.
One extra branch: if the flag was seen and `rawValue` is `""`, say `--from needs a key id`.

### L-5 — a failure in the final `COUNT(*)` discards the entire report

`remainingRows` runs after the loop and outside any per-row `try`. A connection lost at that moment
throws out of `runRotation`, is caught by the top-level catch, and returns 2 having printed one line — so
a run that successfully rotated 100 000 rows and collected a list of failures emits **none** of it: no
`lastId`, no `failures`, no `processed`. Resume is by filter so nothing is corrupted, but the operator
loses the failure list, which is the only record of which rows need attention. Build the report first and
attach `remaining: null, safeToRemoveFromKey: false` when the count cannot be taken.

### L-6 — nothing asserts `processed + declined + failed === attempted`

The identity holds (§8.2) and three mutants that break it die, but each dies on a specific counter's
specific assertion. One line in any existing test —
`assert.equal(report.processed + report.declined + report.failed, report.attempted)` — kills the whole
class at once, and it is the invariant an operator reads the report by.

### L-7 — the progress printer is still silent for every run under 100 rows

REV-053 L-3 was two complaints in one: a line per row when everything fails, *and* no output at all for a
clean run under 100 rows, so the doc comment's "not a black box" argument does not hold for the common
case. The gate moved from `processed` to `attempted`, which fixes the storm. It does not fix the silence:
`attempted % 100 === 0` never fires below 100. Gate on `attempted % 100 === 0 || attempted === 1`.

### L-8 — `npm test` still has no `--test-timeout`

The author declined this deliberately and said so, and the file-local cap in the double (§7) makes every
non-terminating mutant *in this file* fail fast. I agree with the decision and record only the residue:
the next file to grow a non-terminating loop still burns a CI job to the 360-minute limit. A
`--test-timeout` set high enough not to disturb the slow integration tests (say 300 s per test) would
cost nothing and close it.

---

## 10. Info

### I-1 — `--limit` is enforced twice, and each half survives alone

`Math.min(batchSize, room)` bounds the SELECT; `if (limit > 0 && attempted >= limit) break` bounds the
inner loop. Remove either and all 25 tests pass, because the other still holds. Remove both and the suite
goes red (23/25), and the real CLI overshoots:

```
[both limit guards removed]  --limit=2 on 5 rows -> {"processed":5,"attempted":5,"remaining":0,"safeToRemoveFromKey":true}
```

So `--limit` as a whole *is* pinned; what is not pinned is either mechanism individually. That is
defensible redundancy on a flag whose job is to bound blast radius, and I am not filing it as a defect —
but it is worth knowing that the F-M2 test exercises only the `Math.min` path (with `batchSize` 200 and
`limit` 2, the inner break is a no-op on the last row).

### I-2 — the SELECT projection is still unpinned by the unit double

Dropping `crypto_context` from `selectBatch`'s column list survives the unit suite 25/25 (the double
returns `{ ...r }`, the whole row, whatever the SQL asked for) and is killed by all four integration
tests. Unchanged from REV-053 I-5, and still the one place where the division of labour between the two
suites works as designed.

### I-3 — `safeReason` still duplicates `SupplierBankService.#violates`

REV-053 I-2, carried forward unchanged. Both walk `[error, error?.cause, error?.cause?.cause]`, both test
`errno === 1062 || code === "ER_DUP_ENTRY"`, both anchor the same `for key '…'` regex, and only the
service's copy carries the REV-036 H-1 comment explaining why the chain has to be walked. The rotation's
copy is the one that will be read when someone wires `runRotation` to a `MySqlDatabaseService` instead of
the CLI's raw pool wrapper, at which point three links may not be enough.

### I-4 — no harness observation exists at the merge candidate

`98c72f4` appears zero times in `00_harness_state.json`; the newest recorded run is still at `eaeb6c92`,
which is now two commits back. This is the module's known structural property — recording moves HEAD —
not an omission. Stated so the next reader does not mistake a green ledger for a green candidate: the
ledger's evidence does not cover this head. My own runs do, and are listed in the Summary.

### I-5 — `--transition-started` in the future produces neither a warning nor an error

`Math.floor((now - transitionStartedAt) / DAY_MS)` goes negative and `days > 30` is false, so a mistyped
year (`2027-…`) silently disables the transition-age warning rather than reporting anything. Harmless
today; noted because that warning is one of the two things `ringWarnings` exists for.

---

## 11. What I could not check

Stated rather than implied, because "it cannot be tested here" has been wrong in this module before.

- **That TC-059's deadlock (L-2) pre-exists on unmodified `main`.** It passes in isolation, it lives in
  `src/modules/customer/CustomerImportService.js`, and nothing in this change touches customer tables —
  but I did not spend a second full-suite run at `c0ea960` to prove it. If the gate needs a clean full
  suite, that run is the cheapest way to settle it.
- **The client suite.** Record §10 claims 646/646. The change touches no client file (`git diff --stat`
  confirms `server/`, `docs/`, `server/package.json` only). I did not execute it.
- **`npm run test:coverage` and the per-file floors.** Out of scope for this review by instruction.
  `server/scripts/` is still never loaded by any suite, so the CLI contributes nothing to coverage either
  way — which is part of what M-3 is about.
- **CI on GitHub.** I ran CI's commands with CI's variables against MySQL 26.7.0 on macOS, not Ubuntu
  with `mysql:8.0`. Anything version-specific in `ER_DUP_ENTRY` message formatting — which M-2 reasons
  about — I verified on 26.7.0 only, and the 64-character truncation I took from the record's
  measurement plus one observation of my own.
- **The Customer side of H-1 end to end.** I proved the supplier tool authorises removing a key that a
  Customer row still uses, and that removing it makes that row undecryptable. I did **not** run
  `scripts/rotateCustomerBankEncryption.js` to see whether a disciplined operator running both tools in
  the right order is safe. I believe they would be; the point of H-1 is that the supplier report does not
  say so and nothing enforces the order.
- **A real concurrent rotation under sustained load.** I exercised the SELECT/UPDATE race at one
  deterministic interleaving with a second live connection (§8.1), not under continuous application
  writes.

---

## 12. Residual risk I would accept, if the five findings were closed

The shipped rotation logic is sound and that belongs on the record separately from the findings. The
resume design — the filter *is* the progress — remains right, and `id > ?` is genuinely pinned. One
transaction per row is the right trade. `--to` as a confirmation and `--from` against the ring close the
symmetric holes. AAD binding survives re-encryption, proven by mutation in both suites. The concurrency
guard now has an observable signal (`declined`) and I verified it against real MySQL rather than against
the double. `safeReason` forwards no driver text. No key, no plaintext, no ciphertext and no blind index
reaches the report, the progress callback, stdout, stderr or a stack trace, across twelve real CLI runs
including a deliberately malformed configuration. Nothing here is reachable from a request.

What I would carry forward after the five close: I-3 (the duplicated chain walk, the next thing to break
when the database wrapper changes), L-8 (the global test timeout), and the standing recommendation from
REV-034/REV-038 that the integration double be rebuilt on a real `MySqlDatabaseService`.

And one process note, because H-1 is the shape of it: **this module's reviews verify cross-cutting
properties by inspection and then merge `main` on top of them.** REV-053 §7.2 verified "one table shares
this key ring" by grep. One round later, a merge made it two. If `safeToRemoveFromKey` is going to keep
its imperative meaning, the property it rests on needs to be a test, not a paragraph.

---

## 13. Verdict

**CHANGES_REQUESTED** — 0 Critical, **1 High**, 4 Medium, 8 Low, 5 Info.

Two of REV-053's four Mediums are fully closed, two are partially closed, and all sixteen mutants in the
record's table die. The remediation is real work and most of it is right.

What blocks is H-1 — the supplier rotation authorises removing a key that `customer_bank_accounts` rows
are still encrypted under, on a candidate whose own configuration validator forces the two rings to be
identical, demonstrated end to end on real MySQL with the resulting row unreadable — plus M-1 (the
`ORDER BY` column unpinned, surviving real MySQL, four of six rows attempted), M-2 (the leak scan blind
to 55 % of genuine leaks because it scans JSON-escaped text with un-escaped needles), M-3 (`main` still
imported by no test, with a REV-053 fix inside it revertible on a green suite), and M-4 (the new
top-level catch missing the configuration path, which exits 1 into the code reserved for "rows failed").

H-1 is a defect in shipped behaviour, not in the tests, and it is the first one in four rounds. The other
four are the familiar shape: the thing that matters is asserted by something other than the code under
test. This candidate still does not leak, does not corrupt and does not lose supplier data — but it will
now tell an operator to do something that destroys customer data, and it will say so with exit code 0.
