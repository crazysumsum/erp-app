# REV-035 — Independent review of TASK-033 (Bank domain service)

**Reviewer:** independent agent (not the author) · **Task:** TASK-033 / T33 · **Phase:** PHASE-003
**Branch:** `claude/supplier-task-033` · **Head reviewed:** `8718fa78db14b866155c5ebad6024619632f42aa`
**PR:** https://github.com/crazysumsum/erp-app/pull/118 · **Baseline:** cut from main `5125f32`
**Verdict:** **CHANGES_REQUESTED** — 3 High, 4 Medium, 5 Low.

Everything below that says CONFIRMED was executed against the live `erp_dev` MySQL at head, with
the worktree restored and `git status --porcelain` asserted clean after every mutation. Probe
scripts lived in `/tmp/claude-501/` only. `npm run lint` passes at head. The stated suite is green
at head: **51 tests, 51 pass, 0 fail**.

---

## 1. What I ran

| # | What | Result |
| --- | --- | --- |
| Baseline | the three bank suites, integration on | 51/51 PASS |
| Lint | `npm run lint` | PASS |
| Sweep | every codepoint U+0080–U+1FFFF through `normalizeBankAccountNumber` | 1265 fold into `[0-9A-Z]` |
| Probe A | `create` with a disallowed character, through the **real** `MySqlDatabaseService.withTransaction` | 500 |
| Probe B | `create` + `reveal` round trip for superscript / circled / fullwidth inputs | account silently rewritten |
| Probe C | create → deactivate → re-create the same account | `ER_DUP_ENTRY` → 500 |
| Probe D | plant a plaintext into `account_ciphertext`, run the scanner's own logic | found (scanner sound) |
| Probe E | two concurrent same-Supplier creates, with an `authorize` that queries first | 500, not 409 |
| Probe F | two concurrent cross-Supplier creates of the same account | both warnings lost |
| Mutations | four of my own, each applied alone and reverted | **two survived** |

---

## 2. Findings

### H-1 — The HD-029 rejection reaches the caller as a 500, not as a validation error

**Location:** `server/src/modules/supplier/SupplierBankCrypto.js:69-79` (`requireAccount` throws a raw
`TypeError`), consumed inside the transaction by `SupplierBankService.js:185` (`#seal`) via `create`
and `update`; translated at `server/src/services/mysqldatabase/MySqlDatabaseService.js:551-556`.

**What is wrong.** `requireAccount` throws a plain `TypeError`. That throw happens *inside*
`database.withTransaction`, whose catch block rethrows anything that is not an `ApplicationError` as
`MySqlDatabaseOperationError("MySQL database transaction failed", { code: "DATABASE_TRANSACTION_FAILED" })`.
Confirmed end to end (probe A):

```
{ "name": "MySqlDatabaseOperationError",
  "code": "DATABASE_TRANSACTION_FAILED",
  "publicCode": "INTERNAL_SERVER_ERROR",
  "status": 500,
  "causeMsg": "Supplier bank crypto cannot encrypt an account number containing characters it cannot represent" }
```

**Why it matters.** This is the acceptance of HD-029 itself. The Product Owner chose "strip
formatting, reject content" over silent stripping on one stated property, recorded verbatim in the
ledger at revision 154: *"an unlisted separator is now loudly refused, which a user sees and can
correct."* A 500 `INTERNAL_SERVER_ERROR` is neither seen nor correctable — the user is told the
server broke. The author's own doc §0 repeats the claim (「俾人**大聲拒絕**（用戶見到、改得到）」).
It is false at the service boundary. The same path swallows a missing or empty `accountNumber`:
`normalizeBankInput` (`SupplierBankService.js:63-84`) validates holder name, bank name and the two
code fields but never touches `accountNumber`, so every account-shaped input error is a 500.

**Why no test caught it.** `server/test/supplierBankService.test.js:347` asserts only that *something*
threw and that it did not echo the account. The harness's fake transaction at
`server/test/supplierBankService.test.js:63` is `async withTransaction(work) { return work(connection); }`
— it does not reproduce the real wrapper's error translation, so the assertion holds on a
`TypeError` that production never delivers.

**Fix.** Validate before the transaction opens, in `normalizeBankInput`, and throw the module's own
error type:

```js
// SupplierBankCrypto.js — export the rule, keep one implementation
export function bankAccountNumberIsRepresentable(value) {
  const n = normalizeBankAccountNumber(value);
  return Boolean(n) && !DISALLOWED.test(n) && n.length <= MAX_ACCOUNT_LENGTH;
}

// SupplierBankService.js, inside normalizeBankInput (accountNumber present or required)
if (!bankAccountNumberIsRepresentable(input.accountNumber)) {
  throw invalidSupplierInput("BANK_ACCOUNT_INVALID", "帳號只接受數字和英文字母", { field: "accountNumber" });
}
```

Then tighten the test to `error.publicCode === "BANK_ACCOUNT_INVALID" && error.statusCode === 400`,
which is the assertion that discriminates. Keep the `TypeError` in `requireAccount` as the crypto
layer's own backstop.

---

### H-2 — NFKC launders 1265 codepoints past the reject step; REV-034 M-2's second half is **not** closed

**Location:** `server/src/modules/supplier/SupplierBankCrypto.js:47-49`.

```js
const FORMATTING = /[\s\p{Cf}\p{Pd}−._/,·‧:]+/gu;
const DISALLOWED = /[^0-9A-Z]/u;
export function normalizeBankAccountNumber(value) {
  return String(value ?? "").normalize("NFKC").toUpperCase().replace(FORMATTING, "");
}
```

NFKC runs **first**. Compatibility folding turns a large class of characters into pure `[0-9A-Z]`
*before* `DISALLOWED` ever looks, so those characters are never rejected — they are silently
rewritten. A sweep of U+0080–U+1FFFF finds **1265** such codepoints.

**CONFIRMED end to end** through `create` then `reveal` against real MySQL (probe B) — the value on
the right is what the row actually stores and what a payment would use:

| typed | stored | masked shown to the user |
| --- | --- | --- |
| `12²345` | `122345` | `•••• 2345` |
| `1②345` | `12345` | `•••• 2345` |
| `１２３456789` | `123456789` | `•••• 6789` |

And the collapse is exactly REV-034 M-2's shape — four distinct typed strings, one stored account:

```
"B12345"  -> "B12345"
"ᴮ12345"  -> "B12345"   (U+1D2E)
"ᵇ12345"  -> "B12345"   (U+1D47)
"Ⓑ12345"  -> "B12345"   (U+24B7)
```

Others in the set change length as well as content: `ß` → `SS`, `Ⅻ` → `XII`, `℡` → `TEL`,
`Ĳ` → `IJ`, `ǅ` → `DZ`.

**Why it matters.** This is the finding DEF-021 exists to close, reached through a different
character class. The stored normalized string is what gets encrypted, HMACed, measured and
eventually paid — a silently altered account is the wrong-payee path, not a duplicate-detection
quirk. The realistic vector is not an attacker typing `②`: it is a paste from a PDF, a Word
document or a CJK input method, where fullwidth digits and superscripts arrive without the operator
noticing, and the masked echo (`•••• 2345`) confirms the wrong number back to them.

The design principle the author rests on does not hold. From the file header and doc §0:
「一個我列唔到嘅新分隔符號會落入第二步俾人**大聲拒絕**……黑名單嘅不完整而家 fail closed」. For
these 1265 codepoints the incompleteness fails **open**, silently, in precisely the direction the
PO ruled against.

**Fix.** Classify before compatibility folding, not after. The minimal change:

```js
export function normalizeBankAccountNumber(value) {
  return String(value ?? "").normalize("NFC").toUpperCase().replace(FORMATTING, "");
}
```

`NFC` is canonical-only: it composes `A` + combining ring into `Å` (so `ÅB12345` still rejects as
today) but performs no compatibility folding, so `²`, `②`, `ᴮ`, `℡`, `ß` and the fullwidth forms all
reach `DISALLOWED` and are refused. If fullwidth input must keep working — it is the one member of
the set with a plausible business case — fold only the explicit, reviewable ranges before the reject
step, rather than the whole NFKC compatibility table:

```js
const FULLWIDTH = /[０-９Ａ-Ｚａ-ｚ]/gu;
// .normalize("NFC").replace(FULLWIDTH, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
```

Note that dropping NFKC outright turns one test red —
`supplierBankCrypto.test.js` *"formatting differences in the same account collide…"* — so the
fullwidth half is deliberately asserted. That test should pin the bounded fold, and a new test
should pin that `12²345`, `1②345` and `ᴮ12345` are **refused**.

**Ledger consequence.** DEF-021 is recorded `CLOSED` at revision 154 with closure evidence
`SupplierBankCrypto.js`, `supplierBankCrypto.test.js`, `HD-029`. That closure is not supported.

**Separately, the worked example is wrong.** Doc §0, the `SupplierBankCrypto.js` file header and
HD-029's *question text in the ledger* all state that `½` becomes `12`. It does not: `½` normalizes
to `1⁄2`, and U+2044 FRACTION SLASH is `Sm`, matched by neither `\p{Pd}` nor the explicit set, so it
falls into `DISALLOWED` and is **rejected**. Verified. The PO's MAJOR decision was taken on an
example that does not reproduce — while the example that does (`²`, `②`, fullwidth) was never put to
them.

---

### H-3 — Duplicate detection and the unique index disagree, and the gap surfaces as a 500 carrying the blind index

**Location:** `server/src/modules/supplier/SupplierBankService.js:163` —
`WHERE b.account_blind_index IN (…) AND b.status = ?` (bound to `ACTIVE`).
Index: `uq_supplier_bank_blind_index (supplier_id, blind_index_key_id, account_blind_index)` in
`server/database/migrations/0037_create_supplier_bank_accounts.js:52` — **no status predicate**.

The service checks active rows only. The database constrains all rows. Two reachable consequences.

**Trigger 1 — deterministic, and it is the flow the design mandates.** FR-BANK-005 removes hard
delete, so deactivation is the *only* retirement path. Create an account, deactivate it, re-add the
same number (probe C, CONFIRMED):

```
re-add FAILED: { "code": "DATABASE_OPERATION_FAILED", "publicCode": "INTERNAL_SERVER_ERROR",
                 "status": 500, "causeCode": "ER_DUP_ENTRY",
                 "causeMsg": "Duplicate entry '12211-look-1-\\xEA\\x18\\x84\\x04\\x06Bl\\xE2\\x9B;…'
                              for key 'supplier_bank_accounts.uq_supplier_bank_blind_index'" }
```

A supplier reinstating a previously retired account, or an operator who deactivated a typo'd row and
re-enters it, gets a 500.

**Trigger 2 — the race, invisible to every test.** With production's default `authorize`
(`assertActorFresh`, `directoryLookups.js:50-68`), the transaction's **first** statements are plain
`SELECT`s against `users` and the role/permission tables. Under `REPEATABLE READ` — the wrapper's
default, `MySqlDatabaseService.js:415` — that opens the consistent-read snapshot *before*
`#supplierForUpdate` takes the `suppliers` lock. `#duplicates` is a **non-locking** read, so it sees
the pre-lock snapshot and misses a concurrently committed sibling. Two concurrent same-Supplier
creates of the same account (probe E):

- with an `authorize` that runs no query (what **every** test uses): `BANK_ACCOUNT_DUPLICATE / 409` ✔
- with an `authorize` that queries first (what production does): `INTERNAL_SERVER_ERROR / 500 / ER_DUP_ENTRY` ✘

In both cases exactly one row exists afterwards — the unique index holds, so **no duplicate is ever
created**. The defect is the error contract, not the data.

**Secondary exposure.** The `ER_DUP_ENTRY` text embeds the raw `account_blind_index` bytes in
`error.cause.message`. `publicCode` is `INTERNAL_SERVER_ERROR`, so the client sees nothing
(CONFIRMED), but the blind index is a keyed lookup value whose whole purpose is that it not circulate
— design §5.8 chose HMAC over SHA-256 precisely because the account space is enumerable. Whether the
cause chain reaches the log sink is **PLAUSIBLE**, not confirmed; I did not exercise the production
logger. Worth closing regardless.

**Why no test caught it.** My mutation **R-M2** widens the predicate to a tautology:

```diff
-        WHERE b.account_blind_index IN (${placeholders}) AND b.status = ?
+        WHERE b.account_blind_index IN (${placeholders}) AND (b.status = ? OR 1=1)
```
```
ℹ tests 51   ℹ pass 51   ℹ fail 0
```

**SURVIVING.** Nothing in the suite pins whether inactive rows participate in duplicate detection.

**Fix.** Align the service to the index — drop `AND b.status = ?` so a collision with an inactive row
returns `BANK_ACCOUNT_DUPLICATE` (409) with a message the user can act on. If the product answer is
instead that a deactivated account *must* be re-addable, that is a schema change (a status-aware
generated column, the shape `default_slot` already uses) and needs sign-off under CLAUDE.md §8 — it
is not a service-layer decision. Either way:

- add `create → deactivate → create` as an integration test;
- give at least one integration test an `authorize` that issues a query first, so the snapshot
  timing the production default creates is inside the test envelope at all.

---

### M-1 — `list` asserts no permission whatsoever

**Location:** `server/src/modules/supplier/SupplierBankService.js:205-218`.

`list` calls `this.authorize(...)` — which only checks that the claimed roles/permissions still match
reality — and then returns the projection. It never calls `#assertMay`. Design §6.6 specifies
`jwt / supplier.view` for `GET /api/v1/suppliers/:id/bank-accounts`.

Every write path and `reveal` carry the second layer, and the class comment argues explicitly for why
it exists (「擋嘅係『claim 同現況夾晒，但個人其實冇 bank.mgmt』嗰種誠實地冇權嘅 caller」). The one
read path omits it. The file's stated rule #1 — no ciphertext leaves the database — is about column
selection; it is not an authorization control, and the doc's acceptance table conflates the two. No
handler exists yet (author's §6), so today the service is the only layer there is.

**Fix.** `this.#assertMay(actor, "supplier.view", "你目前沒有供應商查看權限");` after the authorize
call in `list`. (Do **not** require `bank.view` — AC-023 deliberately grants the masked list more
broadly.)

Related, lower: `#assertMay` on the write paths checks `supplier.bank.mgmt` only, while §6.6 requires
`supplier.view + bank.view + bank.mgmt`. Defensible as a second layer, and the comment says so.

---

### M-2 — Two masking rules; the one in production is untested, the one under test is dead

**Location:** `server/src/modules/supplier/SupplierBankCrypto.js:84-99` (`maskBankAccount`) versus
`server/src/modules/supplier/supplierProjections.js:98-100` (`toMaskedBankResponse`).

The author flagged this. It is real, and sharper than flagged. `maskBankAccount` has **no production
caller** — grep across `server/src` returns only its own definition; the only other references are in
`server/test/supplierBankCrypto.test.js`. The service uses `toMaskedBankResponse` exclusively.

The guard REV-033 L-1 and REV-034 L-1 forced — a malformed row where `last_four` is longer than
`account_length` must mask *more*, not less — lives only in the dead function
(`SupplierBankCrypto.js:92-98`, asserted at `supplierBankCrypto.test.js:410`). The live projection has
no equivalent: `{ last_four: "123456", account_length: 5 }` yields `•••• 123456`, which is the exact
failure the two prior reviews closed.

**Is the projection's rule correct for a short account?** Yes. `accountLength > 4 ? … : "•".repeat(accountLength)`
returns all bullets for lengths 1–4, `""` for 0 or a NULL column, and cannot throw (the column is
`smallint unsigned`). That attack failed.

**Is it tested?** No. My mutation **R-M4**:

```diff
-  const maskedAccountNumber = accountLength > 4 ? `•••• ${row.last_four}` : "•".repeat(accountLength);
+  const maskedAccountNumber = `•••• ${row.last_four}`;
```
```
ℹ tests 51   ℹ pass 51   ℹ fail 0
```

**SURVIVING.** The short-account rule in the read path BR-020 depends on has zero coverage. It is not
a live leak today — `encryptAccountNumber` sets `lastFour: ""` when length ≤ 4 and the column is
`varchar(4)`, so the mutated form yields `"•••• "` — but that is an accident of the writer, and the
writer is the thing T35+ will add more of.

**Fix.** Delete `maskBankAccount` and move its guard into `toMaskedBankResponse` (or have the
projection call it, and keep exactly one rule including one display character). Move the short-account
and malformed-row assertions onto the projection.

---

### M-3 — The cross-Supplier duplicate warning silently disappears under concurrency

**Location:** `server/src/modules/supplier/SupplierBankService.js:160-183`.

`#duplicates` is a non-locking read, and `uq_supplier_bank_blind_index` is scoped per Supplier, so two
creates under *different* Suppliers with the same account contend on nothing at all. CONFIRMED
(probe F):

```
conn0: CREATED id=522 warnings=[]
conn1: CREATED id=523 warnings=[]
>>> both created with ZERO cross-Supplier warning? YES — warning silently lost
```

Neither caller is told. This warning is the only signal a human gets that two Suppliers share a payee
account, which is a standard invoice-redirection indicator — and it is the one the design took
trouble over (§6.6 specifies what it may and may not name).

**Fix — needs a decision, not a silent choice.** Either make it a real check by taking `FOR SHARE` in
`#duplicates`, which puts a next-key lock on the `idx_supplier_bank_lookup` range and serialises the
two inserts (at the cost of new lock contention on a hot index, and a new deadlock surface to
re-analyse against §2.6); or accept that it is advisory and say so in the design and the doc, so that
nobody downstream builds a control on top of a signal that can vanish. Today the code takes the
second option and the documentation reads as if it took the first.

---

### M-4 — The plaintext scanner's control only exercises the branch the acceptance does not rest on

**Location:** `server/test/integration/supplierBank.integration.test.js:129-178`.

The scanner is the acceptance evidence for "no plaintext anywhere". Its control plants the secret
into `account_holder_name` — a `varchar(190)` text column, taking the `String(value)` branch — and
asserts `deepEqual(hits, ["supplier_bank_accounts.account_holder_name"])`, i.e. **exactly one hit**.
The assertion the acceptance actually depends on is about the `VARBINARY`/`BINARY` columns, which take
the `Buffer.isBuffer(value) ? value.toString("latin1")` branch. That branch is never demonstrated, and
the exact-one-hit shape means it structurally cannot be.

I verified the branch independently (probe D): planting the secret into `account_ciphertext` and
running the same scanning logic returns `YES account_ciphertext`, and `mysql2` does hand back a
`Buffer`. So the scanner **is** sound and the ledger's claim at revision 154 — *"reading binary columns
as latin1 so a plaintext hidden in a BLOB would still be found"* — is true. It is simply not proven by
the suite that ships with it, and an untested control is the thing this module's review history keeps
catching.

**Fix.** Plant into `account_ciphertext` as well (or instead), and assert that hit:

```js
await connection.execute("UPDATE supplier_bank_accounts SET account_ciphertext = ? WHERE id = ?",
  [Buffer.from(SECRET, "latin1"), created.id]);
assert.ok((await scan("supplier_bank_accounts", "supplier_id = ?", [supplierId]))
  .includes("supplier_bank_accounts.account_ciphertext"),
  "the scanner reads binary columns, which is the branch the assertion above depends on");
```

**Scope note, accurate in the ledger, missing from the doc.** T33's acceptance names three targets —
Bank table, audit log and **system log**. The scan covers two. The ledger discloses this honestly
(*"The system-log half is not covered here: nothing in this service logs, and there is no log sink in
the test environment to search"*). The doc's §2 acceptance table and §3 do not carry the caveat. Given
H-3's `ER_DUP_ENTRY` cause chain, the system-log half is no longer a purely theoretical gap.

---

### L-1 — Malformed error code: `SUPPLIER_BANK ACCOUNT_NOT_FOUND` (with a space)

**Location:** `SupplierBankService.js:141` and `:455` call `supplierChildNotFound("bank account")`;
`supplierErrors.js:52-59` builds `` `SUPPLIER_${childType.toUpperCase()}_NOT_FOUND` ``.

`"bank account".toUpperCase()` yields `BANK ACCOUNT`, so the emitted public code is
`SUPPLIER_BANK ACCOUNT_NOT_FOUND`. Every other call site passes a single word
(`address`, `contact`, `identifier`). The code contains a space, is not in §6.4's error contract, and
`labels` has no `bank` entry so the message falls through to the generic 「找不到這項供應商子資料」.

**Fix.** Pass `"bank"`, and add `bank: "銀行帳戶"` to `labels` at `supplierErrors.js:53`.

### L-2 — `reveal` omits `expiresInSeconds` from §6.6's response contract

**Location:** `SupplierBankService.js:476`. §6.6 specifies
`{ id, accountNumber, revealedAt, expiresInSeconds: 30 }`; the service returns the first three.
Also `revealedAt: this.time.nowMs()` is sampled *after* commit, so it is a different instant from the
audit row's `occurred_at` — two timestamps for one event, which an investigator will have to reconcile.

### L-3 — `reveal` cannot return what was typed, and §6.6's own example says it does

Only the normalized form is stored, so `reveal` returns `123456789001` where design §6.6's reveal
example shows `"123-456789-001"`. That is a defensible consequence of HD-029, but the design example
now contradicts the implementation and an operator comparing a revealed number against a bank letter
will see a different string. One of the two should move; say which.

### L-4 — `references` is accepted, stored and never read

**Location:** `SupplierBankService.js:87` and `:100`. The author's reasoning for why `deactivate`
ignores payment references is sound (FR-BANK-005 blocks hard delete, not deactivation) — which is
exactly why the constructor should not take the dependency. Delete both lines.

### L-5 — A missing permission is reported as a 409 conflict

**Location:** `SupplierBankService.js:104-108`. `#assertMay` throws
`supplierConflict("BANK_PERMISSION_LOST", …)` → HTTP 409. For the revoked-token case the name and the
status are both defensible. But the check also fires for a caller who simply never had `bank.mgmt`,
and telling that caller to reload and retry is wrong. Split the two, or use 403.

### N-1 — Doc and ledger inaccuracies

- The `½ → 12` example is wrong in three places (doc §0, `SupplierBankCrypto.js` header, HD-029's
  question text in the ledger). See H-2.
- Doc §2's acceptance table records every row as met; H-1, H-3 and M-1 each contradict a row.

---

## 3. Scope and ledger

**Clean.** All 21 changed files fall inside `00_module_manifest.json` → `scope.allowed_write_paths`:
`docs/supplier_management/**`, `server/src/modules/supplier/**`, `server/test/**`. No
`approval_required_paths` entry is touched — in particular there is **no migration** in the diff, so
CLAUDE.md §8 does not apply to what shipped (it will apply to H-3's alternative fix).
`00_project_profile.json` is untouched. `scope.forbidden_paths` untouched.

**Ledger at revision 154** records, accurately: the branch cut from `5125f32`; HD-029 with the PO's
ruling; the fourteen-mutation campaign including T11's survival, the reason it survived (a vacuous
assertion on bind parameters that never contain `crypto_context`), and the fact that the *first* fix
for it was also wrong (a twelve-character account makes GCM ciphertext and IV the same length); and
the scanner observation with its honest disclosure of the uncovered system-log third. Evidence files
extended by the four `run.json` entries the doc §4 table cites. I re-ran the four suites the doc
claims and the counts match.

**Two ledger entries are not supported by the code at head:**

1. **DEF-021 is `CLOSED`.** Per H-2, REV-034 M-2's second half is open — 1265 codepoints still
   silently rewrite the stored account. The closure evidence (`SupplierBankCrypto.js`,
   `supplierBankCrypto.test.js`, `HD-029`) does not establish the property claimed.
2. **HD-029's recorded rationale** — "loudly refused, which a user sees and can correct" — is false
   per H-1. The refusal is a 500.

**Mutation campaign.** I accept the author's thirteen RED results and the T11 account; the T11
analysis is correct and the replacement property (re-encrypted ciphertext must decrypt under the
context the row stores) is the right one. I did not re-run them. I added four of my own; two survived
(**R-M2**, **R-M3 ✓ RED**, **R-M4**, **R-M1 ✓ RED**), and both survivors sit under findings above.
The campaign's blind spot is consistent: it mutates *decisions the tests were written for* and does
not probe the predicates nobody thought about (the `status` filter, the projection's masking rule).

---

## 4. Attacks that failed

Worth recording, because several of the author's invariants do hold and hold for the stated reason.

1. **Plaintext into `ApplicationError.details`.** Every `throw` in the service passes `{ field }` and
   nothing else; `optionalCode` and `normalizeBankInput` never put a value in `details`. Probe A's 500
   carries no account in `message`, `details` or `cause.message`. Holds.
2. **Plaintext into a MySQL driver error via a bind parameter.** No query in the service binds the
   account number — the INSERT and UPDATE bind only `sealed.*` (ciphertext, IV, tag, key IDs, blind
   index, `last_four`, length) and the scalar detail fields; `#duplicates` binds blind indexes;
   `reveal` binds IDs. A leaked `err.sql` could not contain plaintext. Holds.
3. **The update path's dynamic SQL.** `SupplierBankService.js:310-316` splices a *fixed* column-list
   fragment selected by a boolean, and the parameter array is built with a matching conditional
   spread. No value reaches the SQL text; no injection surface; the two arms cannot desynchronise
   because both are gated on the same `sealed`. Holds.
4. **Plaintext into audit detail.** `create`, `update`, `setDefault`, `deactivate` and `reveal` pass
   only masked strings, booleans and status values. The integration scan over every column of
   `supplier_audit_logs` is green, and I independently confirmed the scanner's binary branch works
   (probe D), so that green is meaningful even though the test's own control does not prove it (M-4).
   Holds.
5. **Plaintext into the returned projection.** `MASKED_COLUMNS` contains no ciphertext, IV, tag, blind
   index or key ID; `#project` and `list` both re-select from that list rather than reusing a row
   fetched by `#rowForUpdate`. Holds.
6. **Reveal ordering.** `plaintext` is a closure local assigned as the *last* statement of the
   transaction body, and the `return` is after `await this.database.withTransaction(...)`. I forced
   each failure: a decrypt failure throws before the assignment; an audit failure throws before it; a
   commit failure rejects the promise (`MySqlDatabaseService.js:513-517`); an indeterminate commit
   rethrows via `reportIndeterminateCommit` (`:534-545`). I could not construct any path where the
   caller receives a value without a committed audit row. The reverse — audit committed, caller gets
   nothing — is reachable on an indeterminate commit, which is the safe direction. **Holds by
   construction, not just by reading.**
7. **Racing two creates into an actual duplicate row.** The snapshot staleness in H-3 changes the
   *error*, never the data: `uq_supplier_bank_blind_index` holds and exactly one row survives
   (probe E). Holds.
8. **Deadlock, within the service and against its peers.** All four write methods take
   `suppliers FOR UPDATE` first, which serialises them per Supplier; `#activeRowsForUpdate` carries
   `ORDER BY id`; audit is last everywhere. `setDefault` locking an *inactive* target after the
   ascending active set is the one out-of-order acquisition, and it cannot form a cycle because every
   peer is already queued behind the same `suppliers` row. `SupplierAdminService` and
   `SupplierApprovalService` also take `suppliers` before any child row and the bank service never
   touches `supplier_settings` or `supplier_activation_requests`, so no inverted order exists.
   `reveal` takes no row lock at all and therefore cannot be a cycle member. Consistent with §2.6.
9. **`toMaskedBankResponse` on a short account.** Correct — all bullets for lengths 1–4, `""` for 0 or
   NULL, no `RangeError` possible. The divergence in M-2 is about the malformed-row guard and the
   display character, not about the short-account rule itself.
10. **AAD cross-row / cross-Supplier ciphertext swap.** The UTF-16LE length-prefixed encoding is
    injective and the integration test moves a row to another Supplier and shows the reveal fails. I
    found no new collision.

---

## 5. Verdict

**CHANGES_REQUESTED** — 0 Critical, **3 High**, 4 Medium, 5 Low.

H-1 and H-2 are the same wound: HD-029 was answered, and what shipped delivers neither half of the
answer. Content characters still silently rewrite the stored account (H-2), and the characters that
*are* refused are refused with a 500 the user cannot act on (H-1). DEF-021 should be reopened. H-3 is
independent and turns the module's only account-retirement flow into a server error.

Nothing I could construct leaks a plaintext account number. The three invariants the author claims for
the read path, the audit path and the reveal ordering all hold, and the reveal ordering holds by
construction under forced decrypt, audit, commit and indeterminate-commit failures. The encryption,
AAD, blind-index and locking work is sound. The defects are at the boundary — what the service
*rejects*, what it *normalizes*, and what it tells the caller when it refuses.

**Head commit reviewed: `8718fa78db14b866155c5ebad6024619632f42aa`.**
Worktree restored and verified clean (`git status --porcelain` empty) after every probe and mutation;
the only file this review adds is itself.
