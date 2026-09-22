# REV-036 — Independent re-review of TASK-033 (Bank domain service)

**Reviewer:** independent agent (not the author) · **Task:** TASK-033 / T33 · **Phase:** PHASE-003
**Branch:** `claude/supplier-task-033` · **Head reviewed:** `aebb6cc5b836acb5203acb633cd19e36caaada87`
**PR:** https://github.com/crazysumsum/erp-app/pull/118 · **Predecessor:** REV-035 (CHANGES_REQUESTED at `8718fa7`)
**Verdict:** **CHANGES_REQUESTED** — 1 High, 3 Medium, 5 Note.

Baseline at head: **56 tests, 56 pass, 0 fail** (up from 51). `npm run lint` passes. Every mutation
was applied alone and reverted, with `git status --porcelain` asserted clean after each; probe
scripts lived outside the repo. The only file this review adds is itself.

**Summary:** REV-035's H-1 is fixed, H-2 is fixed and I verified it more broadly than the author did,
and H-3 is **half** fixed. The deterministic half is genuinely closed. The race half ships a
translation that **never executes in production** — and the reason it was not caught is the same
reason H-1 was not caught the first time: the test fake does not reproduce the real wrapper. It now
reproduces one layer of it. The lie moved down a layer rather than going away.

---

## 1. What I ran

| # | What | Result |
| --- | --- | --- |
| Baseline | three bank suites, integration on | 56/56 PASS |
| Lint | `npm run lint` | PASS |
| Sweep | **full** Unicode U+0080–U+10FFFF through `normalizeBankAccountNumber` | 1 non-fullwidth fold |
| Sweep | 36 ASCII bases × 112 combining marks, NFC composition | 0 accepted |
| Probe 1 | disallowed char, and missing account, through the real wrapper | 400 both ✔ |
| Probe 2 | create → deactivate → re-add | 409 ✔ |
| Probe 3 | two concurrent same-Supplier creates, production `authorize` | **500** ✘ |
| Probe 4 | reveal of a tampered row, and of a key-missing row | 422 ✔, log miswired |
| Probe 5 | `update` an account onto one an inactive row holds | 409 ✔ |
| Probe 6 | two concurrent `create(isDefault:true)` | 1 slot, both created |
| R-M2 | restore the `status` filter (was SURVIVING in REV-035) | **RED**, 9 fail ✔ |
| R-M4 | projection drops the short-account rule (was SURVIVING) | **RED**, 2 fail ✔ |
| R-M6 | restore unbounded `toUpperCase` | RED, 1 fail ✔ |
| R-M5 | make `#translatingDuplicates` **correct** for production | **56/56 GREEN — SURVIVING** |

---

## 2. Findings

### H-1 — The `ER_DUP_ENTRY` translation never fires in production, and both fakes hide it

**Location:** `server/src/modules/supplier/SupplierBankService.js:237-250` (`#translatingDuplicates`),
wrapping the INSERT at `:308`. Wrapper at
`server/src/services/mysqldatabase/MySqlDatabaseService.js:211-223`.

```js
if (error?.code === "ER_DUP_ENTRY" && String(error.message).includes("uq_supplier_bank_blind_index")) {
```

In production the `connection` handed to the transaction body is a `MySqlDatabaseExecutor`, and its
`run()` wraps **every** statement error:

```js
throw new MySqlDatabaseOperationError(`MySQL database ${method} failed`,
  { code: "DATABASE_OPERATION_FAILED", cause: error });
```

So `error.code` is `"DATABASE_OPERATION_FAILED"`. The driver's code lives on `error.cause.code`. The
guard is false, `#translatingDuplicates` rethrows, the outer `withTransaction` catch wraps again, and
the caller gets the same 500 REV-035 reported. Two concurrent same-Supplier creates with production's
`assertActorFresh` (probe 3, CONFIRMED):

```
conn0: CREATED
conn1: REJECTED { code: "DATABASE_OPERATION_FAILED", publicCode: "INTERNAL_SERVER_ERROR", status: 500,
                  causeCode: "ER_DUP_ENTRY",
                  causeMsg: "Duplicate entry '12553-look-1-\xE2\x13l\xFD\xD9\x8B&9~\xF8…'" }
```

The blind index bytes are still in the error chain, which was REV-035's secondary exposure.

**Why the suite cannot see it — this is the diagnostic.** Mutation **R-M5** makes the guard *correct*
for production:

```diff
-      if (error?.code === "ER_DUP_ENTRY" && …
+      if ((error?.code ?? error?.cause?.code) === "ER_DUP_ENTRY" && …
```
```
ℹ tests 56   ℹ pass 56   ℹ fail 0
```

**SURVIVING.** The tests are identical against the broken implementation and the correct one, because
neither fake ever delivers an error in production's shape:

- unit harness, `server/test/supplierBankService.test.js:61-65` — throws a **raw** `Error` with
  `code: "ER_DUP_ENTRY"`. Production's executor never hands raw driver errors to service code.
- integration, `server/test/integration/supplierBank.integration.test.js:44-57` — `serviceOn` passes a
  **raw `mysql2` connection** as `connection`, so it applies no wrapping either, and its
  `withTransaction` does not even reproduce the outer ApplicationError translation.

To be fair to the remediation: the unit fake's new outer layer (`:76-88`) **is** faithful — I checked
it against `MySqlDatabaseService.js:513-560` and the ApplicationError passthrough / rethrow-as-500
behaviour matches. That layer is what made H-1's fix real. The remaining lie is one layer down, at
the per-statement executor, and `#translatingDuplicates` is the only place service code inspects a
database error — so the blast radius is exactly this finding, no wider.

**Fix (two lines, plus the fake):**

```js
const driverCode = error?.code === "ER_DUP_ENTRY" ? error.code : error?.cause?.code;
const driverMessage = String(error?.cause?.sqlMessage ?? error?.cause?.message ?? error?.message ?? "");
if (driverCode === "ER_DUP_ENTRY" && /for key '(?:[^']*\.)?uq_supplier_bank_blind_index'/u.test(driverMessage)) { … }
```

and make the unit fake's `execute` wrap what it throws the way `MySqlDatabaseExecutor.run` does, so a
test can tell the two shapes apart. Without that, R-M5 stays green and the next regression is
invisible again.

---

### M-1 — `logger.warn` is called with the wrong arity, so the evidence the 422 exists for lands in the message slot

**Location:** `server/src/modules/supplier/SupplierBankService.js:538`;
signature at `server/src/services/logging/systemLogger.js:49` — `warn(event, message, context)`.

```js
this.logger?.warn?.("supplier.bank.reveal.unreadable", { bankAccountId, supplierId, reason });
```

Two arguments. The structured payload is passed as `message`; `context` is `undefined`. CONFIRMED
(probe 4): `argc=2`, object in position 2, both times.

The whole justification for `BANK_ACCOUNT_UNREADABLE` — recorded in `supplierErrors.js:33-40` and in
the author's §7 — is that a tampered row and a key missing from the ring need completely different
responses and *must be distinguishable in the log*. The two `reason` strings do differ:

```
"…failed authentication: the row, its context or its ciphertext was altered"
"…cannot be decrypted: its encryption key is not in the configured ring"
```

so the information is produced. It is just wired into the field a sink will render as the human
message, with the structured context empty. A pipeline that indexes `context` will index none of
`bankAccountId`, `supplierId` or `reason`. This is the only `logger` call in the supplier module, so
there is no local convention to check it against — every other call in the codebase
(`MySqlDatabaseService.js:206`, `:524`) passes three.

**Fix:**

```js
this.logger?.warn?.("supplier.bank.reveal.unreadable",
  "Supplier bank account could not be decrypted",
  { bankAccountId: Number(row.id), supplierId: Number(row.supplier_id), reason: error?.message ?? "unknown" });
```

No test asserts on the log at all, which is the second half of this: add one that pins the three-argument
shape and that the two failures produce different `reason` values. Otherwise the property the 422 was
created to deliver has no check behind it.

---

### M-2 — `#translatingDuplicates` wraps only `create`'s INSERT

**Location:** `SupplierBankService.js:308` is the sole wrap site.

`update`'s UPDATE (`:405`) can violate `uq_supplier_bank_blind_index`, and `setDefault`'s two UPDATEs
can violate `uq_supplier_bank_default`. Neither is wrapped. So even once H-1 is fixed, an `update`
that loses the same race stays a 500.

The deterministic `update` case is correctly 409 today (probe 5: changing an account onto one an
inactive row of the same Supplier holds → `BANK_ACCOUNT_DUPLICATE / 409`), because the pre-check now
sees inactive rows. But the pre-check is precisely the thing that loses races — that is why the
translation exists — so leaving `update` outside it reproduces the asymmetry on the one path where it
still matters.

**Fix.** Wrap `update`'s UPDATE too, or hoist the translation to the whole `withTransaction` callback
in `create`, `update` and `setDefault`.

---

### M-3 — Pattern-matching the driver's prose is the wrong discriminator

You asked directly whether the message format is something we should be matching at all. No.

`String(error.message).includes("uq_supplier_bank_blind_index")` searches the **entire** message, and
the message's first component is the duplicated *value*:

```
Duplicate entry '12553-look-1-\xE2\x13l\xFD\xD9\x8B&9~\xF8…' for key 'supplier_bank_accounts.uq_supplier_bank_blind_index'
```

Two problems. The format is version-dependent — MySQL 5.7 emits `for key 'uq_…'`, 8.0 emits
`for key 'table.uq_…'` — which a bare `includes` happens to survive, so that half is benign today and
will not stay benign. The substring is also matched across the value, so a duplicated value containing
the other index's name selects the wrong branch. With a 32-byte HMAC the odds are negligible; the
construction is still unsound, and it is scanning bytes derived from user-supplied input to decide a
control-flow branch.

**Fix.** Discriminate on the structured fields the driver already provides — `errno === 1062` and
`sqlMessage` — and anchor the index name to the key position:
`/for key '(?:[^']*\.)?uq_supplier_bank_blind_index'/u`. Better still, note that `create`'s INSERT can
only violate two known constraints, so the statement's own context, not prose parsing, should pick
the message.

---

## 3. What is fixed, verified

### H-1 of REV-035 (validation reached the caller as a 500) — **FIXED**

`assertAccountNumber` runs inside `normalizeBankInput`, which is the first statement of `create` and
`update`, before the transaction opens. Through the **real** `MySqlDatabaseService.withTransaction`
(probe 1, CONFIRMED):

```
"ÅB12345"      -> ApplicationError BANK_ACCOUNT_INVALID / 400 / "銀行帳號只接受數字同英文字母…"
(no accountNumber) -> ApplicationError BANK_ACCOUNT_INVALID / 400 / "請填寫銀行帳號"
```

No echo of the input in `message`, `details` or `cause`. The layering is right: `requireAccount` keeps
throwing a `TypeError` for callers who reach the crypto directly, and because `assertAccountNumber`
uses the same predicate it is now unreachable from the service — a backstop rather than a duplicate rule.

### H-2 of REV-035 (NFKC laundering) — **FIXED**, and your question about a third path: **no**

I swept the **full** Unicode range, U+0080–U+10FFFF, not the U+0080–U+1FFFF the author reports.
Excluding the three intended fullwidth ASCII ranges, exactly **one** codepoint still folds into an
accepted value:

```
A) non-fullwidth codepoints that end up as ACCEPTED [0-9A-Z]: 1
   U+212A "K" -> "K"
```

**The author's argument for U+212A is correct.** NFC maps KELVIN SIGN to U+004B because Unicode
defines them as the same character by canonical equivalence — not a compatibility approximation. The
failure mode HD-029 exists to prevent is two *different* characters becoming one account; here it is
one character with two encodings, and refusing it would turn one account into two. This is the
behaviour you want. U+0387 GREEK ANO TELEIA does not appear in this bucket at all — it composes to
U+00B7 MIDDLE DOT, which the formatting set strips, so it is in the strip bucket, which is the
sanctioned half of HD-029.

Every REV-035 regression now rejects, and the design's own example still works:

```
"12²345"  UNREPRESENTABLE      "ᴮ12345"  UNREPRESENTABLE      "ß12345"  UNREPRESENTABLE
"1②345"   UNREPRESENTABLE      "Ⓑ12345"  UNREPRESENTABLE      "ÅB12345" UNREPRESENTABLE
"½" "⅓"   UNREPRESENTABLE      "ıB12345" UNREPRESENTABLE      "ﬁB12345" UNREPRESENTABLE
"１２３456789" -> "123456789"    "123-456789-001" -> "123456789001"
```

**I looked for a third path and did not find one.** Three directions, all negative:

1. **Sequences, not just single codepoints.** 36 ASCII bases × 112 combining marks (U+0300–U+036F)
   through NFC: **0** accepted. Canonical composition cannot manufacture an allowed character from a
   rejected sequence.
2. **Codepoints that vanish entirely** — 218 of them normalize into something `FORMATTING` strips. I
   checked the list: every one is `\s`, `\p{Cf}`, `\p{Pd}`, or a member of the explicit separator set
   (NBSP, SHY, the Arabic number signs, the bidi controls, the invisible math operators U+2061–U+2064,
   the dash block, U+2212, U+3000, U+301C). None carries account content. This is the strip half doing
   its stated job, not a laundering path.
3. **Order of operations.** NFC → fullwidth fold → ASCII-only uppercase → strip. Nothing composes into
   a fullwidth form, stripping cannot create characters, and the `[a-z]` narrowing correctly leaves
   `ı` (U+0131) alone where `String.prototype.toUpperCase` would have turned it into `I`.

The `toUpperCase` → `ß`/`SS` path the author found while fixing this is a genuine second hole and I
missed it in REV-035. The narrowing to `[a-z]` closes it and is pinned — mutation R-M6 (restore
unbounded `toUpperCase`) goes RED.

**The record correction is right and I want it noted.** The `½ → 12` example was wrong in the code
comment, the implementation report and HD-029's question text in the ledger; the author has corrected
all three and stated plainly that the Product Owner was shown an example that does not reproduce while
the class that does leak was never put to them. That is the right way to handle it.

### H-3 of REV-035 — **half fixed**

The `status` filter is gone from `#duplicates` (`:209-214`), and the service now agrees with
`uq_supplier_bank_blind_index`. The deterministic half is closed on both write paths:

- create → deactivate → re-add: `BANK_ACCOUNT_DUPLICATE / 409` (probe 2)
- `update` onto an account an inactive row holds: `BANK_ACCOUNT_DUPLICATE / 409` (probe 5)

**R-M2 re-run** (restore the filter): **RED, 9 failures** — previously surviving, now well pinned.

The race half is H-1 above.

### M-1, M-2, M-4 of REV-035 — **FIXED**

- `list` (`:262-266`) now asserts `supplier.view`, correctly not `bank.view` per AC-023, and it fires
  after `authorize` but before the supplier lookup, so it is not an enumeration oracle.
- `maskBankAccount` is gone from `server/` and `client/` (only historical comments mention it), and the
  short-account rule is tested where it is used. **R-M4 re-run**: **RED, 2 failures** — previously
  surviving.
- The scanner's control now plants into `account_ciphertext` as well as a text column, so the binary
  branch the acceptance depends on is exercised by the control rather than only by my probe.

### The REV-035 L findings — **FIXED**

403 via `supplierForbidden` (`supplierErrors.js:27-30`) with a comment that states the reason a 409 was
wrong; `supplierChildNotFound("bank")` with a `bank` label, so no code with a space; `references`
removed from the constructor.

---

## 4. M-3 of REV-035, deliberately not fixed — **I accept the reasoning**

You asked whether it is wrong. It is not. A cross-Supplier duplicate warning is advisory by
construction: the unique index is per-Supplier, so two creates under different Suppliers contend on
nothing, and the only way to make the warning reliable is a `FOR SHARE` next-key lock on
`idx_supplier_bank_lookup` — new contention on a hot index and a new deadlock surface to re-analyse
against §2.6, bought for a signal that is a prompt for human judgement, not a control. Accepting the
gap is the better trade.

One condition, and it is a documentation condition rather than a code one: nothing downstream may be
built as if the warning were a guarantee. §6.6's current wording describes what the warning may
*contain*, not that it always fires, so the design text is fine as it stands. The ledger entry
recording the decision is the right place for it and it is there.

Your carry of the `reveal` L findings (`expiresInSeconds`, `revealedAt` sampled after commit) to the
route task is correct — they are §6.6's HTTP contract and T33 ships no routes. They should stay open
against that task rather than be closed here.

---

## 5. Notes

- **N-1** `BANK_ACCOUNT_DEFAULT_RACE` appears unreachable. Two concurrent `create(isDefault: true)`
  both succeed with exactly one slot taken (probe 6) — the `suppliers FOR UPDATE` serialises them and
  the loser's clear-UPDATE frees the slot before its INSERT. Defensive rather than wrong, but the
  comment implies a race it guards; say it is a backstop.
- **N-2** `BANK_PERMISSION_LOST` is now also the code for `list`'s `supplier.view` failure
  (`SupplierBankService.js:265`). Neither "BANK" nor "LOST" describes a caller who never held
  `supplier.view`. Cosmetic; the 403 and the message are right.
- **N-3** The author's sweep bound was U+0080–U+1FFFF. Mine ran to U+10FFFF and agrees, so the
  conclusion holds — but the narrower bound does not establish it, and the documented evidence range
  should be the full one.
- **N-4** My REV-035 sweep counted 1265 NFKC-laundered codepoints, the author's 1225. Different
  counting rules over the same phenomenon; immaterial to either conclusion.
- **N-5** Ledger: revision 156, `baseline.code_commit` is `9000bd5` (pre-merge) while CI run
  35557165644 and this review are at `aebb6cc`. I verified the supplier source is **byte-identical**
  between them — `git diff 9000bd5 aebb6cc -- server/src/modules/supplier server/test/supplierBank*`
  is empty, and the merge carried only `docs/` and evidence — so the record carries meaning. It should
  say so rather than leave the next reader to check. DEF-021's closure evidence now cites `REV-035 H-2`
  and, per the sweep above, the closure now holds.

**Scope.** Six source/test files changed against `main`, all inside
`00_module_manifest.json` → `scope.allowed_write_paths`. No migration, no
`approval_required_paths` entry, `00_project_profile.json` untouched.

---

## 6. Attacks that failed

1. **A third laundering path.** Full-range single-codepoint sweep, combining-sequence sweep, and an
   order-of-operations analysis. None found. Detailed above.
2. **A decryption oracle in the new 422.** Both the tampered row and the key-missing row produce an
   identical `BANK_ACCOUNT_UNREADABLE` / 422 with an identical public message (probe 4). The
   distinction exists only in the internal log line. No ciphertext, no key id, no `details` — nothing
   a caller can use to classify a row they cannot already classify.
3. **Plaintext in the new rejection path.** `ACCOUNT_REJECTION_MESSAGES` are three static strings and
   `details` is `{ field: "accountNumber" }`. Probe 1 confirms no echo anywhere in the thrown error,
   including `cause`.
4. **An unvalidated `update` account.** `normalizeBankInput(input, { accountNumberRequired: false })`
   validates whenever `accountNumber` is present, using the same predicate as `changingAccount`, so
   there is no arm where a value is encrypted without having been classified.
5. **Injection through the widened `#duplicates`.** Removing `AND b.status = ?` left the parameter
   array as bare `indexes`, and the placeholder count still derives from it. Verified the two stay in
   step; the fragment is still fully parameterized.
6. **A leak through `list`'s new check ordering.** `#assertMay` fires before the supplier lookup, so a
   caller without `supplier.view` cannot use `list` to probe which supplier ids exist.
7. **The `#translatingDuplicates` catch swallowing an ApplicationError.** It rethrows anything that is
   not a matching `ER_DUP_ENTRY`, and the pre-check's own 409 is thrown outside it. No path where a
   duplicate becomes a success.

---

## 7. Verdict

**CHANGES_REQUESTED** — 0 Critical, **1 High**, 3 Medium, 5 Note.

The remediation is substantially right. H-1 and H-2 are properly closed, and H-2 is closed for the
right reason — I checked the U+212A argument rather than taking it, and it holds. Both of REV-035's
surviving mutations are now RED. The author found a hole I missed (`toUpperCase` → `SS`) and corrected
a record error against their own interest.

What blocks is narrower than REV-035's H-3 but worse in kind: the race half of that finding ships a
guard that provably never executes, and the suite is green whether the guard is right or wrong. The
user-visible blast radius is one concurrent-duplicate 500 rather than an everyday flow — but a dead
control that everyone believes is live is the failure mode this module's review history keeps
producing, and R-M5 going green is the same shape as the T11 vacuous assertion and as the fake that
hid H-1. The fix is two lines in the guard and a few in the fake. M-1 is the same shape one level
down: the property the new 422 exists to provide has no test and is miswired into the wrong logger
argument.

**Head commit reviewed: `aebb6cc5b836acb5203acb633cd19e36caaada87`.**
Worktree restored and verified clean (`git status --porcelain` empty) after every probe and mutation.
