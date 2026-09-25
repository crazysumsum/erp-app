# REV-056 — TASK-036 Bank key rotation, independent review of the REV-055 remediation

Reviewer: independent (REV-056). Merge candidate: 4f4a7f77cd7b43bc53db8e7840e4e4d490989fc3
(detached worktree /private/tmp/erp-rev-056, task branch with origin/main merged in).

## Summary

| | |
| --- | --- |
| Critical | 0 |
| High | 0 |
| Medium | 2 |
| Low | 7 |
| Info | 6 |

Disposition: **CHANGES_REQUESTED**.

All three of REV-055's Mediums are closed in the shipped code, and I confirmed each by running it
rather than by reading the diff — including the `remaining === null` path end to end against real
MySQL, which REV-055 listed as something it could not verify. **I found no defect in shipped
behaviour.** Every behavioural claim I attacked held: idempotence, resume, AAD binding, fail-closed
decryption, the count invariant on the new `null` path, no secret on any surface, and — verified for
the first time in six rounds — the anti-clobber guard against a genuine concurrent application write
on real MySQL.

What blocks is the module's established pattern, in its sixth consecutive instance and in a milder
form than the last four: the remediation pinned each contract it touched on one side only.

- **M-1** — `exitCodeFor` was extracted and its six cases tested; four spawned tests pin exit 2 and
  one real-MySQL test pins exit 1. Nothing pins `main`'s **success** return. `return exitCodeFor(report)`
  replaced by `return 1` survives all 35 unit tests and all 5 integration tests, as does a `main` that
  drops the `remaining === null` branch this round created. Every exit path is now pinned except the
  one the round invented.
- **M-2** — the three-token blacklist became a fourteen-key whitelist, which does hold against adding
  or renaming a top-level field. But the same commit started writing new operator-facing content into
  `warnings`, and `warnings` is one key in that list. A warning `{ code: "SAFE_TO_REMOVE_KEY",
  message: "… it is now safe to remove it from the secret store" }` passes both suites and prints
  verbatim on the real CLI's stderr, directly under the shared-ring warning that contradicts it. The
  test is named "the report never claims a key is safe to remove from the ring"; that property is
  still not what it enforces.

Neither is a defect in behaviour. Both are missing regression barriers in front of findings this
module has already had — one of them the only High it has produced.

### What I ran, and on what

- `/private/tmp/erp-rev-056`, detached at `4f4a7f77cd7b43bc53db8e7840e4e4d490989fc3`.
- `npm test -- test/supplierBankKeyRotation.test.js test/supplierBankRotationCli.test.js`
  → **35 tests, 35 pass** (22 + 13 — the record's §12 counts are correct).
- `npm test -- test/integration/supplierBankRotation.integration.test.js` with `/tmp/env53.sh`
  → **5/5** against MySQL 26.7.0 on 127.0.0.1:3421.
- The profile suite `supplier-phase-001-server`, its exact argv from `00_project_profile.json`,
  once → **437 tests, 437 pass, 0 fail, 0 skipped**. The record's §12 figure is correct.
- The real CLI (`node scripts/rotateSupplierBankEncryption.js`) against that instance, on six seeded
  `supplier_bank_accounts` rows across two suppliers with a genuine two-key ring, plus a four-row
  concurrency rig driving `runRotation` against two live connections.
- All 29 author mutants re-applied, plus 8 of my own; details in §4 and §5.
- I did **not** run `npm run test:coverage` (instructed) and did not run the full server suite.

### Restoration

Every mutation was applied from a byte-for-byte backup taken before the first one and restored from
that backup after each run (not `git checkout --`, which has eaten uncommitted work in this module
before). Three temporary scripts written under `server/` for seeding and for the concurrency rig were
deleted. `git status` at the end of the review shows only this report file and the `node_modules`
symlink. All seeded suppliers and rows are dropped; the MySQL instance is left running.

---

## 1. Verification of REV-055's three Mediums

Every line below was produced by running something.

### 1.1 REV-055 M-1 — the `COUNT(*)` failure is reported as a row failure. **CLOSED.**

`failures` is row-only again, and "could not count" is a `REMAINING_UNKNOWN` warning with
`remaining: null`. REV-055 could only demonstrate this path at the unit layer and explicitly listed
the real-MySQL version as unverified. I induced it on the live instance by injecting a throw into
`remainingRows` (a mutation experiment, restored afterwards), on six rows that all rotated cleanly:

```
$ REV056_BREAK_COUNT=1 node scripts/rotateSupplierBankEncryption.js --from=ci-enc-0 --to=ci-enc-1
{ "kind": "encryption", "from": "ci-enc-0", "to": "ci-enc-1",
  "processed": 6, "attempted": 6, "declined": 0, "failed": 0, "failures": [],
  "lastId": 1023, "remaining": null, "supplierRowsDrained": false,
  "warnings": [ { "code": "RING_SHARED_WITH_OTHER_TABLES", ... },
                { "code": "REMAINING_UNKNOWN", "reason": "PROTOCOL_CONNECTION_LOST",
                  "message": "the rotation finished but the count of rows still on the old key could
                  not be read; treat this run as incomplete and re-run it before acting on the
                  result" } ] }
exit=1
stderr: WARNING RING_SHARED_WITH_OTHER_TABLES: …
        WARNING REMAINING_UNKNOWN: …
```

Every complaint REV-055 made is answered:

| REV-055 M-1 | Now |
| --- | --- |
| a clean run reports `failed: 1` | `failed: 0`, `failures: []` |
| a `failures` entry with `id: null` | none; `failures` is row-only |
| `processed + declined + failed === attempted` breaks | holds: 6 + 0 + 0 = 6 |
| exit 1 means "rows failed" | exit 1, and the contract in `exitCodeFor`'s doc now says 1 covers both "rows failed" and "could not count"; `REMAINING_UNKNOWN` on stderr distinguishes them |
| `supplierRowsDrained` | `false`, which is still the safe direction |

**The resumed run after one that could not count** — the question the brief asks — is clean, because
the condition really is the progress:

```
$ node scripts/rotateSupplierBankEncryption.js --from=ci-enc-0 --to=ci-enc-1 --json
{"processed":0,"attempted":0,"declined":0,"failed":0,"failures":[],"lastId":0,
 "remaining":0,"supplierRowsDrained":true,"warnings":[{RING_SHARED_WITH_OTHER_TABLES}]}
exit=0
```

I followed `null` everywhere it can reach. `supplierRowsDrained` uses `remaining === 0`, and
`null === 0` is false; there is no loose `==` anywhere in the module. `exitCodeFor` tests
`remaining !== null` explicitly. `JSON.stringify` renders it as `null` in both pretty and `--json`
modes, so a runbook's `.remaining == 0` and `.supplierRowsDrained` both read false. No arithmetic is
performed on `remaining`. The entry scripts only forward `main`'s return to `process.exitCode`.
Nothing reads it as zero.

### 1.2 REV-055 M-2 — the authorisation still issued by the record's §4 and §5. **CLOSED in the record.**

§4 is now "「呢張表掃乾淨未」嘅條件" and states `supplierRowsDrained = remaining === 0 &&
failures.length === 0`, with an explicit note that the section and the field were both renamed and
why. §5's quoted block now carries `supplierRowsDrained`, a `warnings` array with
`RING_SHARED_WITH_OTHER_TABLES`, and `exit=1`. I re-ran §5's scenario on the live instance and the
shape matches what the code produces. §§9–11 are correctly left as historical records.

The design-spec half is **explicitly excluded from this round's findings by human decision** (moving
`03_design_spec.md` moves a DESIGN hash binding 36 reviews). I have no harm to add beyond what
REV-055 already recorded, and I do not re-file it. I note only that the record's §12 states the
position honestly, including the cost table.

### 1.3 REV-055 M-3 — the exit-code contract and the blacklist. **PARTIALLY CLOSED, both halves.**

**(a) The exit-code contract.** `exitCodeFor` was extracted and is directly tested on six cases; the
two mutants REV-055 used both die now:

```
[08 M-3b body catch returns 1]  unit exit=1  <- killed by the spawned badRing case
[07 M-3a main always returns 0] unit exit=0, integ exit=1  <- killed only by the new MySQL test
[M-1c exitCodeFor ignores remaining===null] unit exit=1
```

But the wire from `main` to `exitCodeFor` is unpinned in the success direction. See M-1 below.

**(b) The blacklist.** The whitelist genuinely holds against the three mutants it was written for:

```
[01 H-1  re-add safeToRemoveFromKey]  unit exit=1
[03 H-1c add keyRemovalApproved]      unit exit=1   <- REV-055's X7, now dead
[02 H-1b drop the shared-ring warning] unit exit=1
```

It does not hold against the surface the same commit opened. See M-2 below.

---

## 2. [MEDIUM] M-1 — every exit path is pinned except the one this round created: `main`'s success return

**Where:** `server/scripts/supplierBankRotationCli.js`, `return exitCodeFor(report);`.

REV-055 M-3(a) was: "`main`'s exit-code contract is pinned by nothing". The remediation extracted
`exitCodeFor`, unit-tested its six cases, added four spawned-process tests and one real-MySQL test.
What those tests pin is `2` (three spawned cases), `0` for `--help` (which returns before the pool is
opened), and `1` for a run with failing rows. **No test anywhere drives `main` to a successful
rotation.** So the line that turns a good report into exit 0 is unobserved:

```
[N2 main always returns 1 after a completed run]                  unit exit=0 (35/35)  integ exit=0 (5/5)
[N1 main drops the remaining===null branch of exitCodeFor]        unit exit=0 (35/35)  integ exit=0 (5/5)
[N3 main always returns 2 after a completed run]                  unit exit=0          integ exit=1  <- killed
```

N2 is the mirror image of the mutant REV-055 used to file M-3(a) ("main always returns 0"), which the
new integration test now kills. The remediation pinned the direction REV-055 demonstrated and left
the opposite one open. N1 is narrower and more pointed: it keeps `exitCodeFor` intact and correct,
keeps all six of its unit cases green, and simply has `main` not use its new branch. The entire
`remaining === null → 1` rule — the only thing this round added to the contract — is connected to the
CLI by a wire nothing watches.

**Why this matters operationally.** Under N2 a rotation that drained every row cleanly exits 1, which
by this tool's own contract means "the rotation ran and rows failed, or the count could not be read;
treat the run as incomplete". A runbook or CI job that branches on the exit code stops on a perfect
run. It fails in the safe direction — which is exactly what was said about REV-055's M-1, and it was
still filed. Under N1 the report says `remaining: null` and `supplierRowsDrained: false` while the
exit code says 0; the JSON and the exit code disagree, and only one of the two is what a `set -e`
script sees.

**Why Medium and not Low.** This is the third consecutive round in which `main`'s exit code is the
finding, and the second in which the remediation pinned half of it. REV-053 M-4 named the surface,
REV-054 M-3 named it again, REV-055 M-3 measured it. A CLI whose success signal is asserted by
nothing is not a theoretical risk in a module with this history.

**Fix.** One spawned test, in the file that already has the `run()` helper and the seeding machinery
next door in the integration suite: seed rows on the old key, run the real entry script to completion,
and assert `status === 0` together with `report.supplierRowsDrained === true`. Then one more asserting
that a run whose `COUNT(*)` cannot be read exits **1** — the state this round invented — for which the
cheapest honest route is to give `main` the injectable `runRotation` that REV-054 already proposed, so
the `remaining: null` report can be produced without breaking a live database.

---

## 3. [MEDIUM] M-2 — the whitelist froze the field list, and the same commit moved the authorisation surface into `warnings`

**Where:** `server/test/supplierBankKeyRotation.test.js`, the test "the report never claims a key is
safe to remove from the ring"; and `server/src/modules/supplier/bankKeyRotation.js`, the `warnings`
array.

The replacement guard is:

```js
  assert.deepEqual(Object.keys(report).sort(), [
    "attempted", "declined", "endedAt", "failed", "failures", "from", "kind", "lastId",
    "processed", "remaining", "startedAt", "supplierRowsDrained", "to", "warnings"
  ], "the report's shape is fixed: a new field must be justified against what this module can see");
```

It is a real improvement over the three-token regex: adding `keyRemovalApproved` now dies, and so does
renaming `supplierRowsDrained` to anything at all. I confirmed both. But `warnings` is one entry in
that list, and its contents are not constrained — and **this round is the round that started writing
new content into it.** `REMAINING_UNKNOWN` was added through exactly the door the whitelist leaves
open. A second warning walks through it unchallenged:

```js
  ...(remaining === 0 && failures.length === 0
    ? [{ code: "SAFE_TO_REMOVE_KEY", scope: "ring",
         message: "the old key id is no longer referenced; it is now safe to remove it from the "
           + "secret store" }]
    : []),
```

```
[N4 authorisation moved into warnings]  unit exit=0  (35/35)   integ exit=0  (5/5)
```

And because `main` prints every warning's message to stderr verbatim, this is not a field buried in
JSON — it is a line on the operator's terminal, immediately under the control that H-1 was remediated
with, saying the opposite:

```
$ node scripts/rotateSupplierBankEncryption.js --from=ci-enc-0 --to=ci-enc-1
WARNING RING_SHARED_WITH_OTHER_TABLES: … Do not remove it from either ring until every table bound
  to the ring reports zero remaining rows …
WARNING SAFE_TO_REMOVE_KEY: the old key id is no longer referenced; it is now safe to remove it from
  the secret store
```

The `scope` and `message` fields of the existing warning are equally unconstrained. The test asserts
`shared.scope === "supplier_bank_accounts"` and two `assert.match` calls on `shared.message`, so that
one entry is partly held — but nothing forbids a **new** entry, and nothing checks the set of codes.

The author's own argument in §12 for why H-1 will not recur is that the property is now enforced by a
test instead of remembered by a reviewer. The property named in the test's title is "the report never
claims a key is safe to remove from the ring". What is enforced is "the report has these fourteen
top-level keys". That is one layer of the report, and the round moved the interesting layer one level
down.

**Why Medium.** H-1 is the only High this module has produced, and the guard that is supposed to stop
it recurring is defeatable by a one-line addition through a door opened in the same commit as the
guard. It is not a shipped defect — the code today issues no such warning — which is why it is not a
second High.

**Fix.** Freeze the warning codes alongside the field list, in the same assertion, and give the
`REMAINING_UNKNOWN` case its own entry:

```js
  assert.deepEqual(report.warnings.map((w) => w.code).sort(), ["RING_SHARED_WITH_OTHER_TABLES"],
    "a new warning code is a deliberate change: the CLI prints every message to stderr verbatim, so "
    + "a warning can authorise exactly as loudly as a field can");
```

The existing `REMAINING_UNKNOWN` test already asserts its code is present; extending it to the full
sorted code list costs one line each and closes the surface for the same reason the field list was
frozen.

---

## 4. The author's twenty-nine-mutant table, re-applied

Every mutant below was applied to a byte-for-byte backup of the merge candidate and run against
`test/supplierBankKeyRotation.test.js` + `test/supplierBankRotationCli.test.js`, and — where the unit
suite did not kill it — against the integration suite as well. A no-op control was run first on both
and exits 0, so an `exit=1` is the mutant dying and not the harness misfiring.

**I accept the table: 29 applied, 29 killed, none hung.**

```
H-1  report re-authorises removal   KILLED   drop AND id > ?                   KILLED (9 tests)
H-1b drop the shared-ring warning   KILLED   encryption guard vacuous          KILLED
H-1c keyRemovalApproved added       KILLED   lookup guard vacuous              KILLED
M-1  COUNT failure into failures    KILLED   drop the --from ring check        KILLED
M-1b drop REMAINING_UNKNOWN         KILLED   drained ignores failures          KILLED
M-1c exit ignores unknown remaining KILLED   --limit accepts 0 again           KILLED
M-3a main always returns 0          KILLED*  --json accepts a value            KILLED
M-3b body catch returns 1           KILLED   drop batch-size upper bound       KILLED
M-3c parse catch returns 1          KILLED   empty --from reports required     KILLED
ORDER BY supplier_id                KILLED*  split('=') truncates again        KILLED
ORDER BY id DESC                    KILLED   unknown flag echoes raw argv      KILLED
drop ORDER BY                       KILLED   progress gate back to processed   KILLED
remainingRows always enc            KILLED   rotateRow always claims a write   KILLED
safeReason forwards message         KILLED   endedAt is startedAt              KILLED
safeReason forwards a slice         KILLED
```

Five qualifications, none of which changes the verdict on the table:

- **`M-3a` (main always returns 0)** is killed **only by the integration suite** — 35/35 unit tests
  stay green. It therefore dies under the profile suite argv (which includes the integration files)
  and under CI, but not for a developer running the two unit files. Worth knowing before someone
  treats the unit pair as the fast feedback loop for this file.
- **`ORDER BY supplier_id`** is killed at the unit layer and **survives the integration suite**, which
  is REV-055's L-1 and is unremediated. `ORDER BY id DESC`, which survived integration in REV-055, now
  dies there — by accident, because the new three-row spawned test happens to expose it. See L-4.
- **drop the shared-ring warning** survives the integration suite (the unit suite kills it). REV-055
  noted the same; recorded only.
- **drop `ORDER BY`** dies partly on the double's own `throw new Error("the double cannot run a SELECT
  with no ORDER BY")` and partly on twenty behavioural assertions. The behavioural half is real; the
  harness half is REV-055's standing note.
- **rotateRow always claims a write** I applied to the encryption branch only; the lookup branch is
  the same shape and is covered by "lookup guard vacuous".

## 5. Mutants of my own

```
N1 main drops exitCodeFor's remaining===null branch   SURVIVED unit + integration   -> M-1
N2 main always returns 1 after a completed run        SURVIVED unit + integration   -> M-1
N3 main always returns 2 after a completed run        KILLED   (integration)
N4 an authorising entry pushed into warnings          SURVIVED unit + integration   -> M-2
P1 drop crypto_context from the SELECT projection     SURVIVED unit / KILLED integration (4/4) -> I-2
P2 drop supplier_id from the SELECT projection        SURVIVED unit / KILLED integration (4/4) -> I-2
P3 drop encryption_key_id from the SELECT projection  SURVIVED unit / KILLED integration (4/4) -> I-2
P4 pool.end() throws after a clean run                (behaviour probe, not a guard test)       -> L-3
```

## 6. Claims I attacked, and that held

- **Concurrency against a live writer, on real MySQL.** Two prior rounds recorded this as unverified.
  I drove `runRotation` against a real connection with a second connection re-writing a row that was
  already inside the selected batch, under the active key, with a fresh `crypto_context`:

  ```
  baseline (no interference):   processed 4, declined 0, failed 0, remaining 0, drained true
  with a concurrent app write:  processed 3, attempted 4, declined 1, failed 0, remaining 0,
                                drained true, invariant holds
  rows afterwards:              all four on ci-enc-1; the concurrently written row is the app's
                                version, not the rotation's
  ```

  The `WHERE … AND encryption_key_id = ?` guard fires exactly once, the rotation does not clobber the
  application's write, the row is counted as `declined` rather than `processed`, and the invariant
  holds. This is the behaviour the design asks for and it is correct on real MySQL, not only in the
  double.
- **AAD binding across re-encryption — confirmed twice, once by accident.** My first concurrency rig
  re-sealed rows without rewriting `crypto_context`. All four rows failed with
  `BANK_ACCOUNT_TAMPERED` and none was written. That is the binding doing its job against exactly the
  shape of tampering it exists for. With `crypto_context` carried correctly, all four rotate and all
  four decrypt back to their original account numbers.
- **The count invariant on every path, including the new one.** `processed + declined + failed ===
  attempted` held on all six runs I produced, including the `remaining: null` run and the
  `declined: 1` concurrency run.
- **Idempotence and resume.** A completed rotation re-run reports `processed 0, attempted 0,
  remaining 0, drained true, exit 0`. A run that could not count, re-run, finishes clean. No row is
  touched twice; no row is left unreadable.
- **Fail-closed on a lying key id.** The record's §5 scenario reproduces on this candidate, and the
  new integration test asserts it end to end through the real entry script (`failed: 3`, exit 1).
- **No secret on any CLI surface.** Across nine real runs I captured stdout and stderr in full.
  Present: row ids, counts, key **ids**, a stable reason code, timestamps. Absent: key material,
  plaintext, ciphertext, blind index, database password. `safeReason` never forwards a driver message
  (mutants 14 and 15 both die on the leak scan), and the `REMAINING_UNKNOWN` warning goes through the
  same `safeReason`, so the new path inherits the control rather than bypassing it.
- **`requireAccount`'s new `code`.** `BANK_ACCOUNT_${rejection}` interpolates one of three frozen
  constants (`EMPTY`, `UNREPRESENTABLE`, `TOO_LONG`) — never the input. Nothing downstream branches on
  a code that could now collide: `SupplierBankService`'s classifier matches `errno === 1062` /
  `ER_DUP_ENTRY` only.
- **Record §12's counts.** 22/22, 13/13, 5/5 and **437/437** for the profile suite all reproduce
  exactly. The 437 figure in particular is the class of claim that has been wrong three times in this
  module; it is right this time.
- **The whitelist against renames and additions.** Both mutants REV-055 asked for die.
- **The double's `WHERE`, `ORDER BY` and `SET` fidelity.** Every clause I deleted from the production
  SQL went red somewhere: `AND id > ?` kills nine unit tests, the two guards kill their own tests, the
  `ORDER BY` column and direction are both read from the SQL. The one layer the double still ignores
  is the SELECT projection, and real MySQL covers it (P1–P3).

## 7. Low findings

### L-1 — the spawned test's "unreachable database" case never reaches the database

`test/supplierBankRotationCli.test.js`, the last case of "the CLI's exit codes mean what the contract
says":

```js
  const noDatabase = run(["--from=e1", "--to=e2"], { DB_PORT: "1", DB_HOST: "127.0.0.1" });
  assert.equal(noDatabase.status, 2, "an unreachable database is 2, not 1");
```

Under the CI environment the ring is `{"ci-enc-1": …}` and the active key id is `ci-enc-1`, so
`--to=e2` fails `assertTarget` before `runRotation` ever issues a query. I ran the exact command:

```
$ DB_PORT=1 DB_HOST=127.0.0.1 node scripts/rotateSupplierBankEncryption.js --from=e1 --to=e2
--to must be the active encryption key id (ci-enc-1); refusing to rotate towards a different key
exit=2
```

No socket is opened. `DB_PORT` is inert. The assertion passes because the process died for a
different reason — the failure mode the brief names. The behaviour it claims to test **is** correct;
I verified it separately with valid key ids:

```
$ DB_PORT=1 node scripts/rotateSupplierBankEncryption.js --from=ci-enc-0 --to=ci-enc-1
connect ECONNREFUSED 127.0.0.1:1
exit=2
```

It is a Low rather than a Medium because the mutant the case exists to catch (body catch → `return 1`)
is killed by the `badRing` case two lines above, so the contract is not unwatched — only this
particular case is redundant while reading as coverage of a distinct path. **Fix:** use key ids that
are in the CI ring (`--from=ci-enc-0 --to=ci-enc-1` with a two-key ring supplied via `env`, or assert
on `stderr` matching `/ECONNREFUSED/u` so the case cannot pass on the `--to` guard).

### L-2 — an assertion that cannot fail

```js
  assert.deepEqual(report.failures, []);
  ...
  assert.deepEqual(report.failures.map((f) => f.id).filter((id) => id === null), [],
    "failures carries rows, and a row always has an id");
```

The second assertion operates on an array the first has already frozen as empty, so it is `[]` by
construction and cannot discriminate any mutant the line above does not already kill. It reads as a
guard on the property "no `failures` entry may have a null id" and enforces nothing. **Fix:** move it
to a fixture where `failures` is non-empty — the `failOn: new Set([2, 4])` fixture in "every attempted
row lands in exactly one of processed, declined or failed" is one line away from carrying it.

### L-3 — REV-055 L-4 unremediated, and the new exit rule makes it read worse

`main`'s `finally { if (pool) await pool.end(); }` is unchanged. A teardown failure replaces `main`'s
return value, escapes as an unhandled rejection, and reaches the entry script's top-level `await`.
Demonstrated on the live instance, after a rotation that processed all six rows cleanly:

```
exit=1
WARNING RING_SHARED_WITH_OTHER_TABLES: …
file:///…/scripts/supplierBankRotationCli.js:213
Error: pool teardown failed
    at …
```

A completed, fully drained rotation — exit 0 by the contract — becomes exit 1 with a raw stack trace.
Since this round, exit 1 also means "the count could not be read", so the operator now gets one of the
two "treat this run as incomplete" signals from a run that was in fact complete. **Fix**, unchanged
from REV-055: `try { await pool?.end(); } catch { /* the run is over; a teardown failure must not
rewrite its verdict */ }`.

### L-4 — REV-055 L-1 unremediated: the cursor's ordering column is still pinned only by the double

`ORDER BY supplier_id` survives all five integration tests, because every one of them seeds a single
supplier, so `supplier_id` order is a stable no-op on real rows. (`ORDER BY id DESC` now dies there,
but by accident — the new spawned test seeds three rows and asserts `failed: 3`, which the reversed
cursor breaks. Nothing about that test is about ordering.) **Fix**, unchanged from REV-055: give "an
interrupted rotation resumes and finishes on real rows" two suppliers whose `supplier_id` order is the
reverse of their `id` order, and assert every seeded id is attempted.

### L-5 — REV-055 L-3 unremediated: the shared-ring warning names two files, and the test pins the sentence

`assert.match(shared.message, /rotateCustomerBankEncryption\.js/u)` pins the message, not the file.
Both named scripts exist today; I checked. If the Customer module renames or moves either, the
supplier tool's only safety control points an operator at a path that does not exist and every suite
stays green. This is H-1's own lesson — a fact that expires on a merge — applied to H-1's own fix.
**Fix:** one `existsSync(new URL("../scripts/…", import.meta.url))` per named path.

### L-6 — the entry scripts' doc comments do not state the exit-code contract, which now has a third meaning

`exitCodeFor`'s doc comment carries the full contract (0 / 1 / 2, with 1 now covering both "rows
failed" and "could not count"). Neither `rotateSupplierBankEncryption.js` nor
`reindexSupplierBankBlindIndexes.js` mentions exit codes at all, and those are the two files a runbook
author opens. REV-055's fix text asked for this explicitly ("or 1, if a partial-run exit is preferred,
but say so in the entry doc comments"); the code took the 1, the documentation did not follow. **Fix:**
three lines in each entry doc comment.

### L-7 — `declined` is never exercised against real MySQL by the suite

The anti-clobber guard is killed by mutants 17, 18 and 28 at the unit layer, and I verified it works
on real MySQL myself (§6). But no integration test produces a `declined` row, so the one path where
the guard's `affectedRows === 0` has to survive a real driver, a real transaction and a real row lock
is not in the suite. The rig is four lines longer than the existing "interrupted rotation" test.

## 8. Info

### I-1 — REV-055 L-5 unremediated: `safeReason`'s cause-chain walk is exercised by no test

`[error, error?.cause, error?.cause?.cause]` reduced to `[error]` still survives the unit suite. No
fixture produces a wrapped error. Either add one or take the single-link version.

### I-2 — the unit double ignores the SELECT projection; the integration suite catches all three columns

Dropping `crypto_context`, `supplier_id` or `encryption_key_id` from the projection survives all 35
unit tests and fails all 4 rotation integration tests. The projection is pinned, an order of magnitude
later than it could be. A projection check in the double would be cheap.

### I-3 — `--transition-started` in the future produces neither a warning nor an error

`Math.floor((now - transitionStartedAt) / DAY_MS)` goes negative and no branch fires. Unchanged from
REV-054 I-5 and REV-055 I-3.

### I-4 — the shared-ring warning states a conditional configuration rule as unconditional fact

"The application configuration requires the Customer and Supplier bank key rings to be byte-identical"
is imposed by `checkSharedBankKeyRings` when both bank capabilities are enabled. Over-warning is the
safe direction; the wording should still say "requires, whenever the Customer bank capability is
enabled". Unchanged from REV-055 I-4.

### I-5 — without `--json`, progress lines and the report share stdout

`progressReporter` writes `attempted=… processed=… lastId=…` to stdout, and the report is written to
the same stream, so a rotation of 100 rows or more piped to `jq` fails unless `--json` is passed. The
new integration test takes `--json` and parses `stdout.trim().split("\n").at(-1)`, which is correct
for that mode only. This is the documented machine mode and not a defect; recorded so the next round
does not re-derive it, and because a runbook example in the entry doc comments would be cheap.

### I-6 — `safeReason` still duplicates the error classification in `SupplierBankService`

Two places decide what an `ER_DUP_ENTRY` means. Unchanged from REV-054 I-3 and REV-055 I-2. Not worth
a shared helper until a third appears.

## 9. What I tried to verify and could not

- **A genuine `COUNT(*)` failure on real MySQL without injection.** I could not induce one against the
  shared instance without disrupting it (revoking `SELECT`, killing the pool's connection mid-run). I
  demonstrated the path end to end on real MySQL by temporarily making `remainingRows` throw, which
  exercises every line after the throw — the warning construction, `supplierRowsDrained`, the printed
  JSON, the stderr lines, `exitCodeFor` and the process exit — with only the origin of the error
  faked. The mutation was restored.
- **The full server suite** (`2168 / 2164 pass / 3 skipped / 1 fail` per the record). I was instructed
  to run it at most once and no finding required it; I spent that budget on the profile suite argv
  instead, which is the number the record actually claims. `TC-016` does fail on this setup for want
  of `DB_ADMIN_USER` / `DB_ADMIN_PASSWORD`, consistent with the brief.
- **`Client 665/665`** in record §12. This change touches no client file; I did not run it.
- **`npm run test:coverage`.** Instructed not to run it.
- **The two known-open items** (`03_design_spec.md`'s five authorisation lines, and the profile's
  `env_keys` omitting `CUSTOMER_BANK_*`). Both are excluded by explicit human decision and I found no
  harm beyond what REV-054 and REV-055 already recorded, so I do not re-file either. I agree with the
  decision on `env_keys`: I ran the profile suite under the full CI environment and it is green, and
  CI runs the argv directly rather than through the harness runner, so the omission is descriptive.

## 10. Verdict

**CHANGES_REQUESTED** — 0 Critical, 0 High, 2 Medium, 7 Low, 6 Info.

This is the strongest candidate the module has produced. All three of REV-055's Mediums are genuinely
closed, and the two that mattered most are closed in the shipped code, not just in the tests: the
report no longer misdescribes a clean run, and the record no longer quotes output the code cannot
produce. The twenty-nine-mutant table is honest — I applied every one of them and all twenty-nine
died. I attacked idempotence, resume, AAD binding, fail-closed decryption, the count invariant on the
new `null` path, secret leakage on nine real runs, and — for the first time in six rounds — the
anti-clobber guard against a real concurrent writer on real MySQL. Every one of them held. **I found
no defect in shipped behaviour.**

What blocks is the pattern, in its sixth consecutive instance and in its mildest form yet. Both of my
Mediums are one unfixed sibling of a fix that landed this round:

- `exitCodeFor` was extracted, tested six ways, and wired to four spawned tests and one real-MySQL
  test — all of which pin the failure directions. The success return is pinned by nothing, and
  neither is the `remaining === null` branch that this round invented (M-1).
- The three-token blacklist became a fourteen-key whitelist that holds against adding and renaming
  fields — in the same commit that started writing new operator-facing content into `warnings`, which
  the whitelist does not cover and which the CLI prints to the operator's terminal verbatim (M-2).

Neither is remotely reachable, neither risks data, and both fail in the safe direction. Both are two
or three lines of test. What makes them worth a round is that the guard in M-2 stands in front of the
only High this module has produced, and the contract in M-1 has now been the finding three rounds
running.
