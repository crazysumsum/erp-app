# REV-052 — TASK-036 Bank key rotation, independent review of the REV-051 remediation

**Review:** REV-052 ・**Task:** TASK-036 (T36) ・**Phase:** PHASE-003 ・**Capability:** SUP-CAP-03
**Head reviewed:** `28d974d9809376fdc4d49df69b3d0f016befcfb3` (`claude/supplier-task-036`, PR #135).
**Subject:** `main…HEAD`, merge-base `da222e2ef4e2b9cf7278878b7badc1b52203bb12`.
**Delta since REV-051:** `a9a081d..HEAD` — the remediation plus a merge of `main`.
**Worktree:** `/Users/sam/Documents/workspace/erp-app-worktrees/supplier-task-036`
**Harness state:** revision 227; baseline `code_commit` / `default_commit` refreshed to `18c16da` / `da222e2`.
**Reviewer:** independent agent (`agent-skills:security-auditor`); not the author. Author is Claude Opus 5.

**Verdict: CHANGES_REQUESTED** — 0 Critical, 0 High, **3 Medium**, 7 Low, 5 Info.

**All three REV-051 Mediums are genuinely fixed, and I verified each by reproduction rather than
reading.** F-M1 is fixed on real MySQL: a genuine `ER_DUP_ENTRY` on `uq_supplier_bank_blind_index`
during a lookup rotation now yields `DUPLICATE_KEY` plus the constraint name, with no index bytes in
latin1, hex, upper hex, base64 or MySQL's own `\xNN` escape form. F-M2 holds across ten
`limit`/`batchSize` combinations, including `limit` below a batch and sparse ids, and `lastId` never
skips a row. F-M3 is closed: all six guard mutants I wrote die, and — unlike at `a9a081d` — the two
"guard removed cleanly" mutants now die at the concurrency assertion rather than at a `TypeError` in
the double. Both record corrections reproduce. The eleven-mutant table in §7 of the record is accurate:
I applied all eleven myself and all eleven die. **That is the first round in which the record's
mutation table has been right.** The boundary claim is exactly right: three `OUTSIDE_MODULE`, all in
`server/scripts/`, `server/package.json` on the approval gate.

**What blocks is three things nobody has looked at.**

The first is `--from`. REV-051 examined `--to` from every angle and established that it is a
confirmation rather than a selector. Nothing validates `--from` at all. On the real CLI, a `--from`
key id that has never existed returns `processed: 0, failed: 0, remaining: 0,
safeToRemoveFromKey: true` and **exit 0** — byte-identical in shape to a completed rotation. The
getter added in this PR to check exactly this carries a doc comment saying so and is never called for it.

The second is the SELECT cursor. The author has now made the double faithful to `SET` and to `WHERE`
in `execute`. He did not touch `db.query`, which still hardcodes `r[column] === params[0] && r.id >
params[1]` and sorts unconditionally. So `AND id > ?` — the clause that makes the rotation terminate
— **is pinned by nothing**. I removed it and the full 356-test suite passed, including every
real-MySQL test; then I removed it again against real MySQL with one permanently failing row and
watched the same row id come back in five consecutive batches with no forward progress. That is the
fourth fidelity gap on this task, in the one method that was never repaired.

The third is what the F-M1 fix cost. `safeReason`'s comment says *Crypto 自己嘅錯誤有 publicCode／
code，兩個都係固定識別碼*. It is false. I checked all four crypto failure paths: every one throws a
plain `Error`/`TypeError` with no `code`, no `publicCode`, no `errno`. So the `named` branch is dead
for crypto and **every crypto-originating row failure now reports `reason: "UNKNOWN"`** — verified on
the real CLI, five rows, five `UNKNOWN`. That is the same scenario §5 of the record documents as
producing a named authentication failure; §5 no longer describes the code.

Everything below states what I ran. Anything reasoned about and not executed is marked **PLAUSIBLE**.
Twenty-three mutations were applied this round, each alone, each reverted immediately, with
`git status --porcelain` asserted empty after each. Six probe scripts were written into the session
scratchpad, outside the repository. Every database row I seeded was removed and the removal verified
by count; one hung mutant run left rows behind and I found, removed and re-verified them before
continuing (I-3). `git status --porcelain` was empty before the review, after every mutation, and
immediately before this file was written. `git rev-parse HEAD` is still `28d974d…`. Nothing committed,
nothing staged, no branch moved.

---

## Summary

| | |
| --- | --- |
| Critical | 0 |
| High | 0 |
| **Medium** | **3** — `--from` is validated against nothing, so a mistyped key id returns `safeToRemoveFromKey: true` and exit 0 (F-M1); the SELECT's `id > ?` cursor is pinned by no test and its removal loops forever against real MySQL (F-M2); every crypto failure now reports `UNKNOWN`, the comment justifying that branch is false, and record §5 documents output the code can no longer produce (F-M3) |
| **Low** | **7** — both `safeReason` fallbacks are unpinned, so restoring `error.message` passes all 356 tests (F-L1); `Math.min(batchSize, room)` was KILLED at `a9a081d` and now SURVIVES, unrecorded (F-L2); `ORDER BY id` still unpinned, reconfirmed on a clean database (F-L3); the double's `WHERE` parser is faithful to exactly one query shape (F-L4); `--batch-size=0` is accepted, does nothing and exits 0 (F-L5); the failure path emits one progress line per row and an uncapped `failures` array (F-L6); `processed` still over-reports, and is now exercised by a test that does not assert it (F-L7) |
| Info | 5 |

**Suites at this head, run by me.**

| Suite | Result |
| --- | --- |
| `node --test … server/test/supplierBankKeyRotation.test.js` | **12/12** |
| Supplier suite, both globs, with DB env (real MySQL) | **356/356, 0 skipped, 0 fail** |
| `npm run lint` | **exit 0** |
| PR #135 | `OPEN`, not a draft, base `main`, `headRefOid` = reviewed head, `mergeable: MERGEABLE`, `mergeStateStatus: UNSTABLE` |
| CI at `28d974d` (run `35826677221`) | four pass, **`Test (server + client, MySQL integration)` FAILURE** — see §8 |

Both baselines were re-run after the last mutation was reverted and were green again.

---

## 1. The eleven-mutant table, reproduced

I applied each of the record's eleven mutants myself against the unit suite.

| Mutant | Record | Mine |
| --- | --- | --- |
| F-M1 forward the driver message | KILLED | **KILLED** (1 test) |
| F-M2 limit counts successes | KILLED | **KILLED** (1 test) |
| F-M3 encryption guard vacuous | KILLED | **KILLED** |
| F-M3b lookup guard vacuous | KILLED | **KILLED** |
| ring limit `>` becomes `>=` | KILLED | **KILLED** |
| drop the lookup half of warnings | KILLED | **KILLED** |
| drop the from-key filter | KILLED | **KILLED** (9 tests) — but see below |
| safeToRemove ignores failures | KILLED | **KILLED** |
| `--to` not validated | KILLED | **KILLED** |
| transition limit off by one | KILLED | **KILLED** |
| reindex: key id not written | KILLED | **KILLED** (2 tests) |

Eleven of eleven. The table is accurate, and this is worth saying plainly after thirteen prior rounds
in which it was not.

One caveat on row seven. "Drop the from-key filter" removes both the predicate and its parameter, and
that is what kills it: the double reads `params[0]` as the key-id filter regardless of the SQL, so
dropping the parameter shifts `after` into that slot and no row matches. The semantically interesting
variant — `WHERE ${column} != ?`, which keeps the parameter and rotates precisely the wrong rows —
**survives the unit suite entirely** and is killed only by the four real-MySQL integration tests
(352/356). The from-key filter is therefore pinned, but by integration alone. This is the same
diagnosis as F-M2 below, and it is what convinced me the gap is in `db.query` rather than anywhere else.

### Mutants the record does not contain

Each run against the unit suite; survivors re-run against the full 356 with real MySQL.

| Mutant | Result |
| --- | --- |
| `selectBatch`: drop `AND id > ?`, keep the parameter | **SURVIVED 12/12 and 356/356** → F-M2 |
| `selectBatch`: `WHERE ${column} != ?` | SURVIVED unit; KILLED by integration (4 tests) |
| `selectBatch`: drop `ORDER BY id` | **SURVIVED 12/12 and 4/4 integration** → F-L3 |
| encryption guard `(…) OR 1 = 1` (parenthesised) | KILLED (6 tests) — for the wrong reason, see F-L4 |
| lookup guard `(…) OR 1 = 1` (parenthesised) | KILLED (3 tests) — same |
| encryption guard `… OR 1 = 1` (unparenthesised) | **KILLED (1 test — the right one)** |
| lookup guard `… OR 1 = 1` (unparenthesised) | **KILLED (1 test — the right one)** |
| encryption guard removed, SQL + parameter | **KILLED (1 test — the right one)** |
| lookup guard removed, SQL + parameter | **KILLED (1 test — the right one)** |
| `ringWarnings`: drop the **encryption** half | KILLED |
| `safeReason`: terminal `UNKNOWN` → `error.message` | **SURVIVED 12/12 and 356/356** → F-L1 |
| `safeReason`: `constraint ?? "unknown"` → full `sqlMessage` | **SURVIVED 12/12 and 356/356** → F-L1 |
| `Math.min(batchSize, room)` → `batchSize` | **SURVIVED 12/12 and 356/356** → F-L2 |
| drop the inner `attempted >= limit` break | SURVIVED — **equivalent mutant**, not a gap (see F-L2) |

---

## 2. [MEDIUM] F-M1 — `--from` is validated against nothing, and a typo answers "yes, remove that key"

**Location:** `server/src/modules/supplier/bankKeyRotation.js:83-86` (`assertDistinct`) and `:196-197`.

```js
function assertDistinct(from, to) {
  if (!from) throw new Error("--from is required");
  if (from === to) throw new Error("--from and --to are the same key id; nothing to rotate");
}
```

That is the whole of it. `--to` is checked against the active key — REV-051 established why that is
right and I have nothing to add. `--from` is checked for emptiness and for not colliding with `--to`.
It is never checked against the configured ring, and it is never checked against the table.

**Reproduced on the real CLI, against real MySQL, with nothing seeded:**

```
$ node scripts/rotateSupplierBankEncryption.js --from=typo-never-existed --to=ci-enc-1 --json
{"kind":"encryption","from":"typo-never-existed","to":"ci-enc-1","processed":0,"attempted":0,
 "failed":0,"failures":[],"lastId":0,"remaining":0,"safeToRemoveFromKey":true,
 "warnings":[],"startedAt":…,"endedAt":…}
exit=0
```

**Impact.** `safeToRemoveFromKey` is the one output this tool exists to produce; it is the gate on the
irreversible step, and the design's whole safety argument (REV-051 §5.1, "the backstop nobody
mentions") is that a cursor-independent `COUNT` cannot report zero while rows still hold the key. That
argument is sound *for the key the operator meant*. For a key id the operator mistyped, the `COUNT`
is trivially zero, `failures` is trivially empty, and the tool answers `true` with exit code 0.

The report is not *false* — removing `typo-never-existed` from a ring that does not contain it is
indeed harmless, and `from` is echoed in the report. The hazard is that the two situations produce the
same shape. A legitimate final resume of a finished rotation also ends `processed: 0, remaining: 0,
safeToRemoveFromKey: true, exit 0` — that is the documented "you are done" signal, reproduced in §6 of
the record and again by REV-051. So "there was nothing to do because you asked about the wrong key"
and "there was nothing to do because it is finished" are distinguishable only by re-reading the key id
the operator already got wrong, in a report they are reading precisely to be told they may proceed.

This matters more here than it would elsewhere because of what comes next: the operator acts on
`safeToRemoveFromKey: true` by editing `SUPPLIER_BANK_ENCRYPTION_KEYS` and dropping a key. Dropping
the wrong one leaves rows that cannot be decrypted at all, and the duplicate pre-check blind to them —
which is exactly the state REV-051 had to construct by hand to demonstrate F-M1, and exactly the state
the design §5.8 ring rules exist to prevent.

**The check already exists and is unused.** This PR adds two getters to `SupplierBankCrypto`, with
this comment (`SupplierBankCrypto.js:210-217`):

> 輪替工具靠呢兩個判斷 ring 大細（設計 §5.8 限 3 條）**同埋確認舊 key 仲喺唔喺 ring 入面**。

"…and confirm the old key is still in the ring." `ringWarnings` uses them for the size check. Nothing
uses them for the second stated purpose.

**Recommendation.** One line beside `assertTarget`, plus one assertion:

```js
const ring = kind === ROTATION_KINDS.ENCRYPTION ? crypto.encryptionKeyIds : crypto.lookupKeyIds;
if (!ring.includes(from)) {
  throw new Error(`--from ${from} is not in the configured ${kind} key ring; refusing to report on a key this process cannot decrypt`);
}
```

Failing closed is right here for the same reason `--to` fails closed: a `--from` outside the ring
describes a rotation this process cannot perform, because it does not hold the material to decrypt
those rows. Note the two cases are not symmetric — a `--from` that is in the ring but has no rows is
legitimate and must keep returning `true`, since that is how a completed rotation is confirmed.

---

## 3. [MEDIUM] F-M2 — the SELECT cursor is pinned by nothing, and removing it never terminates

**Location:** `server/src/modules/supplier/bankKeyRotation.js:131` — `WHERE ${column} = ? AND id > ?`.
**Cause:** `server/test/supplierBankKeyRotation.test.js:44-57`, the double's `query`.

The author repaired the double twice on this task: first to read the `SET` clause instead of assigning
by parameter position, then — this round — to read the `WHERE` clause in `execute` instead of taking
`params[params.length - 2]` as the id. Both repairs are real and both work; six guard mutants die
because of the second one. Neither touched `query`, which still does this:

```js
const column = sql.includes("WHERE encryption_key_id") ? "encryption_key_id" : "blind_index_key_id";
const limit = Number(/LIMIT (\d+)/u.exec(sql)[1]);
return [table.filter((r) => r[column] === params[0] && r.id > params[1])
  .sort((a, b) => a.id - b.id).slice(0, limit).map((r) => ({ ...r }))];
```

The key-id predicate, the `id > ?` cursor and the ordering are hardcoded. Only the column name and the
`LIMIT` are read from the SQL. So the resumption query's text is very nearly unpinned at the unit
layer — which is the same shape as the defect the record reports finding and fixing, one method over.

**Executed.** Removing `AND id > ?` from the SQL while leaving the parameter in place:

| Suite | Result |
| --- | --- |
| `supplierBankKeyRotation.test.js` | **12/12 pass — SURVIVES** |
| `supplierBankRotation.integration.test.js` (real MySQL) | **4/4 pass — SURVIVES** |
| Supplier suite, both globs, real MySQL | **356/356 pass — SURVIVES** |

**And here is what it does against real MySQL.** One row, seeded under a key whose material the
rotator does not hold, so it fails permanently — the exact shape of the record's own §5 scenario. I
instrumented `database.query` to record the row ids in each batch and to abort after five.

```
control (shipped code):   COMPLETED: attempted=1 failed=1 lastId=3279 failures=1
                          batches of row ids SELECTed: [[3279],[]]

mutant ('AND id > ?' removed):  HUNG: STOPPED: no forward progress
                          batches of row ids SELECTed: [[3280],[3280],[3280],[3280],[3280]]
```

The negative control discriminates: with the clause present, the second batch is empty and the run
ends. Without it, the same row returns forever. With `limit: 0` — the default, and what a full
rotation uses — the outer loop has no other exit, `failures` grows by one entry per iteration, and the
process consumes memory until it is killed. `--limit` masks it, which is the inverse of F-M2 in
REV-051: there the failure path escaped the bound, here only the bound saves it.

**Why this is Medium and not Low.** The code is correct today; this is regression risk, not a present
defect. It is the same argument REV-051 used for its own F-M3, and it applies more strongly: the
outcome of losing this clause is not a wrong number in a report, it is a rotation command that never
returns, on a table with a live payment path, at exactly the moment some rows are already failing.

**Recommendation.** Teach the double's `query` to honour the SQL the way its `execute` now does —
parse the `WHERE` predicates rather than hardcoding them. That is roughly the same eight lines already
written for `execute` and it closes F-M2, F-L3 and the `!=` variant in §1 together. Failing that, one
integration test that seeds a permanently-failing row and asserts the run terminates with
`attempted === 1` would pin the cursor by itself.

---

## 4. [MEDIUM] F-M3 — every crypto failure now reports `UNKNOWN`, on a false premise, and §5 of the record is stale

**Location:** `server/src/modules/supplier/bankKeyRotation.js:58-61`.

```js
// Crypto 自己嘅錯誤有 publicCode／code，兩個都係固定識別碼。
const named = chain.find((link) => typeof link.publicCode === "string" || typeof link.code === "string");
if (named) return { reason: named.publicCode ?? named.code };
return { reason: "UNKNOWN" };
```

**The comment is false.** I drove all four crypto failure paths and printed the error shape:

```
key id not in ring                  | ctor=Error      | code=undefined | publicCode=undefined | errno=undefined
GCM auth failure (wrong supplierId) | ctor=Error      | code=undefined | publicCode=undefined | errno=undefined
normalisation reject (empty)        | ctor=TypeError  | code=undefined | publicCode=undefined | errno=undefined
missing AAD                         | ctor=TypeError  | code=undefined | publicCode=undefined | errno=undefined
```

`SupplierBankCrypto` has seven throw sites and not one of them sets `code`, `publicCode` or `errno` —
`publicCode` is set only by `supplierErrors.js` and `SupplierLookupService.js`, neither of which is on
this path. The `named` branch is reachable only for `mysql2` and Node system errors. Every crypto
failure falls through to `UNKNOWN`.

**Reproduced on the real CLI, real MySQL, five rows sealed under material the rotator does not hold:**

```
processed=0 lastId=3470
processed=0 lastId=3471
processed=0 lastId=3472
processed=0 lastId=3473
processed=0 lastId=3474
{ "kind": "encryption", "from": "ci-enc-0", "to": "ci-enc-1",
  "processed": 0, "attempted": 5, "failed": 5,
  "failures": [ {"id":3470,"reason":"UNKNOWN"}, {"id":3471,"reason":"UNKNOWN"},
                {"id":3472,"reason":"UNKNOWN"}, {"id":3473,"reason":"UNKNOWN"},
                {"id":3474,"reason":"UNKNOWN"} ],
  "remaining": 5, "safeToRemoveFromKey": false }     exit=1
```

**This is the same scenario as §5 of the record**, which reports:

> ```
> processed 0 | failed 5 | remaining 5 | safeToRemove false   exit=1
> failure reason: Supplier bank account failed authentication:
>                 the row, its context or its ciphertext was altered
> ```

The counts, the flag and the exit code still match. The reason string does not, and cannot: no code
path at this head can produce it. §5 is the record's evidence that this path is fail-closed, and the
safety half of that claim still holds — I re-ran it and it does. What no longer holds is the text.

**Impact.** The per-row `reason` is the only triage signal the tool emits. After this change an
operator cannot distinguish, from the report, between a key that is not in the ring, a GCM
authentication failure (a tampered or mis-labelled row), an account number that no longer normalises,
and a dropped database connection. On a five-row table that is an annoyance. On the Bank table at
production size, during a rotation that has just failed on a few hundred rows, it is the difference
between "these rows are mis-labelled, fix the key id" and starting from nothing.

**This over-corrects relative to what REV-051 asked for.** Its recommendation kept `error.message` for
errors without a `.code` and suppressed only driver messages, precisely because its I-1 had verified
all seven crypto throw sites carry a category and never a value. That verification is still in the
record and still correct. The safe information was thrown away with the unsafe.

**Recommendation.** Either give the crypto errors a stable `publicCode` at their throw sites — which
makes the comment true rather than aspirational, and is the version I would pick — or classify at the
boundary:

```js
// Crypto's own errors carry no value (REV-051 I-1, re-verified REV-052 §4): a category, never
// the account number, the ciphertext or a key. They are safe to name; a driver's message is not.
const CRYPTO_REASONS = new Map([
  ["is not in the configured ring", "KEY_NOT_IN_RING"],
  ["failed authentication", "AUTH_FAILED"],
  ["cannot encrypt", "ACCOUNT_REJECTED"],
  ["cannot decrypt", "ACCOUNT_REJECTED"]
]);
```

Whichever is chosen, add an assertion that a crypto failure reports something other than `UNKNOWN`,
and correct §5 of the record so the transcript matches the code.

---

## 5. Claims I attacked and that held

### 5.1 F-M1 (REV-051) — no blind index reaches the report. **HELD, on real MySQL.**

I built a genuine collision on the real constraint: `uq_supplier_bank_blind_index` is
`(supplier_id, blind_index_key_id, account_blind_index)`, so two rows for one supplier carrying the
same account number under the old and the new lookup key collide the moment the old row is reindexed.
Rotating `zk-l-old → zk-l-new` produced a real `ER_DUP_ENTRY` from `mysql2`:

```json
"failures": [ { "id": 3328, "reason": "DUPLICATE_KEY",
                "constraint": "uq_supplier_bank_blind_index" } ]
```

I then scanned the serialised report for the colliding index in every encoding I could think of:

| Probe | Result |
| --- | --- |
| raw bytes (latin1) | clean |
| hex, first 16 chars | clean |
| upper-case hex, first 16 | clean |
| base64, first 20 | clean |
| MySQL `\xNN` escape form, first 24 | clean |
| the literal `Duplicate entry` | clean |
| the account number | clean |
| the `supplier_id` | clean |

T36 AC3 is satisfied on the channel that violated it. The constraint name is schema, not data, and it
is the right thing to surface.

**I also attacked the classifier with seventeen error shapes.** Every shape reachable from this
`catch` came back clean:

| Shape | Result |
| --- | --- |
| `ER_DUP_ENTRY` with the index in `message` **and** `sqlMessage` **and** `sql` | clean — `DUPLICATE_KEY` + constraint |
| errno 1062 with no `for key '…'` in the message | clean — `constraint: "unknown"` |
| errno 1586 `ER_DUP_ENTRY_WITH_KEY_NAME`, index in `sqlMessage` | clean — falls to the code identifier |
| errno 1406 `ER_DATA_TOO_LONG` with data in `sqlMessage` | clean — code identifier only |
| non-`Error` thrown: a string containing a duplicate message | clean — `UNKNOWN` |
| non-`Error` thrown: a number | clean — `UNKNOWN` |
| thrown `null` | clean — `UNKNOWN` |
| plain `Error`, no `code` | clean — `UNKNOWN` |
| `AggregateError` wrapping a duplicate in `errors[]` | clean — `UNKNOWN` |
| duplicate nested at `cause` depth 2 | clean — classified |
| duplicate nested at `cause` depth 3 (past the window) | clean — `UNKNOWN` |
| an error whose `toJSON` leaks | clean — `code` only |

The design is fail-safe: anything it does not recognise degrades to a fixed token rather than to the
message. `sqlMessage` is read **only** inside the 1062 branch and only to extract the constraint name,
so no other errno can carry it out. That is the right shape, and it is why F-M3 above is a
diagnosability finding rather than a security one — the author chose the safe side of the trade.

Four shapes do leak, and I record them for completeness and then discount all four as unreachable: a
`code` or `publicCode` that is itself a sentence of data, a thrown plain object with such a `code`,
and a constraint name that is data. `mysql2` and Node both use short identifiers; `SupplierBankCrypto`
sets neither property (§4); and the schema's constraint names are fixed. The one that needs a word is
a duplicate *value* containing the literal `for key '` before the real suffix, which would capture the
wrong token — the regex is unanchored and takes the first match. The value is a keyed HMAC; the
probability of it containing that nine-byte sequence is about 2⁻⁷². **PLAUSIBLE** as an argument, not
executed as an attack, and not worth a line of code.

### 5.2 F-M2 (REV-051) — `attempted` bounds the work. **HELD across ten combinations.**

I instrumented every `selectBatch` call — the `LIMIT` issued, the `after` cursor and the row ids
returned — and every row the transaction touched.

| Case | SELECT `LIMIT`s issued | attempted | rows touched | bounded | no skip |
| --- | --- | --- | --- | --- | --- |
| limit 0, batch 3, 10 rows | 3,3,3,3,3 | 10 | 1…10 | ✓ | ✓ |
| limit 2, batch 200, all 10 fail | 2 | 2 | 1,2 | ✓ | ✓ |
| limit 5, batch 2, 10 rows | 2,2,1 | 5 | 1…5 | ✓ | ✓ |
| limit 5, batch 2, all fail | 2,2,1 | 5 | 1…5 | ✓ | ✓ |
| limit 5, batch 3, rows 2 and 4 fail | 3,2 | 5 | 1…5 | ✓ | ✓ |
| limit 1, 10 rows | 1 | 1 | 1 | ✓ | ✓ |
| limit 20 > 3 rows | 20,17 | 3 | 1,2,3 | ✓ | ✓ |
| batch 0 | *(none)* | 0 | — | ✓ | ✓ |
| batch 1, sparse ids 5,11,40,41 | 1,1,1,1,1 | 4 | 5,11,40,41 | ✓ | ✓ |
| limit 3, batch 2, sparse ids, middle fails | 2,1 | 3 | 5,11,40 | ✓ | ✓ |

`Math.min(batchSize, room)` narrows the last SELECT correctly in every bounded case — note the `2,2,1`
and the `20,17`. `limit` below a batch issues exactly one SELECT of that size. The touched ids are an
exact id-ordered prefix in all ten, including with failures in the middle and with sparse ids, so
`lastId` cannot skip a row: it is assigned from the row just attempted, inside the loop, after both
the success and the failure branch. The revert mutant (`room = limit - processed`) dies.

### 5.3 F-M3 (REV-051) — the guard is now observed. **HELD, and for the right reason.**

| Mutant | Unit result | Killed by |
| --- | --- | --- |
| encryption guard `… OR 1 = 1` | 11/12 | the concurrency test, alone |
| lookup guard `… OR 1 = 1` | 11/12 | the concurrency test, alone |
| encryption guard removed (SQL + parameter) | 11/12 | the concurrency test, alone |
| lookup guard removed (SQL + parameter) | 11/12 | the concurrency test, alone |

That last pair is the meaningful improvement. At `a9a081d` those two died from a `TypeError` thrown by
the double's parameter indexing — REV-051 pointed out that real MySQL would have run the unguarded
`UPDATE` happily. Now the double binds `id` correctly, finds the row, and the *assertion* fails. Both
kinds are covered, which closes the gap the author found in his own first attempt.

### 5.4 The two record corrections. **Both HELD.**

- **Ring boundary at exactly three keys.** `MAX_RING_SIZE` `>` → `>=` is **KILLED** by
  `supplierBankKeyRotation.test.js:351`, which asserts a three-key encryption ring warns about
  nothing. That was REV-051's F-L1 and it is closed.
- **The lookup half of `ringWarnings`.** Deleting `["lookup", crypto.lookupKeyIds]` is **KILLED** by
  `:354`. I also deleted the *encryption* half, which REV-051 never tried, and that is killed too. Both
  halves of the loop are now pinned.

### 5.5 The boundary claim. **HELD, exactly.**

Classified every changed path against `00_module_manifest.json` at the current merge-base `da222e2`:

| Path | Classification |
| --- | --- |
| `server/scripts/rotateSupplierBankEncryption.js` | **OUTSIDE_MODULE** |
| `server/scripts/reindexSupplierBankBlindIndexes.js` | **OUTSIDE_MODULE** |
| `server/scripts/supplierBankRotationCli.js` | **OUTSIDE_MODULE** |
| `server/package.json` | `approval_required_paths` → `APPROVAL-HD-035-SCOPE` |
| everything else (35 paths) | `allowed_write_paths` |

Exactly three `OUTSIDE_MODULE`, all in `server/scripts/`; `server/package.json` runs the approval gate
rather than the boundary gate. The claim is unchanged by the merge of `main` and is exactly right.
`server/package.json` gains two npm script entries and nothing else. No workflow file is touched.

### 5.6 Harness state

Revision 227. `baseline.code_commit` and `source_fingerprint` advanced to the merge commit `18c16da`,
`default_commit` to `da222e2` — REV-051's F-L6 is discharged. The new `MANUAL_TEST` observation
describes the remediation accurately, including the two failed attempts at F-M3, which is the kind of
thing that is easier to leave out than to write down. `DEF-022` is recorded CLOSED with its own MERGE
observation. See I-2 for the one structural note.

---

## 6. Low findings

**F-L1 — both `safeReason` fallbacks are unpinned.** Two mutants, each run against the full 356 with
real MySQL, both **SURVIVE**:

- terminal `return { reason: "UNKNOWN" }` → `return { reason: error?.message ?? "UNKNOWN" }`
- `constraint: constraint?.[1] ?? "unknown"` → `constraint: constraint?.[1] ?? String(duplicate.sqlMessage ?? "unknown")`

The duplicate test at `:236` pins the *happy* path of the classifier — a well-formed `ER_DUP_ENTRY`
whose message matches the regex. Neither fallback is asserted, and both are the doors F-M1 came in
through. The first is the more serious: it restores the exact defect REV-051 blocked on, and the whole
suite stays green. Two assertions close both — a crypto failure must not report a message, and a 1062
whose message does not match must report `unknown` rather than the driver's text.

**F-L2 — `Math.min(batchSize, room)` was KILLED at `a9a081d` and now SURVIVES, and the record does
not say so.** REV-051's table records "batch size ignores remaining room → KILLED (3 tests)". At this
head, replacing it with plain `batchSize` passes 12/12 and 356/356. The cause is the F-M2 fix itself:
the inner `if (limit > 0 && attempted >= limit) break;` now caps the *work* independently, so removing
the `min` changes only how many rows the SELECT fetches, and no test observes that. A `--limit=1`
probe would fetch 200 rows of ciphertext to decrypt one. The behaviour is correct as shipped; what
changed is that nothing holds it there any more, and §7 of the record reports eleven killed without
mentioning that a twelfth stopped dying.

(For completeness: dropping the inner break is an **equivalent mutant**, since `Math.min` already caps
the batch at `room` and `attempted` reaches `limit` exactly on the batch's last row. I record it as
equivalent rather than as a coverage gap.)

**F-L3 — `ORDER BY id` is still unpinned.** REV-051's F-L4 carried forward, and worth re-reading
carefully: my first run of this mutant appeared to kill three integration tests, and it was
contamination from the hung run in F-M2 (see I-3). On a clean database it **survives 12/12 and 4/4**.
The cause is the same as F-M2: the double sorts by id unconditionally, whatever the SQL says. It is
load-bearing — `lastId` takes the last row of the batch, which is a cursor only if the batch is
ordered — and unordered batches still terminate, so the impact stays low. I am recording the correction
because a passing mutant run on a dirty database is exactly the shape of evidence that has misled this
task before.

**F-L4 — the double's `WHERE` parser is faithful to exactly one query shape.** It splits on `\s+AND\s+`
and then on `=`, keeps a predicate only when the right-hand side is exactly `?`, and advances the
parameter cursor only then. I lifted it verbatim and ran realistic shapes through it:

| `WHERE` clause | what the double does |
| --- | --- |
| `id = ? AND encryption_key_id = ?` *(shipped)* | correct |
| `id = ? AND encryption_key_id = ? AND status = 'active'` | **silently drops** the literal predicate |
| `id = ? AND encryption_key_id <=> ?` | **silently drops the guard**, leaves a parameter unconsumed |
| `id = ? AND encryption_key_id IN (?)` | **silently drops the guard** |
| `updated_at < ? AND id = ? AND encryption_key_id = ?` | **binds the wrong parameters** — `id → 999`, `encryption_key_id → 2` — and writes nothing |
| `id <> ? AND encryption_key_id <> ?` | `wanted` is `{}`, and `Object.entries({}).every(…)` is `true`, so **`table.find` returns `table[0]`** and the write lands on an arbitrary row |

The last row is the sharp edge: an unparseable `WHERE` does not fail, it writes to the first row in
the table. Real MySQL would reject invalid SQL and would apply every predicate it parsed. The parser
fails open when a predicate is unrecognised and fails closed when a column name is mangled, and
neither matches the real layer. Nothing is wrong today — the shipped SQL is the one shape it handles,
and the vacuous-guard mutants die — but the parenthesised `OR 1 = 1` variants in §1 die for the
opposite reason to the one intended, which shows the mechanism is already active. Anyone adding a
predicate to either statement should expect this double to agree with them by coincidence.

(`else if (column === "1" && value === "1") continue;` at `:90` is dead: it is reachable only for a
literal `AND 1 = 1`, which is a no-op predicate rather than a vacuous guard.)

**F-L5 — `--batch-size=0` is accepted, does nothing, and exits 0.** Verified on the real CLI:

```
$ … --from=ci-enc-0 --to=ci-enc-1 --batch-size=0 --json
{… "processed":0,"attempted":0,"failed":0,"failures":[],"remaining":5,"safeToRemoveFromKey":false}
exit=0
```

`parseArguments` requires a non-negative integer, so `0` passes; `selectBatch` issues `LIMIT 0`, no
rows come back, the loop breaks immediately, `failed` is 0 and the CLI returns 0. Five rows still on
the old key and the command reports success. `safeToRemoveFromKey` is correctly `false`, so a runbook
that reads the flag is safe; a runbook that reads the exit code is not. The same applies to
`--batch-size=` (empty value → `Number("") === 0`). Note the asymmetry with `--limit`, where `0` means
*unlimited* — the two flags share a validator and give `0` opposite meanings. Reject `0` for
`--batch-size`, or document it.

**F-L6 — the failure path's output is unbounded in two ways.** The CLI's progress callback is
`if (processed % 100 === 0)`, and `processed` stays at 0 while rows are failing, so `0 % 100 === 0` is
true on every row. The real run above printed five `processed=0 lastId=…` lines for five rows; a
rotation failing across a large table prints one line per row. That is on top of the `failures` array,
which is still uncapped and still `JSON.stringify`d into a single string — REV-051's secondary
recommendation under its F-M2, not taken. The `attempted` fix bounds the *work* but only when `--limit`
is given, and the full rotation that an operator eventually runs has no limit by construction. Guard
the progress line on `attempted` rather than `processed`, and keep the first N failures with a count.

**F-L7 — `processed` still over-reports, and is now exercised by a test that does not assert it.**
REV-051's F-L3: `affectedRows` is never read, so an `UPDATE` the guard turned into a no-op still
increments `processed`. The concurrency tests added this round drive exactly that path — the guard
refuses the write, and `processed` counts it anyway — and assert the witness column and `remaining`
but not `processed`. One extra assertion in a test that already exists would close it. Note also that
the double returns `[{ affectedRows: 0 }]` on a miss and `undefined` on a write, so anyone fixing this
by reading `result.affectedRows` will get a `TypeError` from the double on the success path.

---

## 7. Info

**I-1 — two `parseArguments` edge cases, neither a finding.** `--from=a=b` yields `from: "a"`: the
parser destructures only the first two elements of `split("=")`, so a value containing `=` is silently
truncated. Base64 ends in `=`, so an operator who pastes key *material* where a key *id* belongs gets
silent truncation rather than an error — though that operator has a larger problem, and the key id
would not match anything. Separately, `--json=false` sets `json: true`, since the flag is presence-only.
Both are cosmetic; I record them because the CLI is the untrusted-input boundary and nobody has
enumerated it. Rejected correctly: `--limit=-1`, `--limit=abc`, `--limit=2.5`,
`--transition-started=nonsense`, and any positional argument.

**I-2 — the remediation observation is bound to the pre-remediation commit.** The new `MANUAL_TEST`
entry names `code_commit: 18c16da` and the matching `source_fingerprint`, but `18c16da` is the merge
of `main` — the remediation is `28d974d`, the commit that carries the observation itself. This is the
structural knot the harness cannot untie: writing the record changes the tree it describes. Nothing is
wrong and no gate is bypassed; a later reader reconciling the fingerprint against the described change
should know it points one commit behind.

**I-3 — the new integration tests are not isolated from each other across runs, and I proved it by
accident.** `cryptoPair()` uses the fixed literal key ids `enc-old` / `enc-new` / `look-old` /
`look-new` with fresh random material per test, and the assertions are table-wide: `remainingRows` is
an unfiltered `COUNT(*)`, and the rotation's `UPDATE` matches on key id alone with no supplier
predicate. So any row left in `supplier_bank_accounts` carrying one of those four literals poisons
every later run — it will be selected, it will fail to decrypt under the new run's material, and
`processed`/`remaining`/`safeToRemoveFromKey` will all be wrong. My hung F-M2 mutant run skipped its
`t.after` cleanup and left two rows and one supplier behind; the next mutant run then showed three
integration failures that looked like a kill and were not. I found the rows, removed them, re-verified
the count at zero, and re-ran — the mutant survives. Under `node --test` the four tests in the file run
sequentially and CI starts from a fresh database, so this does not affect CI today; it will bite the
next person who interrupts a run locally. Scoping the rotation assertions to the test's own
`supplier_id`, or suffixing the key ids per test, would remove the trap.

**I-4 — `remainingRows` is still a full table scan**, once per run. REV-051's I-5; unchanged and still
the right trade, since it is what makes the key-removal decision cursor-independent.

**I-5 — `TC-016` also failed in my local item-suite reproduction** ("adapter verifies a separately
restored schema through a read-only transaction"). It is in the items module, outside this PR's
subject, and it did not fail in CI at this head. Recording it only so the items module's owners know
the local item integration suite currently shows two reds, not one.

---

## 8. The CI failure — established independently

`Test (server + client, MySQL integration)` is FAILURE at `28d974d` (run `35826677221`). The other
four checks pass. The author's position is that this is an items-module flake inherited from `main`,
where `TC-001` compares raw `SHOW CREATE TABLE` output that embeds `AUTO_INCREMENT`. **I verified that
independently and it is correct. This branch is not implicated.** Four lines of evidence, in
increasing order of weight.

**1. The failure in CI is the AUTO_INCREMENT comparison.** The only failing test in the job is
`TC-001 Item migrations 0010-0026 are idempotent without weakening the global permission catalogue`,
and the diff is confined to two tokens:

```
+  ') ENGINE=InnoDB AUTO_INCREMENT=108 DEFAULT CHARSET=utf8mb4 …',   item_brands
-  ') ENGINE=InnoDB AUTO_INCREMENT=107 DEFAULT CHARSET=utf8mb4 …',
+  ') ENGINE=InnoDB AUTO_INCREMENT=116 DEFAULT CHARSET=utf8mb4 …',   item_categories
-  ') ENGINE=InnoDB AUTO_INCREMENT=115 DEFAULT CHARSET=utf8mb4 …',
```

Every column, key and constraint is identical. Only the counters moved, by one, on the two tables.

**2. The mechanism, demonstrated directly.** `schemaSnapshot` at
`server/test/integration/itemMigrationIdempotency.integration.test.js:67-74` stores `row["Create
Table"]` verbatim, and the test deep-equals a snapshot taken before the migrations against one taken
after. A single insert moves the token, and deleting the row does not move it back:

```
item_brands before:                AUTO_INCREMENT=14566
after INSERT id=14566:             AUTO_INCREMENT=14567
after DELETE (row gone again):     AUTO_INCREMENT=14567
```

Fifteen other test files insert into `item_brands` or `item_categories`, and `node --test` runs files
in parallel. Any one of them landing a row inside that window breaks the comparison.

**3. Reproduced locally with no supplier test in the run at all.** I ran only
`test/integration/item*.integration.test.js` against real MySQL:

```
✖ TC-001 Item migrations 0010-0026 are idempotent … (965.245167ms)
  +  ') ENGINE=InnoDB AUTO_INCREMENT=5419 …'
  -  ') ENGINE=InnoDB AUTO_INCREMENT=5418 …'
ℹ tests 185   ℹ pass 183   ℹ fail 2
```

The identical failure, one off, with nothing from this branch loaded. This is the discriminating
result: the flake needs no supplier code to occur.

**4. It is on `main`, repeatedly, including before this branch existed.** Every `main` CI failure in
the last two days is the same test with the same signature:

| `main` head | run | failing test | signature |
| --- | --- | --- | --- |
| `da222e2` (#134, this branch's merge-base) | 35825657798 | TC-001 | AUTO_INCREMENT 112/113, 119/120 |
| `3e53f7d` (#132) | 35810756949 | TC-001 | AUTO_INCREMENT 106, 113/114, 121 |
| `38e1542` (#128) | 35704583702 | TC-001 | AUTO_INCREMENT 103/104, 110/111 |
| `bd8cc21` (#126) | 35682966932 | TC-001 | AUTO_INCREMENT 107/108, 114/115 |
| `333fc41` (#123) | 35678221569 | TC-001 | AUTO_INCREMENT 103, 109/110, 111 |

`bd8cc21` and `333fc41` are from 2026-09-22; this branch was cut from `1a47b65` on 2026-09-23. And
`main` at `487bec1` passed after all of them, which is what an intermittent race looks like.

**Could this branch have made it more likely?** Adding a test file changes the parallel schedule, and
I cannot falsify a timing influence from outside. But the branch touches no items table, no migration,
no fixture and no workflow file; `server/package.json` gains two npm script entries; and this branch's
own previous head `a9a081d` — which already contained the new integration file, all four tests of it —
ran fully green (run `35824734344`, five checks pass). A schedule perturbation that were doing the
damage would not have produced that. **The branch is not implicated.**

**What I would do about it.** Not on this PR. `TC-001` should strip `AUTO_INCREMENT=\d+` before
comparing, or read the schema from `information_schema` rather than `SHOW CREATE TABLE`. That is a
one-line change in the items module, it needs its own task, and it is what stands between this
repository and a green required check. Re-running the job on this PR will go green some fraction of
the time, which is not the same as the check meaning anything. Per CLAUDE.md §6 a merge needs CI
green; that rule is currently unsatisfiable for any PR in this repository, and the honest resolution
is to fix `TC-001` first rather than to re-roll until the dice cooperate.

---

## 9. What I did not check

- **CI at a merged head, or a re-run.** I read the logs of run `35826677221` and of five `main` runs;
  I did not push, re-run, or merge anything.
- **Production-scale behaviour.** REV-051's F-L5 (the lookup batch query's plan being quadratic) is
  unchanged and I did not re-measure it; no table in `erp_dev` is large enough to time it.
- **The concurrency scenario REV-051 already ran.** Two rotations over 60 real rows, the interleaved
  write against real MySQL, the duplicate check across a half-rotated ring, and resumability on the
  real CLI. I took those as established and did not repeat them.
- **The `--transition-started` flag end to end.** `ringWarnings` is unit-tested at both boundaries in
  time and both rings in size; I did not drive the flag through the CLI to a `TRANSITION_TOO_LONG` on
  stderr. REV-051 did not either.
- **Crash between `commit()` and `release()`.** Not executed. The `safeToRemoveFromKey` second clause
  covers it conservatively either way, and REV-051's F-L7 on the `failAfterWrite` double stands
  unchanged — the double still models a failure the real wrapper cannot produce, by a mechanism the
  real layer does not have. I did not re-litigate it; the conclusion it supports is still true.
- **Whether adding the new integration file perturbs CI scheduling enough to matter.** Argued in §8,
  not executed; the green run at `a9a081d` with the same file present is what I rest on.
- **Any client-side surface.** This task has none.

## 10. Residual risk I would accept, if the three Mediums were closed

The rotation logic is sound and I could not break it. Every property that protects money — the row is
re-encrypted under the active key with its AAD binding intact, the blind index and its key id move in
one statement, a row whose key changed underneath is not overwritten, a key is never declared
removable while a row still holds it — held under every attack I could construct, at both layers,
with negative controls that discriminate. F-M1 (REV-051) is properly fixed and the classifier is
fail-safe by construction, which is the right shape for this.

What remains after that is regression risk and operator risk, not present-defect risk. F-L1 through
F-L4 are four controls that work today and that no test would notice breaking; F-L5 through F-L7 are
edges on the failure path where the tool is less careful than it is on the happy path. The three
Mediums are: one operator-facing fail-open that one line and one assertion close (F-M1); one unpinned
control whose loss is a non-terminating rotation (F-M2); and one diagnosability regression with a
false comment behind it and a stale record in front of it (F-M3). Together they are perhaps sixty
lines of code and test.

I would accept, after those: the quadratic lookup plan at production scale, the crash-between-commit-
and-release window, and the `failAfterWrite` double's unfaithfulness — all three conservative in the
direction that refuses to authorise removing a key.

---

## 11. Verdict

**CHANGES_REQUESTED.** 0 Critical, 0 High, 3 Medium, 7 Low, 5 Info.

**Blocking: F-M1.** `--from` is validated against nothing, and a key id that has never existed returns
`safeToRemoveFromKey: true` with exit 0, in the same shape a completed rotation returns. The gate on
the irreversible step should not answer "yes" to a question nobody asked. The check is one line and it
uses a getter this PR already added with that purpose written in its doc comment.

**Also fix before merge: F-M2.** The `id > ?` cursor is pinned by no test at either layer, and I have
a real-MySQL reproduction showing the same row returned in five consecutive batches with no forward
progress when it is removed. Teaching the double's `query` to honour the SQL — the same repair already
made to `execute` — closes this, F-L3, and the `!=` variant of the from-key filter together.

**F-M3 should land in the same round.** Every crypto failure now reports `UNKNOWN`, the comment
justifying that branch is factually false, and §5 of the record shows a transcript the code can no
longer produce. The information suppressed was verified safe by REV-051's own I-1.

**The seven Lows are follow-ups**, except F-L1, which I would take now: it is two assertions, and
without them the exact defect REV-051 blocked on can be reintroduced with the whole suite green.

**On the record's accuracy.** The eleven-mutant table is correct — all eleven reproduce, which has not
happened before on this task. The boundary claim is exactly right. The two self-reported corrections
are real and both are now pinned. The F-M3 narrative, including the two failed attempts and why the
live-reference double could not discriminate, matches what I found in the code. Three things are
wrong: §5's transcript no longer matches the code (F-M3), §7 does not mention that a mutant REV-051
recorded as KILLED now survives (F-L2), and the comment at `bankKeyRotation.js:58` asserts something
about crypto's errors that is false in all four cases I tested.

**On whether this is ready to merge: not yet, and not only because of the findings.** The required
`Test (server + client, MySQL integration)` check is red, and while I established that this branch did
not cause it — it reproduces locally from the items module alone, and it has failed on five `main`
heads including two that predate this branch — a red required check is still a red required check.
`TC-001` needs its own fix before any PR in this repository can merge under CLAUDE.md §6 without
someone deciding to look away.
