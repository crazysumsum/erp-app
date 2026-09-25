# REV-051 — TASK-036 Bank key rotation commands, independent review

**Review:** REV-051 ・**Task:** TASK-036 (T36) ・**Phase:** PHASE-003 ・**Capability:** SUP-CAP-03
**Head reviewed:** `a9a081d046ee14b85c10f34d15d38ee236a9ea5f` (`claude/supplier-task-036`, PR #135).
**Subject:** `main…HEAD`, merge-base `1a47b65570ed7757b79cdabb1cdea20daadfdbbe`.
**Worktree:** `/Users/sam/Documents/workspace/erp-app-worktrees/supplier-task-036`
**Harness state:** revision 224; HD-034, HD-035, `APPROVAL-HD-035-SCOPE`.
**Reviewer:** independent agent (`agent-skills:security-auditor`); not the author. Author is Claude Opus 5.

**Verdict: CHANGES_REQUESTED** — 0 Critical, 0 High, **3 Medium**, 7 Low, 5 Info.

The rotation logic is correct. I attacked the resumability claim from four directions and it held; I
attacked the optimistic-concurrency guard with a real concurrent write against real MySQL and it held,
with a negative control that discriminates. Two concurrent rotations against 60 real rows left every row
decryptable and on the new key. Seven of the record's eight mutants reproduce exactly as recorded.

**What blocks is one acceptance criterion, demonstrated failing on real MySQL.** T36 AC3 says the error
and the report must not contain a blind index. They do: when the lookup rotation hits `ER_DUP_ENTRY`,
MySQL's message embeds the offending key value, and for `uq_supplier_bank_blind_index` that value *is*
the blind index. It is forwarded verbatim into `failures[].reason` and printed to stdout. The author's
secret scan could not have found this — it scans for base64 and for 43-character base64, and the leak
arrives as hex-escaped binary. This is the channel §6 of the record does not list.

The other two Mediums are `--limit` bounding successes rather than work (so a cautious `--limit=2` probe
walks the whole table when rows fail), and the concurrency guard being correct but covered by nothing:
a mutant that keeps the happy path and removes the protection survives **both** the unit suite and the
real-MySQL integration suite.

Everything below states what I ran. Anything reasoned about but not executed is marked **PLAUSIBLE**.
Twenty-six mutations were applied this round, each alone, each reverted immediately by the harness that
applied them, with `git status --porcelain` asserted empty after each. Four probe scripts were written
into the gitignored `server/logs/` and deleted. Every database row I seeded was removed and the removal
verified by count. `git status --porcelain` was empty before the review, after every mutation, and
immediately before this file was written. `git rev-parse HEAD` is still `a9a081d…`. Nothing committed,
nothing staged, no branch moved.

---

## Summary

| | |
| --- | --- |
| Critical | 0 |
| High | 0 |
| **Medium** | **3** — blind index bytes reach `failures[].reason` and stdout via `ER_DUP_ENTRY`, violating T36 AC3 (F-M1); `--limit` bounds successes, not work, so a bounded probe becomes a full-table scan with an unbounded `failures` array (F-M2); the optimistic-concurrency guard is load-bearing on a silent-data-reversion path and no test observes it (F-M3) |
| **Low** | **7** — the mutation table's "ring limit off by one" is killed in one direction only (F-L1); the lookup ring is checked by no test at all (F-L2); `processed` over-reports under concurrency (F-L3); `ORDER BY id` can be deleted with the suite still green (F-L4); the lookup batch query is quadratic where the encryption one is linear (F-L5); `origin/main` has moved (F-L6); the `failAfterWrite` double models a failure the real transaction wrapper cannot produce (F-L7) |
| Info | 5 |

**Suites at this head, run by me.**

| Suite | Result |
| --- | --- |
| `node --test … server/test/supplierBankKeyRotation.test.js` | **8/8** |
| `node --test … supplierBankRotation.integration.test.js` (real MySQL) | **4/4** |
| Supplier server suite, both globs, no DB env | **352 tests, 296 pass, 56 skipped, 0 fail** |
| Supplier server suite, both globs, with DB env | **352/352, 0 skipped, 0 fail** |
| `npm run lint` | **exit 0**, read as the process's own status |
| CI run `35824734344` at `a9a081d` | **five checks, all `pass`** |
| PR #135 | `OPEN`, not a draft, base `main`, `headRefOid` = reviewed head |

Both baselines were re-run after the last mutation was reverted and were green again.

---

## 1. The eight-mutant table, reproduced

I applied each of the record's eight mutants myself against the unit suite.

| Mutant | Record | Mine |
| --- | --- | --- |
| drop the from-key filter | KILLED | **KILLED** (5 tests) |
| reindex: key id not written | KILLED | **KILLED** |
| safeToRemove ignores failures | KILLED | **KILLED** |
| `--to` not validated against active | KILLED | **KILLED** |
| ring limit off by one | KILLED | **see F-L1 — depends on direction** |
| transition limit off by one | KILLED | **KILLED** |
| encryption: ciphertext not rewritten | KILLED | **KILLED** |
| failures swallowed entirely | KILLED | **KILLED** (2 tests) |

Seven of eight are real and die at assertions that mean what they say. The eighth is F-L1.

### Mutants the record does not contain

Run against the unit suite **and** the real-MySQL integration suite together.

| Mutant | Result |
| --- | --- |
| encryption `WHERE` guard inverted (`=` → `<>`) | KILLED — **only by integration**; no unit test notices |
| lookup `WHERE` guard inverted (`=` → `<>`) | KILLED — **only by integration** |
| encryption guard removed (SQL + param) | KILLED, but see F-M3 on *why* |
| lookup guard removed (SQL + param) | KILLED, same caveat |
| batch size ignores remaining room | KILLED (3 tests) |
| `ORDER BY id` dropped | **SURVIVED** → F-L4 |
| `room` counts failures as well as successes | **SURVIVED** → F-M2 |
| encryption key id not advanced on write | KILLED (6 tests) |
| `remainingRows` counts the wrong column | KILLED (3 tests) |
| `assertTarget` reads the wrong active key | KILLED (11 tests) |
| `crypto_context` not rebound on re-encrypt (AAD drift) | KILLED (2 tests) |
| `MAX_RING_SIZE` 3 → 4 | KILLED |
| ring `>` → `>=` (warn at exactly 3) | **SURVIVED** → F-L1 |
| ring `>` → `> n+1` (miss at 4) | KILLED |
| `MAX_TRANSITION_DAYS` 30 → 31 | KILLED |
| **lookup ring never checked at all** | **SURVIVED** → F-L2 |
| encryption guard made vacuous (`OR 1 = 1`) | **SURVIVED** → F-M3 |
| lookup guard made vacuous (`OR 1 = 1`) | **SURVIVED** → F-M3 |

---

## 2. [MEDIUM] F-M1 — the blind index reaches `failures[].reason` and stdout

**Location:** `server/src/modules/supplier/bankKeyRotation.js:181`, surfaced through
`server/scripts/supplierBankRotationCli.js:88`.

```js
failures.push({ id: Number(row.id), reason: error?.message ?? "unknown" });
```

The comment above that line reasons about the error's origin:

> `error.message` 由 crypto 拋出嚟，佢唔含密文或者 key（見 SupplierBankCrypto）。

That is true of crypto's errors — I checked all seven throw sites in `SupplierBankCrypto.js` and none
carries a value (see I-1). But the `catch` is around `rotateRow`, which also contains
`connection.execute`. A MySQL error lands in the same `reason`.

**Reproduced on real MySQL.** I created the state this tool exists to recover from: a lookup key
dropped from the ring while rows still referenced it, so `candidateBlindIndexes` no longer covers the
old row and the service's duplicate pre-check cannot see it, letting a twin row in under the new key.
Rotating the old row then collides on `uq_supplier_bank_blind_index`:

```
rc=1
{
  "kind": "lookup", "from": "ci-look-1", "to": "ci-look-2",
  "processed": 0, "failed": 1,
  "failures": [
    {
      "id": 2774,
      "reason": "Duplicate entry '15736-ci-look-2-\xC0\x18\x83\xD2\x15>4\xC4\x9C\xB7\x01`\x85&\xEC'
                 for key 'supplier_bank_accounts.uq_supplier_bank_blind_index'"
    }
  ],
  "remaining": 1, "safeToRemoveFromKey": false
}
```

**Impact.** T36 AC3: *CLI參數、progress、error及report不包含key、明文、ciphertext或blind index*. The
report contains fifteen of the thirty-two bytes of the blind index the row *would* have had under the
new lookup key, plus the `supplier_id` and the key id. It goes to stdout, to the JSON report, and into
whatever CI artifact or runbook log captures it. It is a keyed HMAC, so it is not invertible without
the lookup key and it is not plaintext or key material — which is why this is Medium and not High. It
is a stable correlator for one supplier's bank account, and the criterion forbids it without
qualification.

**Why the record's scan could not find it.** §6 says: *掃真 CLI 嘅 stdout＋stderr：兩條 key 嘅 base64、
兩個帳號明文、任何 43 字元 base64 —— 全部零命中*, and demonstrates that the scan finds a planted key.
I re-ran that scan across sixteen captured stdout/stderr files from real CLI runs, including the failing
one, with the negative control. The scan discriminates — it finds the planted key. It also reports zero
hits on the leak, because the leak arrives as `\xC0\x18\x83…`, and no base64 pattern matches hex-escaped
binary. The scan is honest and the conclusion drawn from it is too narrow: it was run over clean runs
only, and its patterns structurally cannot see this channel.

**Recommendation.** Do not forward a driver's message. `mysql2` errors carry `.code`; crypto's do not —
I confirmed `code: 'ER_ACCESS_DENIED_ERROR'` on a real connection failure and plain `Error`/`TypeError`
from crypto.

```js
// A driver's message is not ours to forward. ER_DUP_ENTRY embeds the offending key
// value, and for uq_supplier_bank_blind_index that value IS the blind index.
function failureReason(error) {
  if (error?.code) return `database error ${error.code}`;
  return error?.message ?? "unknown";
}
```

Add a test that drives a real `ER_DUP_ENTRY` through `rotateRow` and asserts the reason matches
`/^database error [A-Z_]+$/` and contains no `\x` escape. The construction is in §6 below.

---

## 3. [MEDIUM] F-M2 — `--limit` bounds successes, not work

**Location:** `server/src/modules/supplier/bankKeyRotation.js:169`.

```js
const room = limit > 0 ? limit - processed : batchSize;
```

`processed` increments only on success (line 176). A failing row increments nothing, so `room` never
shrinks, while `lastId` advances past it. The loop therefore continues until the table is exhausted.

**Demonstrated.** Ten rows, all failing to decrypt, `limit: 2`:

```
--limit=2 over 10 rows that all fail:
  rows SELECTed  : 10   (a bounded run should stop at 2)
  rows attempted : 10
  report.processed=0 failed=10 lastId=10
```

**Impact.** The cautious first pass is the whole point of `--limit`. An operator who runs `--limit=1`
against a misconfigured ring — the exact situation in which the ring is misconfigured — gets a full-table
scan instead of a one-row probe, one decryption attempt per row, and a `failures` array with one entry
per row in the table, accumulated in memory and then `JSON.stringify`d to stdout in one string. On the
Bank table at production size this is the difference between a probe and an incident. T36 describes the
commands as *bounded batch*; this bound does not hold on the failure path.

The mutant that makes `room` count failures survives the suite, so nothing pins either semantics today.

**Recommendation.** One line, plus a test:

```js
const room = limit > 0 ? limit - processed - failures.length : batchSize;
```

Consider capping `failures` in the report (keep the first N, report a count) so the report stays bounded
independently of the limit.

---

## 4. [MEDIUM] F-M3 — the concurrency guard is load-bearing and untested

**Location:** `server/src/modules/supplier/bankKeyRotation.js:129` and `:139`.

```sql
WHERE id = ? AND encryption_key_id = ?
WHERE id = ? AND blind_index_key_id = ?
```

**The guard is correct, and it matters.** A rotation reads a row's plaintext, then writes it back. If
the application updates that account number in between, an unguarded write would put the stale plaintext
back — a silent reversion of a bank account number, which is a payment-to-the-wrong-account risk with no
error anywhere.

I built that interleaving against real MySQL: a second connection lands a genuine account-number change
on the row after the rotation has read it and before the rotation's `UPDATE`.

```
report.processed        = 1
report.failed           = 0
row now decrypts to     = 66660000000099
the app's write survived= true
stale value would be    = 770000000001
```

**The negative control discriminates.** With the guard made vacuous (`OR 1 = 1`), same script, same row:

```
row now decrypts to     = 770000000001
the app's write survived= false
```

So the guard, not something else, is what saves the write.

**Nothing tests it.** Both vacuous-guard mutants **survive the unit suite and the real-MySQL integration
suite**. The guard's presence is pinned only incidentally: inverting it to `<>` breaks the happy path, so
that mutant dies. Weakening it while leaving the happy path intact is invisible.

The unit double is the reason at that layer. `fakeDatabase`'s `execute` now parses the `SET` clause —
the fix §6 of the record describes, and it is real: the `SET`-side mutants die because of it. But it
still does not parse `WHERE`; it locates the row by `params[params.length - 2]` and ignores the guard
entirely. The double reproduces the half of the statement the author was burned by and not the other
half. This is worth saying plainly because it is the same shape as the defect the record reports
finding: **`SET` is now faithful, `WHERE` is not.** Both the resumability filter and the optimistic
guard live in `WHERE`.

This also explains why the "guard removed (SQL + param)" mutants die at the unit layer. They die because
dropping a parameter shifts `params[params.length - 2]` onto a key id, the row lookup returns
`undefined`, and the double throws a `TypeError`. That is the double's indexing hack failing, not a test
observing a missing guard. Real MySQL would have executed the unguarded `UPDATE` happily.

**Recommendation.** Add one integration test using the interleaving above — wrap `withTransaction` so a
second connection's write commits between the `SELECT` and the `UPDATE`, then assert the row still
decrypts to the application's value. It is about fifteen lines and it kills all four guard mutants.
Optionally teach the double's `execute` to honour the `WHERE` predicate so the unit layer stops being
blind to it.

---

## 5. Claims I attacked and that held

### 5.1 "The condition is the progress"

Attacked from four directions.

**A row written behind the cursor during a run.** Cannot carry the `from` key. `encryptAccountNumber`
and `blindIndex` always use the active key (design §5.8), so every insert and every update lands on the
active key id. The `from`-keyed set only ever shrinks. **HELD.**

**`id` not monotonic for new rows.** Same argument reaches it: whatever id a new row gets, it carries
the active key, so `WHERE ${column} = from` excludes it regardless of where it lands relative to the
cursor. The InnoDB auto-increment interleaving detail itself is **PLAUSIBLE** — I reasoned about it and
did not execute it — but the conclusion does not depend on it.

**Two rotations at once.** Executed. Two real CLI processes, `--batch-size=5`, against 60 real rows:

```
race1: processed 60, failed 0, remaining 0, safeToRemoveFromKey true
race2: processed 60, failed 0, remaining 0, safeToRemoveFromKey true
rows=60 decryptable=60 corrupted=0 distinct encryption_key_id=ci-enc-2
```

No corruption, no partial row, every row decryptable under the new key. The guard turns the loser's
`UPDATE` into a no-op. **HELD** (with F-L3 on the counts).

**The backstop nobody mentions.** `remainingRows` is a table-wide `COUNT(*)` with no cursor in it, so
even a cursor that skipped rows cannot produce `safeToRemoveFromKey: true` while rows remain on the old
key. That, not the cursor's correctness, is what makes the key-removal decision safe. It is the
strongest thing in this design and the record undersells it.

**Resumability on the real CLI.** Reproduced §6's manual table exactly, with no progress parameters
passed on the resume:

| Command | processed | remaining | safeToRemove |
| --- | --- | --- | --- |
| `rotate-encryption --limit=2` | 2 | 3 | false |
| `rotate-encryption` (resume) | 3 | 0 | true |
| `reindex-lookup --limit=3` | 3 | 2 | false |
| `reindex-lookup` (resume) | 2 | 0 | true |

### 5.2 `--to` as a confirmation

**HELD.** The mutant dies; the real CLI refuses `--to=ci-enc-9` and exits 1. The reasoning in §3 of the
record is correct: since `encryptAccountNumber` and `blindIndex` can only use the active key, a `--to`
that is not the active key describes a rotation that cannot happen, and failing is right.

### 5.3 `safeToRemoveFromKey`'s second clause

**The clause is non-redundant — but not for the reason the test constructs.** See F-L7. The clause can
only ever *refuse* removal, never wrongly permit it, so it is safe in every case; it just is not
demonstrated by a mechanism the real layer has.

### 5.4 The duplicate check during a half-rotated ring

**HELD**, and it is the right design. `candidateBlindIndexes` computes one index per ring key and
`#duplicates` queries `account_blind_index IN (…)` with no key-id predicate, so a row still on the old
key is found. The integration test constructs a genuinely half-rotated table (`limit: 1` over two rows)
and asserts `BANK_ACCOUNT_DUPLICATE`. I ran it; it passes; inverting the lookup guard breaks it, so the
assertion is live.

The limit of this control is the one F-M1's reproduction exploits: it covers the *configured* ring. A
key removed from the ring while rows still reference it is invisible to it — which is precisely what
`safeToRemoveFromKey` exists to prevent, so the control and the tool are consistent with each other.

### 5.5 Secret scanning, the channels the record did not scan

| Channel | Result |
| --- | --- |
| Crypto failure `reason` (bad key id, GCM auth failure) | **Clean** — fixed string, no value |
| Normalisation failure `reason` | **Clean** — category only (I-1) |
| **MySQL failure `reason`** | **LEAKS** → F-M1 |
| Progress lines | **Clean** — `processed=` and `lastId=` only |
| Warning lines on stderr | **Clean** — counts, limits, kind |
| Unhandled `--to` rejection, stack trace | **Clean** — key **ids** only |
| Unhandled DB access-denied, stack trace | **Clean** — no password, no key |
| `unknown argument ${argument}` | Echoes argv verbatim (I-3) |

### 5.6 The boundary claim

**Verified against the merge-base**, by classifying every changed path against
`00_module_manifest.json`'s `scope`.

| Path | Classification |
| --- | --- |
| `server/scripts/rotateSupplierBankEncryption.js` | **OUTSIDE_MODULE** |
| `server/scripts/reindexSupplierBankBlindIndexes.js` | **OUTSIDE_MODULE** |
| `server/scripts/supplierBankRotationCli.js` | **OUTSIDE_MODULE** |
| `server/package.json` | `approval_required_paths` → `APPROVAL-HD-035-SCOPE` |
| `server/src/modules/supplier/**` (2 files) | `allowed_write_paths` |
| `server/test/**` (2 files) | `allowed_write_paths` |
| `docs/supplier_management/**` | `allowed_write_paths` |

Exactly three `OUTSIDE_MODULE` entries, all in `server/scripts/`, and `server/package.json` runs the
approval gate rather than the boundary gate. **The claim is exactly right.** See I-4 for one
record-level note that does not change this.

The architectural decision behind it is sound and I want to record that: keeping every branch, every
loop and every SQL statement in `bankKeyRotation.js` and leaving `server/scripts/` as three shims is
what makes the logic unit-testable without MySQL *and* minimises what sits outside the module. The two
constraints pointed the same way and the author followed them.

---

## 6. Low findings

**F-L1 — "ring limit off by one KILLED" is direction-dependent.** `MAX_RING_SIZE 3 → 4` dies and
`> → > n+1` dies, but `> → >=` **survives**. No test builds a ring of exactly three keys — which is the
maximum the design permits and the normal state of a system mid-transition. Under the surviving mutant
every healthy three-key transition emits `RING_TOO_LARGE`, and §5.8's own reasoning (*一個正喺輪替途中
嘅系統本來就會短暫超標*) says that is the state you least want to cry wolf in. The record closed exactly
this boundary for the 30/31-day case and did not close it here. One line:
`assert.deepEqual(codes(ringWarnings({ crypto: crypto({ encRing: { e1: KEY_A, e2: KEY_B, e3: KEY_C } }) })), [])`.

**F-L2 — the lookup ring is checked by no test.** Deleting `["lookup", crypto.lookupKeyIds]` from
`ringWarnings`'s loop survives the entire suite. The lookup ring is the one `reindex-lookup` rotates, and
`lookupKeyIds` — one of the two getters §7 of the record adds — has no effective coverage: its only call
site can be removed silently. Add an oversized-lookup-ring case.

**F-L3 — `processed` over-reports.** `connection.execute`'s `affectedRows` is never read, so an `UPDATE`
the guard turned into a no-op still counts. Two concurrent rotations each reported `processed: 60` for
60 rows; my interleaving test reported `processed: 1` for a row it did not write. `safeToRemoveFromKey`
is unaffected because it is driven by the `COUNT`, so this is reporting quality, not safety — but a
runbook that reconciles `processed` against a row count will pass spuriously. `const [result] = await
connection.execute(…); return result.affectedRows === 1;` and count only real writes.

**F-L4 — `ORDER BY id` can be deleted and the suite stays green.** It is load-bearing: `lastId` takes the
last row of the returned batch as the cursor, which is only a cursor if the batch is ordered. Impact is
low because unordered batches still terminate (processed rows stop matching) and `remaining` still
catches anything skipped — but the survivor means the ordering is unpinned. Fixture sizes are small
enough that InnoDB returns primary-key order anyway, which is why no test notices.

**F-L5 — the lookup batch query is quadratic where the encryption one is linear.** `EXPLAIN` on real
MySQL:

```
encryption batch -> Index range scan using PRIMARY over (0 < id), filter on encryption_key_id
lookup batch     -> Covering index lookup using idx_supplier_bank_lookup (blind_index_key_id = …)
                    -> Sort: id, limit input to 200 row(s) per chunk
```

The encryption cursor gets a clean forward primary-key scan, so a whole rotation is one pass. The lookup
cursor uses `idx_supplier_bank_lookup`, which is `(blind_index_key_id, account_blind_index)` and gives no
`id` order, so **every batch reads all remaining old-key rows and sorts them** to take 200. Over a full
rotation that is quadratic in the number of rows. `FORCE INDEX (PRIMARY)` on the lookup `SELECT` makes it
behave like the encryption one, costs one line and needs no schema change — a new index would touch
design §5.8 and need sign-off. **PLAUSIBLE** at production scale: I measured the plan, not the runtime.

**F-L6 — `origin/main` has moved.** `da222e2` (`#134`, two commits) landed after CI ran at this head.
The standing merge-time step applies: merge `origin/main` into the branch, let CI re-run on the merge
commit, refresh `baseline.default_commit`. Process, not a change to this PR's content.

**F-L7 — the `failAfterWrite` double models a failure the real wrapper cannot produce.** The double
throws from inside `execute` *after* mutating the row, so the row keeps the new key and the run records
a failure. In the real `withTransaction` (`supplierBankRotationCli.js:60`), an `execute` that throws is
rolled back — the row keeps the **old** key and `remaining` counts it. So the state the test constructs
is not reachable by the path it models.

The clause is still non-redundant, and I can name two mechanisms that do reach `remaining === 0 &&
failures.length > 0`: `commit()` succeeds and `release()` in the `finally` throws, so the error
propagates after the write landed; and a row the rotation failed on that the application then rewrites
onto the active key before the closing `COUNT`. Either would be a faithful construction. This is the
recurring shape worth naming — the double makes the *conclusion* true by a mechanism the real layer does
not have, which is how a double stops being a model.

---

## 7. Info

**I-1 — the normalisation failure path is clean. HELD.** `requireAccount`
(`SupplierBankCrypto.js:118-123`) throws with the category only — `EMPTY`, `UNREPRESENTABLE`,
`TOO_LONG` — never the value, with a comment tying that to design §6.6. So a row whose decrypted
plaintext no longer normalises produces a `reason` naming the category and nothing else. I checked all
seven throw sites in the file; none carries a value, a ciphertext or a key.

**I-2 — unhandled error paths are clean. HELD.** A rejected `--to` and a bad database password both
produce a Node stack trace containing key **ids**, file paths and `ER_ACCESS_DENIED_ERROR`, and no key
material, no password and no plaintext.

**I-3 — `unknown argument ${argument}` echoes argv verbatim,** value included. Reachable only if an
operator puts a secret on the command line, where `ps` and shell history already have it. Recording it
because it is an output channel, not because it is a finding.

**I-4 — `APPROVAL-HD-035-SCOPE`'s scope list names two of the three `server/scripts/` files.**
`supplierBankRotationCli.js` is absent. No gate is bypassed: the approval's operative subject is
`server/package.json`, the declared `approval_required_path`, and `server/scripts/` is handled
categorically by HD-034, which the approval itself restates. Worth a line in the record so a later
reader does not reconcile three files against two names and think something slipped.

**I-5 — `remainingRows` is a full table scan,** once per run, not per batch. Acceptable at the frequency
it runs, and it is what makes the key-removal decision cursor-independent (§5.1). Not worth changing.

---

## 8. What I did not check

- **CI at a merged head.** I read the five green checks at `a9a081d`; I did not re-run them over
  `origin/main` + this branch. F-L6.
- **Production-scale timing.** F-L5 is a query plan, not a measurement. No table in `erp_dev` is large
  enough to time the quadratic behaviour.
- **InnoDB auto-increment interleaving under concurrent inserts.** Reasoned, not executed; the
  conclusion in §5.1 does not rest on it.
- **Crash-mid-transaction.** I did not kill a process between `commit()` and `release()`. The
  `safeToRemoveFromKey` clause covers it conservatively either way.
- **The `--transition-started` flag end to end.** `ringWarnings` is unit-tested at both boundaries for
  time; I did not drive the flag through the CLI to a `TRANSITION_TOO_LONG` on stderr.
- **Any client-side surface.** This task has none.

## 9. Residual risk I would accept, if F-M1 and F-M2 were fixed

The rotation logic is sound and the safety property that matters — never authorise removing a key while
a row still uses it — is enforced by a cursor-independent `COUNT` and verified at both layers. The
remaining risk is regression risk, not present-defect risk: F-M3, F-L1, F-L2 and F-L4 are all controls
that work today and that no test would notice breaking. On a money path that is worth closing, and the
four together are perhaps forty lines of test.

---

## 10. Verdict

**CHANGES_REQUESTED.** 0 Critical, 0 High, 3 Medium, 7 Low, 5 Info.

**Blocking: F-M1.** T36 AC3 forbids a blind index in the error and the report, and one is there,
demonstrated on real MySQL, on the failure path an operator is most likely to be looking at. The fix is
a four-line helper and one test.

**Also fix before merge: F-M2.** `--limit` not bounding work turns the cautious probe into the dangerous
operation, and the report it produces is unbounded in memory. One line and one test.

**F-M3 should land in the same round.** The guard it covers is the difference between a rotation that is
safe to run against live traffic and one that silently reverts customers' bank account numbers, and
right now nothing would tell you if it broke. I have a working construction; it is about fifteen lines.

**The seven Lows are follow-ups.** F-L1 and F-L2 are one assertion each. F-L6 is one command.

**On the record's accuracy.** Seven of the eight mutants are real, the boundary claim is exactly right,
the resumability table reproduces on the real CLI, and the fail-closed demonstration in §5 is a fair
reading of what happened. One mutation-table row is true in one direction only (F-L1), and the secret
scan's conclusion is broader than what the scan can see (F-M1) — the scan itself is sound and its
negative control does discriminate, which I verified. The record also reports its own double being
unfaithful and fixing it; that fix is real and it works on the `SET` clause. It does not extend to
`WHERE`, and the two things this task's safety rests on most — the resumption filter and the
concurrency guard — both live there.
