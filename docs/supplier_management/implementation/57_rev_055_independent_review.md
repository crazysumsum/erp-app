# REV-055 — TASK-036 Bank key rotation, independent review of the REV-054 remediation

Reviewer: independent (REV-055). Merge candidate: 65017c3ac4b11b131369cc7273300726bd503fc4
(detached worktree /private/tmp/erp-rev-055, task branch with origin/main merged in).

## Summary

| | |
| --- | --- |
| Critical | 0 |
| High | 0 |
| Medium | 3 |
| Low | 5 |
| Info | 5 |

Disposition: **CHANGES_REQUESTED**.

REV-054's High and all four of its Mediums are closed **in the shipped code** — I confirmed each
by execution, not by reading the diff. What is not closed is the second half of two of them, and
one of this round's own fixes contradicts another of this round's own fixes.

The three Mediums:

- **M-1** — REV-054's L-5 (`remaining` may be `null`) and L-6 (`processed + declined + failed ===
  attempted`) landed in the same round and are mutually inconsistent. A run in which **every row
  succeeded** now reports `failed: 1`, breaks the invariant the same round added a test for, and
  exits 1 ("the rotation ran and rows failed"). Neither new test covers the intersection.
- **M-2** — H-1's authorisation was removed from the code and from both entry scripts, but
  `docs/supplier_management/03_design_spec.md` still issues it in five places, single-table and
  unqualified, and that is the normative document a runbook author reads. The record's own §4 and
  §5 also still issue it, under the old field name, with a quoted CLI output the shipped code can
  no longer produce.
- **M-3** — REV-054 M-4's code fix landed; its regression guard did not. `main`'s exit-code
  contract on the body path (the exact thing M-4 was about) is pinned by nothing: flipping the
  body catch from `return 2` to `return 1` leaves all 33 unit tests and all 4 integration tests
  green. The "no field may read as an authorisation" test that replaced the expired REV-053 §7.2
  fact is a three-token blacklist: adding a field literally named `keyRemovalApproved` survives
  both suites.

### What I ran, and on what

- `/private/tmp/erp-rev-055`, detached at `65017c3ac4b11b131369cc7273300726bd503fc4`.
- `npm test -- test/supplierBankKeyRotation.test.js test/supplierBankRotationCli.test.js`
  → 33 tests, 33 pass (22 + 11 — the record's §11 counts are correct).
- `npm test -- test/integration/supplierBankRotation.integration.test.js` with `/tmp/env53.sh`
  → 4/4 against MySQL 26.7.0 on 127.0.0.1:3421.
- The real CLI (`node scripts/rotateSupplierBankEncryption.js`) against that instance, on six
  seeded `supplier_bank_accounts` rows across two suppliers, with a genuine two-key ring.
- 23 author mutants re-applied + 10 of my own; details in §4 and §5.
- I did **not** run `npm run test:coverage` (instructed) and did not run the full server suite.

### Restoration

Every mutation was applied from a byte-for-byte backup taken before the first one and restored
from that backup after each run (not `git checkout --`, which has eaten uncommitted work in this
module before). `git status` at the end of the review shows only this report file and the
`node_modules` symlink. The seeded rows and suppliers are dropped; the MySQL instance is left
running.

---
## 1. Verification of REV-054's High and its four Mediums

Every line below was produced by running something, not by reading the diff.

### 1.1 REV-054 H-1 — the report authorises removing a key Customer rows still use. **PARTIALLY CLOSED.**

**Closed in the code and on the runtime surface.** Six seeded `supplier_bank_accounts` rows across
two suppliers, a genuine two-key ring, the real CLI, no flags:

```
$ node scripts/rotateSupplierBankEncryption.js --from=ci-enc-0 --to=ci-enc-1
{ "kind": "encryption", "from": "ci-enc-0", "to": "ci-enc-1",
  "processed": 6, "attempted": 6, "declined": 0, "failed": 0, "failures": [],
  "lastId": 626, "remaining": 0, "supplierRowsDrained": true,
  "warnings": [ { "code": "RING_SHARED_WITH_OTHER_TABLES", "scope": "supplier_bank_accounts",
      "message": "supplierRowsDrained covers supplier_bank_accounts only. ... Do not remove it from
      either ring until every table bound to the ring reports zero remaining rows; the Customer side
      is server/scripts/rotateCustomerBankEncryption.js and reindexCustomerBankBlindIndexes.js." } ],
  "startedAt": ..., "endedAt": ... }
exit=0
stderr: WARNING RING_SHARED_WITH_OTHER_TABLES: <same message>
```

I swept the whole operator-facing surface the way the brief asks:

| Surface | Still authorises? |
| --- | --- |
| Report fields | No. `supplierRowsDrained` only; no `safe*` / `*removable*` field exists. |
| `USAGE` / `--help` | No. I printed it; it names flags only, no removal language. |
| stderr | No — the opposite. Every run emits the shared-ring warning; I saw it on all five runs. |
| `scripts/rotateSupplierBankEncryption.js` doc comment | No. The imperative sentence is gone and replaced by an explicit "this tool will not tell you to remove a key". |
| `scripts/reindexSupplierBankBlindIndexes.js` doc comment | No. Same. |
| `server/package.json` script names | No. `supplier:bank:rotate-encryption` / `supplier:bank:reindex-lookup` carry no claim. |
| Exit codes | No. 0 / 1 / 2 are about the run, not about key removal. |
| Both named Customer tools | Both exist at `server/scripts/`; the message points at real files. |

**Not closed in the documents a runbook author reads.** See M-2 below. `03_design_spec.md` issues the
single-table authorisation in five places, and the record's own sections 4 and 5 still issue it under
the old field name. The code stopped saying it; the specification it traces to did not.

### 1.2 REV-054 M-1 — the `ORDER BY` column is supplied by the double. **CLOSED at the unit layer, NOT closed at the real-SQL layer.**

The new test `"the cursor orders by the column it advances on, so no row is skipped"` seeds
`supplierId: 100 - id`, so `supplier_id` order is the reverse of `id` order, and the kill is now a
behavioural assertion rather than a wrapper artefact:

```
[M-1 ORDER BY supplier_id] unit exit=1
  the cursor orders by the column it advances on, so no row is skipped
  AssertionError: every row must be attempted   actual: 3, expected: 6
```

The wrapper's `sql.includes("ORDER BY id")` sniff is also gone, replaced by `sql.includes("ORDER BY")`,
so the wrapper can no longer silently stop matching.

REV-054's fix had a second half — "give the interrupted-rotation integration test two suppliers rather
than one, so real MySQL sees the same thing". That half was not done, and it shows:

```
[M-1  ORDER BY supplier_id] integ exit=0   4/4 pass, real MySQL
[M-1b ORDER BY id DESC]     integ exit=0   4/4 pass, real MySQL
```

Both ordering mutants still survive the entire integration suite. Filed as L-1.

### 1.3 REV-054 M-2 — the leak scan misses a real leak 55 % of the time. **CLOSED, and measurably.**

`stringsIn()` now flattens the report's string content and the scan runs over that instead of over
`JSON.stringify(report)`. I re-ran REV-054's own measurement — 20 000 random 32-byte indexes, each
formatted into MySQL's real `ER_DUP_ENTRY` shape and forwarded whole as a `reason`:

```
JSON.stringify haystack (the REV-054 M-2 shape): missed 11818/20000 (59.1%)
stringsIn haystack      (shipped this round):    missed     0/20000 ( 0.0%)
```

The negative control is also no longer fixture-bound: it runs three accounts and requires
`["mysql"]` on each. Both `M-3` and `M-3b` (forward the message; forward a 40-char slice) die.

### 1.4 REV-054 M-3 — `main()` is imported by no test. **PARTIALLY CLOSED.**

`test/supplierBankRotationCli.test.js` now imports `main` and `progressReporter`. REV-053 M-4 named
four unobserved surfaces: flag parsing, the exit-code contract, the progress printer, the pool wiring.

- Flag parsing: covered (10 tests).
- Progress printer: covered, and the mutant that REV-054 used to prove the point (`attempted % 100`
  back to `processed % 100`) now dies. Confirmed: `[09 M-3c] unit exit=1`.
- **Exit-code contract: still not covered.** The two `main` calls in the test both return before the
  pool is opened (`--oops` → 2, `--help` → 0). Everything after that is unpinned; see M-3 below.
- **Pool wiring: still not covered.**

The stdout/stderr stubs themselves are correct: both originals are captured with `.bind()` before the
swap and restored in a `finally`, and the assertions afterwards are real (they match `unknown argument
--oops`, assert `super-secret` is absent, assert no `\n  at ` stack frame, and require `Usage:` on both
streams). I confirmed by inspection and by the fact that the 33-test run produces no stray output.

### 1.5 REV-054 M-4 — the top-level catch does not cover config, crypto or pool construction. **CLOSED in code, NOT pinned by any test.**

The `try` now opens before `dotenv.config()` and the `finally` guards `if (pool)`. Reproduced on the
live instance, both sides of the old boundary:

```
$ SUPPLIER_BANK_ENCRYPTION_KEYS='{"ci-enc-1":' node scripts/rotateSupplierBankEncryption.js --from=ci-enc-0 --to=ci-enc-1
Supplier config "bankEncryption.keyRing" must be a valid JSON object
exit=2                                         <- was a raw stack trace and exit 1

$ DB_PORT=1 node scripts/rotateSupplierBankEncryption.js --from=ci-enc-0 --to=ci-enc-1
connect ECONNREFUSED 127.0.0.1:1
exit=2

$ node scripts/rotateSupplierBankEncryption.js --from=TYPO --to=ci-enc-1
--from key id TYPO is not in the encryption ring (ci-enc-1, ci-enc-0); refusing to report a rotation
that cannot have happened
exit=2
```

One line each, no stack trace, exit 2 in all three. The defect is gone.

**No secret reaches the widened catch.** I enumerated everything that can now arrive there and could
not before: `dotenv.config` (does not throw — it returns `{ error }`), six dynamic imports,
`normalizeSupplierConfig` (twelve throw sites, all naming a config *key* or a key *id*, never
material), `new SupplierBankCrypto` (three constructor-reachable throws: "requires both the
bankEncryption and bankLookup key rings", "requires a 32-byte key", "empty lookup ring" — no values),
`normalizeDatabaseConfig` (three throws, all `Database config "<key>" is ...` — the key name, never
the password), and `createMySqlDatabasePool` (constructs lazily; it does not connect, so no driver
message arrives here — the connect error arrives later from `pool.query`, and `connect ECONNREFUSED
127.0.0.1:1` carries host and port, not credentials). Clean.

**But REV-054's own instruction — "and pin it with one of the `main` tests from M-3" — was not
followed**, and the exit code is exactly the half of M-4 that was new. See M-3 below: flipping this
catch back to `return 1` leaves every suite green.

---
## 2. [MEDIUM] M-1 — this round's L-5 fix breaks this round's L-6 fix: a run in which every row succeeded reports a failure, breaks the invariant, and exits 1

**Where:** `server/src/modules/supplier/bankKeyRotation.js`, the new `try`/`catch` around
`remainingRows` and the `failed` / `failures` fields; and
`server/test/supplierBankKeyRotation.test.js`, the two tests added for REV-054 L-5 and L-6.

REV-054 L-5 made a `COUNT(*)` failure survivable:

```js
  let remaining = null;
  try {
    remaining = await remainingRows(database, kind, from);
  } catch (error) {
    failures.push({ id: null, ...safeReason(error) });
  }
```

REV-054 L-6 added the invariant that nothing had been watching:

```js
  assert.equal(report.processed + report.declined + report.failed, report.attempted, ...)
```

`failures` is a list of **rows** — every other entry is `{ id, reason }` with a real row id, and
`failed` is `failures.length`. The L-5 fix pushes a non-row onto it. The two fixes landed in the same
commit and contradict each other.

**Demonstrated.** Two rows, both rotate cleanly, the final `COUNT(*)` then fails:

```
{ "attempted": 2, "processed": 2, "declined": 0,
  "failed": 1,
  "failures": [ { "id": null, "reason": "PROTOCOL_CONNECTION_LOST" } ],
  "remaining": null, "supplierRowsDrained": false }

invariant processed+declined+failed === attempted : false  (2+0+1 vs 2)
rows actually left on the old key: 0
```

Three things are wrong and they compound:

1. **The report says a row failed when none did.** `attempted: 2, processed: 2, failed: 1` reads, to an
   operator or a runbook, as "one of the two rows did not rotate". Both did. The only row in
   `failures` has `id: null`, so anyone who follows the report's own contract — "go and look at the
   failed rows by id" — has nothing to look at.
2. **The invariant the same round added a test for does not hold.** The test
   `"every attempted row lands in exactly one of processed, declined or failed"` uses a fixture in
   which `COUNT(*)` succeeds, so it never reaches the only path that breaks it. REV-054 L-6 asked for
   a guard on a relationship; what shipped is a guard on one fixture in which the relationship happens
   to hold.
3. **The exit code is wrong, in the same way M-4 was wrong.** `main` returns
   `report.failed === 0 ? 0 : 1`. `failed` is now 1, so the CLI exits **1** — which by the contract
   this very round defended means "the rotation ran and rows failed; do not remove the key". What
   actually happened is "the rotation completed and I could not read the final count". Those need
   different operator responses: the first says investigate the listed rows, the second says re-run
   the (idempotent) command. M-4's complaint was precisely that a non-row failure must not be reported
   as a row failure through the exit code.

**Why Medium and not High.** It fails in the safe direction — `supplierRowsDrained` goes `false`,
which is the whole point of the L-5 fix and is correct. Nothing is corrupted and no key can be removed
on the strength of it. The damage is a report that misdescribes its own run at the exact moment an
operator is deciding what to do next.

**Why it blocks.** This is the fifth consecutive instance of the module's established pattern, and the
first in which both halves were written in the same commit: L-5 changed what may appear in `failures`,
L-6 asserted a property of `failures`, and nobody ran them against each other.

**Fix.** Keep the two kinds of failure apart. `failures` stays row-only; the count failure gets its own
field:

```js
  let remaining = null;
  let remainingError = null;
  try {
    remaining = await remainingRows(database, kind, from);
  } catch (error) {
    remainingError = safeReason(error);
  }
  ...
  remaining, remainingError,
  supplierRowsDrained: remaining === 0 && failures.length === 0,
```

and in `main`, `return report.failed > 0 ? 1 : (report.remainingError ? 2 : 0)` — or 1, if a
partial-run exit is preferred, but say so in the entry doc comments. Then extend the L-6 invariant test
to run over the `COUNT(*)`-failure fixture as well, so the two paths are asserted together rather than
one each.

---

## 3. [MEDIUM] M-2 — the authorisation H-1 removed from the code is still issued by the design spec and by the record's own sections 4 and 5

**Where:** `docs/supplier_management/03_design_spec.md` lines 392, 1415, 1702, 1704, 1742; and
`docs/supplier_management/implementation/52_task_036_bank_key_rotation.md` sections 4 and 5.

The brief for H-1's remediation, in the author's own words in record section 11, is: *"the answer is to
stop issuing this authorisation. A tool that does not authorise cannot mis-authorise."* The tool
stopped. The specification the tool traces to did not:

```
03_design_spec.md:392   ... 兩者只有在舊key ID row count=0且rotation report通過後才可移除舊key。
03_design_spec.md:1415  舊key仍有row引用時report失敗且不可移除；count為0後才通過。
03_design_spec.md:1702  ... 完成report確認old encryption key ID count=0後才從secret store移除。
03_design_spec.md:1704  ... 完成report確認old lookup key ID count=0及duplicate scan無異常後才移除old key。
03_design_spec.md:1742  Bank encryption及lookup keys都不能在仍有row引用時移除。各自rotation report須
                        證明舊key ID count=0後才可從secret store移除。
```

Every one of those is the H-1 statement: *this report's count of zero is what licenses removing the key
from the secret store*. None is qualified by table. Line 1742 is in the security section and is the
sentence a runbook author would quote. `DES-010 / DES-022 / DES-023` are the design ids TASK-036 traces
to, so this is not an unrelated document — it is the normative source for the behaviour H-1 declared
unsafe, and it now contradicts the tool's own stderr on every run.

**And the record re-issues it under the old name.** Section 4 is titled *"the condition for removing
the old key"* and reads, in full:

```
`safeToRemoveFromKey = remaining === 0 && failures.length === 0`.
```

That field does not exist. Section 5 then quotes a CLI output containing `"safeToRemoveFromKey": false`
and **no `warnings` array at all** — the shipped code emits `supplierRowsDrained` and always emits
`warnings` with at least the shared-ring entry, so the quoted block is doubly impossible. I re-ran
exactly section 5's scenario on the live instance:

```
$ node scripts/rotateSupplierBankEncryption.js --from=ci-enc-0 --to=ci-enc-1 --json
{"kind":"encryption","from":"ci-enc-0","to":"ci-enc-1","processed":0,"attempted":3,"declined":0,
 "failed":3,"failures":[{"id":621,"reason":"BANK_ACCOUNT_TAMPERED"},{"id":622,...},{"id":623,...}],
 "lastId":623,"remaining":3,"supplierRowsDrained":false,
 "warnings":[{"code":"RING_SHARED_WITH_OTHER_TABLES",...}],"startedAt":...,"endedAt":...}
exit=1
```

The fail-closed behaviour section 5 claims is real and reproduces. The text quoted to evidence it is
not what the code produces. This is the identical defect REV-053 filed as L-4 — "a quoted output the
code can no longer produce" — reintroduced by H-1's own rename, in the same section that was rewritten
to fix it.

Sections 6, 7, 9 and 10 are per-round historical records and are correctly left alone (section 11
footnotes section 10's counts as measured at `7cd42e3`). Sections 1 to 5 are not historical: they are
the document's description of how the shipped tool behaves.

**Why Medium.** The runtime warning is unconditional and directly contradicts the spec at the moment of
action, which is a real compensating control and is why this is not a second High. But the H-1 fix was
justified on the ground that the authorisation exists nowhere any more, and that is not true.

**Fix.**

1. The record: rewrite section 4 in terms of `supplierRowsDrained` and what it does *not* cover, and
   replace section 5's quoted block with the output above.
2. The design spec: it is baseline-bound (HD-034 accepted an `OUTSIDE_MODULE` rather than move it), so
   this may need a harness decision rather than an edit. Either amend the five lines to say "every
   table bound to the ring", or record an explicit deviation stating that the design's single-table
   removal condition is superseded by `RING_SHARED_WITH_OTHER_TABLES`. What is not acceptable is
   leaving the two in silent contradiction, because the spec is the artefact that outlives the tool.

---

## 4. [MEDIUM] M-3 — `main`'s exit-code contract is pinned by nothing, and the test that replaced the expired REV-053 fact is a three-token blacklist

Two unpinned surfaces, both created by this round's remediation.

### 4.1 The exit-code contract, which is what M-4 was about

```
[X4 main body catch exits 1 instead of 2]  unit exit=0   33 tests, 33 pass
[X5 main always exits 0]                   unit exit=0   33 tests, 33 pass
[X6 progressReporter default write is a no-op] unit exit=0   33 tests, 33 pass
```

X4 is REV-054 M-4 reverted in its most important half. M-4's whole argument was that a malformed key
ring must not exit 1, because 1 means `report.failed !== 0` and a runbook branches on it. The code was
fixed; the mutant that undoes the fix passes all 33 unit tests and all 4 integration tests. X5 removes
the exit-code contract entirely — a run with failing rows exits 0, and a CI job that gates on it reads
success — and nothing goes red. X6 silences the progress printer at its default wiring, so the
extracted `progressReporter` is tested but the way `main` actually calls it is not.

`main`'s two covered calls both return before the pool is constructed. Everything past that line is as
unobserved as it was when REV-053 filed M-4, and this is now the third consecutive round in which the
same sentence is partially remediated.

**Fix.** REV-054 already wrote it: give `main` an injectable dependency loader
(`export async function main(kind, argv = process.argv.slice(2), deps = loadDependencies)`), then three
tests with no database — a fake `runRotation` returning `failed: 0` must give 0 and one returning
`failed: 2` must give 1; a `deps` that throws (standing in for a malformed key ring) must give **2**
and write one line with no stack frame; and a 250-row run through the real `onProgress` wiring must
emit exactly two lines.

### 4.2 The authorisation test does not hold the line it claims

The test that replaced the expired REV-053 section 7.2 fact is:

```js
  const authorising = Object.keys(report).filter((key) => /safe|removable|canRemove/iu.test(key));
  assert.deepEqual(authorising, [],
    "no field may read as an authorisation to remove the key: ...");
```

The stated property is "no field may read as an authorisation". What is enforced is "no field name
contains one of three tokens", and the three tokens were read off the one name that already existed.

```
[X8 ADD a field named safeToRemoveFromKey]  unit exit=1   <- the historical name, caught
[X7 ADD a field named keyRemovalApproved]   unit exit=0   <- 33/33 green
[X7 ADD a field named keyRemovalApproved]   integ exit=0  <- 4/4 green, real MySQL
```

A field literally named `keyRemovalApproved`, carrying exactly the value `safeToRemoveFromKey` used to
carry, passes the test whose job is to stop that field from existing. (Renaming
`supplierRowsDrained` itself *is* caught — but by the `assert.equal(report.supplierRowsDrained, true)`
two lines above, not by the regex. The regex's only demonstrated power is over the one string it was
written from.)

This matters more than a normal weak assertion, because the author's argument for why H-1 will not
recur is that the property is now enforced by a test rather than remembered by a reviewer. The property
is not enforced; one spelling of it is.

**Why Medium, jointly with 4.1.** Neither half is a defect in shipped behaviour — both are missing
regression barriers in front of findings this module has already had. Given the history (REV-052 M-1
lived on the unobserved CLI surface; REV-053 M-4 named it; REV-054 M-3 named it again), an unobserved
operator-facing surface in a key-rotation tool is not a theoretical risk here.

**Fix.** Assert the positive property instead of blacklisting names. The report's removal-relevant
surface is small enough to freeze outright:

```js
  assert.deepEqual(Object.keys(report).sort(), [ ...the exact expected key list... ],
    "a new report field is a deliberate change: if it can be read as an authorisation to remove a "
    + "key, this module cannot make it");
```

A frozen key list forces every future field through a reviewer, which is the actual control wanted,
and it cannot be defeated by choosing a synonym.

---
## 5. The author's twenty-three-mutant table, re-applied

Every mutant below was applied to a byte-for-byte backup of the merge candidate and run against
`test/supplierBankKeyRotation.test.js` + `test/supplierBankRotationCli.test.js`. A no-op control was
run first and exits 0, so a `exit=1` is the mutant dying and not the harness misfiring. **I accept the
table: 23 applied, 23 killed, none hung.**

```
01 H-1  report re-authorises removal        KILLED    13 L-5 COUNT failure discards report   KILLED
02 H-1b drop the shared-ring warning        KILLED    14 L-2 rotateRow always claims write   KILLED
03 M-1  ORDER BY supplier_id                KILLED    15 L-1 endedAt is startedAt            KILLED
04 M-1b ORDER BY id DESC                    KILLED    16 drop AND id > ?                     KILLED
05 M-1c drop ORDER BY                       KILLED    17 F-M3 encryption guard vacuous       KILLED
06 M-2  remainingRows always encryption     KILLED    18 F-M3b lookup guard vacuous          KILLED
07 M-3  safeReason forwards message         KILLED    19 REV-052 M-1 drop --from ring check  KILLED
08 M-3b safeReason forwards a slice         KILLED    20 supplierRowsDrained ignores failures KILLED
09 M-3c progress gate back to processed     KILLED    21 M-4  --limit accepts 0 again        KILLED
10 L-3  drop batch-size upper bound         KILLED    22 M-4b --json accepts a value         KILLED
11 L-4  empty --from reports required       KILLED    23 L-9 split('=') truncates again      KILLED
12 L-8  unknown flag echoes raw argv        KILLED
```

Two qualifications on individual entries, neither of which changes the verdict on the table:

- **05 (drop `ORDER BY`)** dies on the double's own `throw new Error("the double cannot run a SELECT
  with no ORDER BY")`, not on an assertion about behaviour. That is a defensible way to keep the
  double honest, but the kill is the harness's, not the code's.
- **01** dies on `assert.equal(report.supplierRowsDrained, true)`, not on the `/safe|removable|
  canRemove/i` filter the author cites as the new guarantee. The filter's contribution is confined to
  the one historical spelling; see M-3 section 4.2.

## 6. Mutants of my own

```
X1 rename field to readyToRemoveKey          KILLED   (by the equality assert, not the regex)
X2 rename field to oldKeyRetired             KILLED   (same)
X3 drop crypto_context from SELECT list      SURVIVED unit / KILLED integration
X4 main body catch returns 1 instead of 2    SURVIVED unit + integration     -> M-3
X5 main always returns 0                     SURVIVED unit + integration     -> M-3
X6 progressReporter default write no-op      SURVIVED unit + integration     -> M-3
X7 ADD a field named keyRemovalApproved      SURVIVED unit + integration     -> M-3 section 4.2
X8 ADD a field named safeToRemoveFromKey     KILLED   (the regex's one true positive)
X9 safeReason stops following error.cause    SURVIVED unit                   -> L-4
X10 drop the --from === --to guard           KILLED
M-1  ORDER BY supplier_id, integration only  SURVIVED                        -> L-1
M-1b ORDER BY id DESC, integration only      SURVIVED                        -> L-1
02b  drop shared-ring warning, integration   SURVIVED (unit kills it; noted only)
```

X3 is REV-054's I-2 with a measurement attached: the unit double ignores the SELECT projection
entirely, so dropping `crypto_context` from it is invisible there — but real MySQL kills it on all four
integration tests (`actual: 0, expected: 3`). The projection is pinned, just not where REV-054 looked.
Downgraded to Info.

## 7. Claims I attacked, and that held

- **Idempotence.** Re-running a completed encryption rotation on the live instance:
  `processed 0, attempted 0, remaining 0, supplierRowsDrained true, exit 0`. No row is touched twice.
- **Resume with no external state.** `--limit=2` on a six-row lookup rotation gives
  `processed 2, remaining 4, supplierRowsDrained false, lastId 622, exit 0`; the bare re-run picks up
  exactly the remaining four and finishes `remaining 0, drained true`. The condition really is the
  progress.
- **AAD binding across re-encryption.** `crypto_context` and `supplier_id` are read from the row and
  passed unchanged into `encryptAccountNumber`; the integration test decrypts every rotated row back to
  its original account number under the new key, and it passes 4/4. A row cannot be made portable to
  another supplier by rotating it.
- **Fail-closed on a lying key id.** Record section 5's scenario reproduces exactly (three rows forced
  back to `ci-enc-0`): `processed 0, attempted 3, failed 3`, every failure
  `BANK_ACCOUNT_TAMPERED`, `remaining 3`, `supplierRowsDrained false`, **exit 1**. GCM's auth tag stops
  the re-encryption from writing garbage.
- **No secret on any CLI surface.** Across five real runs I captured stdout and stderr in full. Present:
  row ids, counts, key **ids**, a constraint name, timestamps. Absent: key material, plaintext,
  ciphertext, blind index, database password. The widened `main` catch adds no new leak (enumerated in
  section 1.5).
- **No SQL injection in the two interpolations.** `kind` is validated against the two frozen constants
  before either is built, and `LIMIT ${Number(batchSize)}` is numeric-coerced. Unchanged from REV-053.
- **`declined` is real.** Both guard tests assert `declined: 1` and `processed: 1` on the same run, and
  mutants 17/18 (guard vacuous) die on both kinds.
- **The stdout/stderr stubs in the `main` test restore correctly** and assert five distinct things; see
  section 1.4.
- **Record section 11's counts.** 22/22, 11/11, 4/4 and 434/434 for the profile suite all reproduce
  exactly on this candidate. The footnote correctly marks section 10's numbers as historical.

## 8. Low findings

### L-1 — both `ORDER BY` mutants survive the integration suite; the ordering property is pinned only by the double

REV-054 M-1's fix had two halves and one shipped. `ORDER BY supplier_id` and `ORDER BY id DESC` both
leave the four integration tests green, because every integration test still seeds a single supplier
(`seedSupplier` once per test), so `supplier_id` order is a stable no-op there too. The property that
the cursor column and the sort column must agree is enforced only by the fake database. Given that this
module has now had five double-fidelity defects, the real-SQL layer is where it should also be held.
**Fix:** give `"an interrupted rotation resumes and finishes on real rows"` two suppliers whose
`supplier_id` order is the reverse of their `id` order, and assert every seeded id is attempted.

### L-2 — `00_project_profile.json` no longer declares the environment its own suite needs

`env_keys` for `supplier-phase-001-server` lists the five `DB_*` and four `SUPPLIER_BANK_*` variables.
Since the merge, the suite also needs `CUSTOMER_BANK_ACTIVE_KEY_ID`,
`CUSTOMER_BANK_ENCRYPTION_KEYS`, `CUSTOMER_BANK_LOOKUP_ACTIVE_KEY_ID` and `CUSTOMER_BANK_LOOKUP_KEYS`,
because `checkSharedBankKeyRings` arrived with it and `configuration.test.js` / `configSecrets.test.js`
are in the suite. Measured:

```
full CI env (with CUSTOMER_BANK_*):        434 tests, 434 pass, 0 fail, 0 skipped
only the env_keys the profile declares:    100+ failures, starting at
                                           "global configuration validation normalizes every
                                            configuration section"
```

REV-054 section 8.6 concluded "the profile needs no change — HELD". That is the same class of expired
fact as REV-053 section 7.2, and it expired on the same merge. It is a Low rather than a Medium because
`env_keys` appears to be declarative rather than an injection whitelist — the customer module's own
profile declares `env_keys: []` for every suite and evidently runs — so this is a documentation gap,
not a broken gate. It should still be corrected, and the correction is four strings.

### L-3 — the shared-ring warning names two files by path, and the test pins the sentence rather than the fact

`sharedRingWarning()` tells the operator the other half of the job is
`server/scripts/rotateCustomerBankEncryption.js` and `reindexCustomerBankBlindIndexes.js`. Both exist
today; I checked. The test asserts `assert.match(shared.message, /rotateCustomerBankEncryption\.js/u)`
— which pins the *message*, not the *file*. If the Customer module renames or moves either script, the
supplier tool's only safety control points an operator at a path that does not exist, and all 33 unit
tests plus all 4 integration tests stay green. This is H-1's own lesson applied to H-1's own fix.
**Fix:** one line in the test — `assert.ok(existsSync(new URL("../scripts/rotateCustomerBankEncryption.js", import.meta.url)))`
for each named path.

### L-4 — a `pool.end()` failure discards the exit code and prints the stack trace the round removed

```js
  } finally {
    if (pool) await pool.end();
  }
```

An error thrown by `pool.end()` replaces `main`'s return value, escapes `main`, and reaches the entry
script's top-level `await` as an unhandled rejection. Demonstrated with the same control flow:

```
rotation blew up                 <- main's own one-line message, correct
Error: pool teardown failed
    at Object.end (...)
    at main (...)
Node.js v26.6.0
exit=1                           <- not the 2 main returned
```

A raw stack trace and exit 1 where the code said 2 — the exact failure mode REV-053 L-8 and REV-054 M-4
were filed for, on a line this round added. **Fix:** `try { await pool?.end(); } catch { /* the run is
over; a teardown failure must not rewrite its verdict */ }`.

### L-5 — `safeReason`'s cause-chain walk is defensive code no test exercises

`const chain = [error, error?.cause, error?.cause?.cause].filter(Boolean)` reduced to `[error]`
survives the unit suite (X9). No fixture anywhere produces a wrapped error, so neither the duplicate
detection nor the `publicCode`/`code` lookup is ever exercised through a `cause`. Either add a fixture
that wraps an `ER_DUP_ENTRY` in a `cause` — which is the realistic shape if a future driver or pool
wrapper is introduced — or drop the walk and take the single-link version.

### Carried over from REV-054, still open and acknowledged by the author

- **REV-054 L-7** — the progress printer prints nothing for any run under 100 rows. The author's reason
  (such runs finish in seconds and the report is the output) is reasonable; noted, not re-filed.
- **REV-054 L-8** — `npm test` still has no `--test-timeout`. The 50-SELECT cap lives in this file's own
  double, so a future test file with a non-advancing loop still hangs the suite. The author's reason
  (a global timeout changes the whole server suite's behaviour and is not this PR's risk to take) is
  reasonable; noted, not re-filed.

## 9. Info

### I-1 — the unit double ignores the SELECT projection; the integration suite catches it

Dropping `crypto_context` from the SELECT list survives all 33 unit tests and fails all 4 integration
tests. REV-054 filed this as I-2 on the strength of the unit layer alone; with the integration layer
measured, the projection is pinned. Adding a projection check to the double would still be cheap and
would move the kill an order of magnitude earlier.

### I-2 — `safeReason` still duplicates the error classification in `SupplierBankService`

Unchanged from REV-054 I-3. Two places now decide what an `ER_DUP_ENTRY` means. Not worth a shared
helper until a third appears.

### I-3 — `--transition-started` in the future produces neither a warning nor an error

`Math.floor((now - transitionStartedAt) / DAY_MS)` goes negative and no branch fires. A typo'd year
silently disables the transition-age warning. Unchanged from REV-054 I-5.

### I-4 — the shared-ring warning states a configuration rule as unconditional fact

The message asserts "The application configuration requires the Customer and Supplier bank key rings to
be byte-identical". `checkSharedBankKeyRings` imposes that when both bank capabilities are enabled. If
the Customer capability is ever turned off, the sentence becomes false while still being printed on
every run. Over-warning is the safe direction and I would not gate on it, but the wording should say
"requires, whenever the Customer bank capability is enabled".

### I-5 — a `--from` key that is in the ring but has no rows is indistinguishable from a completed rotation

`processed 0, attempted 0, remaining 0, supplierRowsDrained true, exit 0`. This is correct — the ring
check from REV-052 M-1 removes the typo case that made it dangerous — and I confirmed it on the live
instance. Recorded only so the next round does not re-derive it.

## 10. What I tried to verify and could not

- **The `remaining === null` path on real MySQL.** I could not induce a `COUNT(*)` failure against the
  live instance without disrupting another agent's use of it (revoking `SELECT`, killing the connection
  mid-run). M-1 is demonstrated at the unit layer with a fixture that fails only the `COUNT(*)` query;
  the exit code that follows (`report.failed === 0 ? 0 : 1` with `failed === 1`) is a direct
  consequence of the report I did produce, not an inference about untested code.
- **Concurrency against a live application.** The anti-clobber guard is proven by mutation at both the
  unit layer (17/18 die) and by the integration test for the duplicate case, but I did not run the
  rotation while `SupplierBankService` was writing. REV-054 reported the same limitation.
- **`Client 665/665`** in record section 11. This change touches no client file; I did not run it.
- **The full server suite count** (`2168 / 2164 pass / 3 skipped / 1 fail`). I was instructed to run the
  full suite at most once and no finding required it, so I did not. `TC-016` does fail on this setup for
  want of `DB_ADMIN_USER` / `DB_ADMIN_PASSWORD`, consistent with the record.
- **`npm run test:coverage`.** Instructed not to run it.

## 11. Verdict

**CHANGES_REQUESTED** — 0 Critical, 0 High, 3 Medium, 5 Low, 5 Info.

REV-054's High and all four Mediums are genuinely fixed in the shipped code, and I confirmed each by
running it rather than by reading it. The twenty-three-mutant table is honest. The leak scan's miss rate
went from 59 % to 0 %. The tool no longer authorises anything on any surface an operator touches at
runtime, and it fails closed.

What blocks is the same shape as the last four rounds, and this time both halves are in the same commit:
`remaining` was allowed to be `null` and an invariant was asserted over `failures`, and nobody ran the
two against each other, so a run in which every row succeeded now reports a failure and exits 1 (M-1).
The authorisation was removed from the code and left standing in the design spec and in the record's own
sections 4 and 5 (M-2). And the guard that was supposed to stop H-1 recurring catches one spelling of one
field name, while the exit-code contract that M-4 was entirely about is pinned by nothing (M-3).

None of the three is a data-loss risk and none is remotely reachable. All three are one edit each plus a
test, and all three are in the class this module keeps shipping: the named instance closed, its sibling
left open.
