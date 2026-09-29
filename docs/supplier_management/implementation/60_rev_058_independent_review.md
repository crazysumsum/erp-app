# REV-058 — REV-057 remediation and HD-038 `--from-lost` (PR #158), independent review

Reviewer: independent agent (REV-058). I did not write this code. Merge candidate:
bb04fd862615a905b64e1a68224fbb5b96f38f3f on `claude/supplier-def-026-027`, base origin/main c83bcac.
I reviewed the remediation range b701d28..bb04fd8 (3926982, 457cab3, 3abcfa7, bb04fd8) and re-checked the
whole PR. I worked in a detached worktree at `/private/tmp/erp-rev-058`, with `node_modules` symlinked from
the def-026-027 worktree. Git ignores the symlink.

## Summary

| | |
| --- | --- |
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 3 |
| Info | 5 |

Disposition: **APPROVED**.

Every REV-057 finding is closed, and I verified each one by running it:

- **M-1 closed.** Mutant M4 (`AND status = 'active'`) is now killed by the new real-MySQL test.
- **M-2 closed.** Option (b) works end to end as the real CLI against real MySQL on REV-057's lockout shape. During a partial run, the duplicate check never goes blind.
- **L-1 through L-5 closed.**

Across 19 mutants, 18 were killed. The one survivor is equivalent. CI is green on bb04fd8.

The three Lows are all in the runbook text of the new §4.1 and §2. None of them can corrupt data or open a
duplicate-check window. Each one makes an operator draw a wrong conclusion, or leaves them with no next step,
in a situation that fails closed. They are cheap to fix. The HD-036 human sign-off, which now covers §4.1,
should see them, but I do not think they need another code round.

### What I ran, and on what

- MySQL on 127.0.0.1:3440, using `env37d.sh`. The rings are `ci-enc-1` / `ci-look-1`.
- **The 12 Bank files:**
  - unit: crypto, handlers, key-rotation, rotation CLI, service, projections, provider;
  - integration: bank, acceptance, device-writes, restore, rotation.
  - Baseline: **144/144**, run with `--test-concurrency=1`.
- **Full `npm test` in `server/`, twice.** Both runs: 2249 tests, 2241 pass, **1 fail**, 7 skipped.
  - Both failures were **TC-059** (Customer import precheck). That is the pre-existing cross-file Customer race that REV-057 showed fails at base c83bcac too.
  - The test count matches the author's 2242 + 7 = 2249. I could not reproduce the zero-failure run, for the same reason REV-057 could not.
- **Lint.** `npx eslint` on `server/src/modules/supplier`, `server/scripts` and the four changed test files exits 0.
- **CI.** `gh run view 36395842511` is on head `bb04fd862615…`, with conclusion `success`. All five jobs passed: Playwright, build, dependency audit, lint, and server+client with MySQL integration.
- **The production entrypoint.** I ran `node --import ./test-support/testEnv.js src/index.js` with `APP_PORT=38458`. The system log recorded:
  - `keys_outside_ring {kind:"encryption",rows:2}` at error level;
  - `keys_outside_ring {kind:"lookup",rows:2}` at error level;
  - `key_check_completed {encryption:2,lookup:2}` at **info** level.

  No key id appears in any of them. So the completion line really does reach the system log at the shipped `minimumLevel: "info"`.
- **The startup service against real MySQL** (`probe_startup.mjs`, the real `MySqlDatabaseService`):
  - On an empty schema, it logs `key_check_failed {"reason":"ER_NO_SUCH_TABLE"}`. The driver code is now read through the real wrapper, and no `completed` line is written.
  - On `erp_dev`, it logs both kinds followed by `completed`.
- **The real CLI end to end** (`probe.mjs` seed/check/cleanup plus `npm run supplier:bank:reindex-lookup --workspace server -- …`). See §2.
- **The runbook §2 diagnostic SQL**, executed as written with the ring ids substituted. See L-3.
- **`state_tool.py inspect docs/supplier_management --repo-root . --json`:** exit 1, `BLOCKED`. The only issues are `WORKTREE_CHANGED`, `COMMIT_CHANGED` and `SOURCE_CHANGED`, as expected.

### Restoration

- I committed nothing, pushed nothing and commented on nothing.
- **Source files.** All four mutated files (`SupplierBankService.js`, `SupplierProviderServices.js`, `bankKeyRotation.js`, `supplierBankRotationCli.js`) were restored by rewriting the saved bytes. Each one was checked with `filecmp` (shallow=False) after every mutant, and `git status` / `git diff --stat` were clean afterwards.
- **Probe rows.** I deleted the `R58-%` suppliers and all their bank rows (ids 3337–3342), including the one duplicate row I removed by hand in the §2 run. A count confirms 0 remain.
- **Worktree.** The review worktree and its untracked `server/.rev058/` and `server/logs/` are removed after this report is written. Probe scripts and outputs are kept in the scratchpad under `rev058/probes/`.
- **Stopping the entrypoint.** I stopped the booted server with `pkill -f "src/index.js"`. That pattern is broader than my process. I saw no other server affected, but I cannot rule out that it matched another `src/index.js` process on this machine.

---

## 1. Status of REV-057 findings

| REV-057 | Status | How I verified it |
| --- | --- | --- |
| M-1 (inactive out-of-ring row not pinned) | **Closed** | M4 is **KILLED** by `TC-068 … a deactivated row on a lookup key outside the ring still blocks` (`supplierBankAcceptance.integration.test.js:410-422`). In the end-to-end run, S1's inactive lost-key row blocked a re-add with 503. |
| M-2 (no working repair for a lost lookup key) | **Closed** (option (b), HD-038) | The real CLI recovered the REV-057 lockout shape. Mid-run, the Supplier stays 503. After the run, both old accounts give 409 and a new account is accepted. Five of five author mutants were reproduced as killed, plus five of my own. The three Lows below concern §4.1 wording only. |
| L-1 (startup check lookup half unpinned) | **Closed** | M18 (`blind_index_key_idx`) is **KILLED** by TC-068 `a duplicate check that cannot read…`. The filter on `"kind":"lookup"` is not vacuous: the boot log line has the exact form `"context":{"kind":"lookup","rows":2}`. |
| L-2 ("no Bank keys" test could not fail) | **Closed** | M5 (guard removed) is **KILLED** by the provider unit test. |
| L-3 (fake threw an unwrapped driver code) | **Closed** | Mutant `reason: error?.code` is **KILLED**. The fake now throws the real `MySqlDatabaseOperationError`, and the real-MySQL probe logs `ER_NO_SUCH_TABLE`. |
| L-4 (silence was the pass signal) | **Closed** | Four mutants are all **KILLED**: no completion log; completion also logged on failure; completion without counts; completion at error level. Runbook §2 and §8 require the line. It reaches the system log on a real boot. |
| L-5 (1-in-16 `NEXT` flake) | **Closed** | By construction: `NEXT_SECRET` flips `SECRET[6]` between `9` and `8`, and `SECRET` is 16 characters long. TC-071 and both TC-068 repair tests use it. Across my 12-file runs (1 baseline plus 19 mutants) I saw no TC-071 failure. |
| I-3 (diagnostic SQL) | **Closed**, with a new wording issue in L-3 | The SQL now filters to rows outside the ring and lists ids and status. |
| I-1, I-2, I-4..I-8 | Unchanged | The runbook now mentions I-1, cross-Supplier warnings being lost, in §2. I did not re-examine the others. |

## 2. `--from-lost` — what I ran and what held

Seed (real `SupplierBankService` and `SupplierBankCrypto` on `erp_dev`, with a random lost id `r58-lost-*`):

- **S1** has two rows on the lost key, and one of them is inactive. This is REV-057's lockout shape.
- **S2** has a pre-fix duplicate. An inactive row on the lost key holds account X. An active row on `ci-look-1` holds the same X. I created it through REV-057's placeholder-material window, which shows that window can create a duplicate.

```
seeded [[3337,2514,"active","LOST"],[3338,2514,"inactive","LOST"],[3339,2515,"inactive","LOST"],[3340,2515,"active","ci-look-1"]]
S1 create before: 503 BANK_KEY_UNAVAILABLE
== typo (--from=<lost>x --from-lost)         exit 2  no supplier_bank_accounts row uses lookup key id r58-lost-196810x; refusing a --from-lost that matches nothing
== without the flag                          exit 2  --from key id r58-lost-196810 is not in the lookup ring (ci-look-1); refusing …
== in-ring id with the flag (--from=ci-look-1) exit 2  --from and --to are the same key id; nothing to rotate
== encryption tool with the flag             exit 2  --from-lost applies to the lookup reindex only; …
== --limit=1                                 exit 0  processed 1, remaining 2, warnings [RING_SHARED_WITH_OTHER_TABLES]
   mid-run: S1 re-add a1 (row already reindexed) 503; S1 re-add a2 503; S2 new account 503
== full run, §4.1 command verbatim           exit 1  processed 1, attempted 2, failed 1,
   failures [{"id":3339,"reason":"DUPLICATE_KEY","constraint":"uq_supplier_bank_blind_index"}], remaining 1
   after: S1 re-add a1 409 DUPLICATE; S1 re-add a2 (inactive) 409 DUPLICATE; S1 new account OK; S2 new account 503
== (manual DELETE of duplicate 3339) rerun   exit 2  no supplier_bank_accounts row uses lookup key id r58-lost-196810; …
   after: S2 new account OK
```

What held:

- **Misuse.** `--from-lost` cannot write a wrong state. Every row it touches ends up at the canonical state: its index recomputed from the decrypted plaintext under the active key, with the key id and index written in one guarded `UPDATE` (`bankKeyRotation.js:229-235`). An id that is in the ring is refused (`:101-103`), and so is the encryption kind (`:98-100`). A typo that matches no row is refused (`:261-263`). A typo that happened to match another out-of-ring id would repair those rows, not damage them. There is one residual config-mismatch case, I-1.
- **Resume.** A partial run, then the full run, then a rerun behaves as §4.1 says. The condition is the progress, exactly as in normal mode.
- **The duplicate check is never blind.** I verified this mid-run. The row already reindexed (a1) was refused with 503, because the Supplier's other row was still on the lost key. It was not silently accepted. After the run, the reindexed rows match, including the inactive one. By reading, the index and key id change in one statement, so no window exists between them.
- **`RING_SHARED_WITH_OTHER_TABLES`** is present on every report, including the partial and failing ones.
- **`DUPLICATE_KEY`.** It is reported with the id and constraint name only, and exit is 1. No index bytes appear in stdout or stderr. See L-2 for the operational gap.
- **No leaks.** The report and stderr carry only key **ids**, row ids, counts and the constraint name. The npm banner echoes argv, which holds only ids.
- **Exit codes.** A refusal is 2, a failed row is 1, and a clean or partial run is 0. That is unchanged from §6.1.
- **The Customer side.** By reading, `CustomerBankMaintenanceService.reindexBatch` selects `blind_index_key_id <> active` (`:80-81`) and never needs the old key. So "照 §5 處理 Customer 那一邊" is workable for a lost key. This is inferred; I did not run it.

## 3. Mutants

19 mutants, each run against the 12-file set, which has a 144/144 baseline. Each was applied by exact single-occurrence replacement and restored by rewriting the saved bytes, checked with `filecmp`.

| # | Mutant | Result | Killed by |
| --- | --- | --- | --- |
| M4 | `AND status = 'active'` on the 503 check | KILLED | TC-068 deactivated-row test |
| M5 | remove `if (!bankEncryption \|\| !bankLookup) return;` | KILLED | provider unit |
| M18 | startup lookup column → `blind_index_key_idx` | KILLED | TC-068 duplicate-check integration |
| L3 | `reason: error?.cause?.code ?? error?.code` → `error?.code` | KILLED | provider unit |
| L4a | no completion log | KILLED | provider unit |
| L4b | completion also logged on failure | KILLED | provider unit |
| L4c | completion without counts | KILLED | provider unit |
| L4d | completion at error level | KILLED | provider unit |
| F1 | encryption accepted with `fromLost` | KILLED | key-rotation unit |
| F2 | in-ring id accepted as lost | KILLED | key-rotation unit |
| F3 | no row-use check | KILLED | key-rotation unit |
| F4 | flag ignored (`if (fromLost)` → `if (false)`) | KILLED | HD-038 integration, key-rotation unit, CLI unit |
| F5 | in-ring check against the encryption ring | KILLED | key-rotation unit |
| F6 | row-use check counts `encryption_key_id` | KILLED | HD-038 integration, key-rotation unit |
| F7 | CLI does not forward `fromLost` | KILLED | CLI unit |
| F8 | CLI parse never sets `fromLost` | KILLED | CLI unit ×2 |
| F9 | CLI accepts `--from-lost=<value>` | KILLED | CLI unit |
| F10 | row-use check also in normal mode | KILLED | 6 tests (idempotent rerun, guard, count-failure, exit 0) |
| F11 | `from === to` skipped under `fromLost` | SURVIVED | **Equivalent.** `to` is always the active id (checked by `assertTarget`), and the active id is in the ring, so `:101` refuses it anyway. |

The author's five HD-038 mutants correspond to my F3, F2, F1, F4 and F7. I **reproduced all five as killed**. The §2c claim of "all five mutants now killed" for M4, M5, M18, L-3 and L-4 also holds.

---

## 4. Low findings

### L-1 — §4.1 tells the operator that a typo's refusal means "done"

**Where:** `docs/supplier_management/bank_operations.md:182-183`
(「已經跑完的再跑一次也會被拒，看到 `no supplier_bank_accounts row uses lookup key id` 即表示已完成。」)

A mistyped `--from` and a finished run produce the same text and the same exit code 2. The only difference is the echoed id. I ran both against the real CLI (§2): `…lookup key id r58-lost-196810x; refusing…` versus `…lookup key id r58-lost-196810; refusing…`.

**Failure scenario:** the operator's **first** run carries a typo. The runbook tells them this message means the repair is complete. The Supplier stays at 503. This fails closed, and the startup log still reports lookup rows, so there is no data risk. But it is the REV-052 M-1 shape, "a refusal read as completion", reintroduced through prose. The runbook also gives §4.1 no positive completion check.

**Recommendation:** replace the sentence. The run is complete when a run reports `remaining: 0` with no failures. The refusal only means "no row uses this id", which is either done or a typo. Then add a post-check: the §2 SQL returns no row for that id, or after a restart `key_check_completed` shows `lookup: 0`.

### L-2 — `DUPLICATE_KEY` leaves the Supplier locked, and §4.1 does not say so or offer a way out

**Where:** `docs/supplier_management/bank_operations.md:187-188`.

**Verified (§2, S2):**

- The run exits 1 with `DUPLICATE_KEY`. The Supplier's writes stay 503 indefinitely: after the run, "S2 new account" gives 503.
- No application path releases it. Deactivating the row does not help, because inactive rows count (M-1). Re-entering or changing the account is blocked by 503 or 409. A rerun fails identically.
- Only a manual SQL change to the duplicate pair released it. In my run, deleting the out-of-ring duplicate made the rerun report "matches nothing" and S2 writable again.

§4.1 says only 「要人手調查，不要重試了事」. It names the pre-fix bug as the sole cause. As S2 shows, the REV-057 placeholder workaround is another cause, if anyone used it before this PR.

**Recommendation:** state that the Supplier stays at 503 until the pair is resolved. Say that deactivation does not release it. Say that resolution needs a DBA decision on which row to keep, with the account compared by reveal. Also list the placeholder window as a possible cause.

### L-3 — the §2 SQL placeholder invites a form that lists every row

**Where:** `docs/supplier_management/bank_operations.md:80` (`NOT IN ('<encryption key ids>')`).

The quotes sit outside the placeholder. An operator mid-rotation, when the ring holds two ids, who fills it in literally as `('ci-enc-1, e1')` gets every row. I ran it: **7 of 7 rows listed**, against **1 row** with `('ci-enc-1', 'e1')`. Mid-rotation is exactly when this diagnostic is needed.

No damage follows, because `--from-lost` refuses in-ring ids, but the diagnostic answers the wrong question.

**Recommendation:** write the placeholders as `('<id1>', '<id2>', …)`, or give a two-id example.

## 5. Info

- **I-1.** `--from-lost` removes the one check that incidentally caught a CLI environment whose lookup ring differs from the app's.
  - **Scenario:** the app's active lookup id is A, while the CLI's `.env` holds another ring with active id B. Then `--from=A --to=B --from-lost` is accepted, because A is not in the *CLI's* ring and rows use it. It reindexes every row to B, which the app does not have, so every Supplier with bank rows gets 503 on writes.
  - **Recovery** is easy: `--from-lost` back with the right env, or add B to the app ring. No data is lost.
  - Normal mode already has a milder version of the same mismatch risk.
  - **Suggestion:** §4.1 could require the §2 SQL to show the id as outside the ring *of the running app* before the run.
  - *Inferred by reading; not run.*
- **I-2.** The §4.1 and §4 commands use `npm run` without `-s`, so npm prints `> @erp/server… / > node scripts/… --json` to **stdout** before the JSON, and on exit 1 an `npm error` block to stderr. Piping the `--json` output to a parser fails. I verified this in `full.out`. The same holds for the §3 and §4 commands, so it is pre-existing.
- **I-3.** The runbook's "no `key_check_completed` line = the check did not run" also fires when the log `minimumLevel` is set above `info`. The shipped config has `info` (`server/config/logging.js:61`). This fails safe, as a false alarm and not a false pass, but the runbook could name it. *Inferred from config.*
- **I-4.** A code comment at `SupplierProviderServices.js:91` still says the key-id SQL is in 「runbook §8」. It is in §2. The comment was already there at b701d28.
- **I-5.** The text of `RING_SHARED_WITH_OTHER_TABLES` ("Do not remove it from either ring until …") is moot for a key that is already gone. The Customer rows on a lost key are recoverable by `customer-bank:reindex`, because it selects `<> active`, but §4.1 only says 「照 §5」. *Inferred by reading.*

## 6. Ledger and documents

- **Revision 240** (457cab3):
  - adds REV-057 as `CHANGES_REQUESTED`, with 0 critical and 0 high, in the same shape as REV-054..056;
  - `reviewed_baseline` equals the design hash, as in the earlier reviews;
  - HD-038 is `OPEN` with no `answer_ref`;
  - HD-036 stays `OPEN`.
- **Revision 241** (bb04fd8) sets HD-038 to `ANSWERED` with "Product Owner, 2026-09-28: 'B'" and correctly records:
  - the OUTSIDE_MODULE authority for the CLI shim;
  - the "five mutants killed", which I reproduced;
  - "Needs REV-058".

  The feature commit 3abcfa7 comes after revision 240, so the question was opened before the implementation. The records match what happened, as far as git shows.
- **`next_safe_action`** is accurate.
- **`02_technical_test_report.md` §2c:**
  - The DEF-027 row's retest text matches the tests.
  - The REV-057 paragraph's claims hold: five mutants killed; verified on the lockout shape, which is the HD-038 integration test in my baseline and killed by F4 and F6.
- **`04_defect_register.md:32-34`** now states the repair conditions correctly. `grep` finds no remaining unconditional "only such row can be repaired" outside the REV-057 report.
- **Runbook §2 claims, checked against behaviour:**
  - inactive rows block (M-1 test, probe);
  - the completion line is always written on success and never on failure (L4a/L4b, boot, probe);
  - the three repair conditions (REV-057 probe, which I did not re-run, plus the test at `supplierBankAcceptance.integration.test.js:390-408` in my baseline);
  - `--from-lost` works (§2 above).

  §8's added requirement is satisfiable, because the line reaches the log on a real boot.

## 7. What I could not verify

- **The Product Owner's words.** I could not verify the "B" answer in HD-038 or the HD-037 quotes. I can only confirm that the ledger order is consistent.
- **The zero-failure full run.** Both of my runs failed only TC-059, the known pre-existing Customer race.
- **The Customer reindex on a lost lookup key (I-5).** This is inferred from reading only.
- **The config-mismatch misuse (I-1).** This is inferred and was not run.
- **Anything about production:** the secret store, how lookup keys get lost in practice, alert routing, and multi-instance rings during a `--from-lost` run.
- **Playwright.** There are no client changes in b701d28..bb04fd8; I checked the diff stat. I relied on CI's green Playwright job on bb04fd8 and REV-057's browser checks, and did not re-drive the UI.

## 8. Verdict

**APPROVED.** M-1 and M-2, and L-1 through L-5, are closed and verified by running them. The only surviving
mutant is equivalent. `--from-lost` is narrowly gated, cannot write a non-canonical state, keeps the
duplicate check fail-closed throughout a run, preserves exit-code semantics and leaks nothing. CI is green on
the merge candidate. The three Lows are runbook wording in §4.1 and §2. They belong in front of the HD-036
Security/Operations sign-off and can be fixed in the same pass, but none of them is a reason to hold the code.
