# REV-034 — TASK-032 remediation review (follow-up to REV-033)

**Review:** REV-034 · **Task:** TASK-032 · **Phase:** PHASE-003 · **Capability:** SUP-CAP-03
**Head reviewed:** `dda9a4030c12c3eb105f01b0ee0314951fa68580`
**Previous review:** REV-033 at `699ab06`, CHANGES_REQUESTED, three H
**Branch:** `claude/supplier-task-032` · **PR:** #116 · **Ledger revision:** 149

**Verdict: APPROVED.** All three blocking findings are closed and I verified each by re-running the
attack that found it. Two new M findings and six L, none blocking — reasoning in §5.

---

## 0. What I ran

| # | Probe | Result |
| --- | --- | --- |
| R1 | Full `supplier-phase-001-server` argv | **338/338 PASS** (was 332) |
| R2 | `npm run lint` | PASS |
| R3 | REV-033's three surviving mutations (M1, M6, M7) re-applied | **all three now RED** |
| R4 | Unicode scan, 128,992 codepoints, through the new normalizer | see §2 |
| R5 | Under-detection probe, 9 formatting pairs incl. my U+00AD / U+200E cases | **0 under-detections** |
| R6 | Schema probe: the 8 REV-033 divergence classes | **8 of 8 now rejected** |
| R7 | Schema probe: 7 new divergence classes hunting a ninth | **1 real gap + 6 low-impact** |
| R8 | End-to-end proof of the ninth gap against real MySQL | **5 simultaneous defaults inserted** |
| R9 | AAD injectivity: old M-1 collision + 196-pair brute force | **fixed, 0 collisions** |
| R10 | 3 new mutations against the remediated code (N8, N9, N10) | 1 survives (the stated gap) |
| R11 | Ledger, evidence, trigger-privilege and DB-residue spot-checks | §4 |

Hygiene: every mutation applied alone, reverted immediately, `git status --porcelain` asserted empty
between each and at the end. All probe tables were `DROP`ped; I re-queried afterwards and
`information_schema` shows 0 `bank%probe%` tables, 0 rows in `supplier_bank_accounts`, 0 triggers.
Scratch scripts outside the repo. The real table was never mutated.

---

## 1. The three blocking findings are closed

### H-1 — normalization · CLOSED

`SupplierBankCrypto.js:42-53` now allowlists: `NFKC → toUpperCase → replace(/[^0-9A-Z]/gu, "")`.

R5, the exact probe that produced REV-033 H-1 — every pair must share one blind index:

```
"1234-5678"   vs "1234 5678"  yes      "1234­5678" vs "12345678"  yes   (invisible, was a bypass)
"1234.5678"   vs "1234/5678"  yes      "1234‎5678" vs "12345678"  yes   (invisible, was a bypass)
"gb29abcd"    vs "GB29ABCD"   yes      "1234‐5678" vs "12345678"  yes
"１..."   vs "1234"       yes      "1234‒5678" vs "12345678"  yes
"  1234 5678  " vs "12345678" yes
under-detections: 0
```

All ten of the original bypasses are gone, and the two invisible ones — the sharp end of the original
finding — collapse correctly. The test asserts a 23-character negative set rather than the two cases
that already worked, which is the right shape. Routing this to the Product Owner instead of picking a
character contract unilaterally was the correct call: design §4 genuinely does not define one, and
HD-028's `answer_ref` records the reasoning (IBAN is specified as `[0-9A-Z]`, domestic numbers are
digits, a blocklist's problem is not which ten it misses today).

Idempotence checked separately and it matters for the future reindex script: across all 128,992
scanned codepoints there are **zero** cases where `normalize(normalize(x)) !== normalize(x)`.

### H-2 — schema compatibility assertion · CLOSED

`0037_create_supplier_bank_accounts.js:18-202` now reads a full `COLUMN_CONTRACT` — `column_type`
(which pins type, length and unsigned in one field), nullability, default and collation for all 26
columns — plus the `default_slot` generation expression, all three UNIQUEs for uniqueness and covered
columns, every FK's referenced table and delete rule, and `information_schema.triggers`.

R6, re-running the eight tables REV-033 built:

| Class | REV-033 | REV-034 |
| --- | --- | --- |
| G1 `default_slot AS (NULL)` | accepted | **rejected** — expression check |
| G2 `default_slot AS (1)` | accepted | **rejected** |
| G3 `uq_..._crypto_context` → plain `KEY` | accepted | **rejected** |
| G4 IV / tag / blind index NULLable | accepted | **rejected** |
| G5 `last_four` → `varchar(190)` | accepted | **rejected** |
| G6 `status` → `utf8mb4_general_ci` | accepted | **rejected** |
| G7 `account_length` → `tinyint unsigned` | accepted | **rejected** |
| G8 `crypto_context` → `varchar(255)` | accepted | **rejected** |

Using `COLUMN_TYPE` rather than `DATA_TYPE` plus length is the right choice and is what catches G7.
L-5 is folded in correctly: the FK query now selects `referenced_table_name` and `delete_rule`.

### H-3 — the writer is now tested · CLOSED

R3, both mutations re-applied to `SupplierBankCrypto.js:184-185`:

```
M1  lastFour: normalized.slice(-4)                  -> 337/338, ✖ "the writer, not just the renderer,
M6  accountLength: String(accountNumber).length     -> 337/338,    respects the short-account boundary"
M7  createHash("sha256").update(key).update(acct)   -> 337/338, ✖ "the blind index is keyed, not a
                                                                   plain digest of the account"
```

One test kills both writer mutations because it asserts `accountLength`, `lastFour` and
`maskBankAccount` together across the 1/4/5/8/12-character boundary, formatted and unformatted. M7
dies on the M-4 fix, which now pins the HMAC construction directly instead of only excluding an
unkeyed digest.

### The other REV-033 findings

M-1 verified by R9 — `additionalData` (lines 94-116) encodes both identities UTF-16LE with byte-length
prefixes. The original cross-identity decrypt is refused, and a brute force over 196 identity pairs
built from delimiters, NULs, `|ctx:`, `sup:` and lone surrogates produced 0 collisions. The author is
right that my suggested fix would not have closed it: byte-length prefixing alone does not help,
because UTF-8 maps every lone surrogate to the same three bytes, so both sides carry length 3.
UTF-16LE is a bijection on JS strings and is the correct fix. Good catch on their part.

M-2 (`keyBuffer` validates 32 bytes at the one point both rings converge — the right place), M-3
(setup moved inside the `try`), M-5 (all four evidence runs re-recorded on `3edfd7a`, the final code
commit), M-6 (512 bound on the *normalized* length — R4 confirms 512 accepted at exactly 512
ciphertext bytes, 513 refused, and an NFKC expansion to 600 refused), L-1 through L-4: all verified.
L-6 does not apply and I confirmed it: `git merge-base --is-ancestor 5d390d2 HEAD` succeeds.

---

## 2. New findings (M)

### M-1 — Ninth schema gap: the expression comparison lowercases the string literal, reopening G1

**Location:** `server/database/migrations/0037_create_supplier_bank_accounts.js:72-78`

```js
function normalizeExpression(value) {
  return String(value ?? "")
    .replace(/\\'/gu, "'").replace(/_[a-z0-9]+'/gu, "'").replace(/[`\s]/gu, "")
    .toLowerCase();                                    // <- also lowercases 'ACTIVE' -> 'active'
}
```

`status` is `ascii_bin`, which is case-sensitive — the migration's own comment says so and calls it
load-bearing. But `normalizeExpression` lowercases the whole expression including the quoted literal,
so a `default_slot` defined as `... AND status = 'ACTIVE' ...` compares equal to the documented
expression. Under `ascii_bin` that predicate never matches the `'active'` the column defaults to and
the application writes, so the slot is permanently NULL and `UNIQUE(supplier_id, default_slot)`
enforces nothing. This is exactly G1, reached through a one-character difference.

**Proof of concept.** CONFIRMED (R8), real MySQL, a probe table identical to the live one except for
that literal's case:

```
1. compatibility assertion: reached the FK check -> every column/index/expression check passed
2. five rows, all is_default = 1, status = 'active', same supplier:
   rows inserted: 5/5   non-NULL default_slot values: 0
   *** UNLIMITED DEFAULTS: UNIQUE(supplier_id, default_slot) enforces nothing ***
```

**Why it is M and not H.** The door is far narrower than what REV-033 found. The eight original
classes included things a careless hand-edit or a half-applied migration actually produces — a plain
`NULL` expression, a NULLable column, a name-only unique. A generated expression that differs *only*
in the case of a string literal is something you have to type deliberately; no tool emits it. The
realistic threat model for this check — a differently-shaped table arriving from the renumbering
hazard §0 flags — produces either the right expression or an obviously different one, both of which
are now caught.

**Recommendation.** Do not simply drop `.toLowerCase()` — I checked (R10/N10) and it is load-bearing:
`information_schema` emits `NULL` uppercase and `_utf8mb4\'active\'`, and removing it fails two tests.
Lowercase everything outside quoted literals instead:

```js
.replace(/'[^']*'|[A-Z]+/gu, (m) => (m.startsWith("'") ? m : m.toLowerCase()));
```

Then add the `'ACTIVE'` case to the probe suite — it slots in beside the G1 probe that is already
there.

### M-2 — The normalizer silently strips disallowed characters instead of rejecting them, so a malformed account becomes a different valid account

**Location:** `server/src/modules/supplier/SupplierBankCrypto.js:42-64`

HD-028's `answer_ref` specifies what to *keep* — "NFKC, uppercase, keep only [0-9A-Z], reject when the
result is empty or exceeds the bound". It does not say what to do with a disallowed character that
appears in the middle of an otherwise plausible account. The implementation drops it silently. That
has two consequences, both CONFIRMED (R4, 128,992 codepoints scanned; R5 end-to-end through
`encryptAccountNumber`).

**Silent deletion.** A non-ASCII letter inside an account is removed and the shortened result is
accepted as a valid account — encrypted, indexed, masked, with no error:

```
typed "ÅB12345"   -> stored "B12345"    len=6  mask=**2345
typed "ÄB12345"   -> stored "B12345"    len=6  mask=**2345
typed "B12345"    -> stored "B12345"    len=6  mask=**2345
typed "NØR12345"  -> stored "NR12345"   len=7  mask=***2345
typed "CZČ1234"   -> stored "CZ1234"    len=6  mask=**1234

  "ÅB12345" vs "ÄB12345" share one blind index: true
  "ÅB12345" vs "B12345"  share one blind index: true
```

Three genuinely different typed strings become one stored account. In a supplier-payment system the
stored value is the one that eventually gets paid, so this is a wrong-payee path, not just a
duplicate-detection quirk.

**Content injection.** The allowlist is applied *after* NFKC, so NFKC gets to add characters into the
allowed set. 1,481 non-alphanumeric codepoints produce alphanumeric output, and 46 produce **pure
digits**:

```
typed "½"      -> stored "12"      accepted as a valid account
typed "¼"      -> stored "14"      accepted as a valid account
typed "1234½"  -> stored "123412"  accepted as a valid account
typed "⅓456"   -> stored "13456"   accepted as a valid account
```

**Why it is M.** A real IBAN is `[0-9A-Z]` by ISO 13616 and domestic account numbers are digits, so
any input that triggers this is already invalid — and T33 will add business format validation, which
is where a format *rule* belongs. But rejecting input the normalizer cannot faithfully represent is
not a business rule, it belongs with the normalizer, and the module has no callers yet so the cost is
zero today.

**Recommendation.** One line in `requireAccount` (line 55), keeping the PO's allowlist exactly as
answered and only changing what happens to the rest:

```js
const normalized = normalizeBankAccountNumber(value);
if (normalized !== String(value ?? "").normalize("NFKC").toUpperCase()) {
  throw new TypeError(`Supplier bank crypto cannot ${what} an account number with non-alphanumeric characters`);
}
```

This is a change to what HD-028 decided in spirit, so it is worth one line back to the Product
Owner rather than an author decision — the same routing that made H-1 come out well.

---

## 3. Minor findings (L)

- **L-1 — the mask now fails open rather than throwing.** `SupplierBankCrypto.js:80`. The L-1 fix
  replaced a `RangeError` with `Math.max(0, …)` and `suffix.slice(-length)`. On an inconsistent row
  the result is now **unmasked**: `maskBankAccount({ lastFour: "123456", accountLength: 5 })` returns
  `"23456"` — five characters, zero stars — and the new test pins that value under the name "the read
  paths fail safe rather than throwing or passing on bad input". Fail-safe for a masking function is
  masking *more*, not less. Unreachable in practice (`last_four` is `varchar(4)`, now enforced), so L
  — but the name and the assertion disagree, which is the shape this module keeps catching. Fix:
  `if (suffix.length >= length) return "*".repeat(length);`
- **L-2 — non-unique indexes and PRIMARY are still name-only.** CONFIRMED (R7): `KEY
  idx_supplier_bank_lookup (id)` and `KEY idx_supplier_bank_owner_status (id)` and `PRIMARY KEY (id,
  supplier_id)` are all accepted. No correctness guarantee is lost — the three UNIQUEs carry those —
  but `idx_supplier_bank_lookup` is the index behind §5.8's cross-supplier duplicate *warning*, so a
  wrong one turns that into a table scan. The `UNIQUE_INDEXES` loop already does exactly this check;
  extending it to the two `KEY`s is a two-line change.
- **L-3 — `VIRTUAL` is accepted where design §5.8 says generated *stored*.** CONFIRMED (R7/N2). MySQL
  enforces a UNIQUE on a virtual generated column, so the one-default guarantee survives; this is
  contract drift, not a hole. `EXTRA` already distinguishes them (`STORED GENERATED` vs `VIRTUAL
  GENERATED`) so the fix is to tighten the existing `includes("GENERATED")` at line 134.
- **L-4 — CHECK constraints are not read.** CONFIRMED (R7/N7): a table carrying `CHECK
  (account_length < 0)`, which rejects every write, is accepted. Design §5.14's list does not name
  CHECK constraints and the failure is loud at write time rather than silent, so this is genuinely
  minor — noting it because the assertion now claims to cover the §5.14 contract.
- **L-5 — the trigger check has no test, and I agree with stating it rather than faking it.**
  Quantified (R10/N8): deleting the trigger check outright leaves **338/338 green**, so the stated gap
  is exactly as wide as claimed. I verified the cause rather than taking it on trust — `erp_user` has
  `ALL PRIVILEGES ON erp_dev` but only `USAGE ON *.*`, `log_bin = 1`, and `CREATE TRIGGER` returns
  `ERROR 1419 (HY000): You do not have the SUPER privilege and binary logging is enabled`. The
  author's reasoning — that a test which always takes the skip branch is not coverage and poses as
  coverage — is correct and is the same discipline REV-030 and this task's own S5 applied. So: stating
  it is acceptable. One suggestion rather than an objection: the check is `triggers.length > 0`, and
  the trigger list is the only input. Extracting that one decision, or letting the existing `{ table }`
  seam accept an injected trigger list in tests, gets real coverage of the throw path without any DDL
  privilege. Cheaper than a skip-test and it actually tests something.
- **L-6 — the decrypt `try` now swallows configuration errors as data-integrity errors.**
  `SupplierBankCrypto.js:204-213`. The M-3 fix moved `keyBuffer(secret)` and `additionalData(...)`
  inside the `try`, so a key ring holding a wrong-length key, or a caller omitting `cryptoContext`,
  now reports "the row, its context or its ciphertext was altered". Fail-closed and uniform, which was
  the point — but during a key rotation that message points an operator at the data when the problem
  is the configuration. The unknown-key-ID branch at line 197 already has a distinct message and is
  not an oracle; a wrong-length key could join it above the `try`.

---

## 4. Spot-checks of §6 and the ledger

Verified as stated:

- **338/338** server (R1), up from 332, and `lint` PASS (R2).
- **Evidence**: all four `run.json` files record `code_commit: 3edfd7ae…`, the final code commit.
  `dda9a40` is documentation only, so the evidence covers the merge candidate. REV-033 M-5 is
  properly closed — this is the thing that was stale last time and is not stale now.
- **Ledger revision 149.** `REV-033` recorded with `status: CHANGES_REQUESTED`, `open_critical: 0`,
  `open_high: 3`, `method: SEPARATE_AGENT`, pointing at `31_rev_033_independent_review.md`. Accurate.
- **HD-028** is in `pending_decisions` with `status: ANSWERED`, `impact: MAJOR`, and an `answer_ref`
  recording the PO's choice and reasoning. There is no separate `APPROVAL-HD-028-*` entry, and that is
  correct rather than an omission: HD-027 needed one because it authorised writing to
  `server/database/migrations/**`, an approval-required path, whereas HD-028 changes
  `SupplierBankCrypto.js`, which is in `allowed_write_paths`. Consistent with how HD-023 through
  HD-026 are recorded.
- **L-6 claim**: `git merge-base --is-ancestor 5d390d2 HEAD` succeeds. True.
- **DB residue**: 0 probe tables matching `bank%probe%`, 0 rows in `supplier_bank_accounts`, 0
  triggers on the real table. True.
- **The trigger-privilege claim**: reproduced verbatim (L-5 above). True.

One correction to §6, minor and not a finding in the code: the table row for M-1 says the AAD problem
was that "UTF-8, lone surrogates collide", and the fix row says UTF-16LE. Both accurate. But §6's
framing of REV-033 as having found "三個變異存活" alongside "8 張歪表" slightly undercounts — the
schema probe found eight *accepted divergence classes*, not eight mutations, and the review also
carried six M and six L. The remediation table below it does list all of them, so the record as a
whole is complete; only the summary sentence compresses.

---

## 5. Attacks that failed

**Under-detection.** I could not construct any pair of renderings of the same account that produce
different blind indexes (R5, 9 pairs including both original invisible-character bypasses). This is
the property H-1 was about and it now holds.

**AAD ambiguity after the UTF-16LE change** (R9). The encoding is `sup:` + byte-length + `:` +
UTF-16LE bytes + `|ctx:` + byte-length + `:` + UTF-16LE bytes. It is injective: the length digits are
terminated by a `:` that cannot appear inside a decimal, so the first boundary is exact; the byte
count is exact, so the second is too; and UTF-16LE is a bijection on JS strings, unlike UTF-8. A brute
force over 196 identity pairs built from `|`, `:`, `|ctx:`, `sup:`, U+0000, `\uD800`, `\uDC00`,
`�` and CJK found 0 collisions, and REV-033's demonstrated cross-identity decrypt is now refused.

**The 512 bound** (R4). Checked against the actual column: 512 normalized characters produce exactly
512 ciphertext bytes and are accepted; 513 is refused; an input of 200 `U+33A0` characters, which NFKC
expands threefold to 600, is refused *after* expansion. The bound is applied to the normalized length,
which is the correct side, and the comment's reasoning about GCM being a stream mode so ciphertext
length equals plaintext byte count is right.

**Nine more schema divergences** (R7). Beyond M-1 and L-2/L-3/L-4 I tried an unexpected extra index
and a shuffled PRIMARY; the extra index is accepted, which I think is correct — an assertion that
forbids additional indexes would break on any future performance work and buys nothing, since none of
the guarantees depend on an index being absent.

**Mutations against the remediated code** (R10). The length bound is pinned (`>` → `>=` kills a test).
`normalizeExpression`'s `toLowerCase` is pinned (removing it kills two). Only the trigger check
survives deletion, which is the stated gap and nothing more.

**Leak surface.** Not re-run in full — the private-field mechanism REV-033 identified as load-bearing
is unchanged, the two redaction members are unchanged, and no new field or accessor was added to the
class. The `keyBuffer` error message reports only the expected byte count, not the actual key or its
length.

---

## 6. Verdict

**APPROVED** at head `dda9a4030c12c3eb105f01b0ee0314951fa68580`.

H-1, H-2 and H-3 are closed, each verified by re-running the probe that found it rather than by
reading the diff: 0 under-detections where there were 10 bypasses, 8 of 8 divergence classes now
rejected where 8 of 8 were accepted, and all three previously surviving mutations now red. M-1 through
M-6 and L-1 through L-6 from REV-033 are all addressed, and the two I was most likely to see fudged —
the evidence pinning (M-5) and the AAD encoding (M-1) — were both done properly, the latter with a
better fix than the one I suggested.

Two new M findings carry forward and neither blocks. **M-1** is a real residual of the H-2 fix and
reopens the same guarantee, but through a door narrow enough that no realistic accident produces it,
and the fix is one regex. **M-2** is a wrong-payee footgun in the normalizer that only triggers on
input which is already invalid under IBAN and domestic account formats, and which has no production
callers until T33. Both should be dispositioned before T33 wires the write API — M-2 in particular is
worth one line back to the Product Owner, since HD-028 answered which characters are kept and was
never asked what happens to the rest.

The stated trigger-check gap is acceptable as stated. I verified the privilege claim rather than
accepting it, and the reasoning for not writing a skip-branch test is correct — a test that always
skips is the exact failure mode this module has now caught three times. L-5 offers a cheaper way to
get real coverage if it is wanted.

**Reviewed by:** REV-034 independent reviewer
**Head:** `dda9a4030c12c3eb105f01b0ee0314951fa68580`
**Worktree state at end of review:** clean apart from this file
