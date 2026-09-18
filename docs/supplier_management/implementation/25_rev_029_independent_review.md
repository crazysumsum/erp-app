# Supplier Management — PHASE-002 TASK-027 Remediation Review (REV-029)

## Decision

**`APPROVED`** — **0 Critical, 0 High, 1 Medium, 2 Low, 1 Nit. No blocker.**

> All nine REV-028 findings are closed, and I established each one by mutation or probe rather than
> by reading the diff. **All 29 of my original mutations now die, up from 27** — and S4, which
> previously escaped the targeted suite and was caught only at app boot, now dies in the file that
> owns it. I applied 10 further mutations aimed at the remediation itself; 9 die and the tenth is an
> equivalent mutant I could not make reachable.
>
> **H-2 is closed, and I proved that the fixture change is what closed it.** Four cells: the shipped
> fixture kills my overwrite mutant and passes clean; reverting only the fixture to the REV-028 shape
> lets the same mutant through again. The control is held by the test, not by luck.
>
> **On M-2 the author was right and I was wrong.** I proposed catching every `inspect()` failure.
> The handler catches `ER_NO_SUCH_TABLE` only, and the reasoning — that a connection loss tells you
> nothing about readiness, so reporting NOT_READY would assert something unproven — is correct. My
> blanket catch would have told an administrator to go and migrate a schema that was fine. I probed
> six MySQL failure shapes against the real service; the narrow catch behaves correctly on five of
> them and stops one errno short of its own principle on the sixth (**L-1**).
>
> **I was also wrong about L-5.** I called widening the client suite filter "a one-word change". I
> verified the coordinator's correction directly: `00_project_profile.json` is hashed into the plan
> baseline, and making that edit moves it from `a0d41e31…` to `abfe63dd…`. The exception under
> HD-023 is the right call and my characterisation was not.
>
> One new Medium. H-1's fix covers the mount-time read and not the conflict-time one: if the reload
> that follows a VERSION_CONFLICT itself fails, the page still reaches the error boundary, with no
> notification and no retry. Same defect class, narrower path, and it needs two failures in a row —
> which is why it is Medium and not a re-opening of H-1.

> ### One episode worth reading even though it is now closed
>
> Mid-review, `2dfba2c` ("record DEF-019") landed and **committed one of my throwaway probe files**.
> For two commits the branch had a red `npm run lint`, a browser suite of 9 instead of 8, and a
> source fingerprint matching nothing in the ledger. `86bfc35` untracked the file and I deleted my
> local copy; I re-verified at that head — **lint exit 0, 8 passed, fingerprint back to
> `5e79c3b1…`, design and plan baselines unmoved**. Nothing is outstanding. It is written up in
> **"Contamination at the true head"** below because the mechanism will recur and costs one line to
> prevent.

## Provenance

| Item | Value |
| --- | --- |
| Reviewer | REV-028's reviewer, re-engaged per the HD-021 precedent rather than a fresh agent |
| Reviewed head | `26d8a4c1c9c8e257891a307de0a923baa5b5ab11` (`26d8a4c`), as instructed; source commits are `50658a8` and `8c3e252`, `63bf613`/`26d8a4c` are ledger only |
| Source fingerprint reviewed | `5e79c3b190e6fe1b64c2c15d8d772b17b9296f68249f494e5d70cddb2e071a6f` — **recomputed independently**; matches `state.baseline.source_fingerprint` |
| Head on exit | `86bfc35` — two further commits landed mid-review (`2dfba2c`, `86bfc35`); re-verified there, and its source fingerprint is `5e79c3b1…` again, identical to the head I reviewed |
| Previously reviewed | `5fb3a4c` at fingerprint `8515273a…` (REV-028) |
| Design baseline | `e4083319e526682f70b40a0b2676ae5b50cc72d8f03e9e07c6d6fbb671f211e4` — recomputed, unmoved |
| Plan baseline | `a0d41e31d887447d669d0f8252991e43fcdd273eb9eadcbe0d211468092bd154` — recomputed, unmoved |
| Branch / worktree | `codex/supplier-task-027` @ `/Users/sam/Documents/workspace/erp-app-worktrees/supplier-task-027` |
| Tree at start | clean, as the coordinator said it would be |
| Tree on exit | clean apart from this report; every probe file removed, and Playwright now leaves nothing behind |

Source diff reviewed, `5fb3a4c..26d8a4c`: `SupplierSettingsPage.vue` (+24/−6),
`businessMasterReadinessHandler.js` (+31/−2), `supplier-settings.spec.js` (+55/−6),
`settings.test.js` (+41/−8), `supplierLookupHandlers.test.js` (+48), `playwright.config.js`
(+17/−4). No schema, no migration, no permission catalogue.

I recomputed all three hashes with the harness's own `harness_core` rather than reading them out of
the ledger. The design and plan baselines are byte-identical to the values recorded in
`state.baseline`, so nothing in this remediation moved a baseline.

---

## The mutation run

38 distinct mutations, applied one at a time with the file restored between each. Five of them were
run in both layers, so 42 executions in total. Baselines: vitest `settings.test.js` +
`supplierSettings.test.js` **13 pass, 0 fail**; `supplierLookupHandlers.test.js` +
`handlerConventions.test.js` **9 pass, 0 fail**; Playwright `--project technical` **8 passed**.

**37 killed, 1 equivalent mutant.**

### My 29 original mutations, re-run in full

**29 killed, 0 survived** — against **27 killed, 2 survived** at `5fb3a4c`. I re-ran all 29 rather
than only the survivors, precisely to check that the remediation had not bought new coverage by
weakening something that used to die. Nothing regressed.

| Former survivor | Now killed by |
| --- | --- |
| **A** — conflict reloads, then overwrites with the user's clicked value | vitest `a version conflict shows the server's value, not the one the user just clicked` **and** the Playwright case of the same name |
| **B** — a `q-btn` catalog write control in the dependency card | the Playwright `button, a` → `href` loop (it already died in vitest) |
| **S4** — policy name typo `hasPermission` → `hasPermissions` | now `supplierLookupHandlers.test.js` itself, via `assert.equal(policy.name, "hasPermission")`, not only `applicationFactory.test.js` at boot |

S4 is worth spelling out. My REV-028 table recorded it as "survived the targeted suite" but my
headline count treated it as killed, because `applicationFactory.test.js` caught it one layer out.
That was a soft edge in my own arithmetic. Counted strictly, `5fb3a4c` was **26 of 29** against the
suites as shipped; it is now 29 of 29, and the difference is a single asserted line.

### 10 new mutations aimed at the remediation

**9 killed, 1 equivalent.**

| # | Mutation | Result |
| --- | --- | --- |
| N1 | the whole `v-else-if="!settings"` banner block deleted (the H-1 crash returns) | killed — vitest **and** Playwright |
| N2 | `settingsError` never assigned, so the banner falls back to its literal | killed — the vitest case asserts the server's message reaches the page |
| N3 | the retry button's `@click="load"` removed | killed — the Playwright case clicks it and requires the toggle to come back |
| N5 | page gate widened to `["supplier.view"]` | killed — the new denied-user Playwright case |
| N6 | the M-2 catch widened to every error | killed — `any other database failure is not dressed up as a readiness answer` |
| N7 | the M-2 catch removed, rethrow always | killed — `absent Business Master tables read as NOT_READY` |
| N8 | the synthesized result claims `schemaReady: true` | killed |
| N9 | the synthesized result claims `status: "READY"` | killed |
| N10 | `execute()` bypasses the new `inspect()` wrapper | killed |
| N4 | `v-else-if="!settings"` → `v-else-if="settingsError && !settings"` | **equivalent** |

N4 is not a coverage gap and I am not raising it. The two predicates differ only when
`loadSettings()` *resolves* with a falsy value, and that is unreachable: the route's response schema
for `200` validates against `SUPPLIER_SETTINGS_SCHEMA` with validation enabled, so a null body is a
`500` and therefore a rejection, which sets `settingsError`. I could not construct an input that
tells the two apart.

### The H-2 four-cell matrix

The question is not only "does the mutant die" but "is it the fixture that kills it". Both fixtures
run against both page states:

| | clean page | mutant A |
| --- | --- | --- |
| **shipped fixture** (starts ON, user clicks OFF, server holds ON) | 1 passed | **1 failed** |
| REV-028 fixture (starts OFF, user clicks ON, server holds ON) | 1 passed | 1 passed |

The bottom-right cell is the point: the old fixture *still* cannot discriminate, so the thing that
closed H-2 is the fixture change and nothing else. vitest answers the same way — mutant A fails,
clean passes 10/10.

---

## Every REV-028 finding, and how I established closure

### H-1 — a failed settings read crashed the page — **CLOSED**, with a residue recorded as M-1 below

`SupplierSettingsPage.vue:72-87` now has `settingsError`, `load()` is extracted and reusable, and
`:136-144` renders a banner with a retry before the `v-else` that dereferences `settings`.

Re-ran my REV-028 browser reproduction verbatim against this head — same 500 on
`GET /api/v1/supplier-settings`, same page:

| | `5fb3a4c` | `26d8a4c` |
| --- | --- | --- |
| page body | `呢一頁出咗問題：Cannot read properties of null (reading 'requireActivationApproval')` | error banner + `重新載入` |
| `.q-toggle` count | 0 | 0 (correctly absent) |
| recovery | none | retry restores the page |

N1 (delete the banner) and N3 (make retry a no-op) both die, in both layers, so the fix is held from
both ends rather than merely present.

I also probed the paths the fix creates, none of which are exercised by the shipped tests:

```
retry that fails again          -> banner persists (1), toggle absent (0)
retry double-clicked, failing   -> banner persists (1), no crash
retry double-clicked, recovered -> toggle present (1), no error boundary, console clean
```

Re-entrancy is safe, and the banner cannot be reached while a save is in flight — the banner only
renders when `settings` is null, and when `settings` is null there is no toggle to save from.

### H-2 — the version-conflict control could not fail — **CLOSED**

Both fixtures now start ON and click OFF against a server holding ON, so the value the page must
show and the value it must not show are different values. See the matrix above. The vitest case
gained three assertions rather than one: the initial state is ON, the update carried
`requireActivationApproval: false`, and the post-conflict display is ON. Nothing was removed — I
diffed the test file rather than only counting.

The two false records are corrected in the ledger as their own entry rather than by editing the
originals, which keeps the mistake visible. That is the right treatment and matches how REV-014
through REV-017 were handled on this branch.

### M-1 — the browser read-only check ignored buttons — **CLOSED**

`supplier-settings.spec.js:233-238` now carries the `button, a` → `href` loop, with
`expect(controls.length).toBeGreaterThan(0)` in front of it — a vacuity guard the vitest original
does not have, so the browser copy is now the stronger of the two. Mutation B dies there.

### M-2 — NOT_READY was unreachable for the ordinary cause — **CLOSED, and better than I proposed**

I proposed catching every `inspect()` failure. That was wrong, and I want to say so plainly rather
than quietly accept the narrower fix: under my proposal a dropped connection or a query timeout
would have been reported to an administrator as "Business Master is not ready", sending them to
re-run a migration against a schema that is fine. The author's principle — report only what we
actually know — is the correct one.

I drove six failure shapes through the real `BusinessMasterReadinessService` and the real handler:

```
1146 ER_NO_SUCH_TABLE        (table absent)      -> REPORTED  NOT_READY, schemaReady=false
1054 ER_BAD_FIELD_ERROR      (column absent)     -> THREW -> 500        <- L-1
1142 ER_TABLEACCESS_DENIED   (grant missing)     -> THREW -> 500
1049 ER_BAD_DB_ERROR         (schema absent)     -> THREW -> 500
1932 ER_TABLE_DEF_CHANGED                        -> THREW -> 500
PROTOCOL_CONNECTION_LOST                         -> THREW -> 500
```

Five of six are right. The sixth is L-1 below.

On the coordinator's other hypothetical — permission-denied as "the realistic production shape" — I
do not think it is, and the narrow catch is right to let it propagate anyway. This deployment runs
migrations as the same `DB_USER` the application connects with, so the account that reads
`currencies` is the account that created it; a table-scoped grant permitting `information_schema` and
`permissions` while denying `currencies` is not a configuration this deployment produces. And if it
somehow did, `1142` genuinely does not tell you whether the schema is ready, so the author's rule
covers it correctly.

I also checked the synthesized projection for over-claiming, since it asserts three falses from one
observation. Migration `0027_create_business_master.js` creates the three tables **and** seeds
`business_master.view` / `business_master.mgmt` in the same migration, and HKD lives in `currencies`.
So if the tables are absent the migration never ran, and `hkdReady: false` / `permissionsReady: false`
are sound inferences rather than guesses. N8 and N9 confirm nothing can quietly flip them.

The two new tests are the first on this route to run the real service — every other case replaces
`handler.readiness` with a hand-written object, which is exactly the shape REV-020 M2 and REV-024 H2
were about. N6 and N7 prove each branch is load-bearing in its own direction.

### L-1 — a policy-name typo escaped the targeted suite — **CLOSED**

`supplierLookupHandlers.test.js:37` asserts `policy.name`. S4 now dies here, at `9 pass` baseline,
rather than only in `applicationFactory.test.js` at route registration.

### L-2 — no browser case for the denied user — **CLOSED**

`supplier-settings.spec.js:271-283` drives a user holding `supplier.view` + `business_master.view`
and asserts the URL leaves the page, no toggle renders, and neither `/api/v1/supplier-settings` nor
`/api/v1/supplier-lookups/business-master` is called. N5 (widen the gate to `supplier.view`) kills it.

Worth recording as a strength rather than a gap: the fixture keeps `roles: ["system-admin"]` from the
spread, so the case also proves that holding the protected superuser role does **not** substitute for
the permission — which is the "a role could bypass" question, covered by accident but covered.

### L-3 — the policy and empty schema are redefined rather than imported — **left alone, correctly**

I recorded this rather than raised it, and the author left it. The drift guard
(`deepEqual` against `GetSupplierSettingsHandler`'s policy) still holds, and S1/S2/S3 die on it.
Nothing to close.

### L-4 — every Playwright run dirtied the tree — **CLOSED, by a better route than the one authorised**

The Product Owner authorised adding two `.gitignore` entries. The author did not spend that
authorisation: `playwright.config.js` now defaults its run directory to `/private/tmp/…`, following
`client/e2e/item-management/playwright.config.js`, so nothing reaches the working tree at all and the
approval-required path stays untouched. That is strictly better — the entries would have been needed
for every future module that runs a browser suite.

Verified all three paths the harness depends on, rather than reading the config:

| Environment | XML lands at | artifacts | `git status` |
| --- | --- | --- | --- |
| neither variable set | `/private/tmp/supplier-management-playwright/supplier-browser.xml` | beside it | **clean** |
| `HARNESS_RUN_DIR` only | `<run_dir>/supplier-browser.xml` | `<run_dir>/playwright-artifacts` | **clean** |
| both set, as `harness_runner.py:147` does | exactly `HARNESS_RESULT_PATH` | beside it | **clean** |

The third row is the one the evidence pipeline needs, and it is the one the runner actually produces:
`harness_runner.py:147` sets both variables, with `report_path = inside(run_dir, suite['result_path'])`
and the supplier browser suite's `result_path` being `supplier-uat-browser.xml`, so
`path.dirname(reportOutput)` resolves to the run directory. The override is not broken.

This closure is load-bearing beyond tidiness, which neither the finding nor the fix says out loud:
`harness_runner.py:126-133` fails a non-DEVELOPER run with `CANDIDATE_DIRTY` for any changed path
outside the bookkeeping globs. The old config's two artifacts would have tripped that on every formal
execution.

### L-5 — the new service test sits outside the declared client gate — **standing exception under HD-023, and my own claim retracted**

I wrote that widening the filter was "a one-word change". **That is wrong, and I verified the
correction myself rather than accepting it.** `harness_core.py:307` computes
`plan = digest({'manifest', 'profile', 'traceability', 'specs'})`, so the profile is inside the plan
baseline. I recomputed it, applied exactly the edit I recommended, and recomputed again:

```
current plan baseline                     a0d41e31d887447d669d0f8252991e43fcdd273eb9eadcbe0d211468092bd154
plan baseline after widening the filter   abfe63dd4061f9e550252b0db0c90cc97f44b3398b4800c9d0bbc7c50637be35
```

Every observation in this ledger, including all four TASK-027 evidence records, is bound to
`a0d41e31`. Moving it for a gate-completeness issue that CI's full run already covers would be a
MAJOR action to fix a Low. The HD-023 decision to leave it as a recorded exception is right. I
confirmed the underlying fact stands: `test/services/supplierSettings.test.js` does not run in
`supplier-phase-001-client` (50 vs. 53 tests with the filter widened) but does run in CI's
`npm run test:coverage`.

---

## New findings

### M-1 — H-1's fix does not cover the reload that follows a version conflict

`client/src/pages/suppliers/SupplierSettingsPage.vue:115-118`

`toggleApproval`'s conflict branch calls `loadSettings()` directly, not the new `load()`. If that
reload fails, the rejection escapes `toggleApproval` — `notifyError` never runs — and reaches Vue's
error handler, which is the same error boundary H-1 was raised about. The H-1 banner does not appear,
because `settings` is still non-null from the first successful load.

Reproduced in a real browser (temporary spec, removed afterwards) with the mock returning `409
VERSION_CONFLICT` and then `500` on the following `GET`:

```
P1_TOGGLE_COUNT: 0
P1_RETRY_BTN:    0
P1_NOTIFY_TEXT:  (empty — the conflict message never fires)
P1_UPDATES:      1        <- correctly not retried
P1_GETS:         2        <- the reload was attempted and failed
P1_BODY:         … error 呢一頁出咗問題：系統發生錯誤，請稍後再試
```

The user is told nothing, loses the page, and has no retry — only a browser reload recovers it.

Two things keep this Medium rather than a re-opened High. It needs two failures in sequence, so it is
much rarer than H-1's single failed read. And the message is now the framework's generic string
rather than a raw `TypeError`, because what propagates is an `ApiError` carrying a `publicMessage` —
so nothing internal leaks.

**Fix**, three lines, entirely inside the existing branch:

```js
if (error.code === "VERSION_CONFLICT") {
  try {
    await loadSettings();
    notifyError("設定已被其他人修改，已重新載入目前值，請確認後再儲存");
  } catch (reloadError) {
    notifyError(reloadError.message || "設定已被其他人修改，但重新載入失敗，請重新整理頁面");
  }
}
```

Substituting `await load()` for `await loadSettings()` also works and is shorter, but it flips
`loading` to `true`, so the toggle disappears and returns mid-conflict. The try/catch keeps the page
still. Either way the case needs a test: neither layer currently drives a failing post-conflict
reload, and the existing `toHaveLength(2)` assertion on the `GET` count passes whether the reload
succeeded or threw.

### L-1 — the M-2 catch stops one errno short of its own principle

`server/src/handlers/supplier-lookups/businessMasterReadinessHandler.js:79`

The rule the author states is "catch the case where we genuinely know the schema is not ready". The
page's label names two such cases — 「資料表尚未建立**或版本不符**」 — and the catch covers only the
first. A table that exists with a missing or renamed column is exactly the version-mismatch case: we
can see the table, we can see it is structurally wrong, and MySQL answers `1054
ER_BAD_FIELD_ERROR`, not `1146`. Proven in the six-shape probe above.

The structural reason is that `BusinessMasterReadinessService.inspect()` runs
`SELECT code, decimal_places, status FROM currencies` at `:22-24` **before** it calls
`inspectBusinessMasterSchema` at `:35-39` — and that call, the one whose whole job is to detect
structural incompatibility, is the only one wrapped in a `try`. So the structural check can never run
on the structurally broken schema it exists for.

**Low, not Medium**, and the reason matters: M-2's original form made the *most likely* cause
unreachable — absent tables on an un-migrated schema is what you hit on a fresh checkout. A
column-level mismatch requires a partially applied or drifted migration, against a module whose
migrations have idempotency coverage. The consequence is message specificity, not correctness: the
page falls back to the readiness error banner and the toggle keeps working.

**Fix**, if taken: make the caught set a named list rather than a single code.

```js
const SCHEMA_NOT_READY = new Set([1146, 1054]);  // no such table, unknown column
…
if (!SCHEMA_NOT_READY.has(error?.errno) && error?.code !== "ER_NO_SUCH_TABLE") throw error;
```

with a third test alongside the two that exist. I would not block on it, and I would rather it be
decided than silently widened — the author's instinct to keep the set small is the correct one.

### Nit — two assertions that are weaker than the cases around them

`client/e2e/supplier-management/supplier-settings.spec.js:278` asserts
`await expect(page).not.toHaveURL(/\/suppliers\/settings$/u)`. A negative URL assertion is satisfied
by any destination, including a crash. `toHaveURL(/\/403$/u)` says what is actually required, and I
confirmed with my own probe at REV-028 that `/403` is where the guard sends this user. The
companion assertions carry the case and N5 dies on it, so nothing is lost — it is one character of
precision.

`playwright.config.js:21-22` wraps an absolute literal in `path.resolve(process.cwd(), …)`, where the
first argument can never affect the result. `item-management`'s version puts the environment variable
inside the `resolve` so the argument does something; this one does not. Harmless, and copied faithfully
enough that I would leave it.

---

## Suites and checks, re-run

| Check | Result | Was (REV-028) |
| --- | --- | --- |
| `supplier-phase-001-server` evidence contract, `DB_INTEGRATION_TESTS=1` | **300 pass, 0 fail, 0 skipped** | 298 |
| `supplier-phase-001-client` declared gate | **50 pass, 0 fail** | 49 |
| Full client suite | **545 pass, 0 fail** (69 files) | 544 |
| Full server suite, `DB_INTEGRATION_TESTS=1` | **1749 tests, 1746 pass, 2 fail, 1 skipped** | 1747 / 1744 / 2 / 1 |
| Playwright `--project technical` | **8 passed** | 6 |
| `npm run lint` | exit 0 | exit 0 |
| `npm run build --workspace client` | exit 0 | exit 0 |
| `git status` after a full browser run | **clean** | 2 untracked artifacts |

All of the above are at `26d8a4c`, and `lint` (exit 0), the browser suite (8 passed) and the source
fingerprint were re-confirmed at the final head `86bfc35`. Between those two heads the branch briefly
carried a stray file of mine that turned `lint` red and the suite to 9; see "Contamination at the
true head".

The +2 server and +1 client tests are exactly the two real-service M-2 cases and the one H-1 vitest
case; the +2 Playwright cases are H-1 and L-2. No test was removed or weakened — I diffed both test
files rather than only counting, and all 29 original mutations still die.

The two server failures are the same pre-existing Item Management environment failures I reported at
REV-028 — `TC-016` asserting `DB_ADMIN_USER is required for recovery integration setup`, and `TC-001`
comparing `item_categories` DDL against drift in the shared `erp_dev`. Neither is reachable from this
remediation, which adds no migration and touches no Item file. *Accepted on reasoning; I did not
re-run the suite at the parent commit.*

---

## Contamination at the true head — occurred, measured, and now closed

Every number in this report was measured at `26d8a4c`, the head the coordinator named. Partway
through, `2dfba2c` landed on the branch:

```
2dfba2c docs(supplier): record DEF-019, a second Item test that cannot share a database
 client/e2e/supplier-management/rev029probe2.spec.js  | 145 +++++++++++++++++++++   <- mine, not intended
 docs/supplier_management/00_harness_state.json       |  39 +++++-
```

A commit whose subject and purpose are docs-only staged everything in the worktree, and one of my
throwaway probe files was on disk for the couple of seconds between writing it and deleting it. The
file is mine and the mistake is mine; I am recording it here rather than quietly deleting it,
because removing a tracked file is a change to the branch and I am not committing.

**Three consequences, each measured rather than inferred:**

| | at `26d8a4c` | at `2dfba2c` |
| --- | --- | --- |
| `npm run lint` | exit 0 | **exit 1** — `rev029probe2.spec.js:113 'confirmDialog' is defined but never used` |
| `supplier-uat-browser` / `--project technical` | 8 passed | **9 passed** — my probe now runs as a module test |
| source fingerprint | `5e79c3b1…`, matching `state.baseline` | **`b7e9ee4d…`**, matching nothing |

The lint one is the immediate problem: `lint` is a DEVELOPER suite in `00_project_profile.json` with
`result_adapter: EXIT_CODE`, so the branch currently fails its own gate. I confirmed the cause is
only this file — `eslint . --ignore-pattern client/e2e/supplier-management/rev029probe2.spec.js`
exits 0 — and that the file does not exist at `26d8a4c`.

The nine-case run is the more insidious one, because **it passes**. `testMatch: "*.spec.js"` picks up
anything in that directory, so a junk probe with a `@technical` tag becomes part of the module's
formal browser evidence and stays green forever.

The fingerprint move is the one this module has paid for before: observations are bound to
`5e79c3b1…`, and the recorded remediation evidence for `50658a8` no longer describes the head.

**Resolved while this report was being written.** `86bfc35` ("untrack a reviewer probe I committed by
accident") removed the file, and I deleted the copy that my own `git restore` had left in the
worktree. Re-verified at `86bfc35`:

```
npm run lint                                   exit 0
--project technical                            8 passed
source fingerprint   5e79c3b190e6fe1b64c2c15d8d772b17b9296f68249f494e5d70cddb2e071a6f   (as reviewed)
design baseline      e4083319e526682f70b40a0b2676ae5b50cc72d8f03e9e07c6d6fbb671f211e4   (unmoved)
plan baseline        a0d41e31d887447d669d0f8252991e43fcdd273eb9eadcbe0d211468092bd154   (unmoved)
```

The fingerprint returning to exactly `5e79c3b1…` is the part worth noting: the removal restored the
head to the source state the ledger already describes, so the recorded remediation evidence for
`50658a8` is valid again and no approval was stranded. Nothing is outstanding.

**The systemic half, which will recur.** The mechanism was a blanket stage inside a docs-only commit.
Any reviewer or agent with a scratch file on disk at that moment gets it committed, and the commit
message will describe something else entirely. Two cheap mitigations, offered rather than raised as a
finding: have doc-recording commits name their paths explicitly instead of staging everything, and
narrow `testMatch` to the specs the suite actually owns so a stray `*.spec.js` cannot silently join
the evidence. I have kept my own probes out of the repository since; the two I ran after this one
were written and deleted inside a single command.

---

## Findings I could not confirm closed

None. All nine REV-028 findings are closed, each by a mutation that now fails or a probe that now
behaves differently.

Two things I am recording plainly rather than dropping, because both are places where my own REV-028
report was the thing that was wrong:

- **M-2**: my recommended fix was worse than what was shipped. A blanket catch would have reported
  NOT_READY on evidence that does not support it. I re-ran the probe six ways before saying so.
- **L-5**: my "one-word change" was false. The profile is inside the plan baseline, and I proved the
  digest moves. HD-023's exception is the correct disposition.

The residue I am leaving open is M-1, which is genuinely new — it was invisible at `5fb3a4c` because
H-1 already put the same page in the same error boundary by a shorter route. Closing H-1 is what made
it observable.
