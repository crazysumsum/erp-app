# REV-033 — TASK-032 independent review (Bank persistence 與 crypto primitives)

**Review:** REV-033 · **Task:** TASK-032 · **Phase:** PHASE-003 · **Capability:** SUP-CAP-03
**Head reviewed:** `699ab066673570a6981da2ec298d958d3eb25212`
**Branch:** `claude/supplier-task-032` (cut from main `087b268`; main is now `5d390d2`)
**PR:** https://github.com/crazysumsum/erp-app/pull/116
**Reviewer role:** independent — not the author. Every claim below that is marked CONFIRMED was
produced by a command run against this worktree at this head.

**Verdict: CHANGES_REQUESTED.** Three blocking findings (H-1, H-2, H-3).

---

## 0. What I ran

| # | Command / probe | Result |
| --- | --- | --- |
| R1 | Targeted suite (`supplierBankCrypto` + `supplierConfig` + `supplierCoreMigrations.integration`) | 25/25 PASS |
| R2 | Full `supplier-phase-001-server` argv from `00_project_profile.json` | **332/332 PASS** — matches §4 |
| R3 | `npm run lint` | PASS, no output |
| R4 | Leak battery: 26 extraction attempts against a live `SupplierBankCrypto` | no key material, no plaintext |
| R5 | AAD injectivity probe (lone surrogates) | **collision found, cross-identity decrypt succeeded** |
| R6 | Normalization probe: 16 separator characters + 6 false-duplicate pairs | **10 of 16 bypass duplicate detection** |
| R7 | Schema-assertion gap probe against real MySQL 26.7.0 / `erp_dev`, 8 divergent tables | **8 of 8 accepted** |
| R8 | Decrypt error-oracle probe, 10 malformed-row classes | **3 raw `TypeError`s escape** |
| R9 | My own mutations M1, M6, M7 against the full 332-test suite | **all three survive** |
| R10 | Replication of the author's B3 mutation | RED — the author's rewrite does discriminate |
| R11 | `git merge-tree main HEAD`, merged-ledger inspection | clean merge, one `APPROVAL-HD-027-SCHEMA`, no duplicates |
| R12 | `gh pr checks 116` | all four checks pass at `699ab06` |

Worktree hygiene: every mutation was applied alone, reverted immediately, and
`git status --porcelain` asserted empty before the next step. It was empty immediately before this
file was written. All scratch scripts live outside the repo. No DDL mutation was applied to the real
`supplier_bank_accounts` table — the gap probe (R7) worked entirely on throwaway `bank_gap_*` tables
built from `SHOW CREATE TABLE`, so `up()`'s early return was never in play and nothing needed
reapplying.

---

## 1. Blocking findings (H)

### H-1 — `normalizeBankAccountNumber` strips only whitespace and the ASCII hyphen, so duplicate detection is bypassable with a dot — or with an invisible character

**Location:** `server/src/modules/supplier/SupplierBankCrypto.js:26-30`

```js
const SEPARATORS = /[\s  -​⁠﻿-]+/gu;
```

**What is wrong.** The class covers whitespace, a few Unicode spaces, and U+002D. It does not cover
the other characters people actually type into a bank account field. CONFIRMED (R6), baseline
account `12345678`:

| Character between `1234` and `5678` | Same blind index as `12345678`? |
| --- | --- |
| ASCII `-`, TAB, U+3000, U+202F, U+FF0D | yes |
| `.` `/` `_` `,` U+00B7 U+2027 | **no — bypass** |
| U+2010 HYPHEN, U+2011 NB-HYPHEN, U+2212 MINUS | **no — bypass** |
| **U+00AD SOFT HYPHEN, U+200E LRM** | **no — bypass, and the character is invisible** |

**Why it matters.** Design §5.8 makes the blind index the duplicate control, and the module's own
comment at line 23-25 states the goal: `"1234 5678"` and `"12345678"` must not produce two indexes.
That goal is met for a space and missed for a dot. The soft-hyphen and LRM rows are the sharp end:
two rows whose account numbers render **byte-for-byte identically on screen and in the mask** get
different `account_blind_index` values, so `UNIQUE(supplier_id, blind_index_key_id,
account_blind_index)` does not fire and `candidateBlindIndexes` does not match. An operator looking
at the list sees the same masked account twice with no explanation.

This is blocking specifically because it cannot be walked back cheaply. The normalized string is
what gets encrypted, what `last_four` and `account_length` are derived from, and what the HMAC is
taken over. Widening `SEPARATORS` after rows exist changes every stored blind index and every stored
ciphertext, so the fix becomes a full decrypt/re-encrypt/reindex of the table — the exact migration
the two rotation scripts in design §2.6 are scoped for, run for a reason that is not rotation. Fixed
now, it costs one regex.

**Proof of concept.**

```js
const a = crypto.blindIndex("1234-5678").index;          // ASCII hyphen
const b = crypto.blindIndex("1234­5678").index;     // soft hyphen, renders identically
SupplierBankCrypto.sameIndex(a, b);                      // => false
```

**Recommendation.** Decide the accepted alphabet explicitly rather than enumerating separators to
remove. Because §5.8 gives no character contract, this needs a Product Owner answer, but the
defensible default for a bank account number is: normalize NFKC, uppercase, strip everything that is
not `[0-9A-Z]`, then reject if what remains is empty or exceeds the length bound (see M-6). That is
one rule instead of a blocklist that will be incomplete again the next time someone finds a new dash.
Whatever is chosen, add a test that asserts a *negative* set — that a list of formatting characters
all collapse — rather than only the two that already work.

---

### H-2 — `inspectSupplierBankAccountSchema` accepts eight classes of incompatible table, including one where `UNIQUE(supplier_id, default_slot)` enforces nothing

**Location:** `server/database/migrations/0037_create_supplier_bank_accounts.js:37-119`, consumed by
`up()` at line 122 (`if (await inspectSupplierBankAccountSchema(connection)) return;`)

**What is wrong.** AC4 says an existing table must pass a *complete* compatibility assertion, and
design §5.14 spells out what complete means: `欄位、型別、NULL/default、FK、unique/index及trigger`.
The implementation checks the column *set*, the type of four binary columns, the presence of the
string `GENERATED` in `default_slot`'s `EXTRA`, the *names* of six indexes, uniqueness and covered
columns for two of them, and the *names* of four foreign keys. Nullability, defaults, collation,
triggers, the generated *expression*, and every FK's referenced table and delete rule are never read.

CONFIRMED (R7). I built eight divergent tables from the live `SHOW CREATE TABLE`, minus the FK
clauses (MySQL constraint names are schema-global, so a copy cannot carry them — this is the same
control the author's own test uses). A table that reaches the FK-name check has passed everything
before it, i.e. the divergence was not detected:

| Probe | Assertion's response |
| --- | --- |
| control: verbatim copy | reaches FK check (expected) |
| **G1 `default_slot` GENERATED ALWAYS AS (NULL) STORED** | **accepted** |
| **G2 `default_slot` GENERATED ALWAYS AS (1) STORED** | **accepted** |
| **G3 `uq_supplier_bank_crypto_context` downgraded to a plain `KEY`** | **accepted** |
| **G4 `account_iv` / `account_auth_tag` / `account_blind_index` made NULLable** | **accepted** |
| **G5 `last_four` widened to `varchar(190)`** | **accepted** |
| **G6 `status` collation → `utf8mb4_general_ci`** | **accepted** |
| **G7 `account_length` `smallint` → `tinyint unsigned`** | **accepted** |
| **G8 `crypto_context` `char(36)` → `varchar(255)`** | **accepted** |

**Why it matters.** Three of these destroy a guarantee the migration's own comment block (lines
123-142) says the database is there to enforce:

- **G1** is the worst. `default_slot` is still a generated stored column, so the `EXTRA`-contains-
  `GENERATED` check at line 72 passes, but the expression always yields NULL, and MySQL's UNIQUE does
  not compare NULLs. `UNIQUE(supplier_id, default_slot)` becomes decorative and a supplier can hold
  unlimited simultaneous default bank accounts. The comment at line 69-70 correctly identifies that a
  plain `TINYINT` named `default_slot` would be a problem and guards against exactly that — and then
  misses the neutered-expression case, which is indistinguishable from the real thing at the
  `EXTRA` level.
- **G3** removes uniqueness from `crypto_context`. `crypto_context` is half the AAD. Its uniqueness
  is the only reason two rows under one supplier cannot have their ciphertexts swapped — which is
  precisely the property the AAD binding exists to provide and which
  `supplierBankCrypto.test.js:74-84` tests at the crypto layer. The assertion verifies uniqueness and
  covered columns for `uq_supplier_bank_default` and `uq_supplier_bank_blind_index` (lines 89-106)
  and verifies only the *name* of `uq_supplier_bank_crypto_context` (lines 83-85). The one index
  whose uniqueness underwrites the cryptography is the one that is only name-checked.
- **G4** allows rows with a NULL IV or NULL auth tag, which then reach `decryptAccountNumber` and
  produce an uncaught `TypeError` rather than an authentication failure (see M-3).

G5 lets `last_four` hold a whole account, which is the DB-level half of the no-plaintext-column
guarantee. G6 loosens `status = 'active'` inside the generated expression to case-insensitive,
directly contradicting the migration's own claim at line 131-132 that ascii_bin is load-bearing.

`up()` returns early on any of these, so a deployment against such a table proceeds silently — the
opposite of §5.14's `任何不相容即fail closed並停止部署`.

**How it arises without an attacker.** The report's own §0 flags that `codex/customer-management-
phase-001` defines colliding migration numbers and that one branch must renumber. A half-applied or
renumbered migration sequence landing a differently-shaped `supplier_bank_accounts` is the realistic
path here, not a DBA with malicious intent.

**Recommendation.** Read the contract from `information_schema` instead of sampling it:

```js
// GENERATION_EXPRESSION, not just EXTRA
const expr = String(value(slot, "generation_expression", "GENERATION_EXPRESSION") ?? "")
  .replace(/_ascii|_utf8mb4|`/gu, "").replace(/\s+/gu, "");
if (expr !== "if(((is_default=1)and(status='active')),1,NULL)") {
  throw new Error("Incompatible existing Supplier bank account column: default_slot expression");
}
```

and, in the same pass: add `is_nullable` and `column_default` to the existing column query and assert
them for every column; add `uq_supplier_bank_crypto_context` to the unique-index loop at line 89;
assert `collation_name` for `status` and `crypto_context`; select `referenced_table_name` and
`delete_rule` alongside `constraint_name` in the FK query at line 108 and assert `suppliers`/`CASCADE`,
`currencies`/`RESTRICT`, `users`/`SET NULL`; and assert `information_schema.triggers` is empty for the
table. Then extend the probe test to cover at least G1, G3 and G4 — the existing five probes are well
built (see N-4) and these slot straight in.

---

### H-3 — Mutation M1 survives: `encryptAccountNumber` can write a complete short account into `last_four` and all 332 tests stay green

**Location:** `server/src/modules/supplier/SupplierBankCrypto.js:127`, tested (only) at
`server/test/supplierBankCrypto.test.js:245-254`

**The mutation.**

```diff
-      lastFour: normalized.length > 4 ? normalized.slice(-4) : "",
+      lastFour: normalized.slice(-4),
```

**The green run.** CONFIRMED (R9), full `supplier-phase-001-server` argv:

```
ℹ tests 332
ℹ pass 332
ℹ fail 0
```

**What the mutant does.** CONFIRMED by direct invocation under the mutation:

```
account "1234" -> DB last_four="1234"  account_length=4  mask="****"
account "123"  -> DB last_four="123"   account_length=3  mask="***"
```

**Why it matters.** The shipped code is correct — this is a hole in the acceptance evidence, not a
live defect, and I want to be precise about that. But it is a hole in the evidence for the one
property of TASK-032 that cannot be walked back. AC3 and AC4 both turn on there being no plaintext
account anywhere in the table. Under the mutant, `last_four VARCHAR(4)` holds the entire account
number for any account of four characters or fewer, unencrypted, in a column that every projection,
`SELECT *`, mysqldump and slow-query log touches. `maskBankAccount` still renders `****`, so the
defensive layer holds and nothing visible changes — which is exactly why no test notices.

The cause is structural: **no test in the suite ever calls `encryptAccountNumber` with a short
account, or with a formatted one.** Every call site uses `ACCOUNT = "1234567890123"` (13 characters,
no separators) or an input that throws. The AC3 test at lines 245-254 exercises `maskBankAccount`
— the renderer — five times and `encryptAccountNumber` zero times. The report's §2 AC3 claim, «連
「有人錯手將短帳號全值放咗入 `lastFour`」都測咗», is true of the renderer and untrue of the writer,
and the writer is what decides what lands in the column.

**A second survivor in the same blind spot.** CONFIRMED (R9), also 332/332 green:

```diff
-      accountLength: normalized.length
+      accountLength: String(accountNumber).length
```

Under this one, `"1234 5678"` stores `account_length = 9` for an 8-character account, and
`maskBankAccount` renders a nine-character mask for an eight-character account. It survives for the
same reason: no test encrypts a value that normalization actually changes.

**Recommendation.** Add to `supplierBankCrypto.test.js` a test that drives the writer, not the
renderer, over the boundary:

```js
test("a short account never lands in last_four, and the stored length is the normalized one", () => {
  const c = cryptoWith();
  for (const [input, length, four] of [["1234", 4, ""], ["123", 3, ""], ["12345", 5, "2345"],
                                       ["1234 5678", 8, "5678"]]) {
    const sealed = c.encryptAccountNumber({ supplierId: 7, cryptoContext: c.newCryptoContext(),
                                            accountNumber: input });
    assert.equal(sealed.accountLength, length, input);
    assert.equal(sealed.lastFour, four, input);
    assert.ok(!input.replace(/\s/gu, "").includes(sealed.lastFour) || sealed.accountLength > 4,
      "a short account must not survive into an unencrypted column");
  }
});
```

Re-run M1 and M6 against it before calling it done.

---

## 2. Non-blocking findings (M)

### M-1 — The AAD format is not injective; the length prefix counts UTF-16 units and lone surrogates collide

**Location:** `server/src/modules/supplier/SupplierBankCrypto.js:59-66`

`additionalData` builds `sup:${supplier.length}:${supplier}|ctx:${context.length}:${context}` and
encodes it UTF-8. `String.prototype.length` counts UTF-16 code units, but `Buffer.from(s, "utf8")`
maps every lone surrogate to the same three bytes (EF BF BD). Two different identities therefore
produce the same AAD. CONFIRMED (R5) end to end — not just the buffers, the actual decrypt:

```js
const sealed = c.encryptAccountNumber({ supplierId: "\uD800", cryptoContext: "ctx-A", accountNumber: ACCOUNT });
c.decryptAccountNumber({ supplierId: "\uDC00", cryptoContext: "ctx-A", ...sealed });
// => "1234567890123"   *** cross-identity decrypt succeeded ***
```

**Why it matters, and how much.** Not reachable today, and I agree with the author's reasoning about
why: `supplierId` is a BIGINT from the database and `crypto_context` is a server `randomUUID()`.
Neither can carry a lone surrogate. So this is M, not H.

What it does falsify is a specific claim. The report §3 B3 and the test comment at
`supplierBankCrypto.test.js:92-94` say the rewritten case proves «個格式本身冇歧義» — that the format
itself is unambiguous. It does not. It proves the narrower and still-worthwhile thing: that a value
containing the literal `|ctx:` delimiter cannot shift the boundary. Injectivity is a stronger claim
and it is false. The brief asked whether the rewrite is merely a second way of being wrong; it is not
— B3 is a genuine fix and I verified it discriminates (R10: with the length prefixes removed, that
one test and only that test goes red). But the claim written around it overreaches.

**Recommendation.** Either prefix with byte length and build the AAD from Buffers
(`Buffer.byteLength(supplier, "utf8")`), which makes the encoding injective outright, or narrow the
claim in the test comment and in §3 to what the case actually establishes. If the code is left as is,
the guard at line 61-63 is the natural place to reject non-BMP-safe input.

### M-2 — The blind index fails open on a bad key while encryption fails closed; `normalizeSupplierConfig`'s 32-byte check is assumed, not enforced

**Location:** `server/src/modules/supplier/SupplierBankCrypto.js:68-72` (`keyBuffer`), `188-193`
(`#index`)

The comment at line 69-70 says the length check is not repeated because `normalizeSupplierConfig`
already did it. That is true of the configuration path and not true of the constructor, which accepts
any `{ activeKeyId, keyRing }` shape without revalidating. The two rings then behave differently.
CONFIRMED (R6), hand-built rings bypassing the config path:

```
0-byte key ENCRYPT     : refused (Invalid key length)
0-byte key BLIND INDEX : *** ACCEPTED *** 296c0fe9e29b8b50cca5...
4-byte key ENCRYPT     : refused (Invalid key length)
4-byte key BLIND INDEX : *** ACCEPTED *** 33ea76965d42bb1e9eda...
```

`createCipheriv` enforces 32 bytes for AES-256; `createHmac` accepts a key of any length including
zero. So a misconfigured or wrongly-wired lookup ring produces a silently weak — at zero bytes,
effectively unkeyed — blind index, with no error, and the resulting indexes go straight into the
duplicate-detection UNIQUE. To answer the brief's question directly: `normalizeSupplierConfig`'s
validation is load-bearing for the encryption ring only by accident of what OpenSSL rejects, and is
purely assumed for the lookup ring.

**Recommendation.** Validate in `keyBuffer`, which both paths already share:

```js
function keyBuffer(secret) {
  const key = Buffer.from(secret.reveal(), "base64");
  if (key.length !== 32) throw new TypeError("Supplier bank crypto requires a 32-byte key");
  return key;
}
```

Four lines, and it makes the stated invariant true at the boundary that relies on it instead of two
modules away.

### M-3 — Malformed rows escape `decryptAccountNumber` as raw `TypeError`s, so the uniform-error property does not hold

**Location:** `server/src/modules/supplier/SupplierBankCrypto.js:143-145` — `createDecipheriv`,
`setAAD` and `setAuthTag` sit **outside** the `try` at line 146.

§2 AC3 states the decrypt error deliberately carries no input because «一個講得出「邊一段唔啱」嘅訊息
就係一個 oracle». The `try` only wraps `update`/`final`, so three failure classes bypass the uniform
message. CONFIRMED (R8):

| Row state | What the caller gets |
| --- | --- |
| tag bit flipped (real auth failure) | module message |
| IV truncated to 11 bytes | module message |
| ciphertext NULL or empty | module message |
| **auth tag truncated to 8 bytes** | `TypeError` `ERR_CRYPTO_INVALID_AUTH_TAG: Invalid authentication tag length: 8` |
| **IV NULL** | `TypeError` `ERR_INVALID_ARG_TYPE` |
| **auth tag NULL** | `TypeError` `ERR_INVALID_ARG_TYPE` |

No plaintext and no key material appear in any of them, which is the important part. But the failure
classes are distinguishable — a caller can tell "this row is shaped wrong" from "this row did not
authenticate" — and a raw `TypeError` crossing a security boundary is what upstream handlers render
as a 500 with a stack rather than a controlled error. It also means the NULLable-column table from
H-2/G4 produces uncaught `TypeError`s in T33's service instead of authentication failures.

**Recommendation.** Move lines 143-145 inside the `try`, or validate shapes before constructing the
decipher (`iv` 12 bytes, `authTag` 16 bytes, `ciphertext` a Buffer) and throw the same message the
`catch` throws. The latter is preferable: it keeps the uniform message and makes the intent explicit.

### M-4 — Mutation M7 survives: HMAC-SHA-256 can be replaced with a home-rolled `SHA256(key ‖ account)` and all 332 tests stay green

**Location:** `server/test/supplierBankCrypto.test.js:169-182`

```diff
-    return createHmac("sha256", keyBuffer(this.#lookup.keyRing[keyId])).update(normalized, "utf8").digest();
+    return createHash("sha256").update(keyBuffer(this.#lookup.keyRing[keyId])).update(normalized, "utf8").digest();
```

CONFIRMED (R9): 332/332 pass. The negative control at line 177-178 computes
`createHash("sha256").update(ACCOUNT)` and asserts the index differs from it. That excludes exactly
one wrong construction — an unkeyed digest of the account — and admits any keyed-looking one,
including a prefix-MAC. The key-dependence check at line 181 also passes, because the mutant is
key-dependent.

This is the discriminating-negative-control problem the module has hit before (REV-030's vacuous
assertions, and the author's own S5/B3 findings): the control rules out the specific thing the author
was thinking of rather than the class. §2 AC2's claim that the control proves «一般 SHA-256 不處理
帳號» is accurate as written; the report's framing of it as establishing the construction is not.

Practically the mutant is not catastrophic — with a fixed 32-byte key over short inputs and an index
that is never published, length extension is not a live attack. So M, not H. But the test does not pin
the construction the design names.

**Recommendation.** Pin it directly, the way the author pinned the negative case:

```js
const expected = createHmac("sha256", Buffer.from(revealedLookupKey, "base64")).update(ACCOUNT, "utf8").digest();
assert.ok(index.equals(expected), "the index must be HMAC-SHA-256 over the normalized account");
```

This requires the test to hold the key material it generated, which it already does inside `ring()`.

### M-5 — The §4 evidence table is pinned to `56ae08f` and predates the test change in `1a4c8d5`

**Location:** `docs/supplier_management/implementation/30_task_032_bank_persistence.md` §4, and the
four `run.json` files.

CONFIRMED: all four evidence runs record `"code_commit": "56ae08f28147a6e20f42762a8d32c83b73accedc"`.
`1a4c8d5` then changed `server/test/integration/supplierCoreMigrations.integration.test.js` by
+26/−8. The §4 table presents four PASS rows with evidence links and no note that the recorded runs
predate a change to the test code they are evidence for.

Scoped correctly, this is narrow: `git diff 56ae08f..HEAD` over
`0037_create_supplier_bank_accounts.js` and `SupplierBankCrypto.js` is empty, so the evidence does
cover the production artifacts. Only the test file moved. And PR #116's CI is green at `699ab06`
(R12), which does cover head. So the substance is fine and I independently reproduced 332/332 at head
(R2). What is wrong is the presentation: §4 reads as covering the merge candidate, and it does not.

This is the shape recorded in the harness memory as «MERGE_READY can't be fully green» — recording
evidence moves HEAD. The fix is not to chase a green that cannot exist, it is to say which commit
each row covers.

**Recommendation.** Add the `code_commit` to each row of the §4 table and one sentence stating that
`1a4c8d5` postdates them and is covered by PR CI instead.

### M-6 — No length or alphabet bound on the account number; a 600-character input encrypts cleanly and only fails at the INSERT

**Location:** `server/src/modules/supplier/SupplierBankCrypto.js:111-116`

`encryptAccountNumber` rejects only the empty normalized string. CONFIRMED (R6): a 600-character
account produces a 600-byte ciphertext against a `VARBINARY(512)` column, and
`"not-a-number-at-all"` normalizes to `"notanumberatall"` and encrypts happily, as do
`"<script>x</script>"` and a string containing U+0000.

Under this instance's `sql_mode` (`STRICT_TRANS_TABLES` present, CONFIRMED R7) the oversized insert
is rejected with `ER_DATA_TOO_LONG`, so it fails closed here. Under a non-strict `sql_mode` it would
truncate silently, producing a row whose ciphertext can never be authenticated — an unrecoverable
account with no error at write time.

The column width was chosen in this task, so the bound belongs with it even though field validation
is T33's. Note the interaction with H-1: if H-1 is fixed by defining an alphabet, the length bound
comes along for free in the same guard.

**Recommendation.** Bound the normalized length in `encryptAccountNumber` — `VARBINARY(512)` with a
16-byte tag stored separately leaves room for a 512-character account, and design §5.8 implies far
shorter, so a bound of 64 with a clear error is generous. State the chosen bound in §5.8 or in the
module comment so T33's schema and this check cannot drift apart.

---

## 3. Minor findings (L)

- **L-1 — `maskBankAccount` throws `RangeError` on an inconsistent row.**
  `SupplierBankCrypto.js:45` computes `"*".repeat(length - suffix.length)`. CONFIRMED (R6):
  `maskBankAccount({ lastFour: "123456", accountLength: 5 })` throws
  `RangeError: Invalid count value: -1`. Only reachable from a row where `last_four` is longer than
  `account_length`, which the current writer cannot produce — but a masked-list projection is a read
  path that should not be able to throw on bad data. Clamp: `Math.max(0, length - suffix.length)`,
  or return all-stars when the row is inconsistent. Relatedly, `accountLength: 70000` builds a
  70,000-character string; `SMALLINT UNSIGNED` caps the real value at 65,535, so this is cosmetic,
  but a clamp handles both.

- **L-2 — `candidateBlindIndexes` fails open on a ring that is not a plain object.**
  `SupplierBankCrypto.js:174` uses `Object.keys(this.#lookup.keyRing)`. CONFIRMED (R6): a `Map`-shaped
  ring yields `[]`, so the duplicate check finds no candidates and every write looks unique. The
  config path freezes a plain object so this cannot happen today, but the failure direction is wrong
  for a duplicate control. Assert non-empty and throw:
  `if (candidates.length === 0) throw new TypeError(...)`.

- **L-3 — `sameIndex` silently coerces strings.** `SupplierBankCrypto.js:181-186`.
  CONFIRMED (R6): `sameIndex("abc", Buffer.from("abc"))` returns `true` — `Buffer.from(left ?? [])`
  treats a string as UTF-8. A caller comparing a hex-encoded index against a raw Buffer gets `false`
  with no indication it compared the wrong things. Require Buffers, or require length 32. The
  `timingSafeEqual` use itself is correct: the length guard in front of it leaks only length, and the
  index is always 32 bytes, so nothing data-dependent is exposed. `a.length === 0` returning `false`
  is also right.

- **L-4 — the dead forbidden-name list the author removed from production survives in the test.**
  `server/test/integration/supplierCoreMigrations.integration.test.js`, the loop over
  `["account_number", "account_no", "bank_account_number", "iban"]` (diff lines 57-60). §3 S5 removes
  `FORBIDDEN_COLUMNS` from the migration with the correct reasoning — «一個永遠唔會觸發嘅守衛比冇守衛
  更差，因為佢讀落似有保護» — and the identical construct remains in the test, checking a table the
  test itself just created from a literal DDL, and redundant with the column-set equality that the
  G5 probe already pins. Same shape, same argument, one file over.

- **L-5 — the FK check reads only `constraint_name`.**
  `0037_create_supplier_bank_accounts.js:108-117` selects `constraint_name` from
  `referential_constraints` and never `referenced_table_name` or `delete_rule`. A constraint named
  `fk_supplier_bank_supplier` pointing at the wrong table, or with `ON DELETE RESTRICT` instead of
  `CASCADE`, passes. Read-confirmed from the SQL, not runtime-confirmed — FK names are schema-global
  so I could not build a probe table carrying them without touching the real table, which I would not
  do. Folded into the H-2 fix.

- **L-6 — the branch has not been merged with its target.** Main moved from `087b268` to `5d390d2`
  after the cut. CLAUDE.md §6 requires merging the target in first. CONFIRMED (R11):
  `git merge-tree main HEAD` succeeds with no conflict, and the merged ledger carries exactly one
  `APPROVAL-HD-027-SCHEMA` with no duplicates, so there is no actual hazard here — main's only new
  commit is the docs file recording HD-027. Worth noting only because PR CI is green on `699ab06`,
  not on the merge result.

---

## 4. Attacks that failed

A security review that reports nothing found is worth what its account of the attempts is worth.
These all failed, and I am recording them as evidence that the corresponding defences hold.

**Key and plaintext extraction (R4, 26 probes).** Nothing escaped. `util.inspect(c)`,
`util.inspect(c, { customInspect: false })`, `util.inspect(c, { showHidden: true, getters: true,
showProxy: true, depth: 20 })`, `Object.keys`, `Object.getOwnPropertyNames` on the instance and the
prototype, spread, `JSON.stringify(c)`, `JSON.stringify({ svc: c })`, `String(c)`, `structuredClone`,
`v8.serialize`, `new Error("x", { cause: c })`, a nested `{ ctx: { service: c } }`, the `.stack` and
every own property of all three thrown error classes, and `process.report.getReport()` including its
`environmentVariables` — none yielded key material or a plaintext account. The only things that came
back were key *IDs* (`enc-1`, `look-1`), which are public by design: they are stored in
`encryption_key_id` and `blind_index_key_id` as VARCHAR columns.

Worth naming precisely what is doing the work, because the report attributes it differently. The
real protection is `#encryption` / `#lookup` being ECMAScript private fields — Node's `util.inspect`
does not walk private fields, so `inspect(c, { customInspect: false })` returns `SupplierBankCrypto
{}` even with `[inspect.custom]` removed. `[inspect.custom]` and `toJSON` are belt-and-braces, and
the B8 mutation goes red on the `/REDACTED/` assertion rather than on an actual leak. That is a fine
place to be — two independent mechanisms — but the private fields are the load-bearing one.

**IV handling.** No caller path supplies an IV: `encryptAccountNumber` accepts only `supplierId`,
`cryptoContext` and `accountNumber`, and `iv` is `randomBytes(12)` at line 118, unreachable from
outside. CONFIRMED (R6): 20,000 successive encryptions under one key produced 20,000 distinct IVs.
IV is 12 bytes, tag is 16, key is 32, `getAuthTag` is read after `final`, and `setAuthTag` is called
before `final` on the decrypt side — all correct. Decryption keys off the row's `encryptionKeyId`,
not the active key, and `supplierBankCrypto.test.js:140-167` pins that.

**AAD forgery by delimiter embedding.** The author's rewritten B3 case is sound. R10 confirms: with
the length prefixes stripped, `supplierBankCrypto.test.js:86-103` is the single failing test, 15/16
pass. The parse is unambiguous for any input without lone surrogates — the length digits are
terminated by a `:` that cannot appear inside the decimal, so the boundary is determined. M-1 is the
one residual.

**False duplicates from normalization.** I could not construct two genuinely different account
numbers that collide. NFKC folds fullwidth digits, superscripts, subscripts and Roman numerals to
their ASCII forms, all of which are the same account rendered differently — which is the intent. The
failure mode here is the opposite one, H-1: same account, different index.

**Timing and ordering in `candidateBlindIndexes`.** No early exit, no data-dependent branching — it
computes an HMAC for every key in the ring unconditionally and returns them in ring-insertion order,
which is configuration-dependent, not input-dependent. Nothing observable varies with the account.

**Ciphertext containment.** `supplierBankCrypto.test.js:44` asserts the ciphertext does not contain
the account bytes; I re-ran it and also checked the returned row object (R4) — no plaintext in
`ciphertext`, `iv`, `authTag`, `lastFour` or `accountLength` for a 13-character account.

**Plaintext retention.** Nothing is retained longer than necessary in any way JavaScript lets you
avoid. `normalized` and the decrypt return value are immutable strings that cannot be zeroed, and
`keyBuffer` allocates a fresh key Buffer per operation and leaves it to GC. This is inherent to the
runtime, not a defect in this module, and I am recording it so a later reviewer does not re-derive it
as a finding.

**Migration versus design §5.8.** I diffed the live `SHOW CREATE TABLE` against §5.8 column by
column. Every column, type, nullability, default, index and constraint matches, including the
`default_slot` expression, the three UNIQUEs, the two KEYs and all four FKs. The §4 claim that the
migration was run against real MySQL and verified line by line is accurate. `ON DELETE CASCADE` on
`supplier_id` is right and matches §5.8: a future payment table referencing this one with RESTRICT
will block the cascade at statement level, so a supplier with payment history cannot be hard-deleted
out from under its bank rows — the combination fails closed.

**Scope and process.** Every changed path is inside `allowed_write_paths`
(`docs/supplier_management/**`, `server/src/modules/supplier/**`, `server/test/**`) except
`server/database/migrations/0037_create_supplier_bank_accounts.js`, which is in
`approval_required_paths` and is named explicitly in `APPROVAL-HD-027-SCHEMA`'s scope.
`00_project_profile.json` is untouched, so the PLAN baseline hash is intact. The approval's timeline
checks out: HD-027 was recorded on main at 09:20:23 and the migration was first committed at
09:25:01, so §0's and the approval's claim that the schema was presented before any migration was
written is true. The approval's `code_commit` pin at `56ae08f` is accurate — the migration has not
changed since. No production code imports `SupplierBankCrypto` yet, consistent with T33 holding the
service.

**The `probe()` no-op guard.** The brief asked whether it is sufficient. For what it is for, yes.
`assert.notEqual(ddl, template)` catches a mutation that silently matched nothing, which is the
CI-only defect `1a4c8d5` fixed, and each probe additionally asserts a *specific* non-alternating
error regex, so a mutation that changes the DDL but not in the intended way is caught by the
expectation rather than by the guard. I checked the other string anchors in that file: `stripFk`'s
`CONSTRAINT \`fk_supplier_bank_` filter and the dangling-comma repair both produce a `CREATE TABLE`
syntax error or a duplicate-constraint error if they fail to match, so neither can silently do
nothing. The control block's assertion that the unmodified copy stops exactly at the FK check is
well constructed and is what makes the five probes mean anything — it is the negative control the
harness memory says to run, and the author ran it. The one anchor-shaped weakness I found in the
tests is L-4, and the one structural gap is H-3, which is an absent test rather than a silent one.

---

## 5. Honesty of the report

Spot-checking §3 and §4 as instructed. The report is substantially honest and unusually
self-critical — it volunteers two of its own defects and a CI-only defect, and both B3 and S5 are
real findings correctly diagnosed. Four corrections:

1. **§3 B3, «呢條測試證嘅係個格式本身冇歧義».** Overstated. The case proves delimiter-embedding is
   handled; the format is not injective (M-1, demonstrated).
2. **§2 AC3, «連「有人錯手將短帳號全值放咗入 `lastFour`」都測咗».** True of `maskBankAccount`, false
   of `encryptAccountNumber`. The writer is untested at that boundary (H-3, two surviving mutations).
3. **§2 AC2, the SHA-256 negative control.** It rules out an unkeyed digest, not the construction
   (M-4, surviving mutation).
4. **§4 evidence table.** Accurate per row, but pinned to `56ae08f` and presented without noting that
   `1a4c8d5` changed test code afterwards (M-5).

Verified as stated: 332/332 (R2), lint PASS (R3), B3 red after rewrite (R10), S5's reasoning that
`FORBIDDEN_COLUMNS` was unreachable (the column-set equality at line 54 does reject both the
extra-column and renamed-column cases), the migration matching §5.8 in real MySQL (R7), the branch
and migration-number reasoning in §0, and §4's stated reason for not running Playwright — there is no
UI in this change and no browser-reachable code, so CLAUDE.md §9 does not bite. The §3 claim that
`git status` was asserted clean between all seventeen mutations is not retroactively verifiable; I
note it as recorded rather than confirmed, and my own six mutation runs left the worktree clean.

---

## 6. Verdict

**CHANGES_REQUESTED** at head `699ab066673570a6981da2ec298d958d3eb25212`.

Blocking: **H-1** (normalization lets a dot or an invisible character bypass duplicate detection, and
the choice is baked into stored ciphertext), **H-2** (the compatibility assertion accepts eight
classes of incompatible table, including one where the one-default UNIQUE enforces nothing and one
where `crypto_context` is not unique), **H-3** (the writer that decides what lands in `last_four` has
no test at the short-account boundary; two mutations survive the full suite).

None of the three is a defect in the cryptography as written. AES-256-GCM is used correctly — random
96-bit IV per row with no caller path to supply one, 128-bit tag, tag verified before plaintext is
returned, 32-byte key enforced by OpenSSL on the encryption path, decryption keyed off the row's own
key ID. The AAD binds both identifiers and resists the forgery it was built to resist. The leak
surface held against everything I threw at it. The blocking issues are at the edges the cryptography
depends on: what goes into it (H-1), what the database guarantees about where it lands (H-2), and
what the tests actually pin (H-3). For a foundation that later tasks will build on and that cannot
be re-normalized or re-shaped cheaply once rows exist, those edges are the whole job.

M-1 through M-6 and L-1 through L-6 do not block but should be dispositioned before PHASE-003 closes;
M-2 and M-3 are four-line changes and I would take them in the same pass as the H fixes.

**Reviewed by:** REV-033 independent reviewer
**Head:** `699ab066673570a6981da2ec298d958d3eb25212`
**Worktree state at end of review:** clean apart from this file
