# REV-057 — DEF-026/027/028 remediation (PR #158), independent review

Reviewer: independent agent (REV-057). I did not write this code. Merge candidate:
b701d284a9accf4d6b9ce6ac16bffbeff1a67935 on `claude/supplier-def-026-027`, base origin/main c83bcac.
I worked in a detached worktree at `/private/tmp/erp-rev-057`, with `node_modules` symlinked from the
def-026-027 worktree. Git ignores the symlink.

## Summary

| | |
| --- | --- |
| Critical | 0 |
| High | 0 |
| Medium | 2 |
| Low | 5 |
| Info | 8 |

Disposition: **CHANGES_REQUESTED**.

The shipped behaviour matches the design and HD-037 on every path I ran:

- **DEF-026.** A key missing from the ring gives 503 `BANK_KEY_UNAVAILABLE`. A GCM integrity failure gives a generic 500. Each logs its own error-level event, and no log or response carries a key id or the account.
- **DEF-027.** The 503 is scoped to the one Supplier and to the ring. It correctly excludes the row being rewritten, and it is correctly unaffected by rename, setDefault and deactivate.
- **Startup check.** It is discovered by the real `src/index.js` and logs without refusing to start.
- **DEF-028.** The mask uses `*`.
- **Ledger.** Revision 239 is honest. Every backfilled value reproduces exactly from git history, and no historical content was lost.

What blocks is the module's recurring pattern, together with one operability gap in the runbook that a
human is about to sign off (HD-036):

- **M-1.** The fix counts deactivated rows in the 503 check, which is the right decision (REV-035 H-3), but no test pins it. Adding `AND status = 'active'` to the new query survives all 108 tests in the nine Bank files.
- **M-2.** The runbook gives two remedies. The first assumes the key can be found again. The second, re-entering the account, fails for an inactive row (409) and for any Supplier with two or more such rows (each blocks the other, 503). The reindex CLI refuses a `--from` key that is not in the ring. So in the most likely real incident, a rotation where the old lookup key was removed before the reindex finished, the Supplier is locked out of Bank writes and no documented procedure recovers it. I found and ran a working recovery; it is undocumented.

### What I ran, and on what

- MySQL on 127.0.0.1:3440, using `env37d.sh`.
- **The seven named Bank files plus projections and crypto:**
  - First run: 80 pass, 1 fail. The failure was TC-071, a pre-existing 1-in-16 flake; see L-5.
  - Second run: **81/81**.
- **The nine-file mutation set** (the above plus `supplierBankKeyRotation.test.js` and `supplierBankRotation.integration.test.js`): **108/108** baseline.
- **Full `npm test` in server, twice:**
  - Run 1: 2244 tests, 2235 pass, 2 fail, 7 skipped.
  - Run 2: 2244 tests, 2236 pass, 1 fail, 7 skipped.
  - Every failure was in the Customer import integration tests: TC-059, plus in run 1 an `ER_LOCK_DEADLOCK` in TC-060..063.
  - Running `customerImportExecution` and `customerImportPrecheck` together fails 3 out of 3 times **at base c83bcac and at b701d28 alike**, and TC-059 alone passes 3 out of 3. This is a pre-existing Customer cross-file race on "claim the next queued job" in the shared schema, and it is unrelated to this PR.
  - The author's 2237 pass / 0 fail total of 2244 matches my test count. I could not reproduce the zero-failure run in this environment.
- **The production entrypoint.** I ran `node --import ./test-support/testEnv.js src/index.js` with `APP_PORT=38457` against `erp_dev`.
  - Health returned 200.
  - The system log recorded `supplier.bank.keys_outside_ring` `{kind:"encryption",rows:2}` and `{kind:"lookup",rows:2}`, with no key id.
- **The startup service against real MySQL** (`.rev057/probe_startup.mjs`), using the real `MySqlDatabaseService`:
  - On an empty schema, where the table is missing, it logs `key_check_failed {reason:"DATABASE_OPERATION_FAILED"}` and does not throw.
  - On `erp_dev` it logs both kinds.
- **A lockout and recovery probe against real MySQL** (`.rev057/probe_lockout.mjs`). See M-2.
- **Playwright:**
  - `npx playwright test --config client/e2e/supplier-management/playwright.config.js supplier-bank` gives 3/3 pass. I confirmed port 5203 was free first, so it ran against this worktree.
  - A throwaway probe spec, deleted afterwards, drove the reveal dialog through a 503 `BANK_KEY_UNAVAILABLE` and a 500 `INTERNAL_SERVER_ERROR` in the real server envelope.
  - Both show the right text (the server's Chinese message; 「系統發生錯誤，請稍後再試」). Neither renders a plaintext node, the session token is kept, and there is no page error beyond Chromium's own "Failed to load resource" line.
- **`state_tool.py inspect`:**
  - At b701d28: only `WORKTREE_CHANGED`, `COMMIT_CHANGED` and `SOURCE_CHANGED`.
  - At c83bcac: `STATE_ERROR` with the schema violations the commit message lists.
- **19 mutants.** I applied each by exact string replacement (asserting a single occurrence), ran it against the nine-file set, and restored it by rewriting the saved original. I verified the restore with `cmp` against a copy in the scratchpad.

### Restoration

- I committed nothing, pushed nothing and commented on nothing.
- All four mutated source files are byte-identical to b701d28, checked with `cmp`.
- The throwaway Playwright spec was deleted. My probe rows (the `R57-%` suppliers) were deleted, and a count confirms 0 remain.
- I removed two scratch worktrees: the base worktree used for the ledger and Customer-race comparison, and the three fingerprint worktrees at fddcc44, 320540a and 654f7c3.
- The review worktree is removed after this report is written.

---

## 1. [MEDIUM] M-1 — nothing tests that deactivated rows count in the 503 check

**Where:** `server/src/modules/supplier/SupplierBankService.js:210-222` (the new `unreadable` query in
`#duplicates`).

The query deliberately has no status predicate. That is correct: REV-035 H-3 made the same-Supplier
duplicate rule include inactive rows, because re-adding a deactivated account must give 409. A row on a lookup key
outside the ring cannot be matched by the `IN` query that follows, and the database's unique index
cannot catch the duplicate either, because it includes `blind_index_key_id`. So the only thing that stops
an inactive out-of-ring row from being silently duplicated is this query also counting inactive rows.

**Mutant M4:** append `AND status = 'active'` to the `NOT IN (…)` clause. **SURVIVED**: 108 pass, 0 fail.
The run covered the unit, projection, crypto, key-rotation and provider suites plus the acceptance,
restore, bank and rotation integration suites.

**Failure scenario:** someone "aligns" this query with `list()`, which does filter on `status = 'active'`.
A Supplier whose deactivated row sits on a retired lookup key can then re-add that same account: the
check says there is nothing unreadable, and the `IN` query cannot match the old index. The result is
DEF-027 again, restricted to deactivated rows. This exact filter has been introduced into this exact
function once before (REV-035 H-3).

**Why the tests cannot see it:** every out-of-ring row the tests plant is active. The unit double answers
`blind_index_key_id NOT IN` with a fixed list and ignores the SQL.

**Recommendation:** add a real-MySQL case to the TC-068 block. Seed a row under `gone-look-*`,
deactivate it (with the app crypto, since deactivate does not touch crypto), then create a different account on the same
Supplier and require 503 `BANK_KEY_UNAVAILABLE`. My probe already does exactly this (§3, first line). Then
rerun M4 and require it to be red.

## 2. [MEDIUM] M-2 — the runbook's repair procedure fails in the common lockout shapes

**Where:**
- `docs/supplier_management/bank_operations.md:80-82` (「修復：把該 key 補回 ring 並重新啟動；或對 lookup key 缺失的列重新輸入帳號…」).
- `docs/supplier_management/testing/04_defect_register.md:32` and `02_technical_test_report.md:235` ("the only such row can be repaired by re-entering its account").
- `server/src/modules/supplier/bankKeyRotation.js:100-105` (`assertSource` refuses a `--from` outside the ring).

**What I ran:** `.rev057/probe_lockout.mjs`. It uses the real `MySqlDatabaseService` on `erp_dev`, the
real `SupplierBankService`, `SupplierBankCrypto` and `runRotation`, rows planted under a random lookup
key `r57-lost-*` that is not in the app ring, and it cleans up afterwards:

```
S1 deactivate lost-key row: inactive
S1 create a different account (inactive lost-key row present): 503 BANK_KEY_UNAVAILABLE
S1 repair by re-entering account on the inactive row: 409 BANK_ACCOUNT_INACTIVE
S2 re-enter row1: 503 BANK_KEY_UNAVAILABLE
S2 re-enter row2: 503 BANK_KEY_UNAVAILABLE
reindex --from lost key with app ring: REFUSED: --from key id r57-lost-… is not in the lookup ring (ci-look-1) …
reindex with placeholder material under the lost id: {"processed":3,"failed":0,"remaining":0}
S2 create after reindex (same account c1 -> expect 409): 409 BANK_ACCOUNT_DUPLICATE
S1 create after reindex (new account): OK id=…
```

**Failure scenario:** the realistic way to reach DEF-027 is a lookup rotation where the old key was
removed from the secret store before the reindex finished. Every row a Supplier had under that key is
then out of the ring. A Supplier with two or more such rows, or with any deactivated one, is refused
every account create and account change indefinitely:

- **Remedy 1** (「把該 key 補回 ring」) assumes the key material still exists.
- **Remedy 2** (re-enter the account) fails with 503 when another row on the lost key remains, because the rows block each other. It fails with 409 when the row is inactive, since `update()` checks status before `#duplicates`. The runbook states neither condition.
- **The reindex CLI**, which only needs the *encryption* key to recompute an index, refuses the lost `--from`.

The runbook is the object of the HD-036 human Security/Operations sign-off. It currently describes a
repair that does not work in these cases.

**A recovery that works (verified above, undocumented):**

1. Put placeholder material under the lost key id into the lookup ring. The material is never used for the rows, only the id.
2. Restart.
3. Run `supplier:bank:reindex-lookup --from=<lost> --to=<active>`.
4. Remove the placeholder.

This has a caveat the runbook would need to state. While the placeholder is in the ring, the 503 guard
passes for those rows, but their candidate indexes are computed with the wrong material, so the
duplicate check is blind to them. That is exactly DEF-027. The window must be kept to the reindex run.

**Recommendation.** Either:

- **(a)** document the placeholder-and-reindex procedure, with that caveat, plus the inactive and multi-row conditions on remedy 2; or
- **(b)** let the lookup reindex accept a `--from` that is absent from the lookup ring. Lookup rotation decrypts with the encryption ring and does not need the old lookup material. A separate, explicit flag would keep REV-052 M-1's typo protection.

(b) removes the window entirely. Either way, correct the "only such row can be repaired" sentence in
the register and in §2c so it states when it applies.

---

## 3. Mutants

19 mutants, each against the nine-file set, which has a 108/108 baseline. "KILLED" lists the tests that went red.

| # | Mutant | Result | Killed by |
| --- | --- | --- | --- |
| M1 | `if (unreadable.length > 0)` → `if (false)` | KILLED | unit TC-068; integration TC-068 ×2 |
| M2 | drop `supplier_id = ?` (param shape kept) | KILLED (suite **hung** 240 s, 12 tests red) | other-Supplier control and every Bank create in the shared schema |
| M3 | `AND id <> ?` → `AND ? IS NOT NULL` | KILLED | integration TC-068 repair case only (the author's note that the unit fake could not see it holds) |
| **M4** | `AND status = 'active'` on the 503 check | **SURVIVED** | — (M-1) |
| **M5** | remove `if (!bankEncryption \|\| !bankLookup) return;` | **SURVIVED** | — (L-2) |
| M6 | lookup tuple → `encryption_key_id` with the encryption ring | KILLED | provider unit test (params) |
| M7 | reveal log context + `keyId: row.encryption_key_id` | KILLED | unit log test |
| M8 | reveal `logger.error` → `logger.warn` | KILLED | unit log test |
| M9 | both reveal failures → 503 | KILLED | TC-067, TC-077, unit ×2 |
| M10 | both reveal failures → 500 | KILLED | TC-068 503 case, TC-077, unit |
| M11 | short mask `"*".repeat` → `"•".repeat` | KILLED | projections, crypto ×2 |
| M12 | 503 check against `[activeLookupKeyId]` only | KILLED | TC-076 (half-rotated ring) |
| M13 | integrity `publicCode` → `BANK_ACCOUNT_INTEGRITY_FAILED` | KILLED | TC-067, TC-077, unit ×2 |
| M14 | startup `n > 0` → `n >= 0` | KILLED | provider unit |
| M15 | startup `catch` rethrows | KILLED | provider unit only |
| M16 | dup-check log `error` → `info` | KILLED | unit TC-068 |
| M17 | startup log context + ring ids | KILLED | provider unit |
| **M18** | startup lookup column → `blind_index_key_idx` (invalid SQL on real MySQL) | **SURVIVED** | — (L-1) |
| M19 | startup never logs `kind === "lookup"` | KILLED | provider unit |

The author's list in §2c: write check removed, not scoped, self-blocking, refusal as `warn`, startup
throwing, wrong column, never logging, mask reverted. Those correspond to my M1, M2, M3, M16, M15, M6,
M14 and M11, and I **reproduced all eight as killed**. The three DEF-026 mutants correspond to my
M8, M9 and M10, all killed. The claim holds.

---

## 4. Claims I attacked, and that held

- **`NOT IN` and NULL.** `blind_index_key_id` and `encryption_key_id` are `NOT NULL`. That holds in the migration contract (`0037…js`, `nullable: false`) and in the live `information_schema` (`IS_NULLABLE=NO`, `ascii_bin`). Config key ids match `^[A-Za-z0-9._-]{1,50}$` and are trimmed. An empty ring is impossible: the normalizer requires at least one key, and `candidateBlindIndexes` throws on an empty ring before `#duplicates` runs. The `NULL`-in-`NOT IN` trap cannot occur.
- **Per-Supplier scoping, excludeId, whole ring.** M2, M3 and M12 were all killed. The other-Supplier control in the acceptance TC-068 test discriminates.
- **setDefault, deactivate and rename are unaffected.** By reading: only `create` and account-changing `update` call `#duplicates`. The unit rename control covers the non-account update. My probe deactivated a lost-key row successfully.
- **No key id or account in any public message or log.**
  - Messages: the 503 message is a fixed string, the 500 is `Internal server error`, and the errors' internal `message` (logged by `request.handler.finished`) names no id.
  - Logs: `duplicate_check_unavailable` logs `{supplierId}`, reveal logs `{bankAccountId, supplierId, reason: <crypto code>}`, and startup logs `{kind, rows}`.
  - Evidence: M7 and M17 were killed. The production boot log shows no id. The integration test asserts `gone-look` is absent from the system log and the response.
- **Design conformance.** §6 error table line 1052 is 503 `BANK_KEY_UNAVAILABLE`. §8.3 line 1199 is a generic 500 for an integrity failure, with a structured error log without ciphertext, key ID or plaintext. §12.4 line 1733 asks for a critical alert on both, which is served by error level. §5.8 line 677 is `*`. All match.
- **No dependant on the old contract.**
  - `grep` over `client/src`, `server/src` and `server/scripts` finds no `BANK_ACCOUNT_UNREADABLE` or `•` in any supplier path.
  - The client shows the server's `message` for 503 and maps `INTERNAL_SERVER_ERROR`. `sessionWatchdog` and `session.js` treat 503 specially only on their own session calls.
  - The route schema declares no error statuses, and `MASKED_BANK_SCHEMA.maskedAccountNumber` is a plain string.
- **Startup service.**
  - It is discovered in production (`server/src/index.js:18`). I verified this by booting.
  - Its dependencies are `mysqldatabase` and `logging`, so it initialises after both, with no cycle.
  - Missing `config.supplier`, `null` groups (PHASE-001/002) and `SecretValue` wrappers are all safe: only `Object.keys` is used.
  - A missing table is caught and logged (probe).
  - It never throws: `systemLogger.log` catches its own write failures (`systemLogger.js:32`), so even the `catch`'s `logger.error` cannot reject.
- **Error level is right** for both reveal events and the startup event, per §12.4.
- **Client under the new statuses.** The Playwright probe is described above. The `supplier-bank` spec passes 3/3.
- **Ledger revision 239.**
  - `inspect` residuals are exactly the three expected issues, and base c83bcac fails with the listed schema violations.
  - The `actor` and `observed_at` values for observations 153–159 equal the author dates of 0d15951, 0534593, 4f4a7f7, d78a8b3, 7fd0623, 92d6b7a and ef029a9. Each of those commits is the one that grew `observations` from index *i* to *i*+1, which I checked for all seven.
  - The three backfilled `source_fingerprint`s reproduce exactly with `harness_core.fingerprint` on clean checkouts: `8c4c3ee…` for fddcc44, `5713fc0…` for 320540a, and `c4a9d77…` for 654f7c3 with the DEF-025 symlink `git rm --cached`.
  - The DEF-023, DEF-024 and DEF-025 `summary` texts appear verbatim (whitespace-normalised) in `04_defect_register.md`.
  - Observations 0–152 are unchanged. The only removed key is the empty `decisions: []`. HD-036 changed `PENDING`→`OPEN` and nothing else.
- **No `todo` left in the Bank suites.** The only matches are two comment lines.

## 5. Low findings

### L-1 — no real-MySQL test pins the startup check's lookup half

**Where:** `server/test/integration/supplierBankAcceptance.integration.test.js:372-375` and
`server/test/supplierProviderServices.test.js:103-108`.

Mutant M18 renames the lookup column to one that does not exist and **survives**. The two tests miss it for different reasons:

- **The unit fake** picks its answer by `sql.includes("blind_index_key_id")`, a substring the broken column also contains, and never runs the SQL.
- **The integration assertion** only counts `supplier.bank.keys_outside_ring` lines. The encryption half satisfies it, because the same file plants `gone-enc*` rows in the shared schema.

Under M18 the real startup logs the encryption count and then `key_check_failed`, and rows on a lost *lookup* key, which is DEF-027's own subject, are never reported.

**Recommendation:** in the integration test, assert on a line with `"kind":"lookup"`.

### L-2 — the "no Bank keys" test cannot fail for the property it names

**Where:** `server/test/supplierProviderServices.test.js:129-130`.

Mutant M5 removes the guard and **survives**. Without the guard, `Object.keys(undefined.keyRing)` throws inside the `try` before any query runs. `queries.length === 0` still holds, but every PHASE-001/002 boot now writes an error-level `supplier.bank.key_check_failed` log, which is a critical alert under §12.4.

**Recommendation:** also assert `undeployed.errors` is empty.

### L-3 — the test double throws a code the real database layer never does

**Where:** `server/test/supplierProviderServices.test.js:107,127` and
`SupplierProviderServices.js:121-122`.

The fake throws `{code:"ER_NO_SUCH_TABLE"}`, and the test pins `reason: "ER_NO_SUCH_TABLE"`. The real `MySqlDatabaseExecutor` wraps every driver error as `DATABASE_OPERATION_FAILED` with the driver error in `cause` (`MySqlDatabaseService.js:216-222`). My probe on an empty schema logged `{"reason":"DATABASE_OPERATION_FAILED"}`. In production the log therefore cannot tell a missing table from a privilege or connection failure.

This is REV-036 H-1's mechanism again, one layer over: a double that skips the wrapper.

**Recommendation:** read the driver code through `cause`, as `#violates` does, or make the fake throw the wrapped error.

### L-4 — runbook §8 treats the absence of a log line as a pass

**Where:** `docs/supplier_management/bank_operations.md:282-283`.

The restore check says the startup log must not contain `keys_outside_ring`. A check that failed (`key_check_failed`) or was skipped because no Bank config is present leaves the same absence. The healthy path logs nothing positive, so "silence" is the only pass signal, and it is also what a check that never ran produces.

**Recommendation:** also require the absence of `key_check_failed`, or have the service log an info-level completion line with both counts, and have the runbook require seeing it.

### L-5 — a pre-existing 1-in-16 flake in the same file (not introduced here)

**Where:** `supplierBankAcceptance.integration.test.js:449` (TC-071, since 813d413).

`NEXT = SECRET.slice(0,6)+"9"+SECRET.slice(7)` equals `SECRET` whenever `SECRET[6]` is already `9`. `SECRET` is random hex, and I measured the rate at 0.0632 over 200k draws. When that happens, "changing the account must replace idx" fails with `actual === expected`. It happened on my first run of the Bank files and again during M6.

The new TC-068 repair test uses the same construction with `8`. By reading, it is immune, because each `seedUnder` draws fresh random key material, so equal accounts still give different indexes. That is inferred, not run.

**Recommendation:** derive `NEXT` so it always differs from `SECRET`, for example by flipping the digit.

## 6. Info

- **I-1.** Duplicate warnings across Suppliers are silently lost against another Supplier's rows on an out-of-ring key. No warning is shown and nothing is logged. This is pre-existing and acknowledged in the code comment at `SupplierBankService.js:206-209`. The runbook's 「其他 Supplier 不受影響」 is true for writes only and does not mention this. *Inferred by reading.*
- **I-2.** The 503 check is a non-locking consistent read under REPEATABLE READ. `authorize` reads on the same connection before `suppliers … FOR UPDATE`, so the snapshot can predate the lock. A row written concurrently under a key outside *this* instance's ring would be missed. That needs app instances running with different rings, which rotation procedure excludes. *Inferred, not run.*
- **I-3.** The runbook's diagnostic SQL (`bank_operations.md:73-77`) runs (I executed it). It lists every (encryption key, lookup key, Supplier) group rather than the out-of-ring ones, and gives no row ids despite 「哪些列」. A `WHERE encryption_key_id NOT IN (…) OR blind_index_key_id NOT IN (…)` form would answer the stated question.
- **I-4.** DEF-028's Playwright retest in §2c line 236 cannot fail on the server change. The spec defines `maskedAccountNumber: "**** 1234"` in its own route mock. The author labels it "API mocked". The real barrier is the server projection and crypto tests (M11 killed by three).
- **I-5.** Bank create and update can now return 5xx, which triggers `bodyCaptureErrorStatus: 500` full body capture. `accountNumber` and `password` are both on `redactedFields` (`server/config/logging.js:85-103`), so nothing leaks today, but this widens DEF-023's reach to a body that always carries an account. *Inferred from config and TC-074's mechanism; I did not read a request log for the 503 path.*
- **I-6.** Observation 157's `source_ref` still says "source_fingerprint is null deliberately … would claim more than was observed", while the field now holds a fingerprint. The appended bracket explains this, and the value reproduces. Observation 158's fingerprint describes a tree that never existed as committed (symlink removed). That is disclosed on the record, and the value reproduces. Neither is dishonest, but 157 now reads as contradicting itself.
- **I-7.** The Customer module still collapses a missing key and tampering into 422 `BANK_ACCOUNT_UNREADABLE` (`CustomerBankService.js:385`) and masks with `•` (`CustomerBankCrypto.js:53`). The Product Owner excluded Customer. The register records the Customer gap for DEF-027 only, not for DEF-026 or DEF-028.
- **I-8.** `SupplierBankKeyCheckService` does two unindexed `COUNT(*)` scans at boot (`encryption_key_id` has no index). That is negligible at Bank table sizes.

## 7. What I could not verify

- **CI on b701d28.** I did not look at GitHub checks.
- **The author's zero-failure full run.** My two full runs failed only in Customer import tests. The same pair of files fails identically at base c83bcac, so this is environmental or pre-existing, not caused by the PR, but I could not reproduce "0 fail".
- **The concurrency race in I-2.** It is inferred only.
- **The request-log content on the new 503 create path (I-5).** It is inferred from config.
- **Whether the placeholder-and-reindex recovery is acceptable operationally.** It is a human decision, like the rest of HD-036.
- **Anything about production:** the secret store, alert routing for error-level events, and multi-instance rollout.

## 8. Verdict

**CHANGES_REQUESTED.** The code change is correct and, apart from one branch, well pinned: 16 of my 19
mutants were killed, including all 11 the author claimed. Before merge, the two Mediums need:

- **M-1:** one real-MySQL case, with an inactive out-of-ring row giving 503, so that the REV-035 H-3 regression cannot come back through the new query.
- **M-2:** a repair procedure in the runbook that works when a Supplier has more than one out-of-ring row or a deactivated one, or a reindex that accepts a lost `--from`. The HD-036 sign-off should review whichever is chosen.

The Lows are cheap: one assertion each for L-1 and L-2, the cause-chain read for L-3, a runbook line for L-4, and a one-line test fix for L-5.
