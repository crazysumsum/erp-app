# Supplier Management — PHASE-002 TASK-027 Independent Review (REV-028)

## Decision

**`CHANGES_REQUESTED`** — **0 Critical, 2 High, 2 Medium, 5 Low.**

> The code is right. Two of the controls it is right about have no test that can fail, and one
> error path was never rendered.
>
> **H-1** is the only behavioural defect: when `GET /api/v1/supplier-settings` fails, the page does
> not show an error — it crashes. `settings` stays `null`, `loading` still goes `false`, and the
> `v-else` branch dereferences it. A real browser shows the framework error boundary reading
> *"呢一頁出咗問題：Cannot read properties of null (reading 'requireActivationApproval')"*. The author
> anticipated the rejection — there is a `notifyError` for it in `onMounted` — but the template was
> never guarded. The readiness read got the careful treatment; the settings read did not.
>
> **H-2** is the REV-026/REV-027 pattern again, on the control the commit message singles out.
> Both the vitest case and the Playwright case build the conflict fixture so that **the server's
> post-conflict value equals the value the user just clicked** (both `true`). A page that reloads
> and then overwrites the reloaded value with the user's click passes both suites. I applied that
> mutation: **survived vitest 9/9 and Playwright 6/6**. Changing one word in the e2e fixture
> (`approvalOn: true`, so the user clicks OFF against a server holding ON) kills it immediately and
> still passes on clean code. The recorded evidence says the browser test "pins" this. It does not.
>
> Everything else held up under attack. 27 of 29 mutations died, the permission is exactly
> `supplier.settings` at runtime, the whitelist projection is real, HD-022 is honoured to the letter
> with no Business Master file touched, and DEF-018 reproduces exactly as recorded.

## Provenance

| Item | Value |
| --- | --- |
| Reviewer | REV-028, fresh; no prior involvement in TASK-027 |
| Reviewed head | `13e7ab4c5d15629b5e8cd31a9c80887238275515`; the only commit with source changes is `5fb3a4c2d7a3cd36586e3cb2556f95d5e75e895b` |
| Diffed against | `6899a02` (current `origin/main`) |
| Source fingerprint | `8515273a383fd263f60644430729e25c3b06de48307bca446f026cc998ca1e60` — **recomputed independently**, not copied from the ledger |
| Spec baseline | `a0d41e31d887447d669d0f8252991e43fcdd273eb9eadcbe0d211468092bd154` |
| Branch / worktree | `codex/supplier-task-027` @ `/Users/sam/Documents/workspace/erp-app-worktrees/supplier-task-027` |
| Tree at start | clean |
| Tree on exit | clean apart from this report; every probe file and Playwright artifact removed |

Source diff reviewed: 8 files, +859/−0. `businessMasterReadinessHandler.js` (+77),
`SupplierSettingsPage.vue` (+190), `supplierSettings.js` (+25), `supplier-settings.spec.js` (+239),
`playwright.config.js` (+43), and three test files. `13e7ab4` is ledger and evidence only.

I recomputed the fingerprint with the harness's own `harness_core.fingerprint()` against this
worktree and got `8515273a383fd263f60644430729e25c3b06de48307bca446f026cc998ca1e60` — an exact
match for the value the coordinator supplied and the value in all four observations.

---

## The mutation run

29 mutations, applied one at a time with the file restored between each. Baselines: vitest
`settings.test.js` + `supplierSettings.test.js` 9+3 pass / 0 fail; `supplierLookupHandlers.test.js`
+ `handlerConventions.test.js` exit 0; Playwright `--project technical` 6 passed.

**27 killed, 2 survived.** The two survivors are H-2 and M-1.

### Client — 15 mutations, 14 killed

| # | Mutation | Result |
| --- | --- | --- |
| C1 | page gate widened to `["supplier.settings","supplier.view"], match:"any"` | killed |
| C2 | `page.requires` removed entirely | killed |
| C3 | `reason` dropped from the update payload | killed |
| C4 | `password` replaced by `""` | killed |
| C5 | `requireReason: true` → `false` | killed |
| C6 | loaded `version` replaced by the constant `1` | killed |
| C7 | `version` omitted from the request | killed |
| C8 | VERSION_CONFLICT silently retried with a fresh version | killed |
| C9 | missing readiness parts collapsed to a generic "尚未就緒" | killed |
| C10 | `missingParts` always `[]` | killed |
| C11 | non-retroactive wording replaced | killed |
| C12 | readiness failure rethrown, taking the page down | killed |
| C13b | cancel proceeds with an empty reason and password | killed |
| C14 | `signed: true` dropped from the settings update | killed |
| C15 | readiness read redirected to `/api/v1/business-master/currencies` | killed |
| **A** | **conflict: reload, then overwrite with the user's clicked value** | **survived — see H-2** |

### Server — 12 mutations, 11 killed

| # | Mutation | Result |
| --- | --- | --- |
| S1 | permission widened to `["supplier.settings","supplier.view"]` | killed |
| S2 | permission replaced by `["supplier.view"]` | killed |
| S3 | `match: "any"` added | killed |
| S4 | policy name typo `hasPermission` → `hasPermissions` | **survived the targeted suite** — see L-1 |
| S5 | `authorizationPolicies` removed entirely | killed |
| S6 | projection replaced by `{ ...result }`, leaking `checkerIds` | killed |
| S7 | one projected field (`hkdReady`) dropped | killed |
| S8 | handler fails closed on NOT_READY instead of reporting it | killed |
| S9 | request schemas opened (`additionalProperties: true`) | killed |
| S10 | response schema opened | killed |
| S11 | path moved under `/api/v1/business-master/…` | killed |
| S12 | `authType` pinned explicitly | killed |

### Browser — 2 mutations aimed at the Playwright spec specifically

| # | Mutation | vitest | Playwright |
| --- | --- | --- | --- |
| A | conflict reload then overwrite with the user's click | **survived** | **survived** |
| B | `<q-btn label="新增貨幣" @click="…">` added inside the dependency card | killed | **survived** — see M-1 |

---

## Findings

### H-1 — a failed settings read crashes the page instead of showing an error

`client/src/pages/suppliers/SupplierSettingsPage.vue:73-81` and `:127-147`

`onMounted` awaits `Promise.all([loadSettings(), loadReadiness()])`. `loadReadiness()` swallows its
own failure into `readinessError`; `loadSettings()` does not, so a rejection propagates to the
`catch`, fires `notifyError`, and the `finally` sets `loading = false` with `settings` still `null`.
The template then enters `v-else` and evaluates `settings.requireActivationApproval` at `:134` and
`:141`.

Reproduction, in a real browser against the real dev server:

```js
// temporary spec, rev028load.spec.js — removed afterwards
if (method === "GET" && path === "/api/v1/supplier-settings")
  return fail(500, "INTERNAL_SERVER_ERROR", "Internal server error");
```

```
PROBE_URL:           http://127.0.0.1:5203/suppliers/settings
PROBE_TOGGLE_COUNT:  0
PROBE_SPINNER:       0
PROBE_BODY_TEXT:     … error 呢一頁出咗問題：Cannot read properties of null
                     (reading 'requireActivationApproval') warning 系統發生錯誤 …
PROBE_CONSOLE:       ["Failed to load resource: the server responded with a status of 500 …"]
```

The framework error boundary contains it, so nothing else breaks — but the page is gone, and the
user is shown a raw JavaScript `TypeError` string. Every realistic trigger is a live one: a 500, a
network drop, a request timeout, or a 403 after a role change invalidates the session's claims.

No test covers it. `settings.test.js` has `a readiness failure does not take the toggle down with
it`; there is no counterpart for the settings read, and `mountPage()` cannot construct one because
it only parameterises `readinessError`.

This is DoD 1.4 #1 — *error／edge paths已覆蓋* — unmet on the page's own primary read.

**Fix.** Guard the branch and give the failure a state of its own:

```diff
-    <div v-else class="column q-gutter-md q-pa-md">
+    <div v-else-if="settings" class="column q-gutter-md q-pa-md">
```

plus an `v-else` block carrying a load-failure message and a retry, and a `settingsError` ref set in
`onMounted`'s `catch` beside the existing `notifyError`. Add the mirror-image test to
`settings.test.js` (`mountPage({ settingsError: … })` asserting the page renders an error and not a
crash) and one `@technical` browser case, since §9 makes the rendered result the thing that counts.

---

### H-2 — the version-conflict control has no test that can fail

`client/test/pages/suppliers/settings.test.js:99-115` and
`client/e2e/supplier-management/supplier-settings.spec.js:198-210`

Both fixtures start the toggle **OFF**, have the user click it **ON**, and have the server's
post-conflict value be **ON**. The value the page must show and the value it must not show are the
same value. The assertion `aria-checked === "true"` therefore cannot distinguish "shows the server's
value" from "shows the user's click".

Mutation A, applied to `SupplierSettingsPage.vue:107-110`:

```js
if (error.code === "VERSION_CONFLICT") {
  await loadSettings();
  settings.value = { ...settings.value, requireActivationApproval: target };  // <- added
  notifyError("設定已被其他人修改，已重新載入目前值，請確認後再儲存");
}
```

That is the exact failure the AC forbids: the user re-confirms against a value the server does not
hold. Results:

```
vitest  settings.test.js                     9 passed   <- survived
npx playwright … --project technical         6 passed   <- survived
```

The `get` call-count assertions (`toHaveBeenCalledTimes(2)`, `toHaveLength(2)`) survive it too,
because the mutant *does* reload — it just discards the answer. The author's own recorded mutation
was "not reloading after VERSION_CONFLICT", which those call-counts do catch; the stronger mutant
was never tried.

**Negative control.** One word makes the fixture discriminate. In the e2e case:

```diff
-  const state = await installApi(page, { conflictOnce: true });
+  const state = await installApi(page, { conflictOnce: true, approvalOn: true });
```

The user now clicks **OFF** while the server moves to **ON**, so the two values differ.

| | mutated page | clean page |
| --- | --- | --- |
| shipped fixture (`approvalOn` unset) | **1 passed** | 1 passed |
| discriminating fixture (`approvalOn: true`) | **1 failed** | **1 passed** |

I ran all four cells. The mutant dies only in the bottom-left; the fix passes on clean code, so this
is a one-line change, not a redesign.

The same correction is needed in `settings.test.js:99-115`: start from
`{ ...SETTINGS_OFF, requireActivationApproval: true }` and have `get` resolve to a server value that
differs from `target`.

**This also falsifies two recorded claims.** The commit message says the browser test "pins [it] by
asserting the toggle shows the server's ON rather than the user's click", and the Playwright
observation says the run covered "VERSION_CONFLICT reloading the server's value rather than the
user's click". Neither is true as written — the user's click was also ON. The ledger entries should
be corrected along with the fixtures.

---

### M-1 — the browser "read-only dependency panel" case does not check for write controls

`client/e2e/supplier-management/supplier-settings.spec.js:225-226`

The author correctly replaced a text-substring ban after finding it both false-positive (the
explanatory sentence itself contains 「新增或修改」) and too narrow. The vitest replacement is strong
— `settings.test.js:130-133` walks every `button, a` in the card and requires an
`href` under `/system/business-master/`, *and* bans form fields. **The Playwright replacement kept
only the second half:**

```js
await expect(card.locator("input, textarea, select")).toHaveCount(0);
```

Mutation B adds a plain catalog write button inside the second card:

```html
<q-btn color="primary" label="新增貨幣" @click="alert('write')" />
```

```
vitest      1 failed | 8 passed   <- killed, on the button/href loop
playwright  1 passed              <- survived
```

A `q-btn` with no `:to` renders a `<button>` with no `href` and no form field, so it walks straight
through. Under CLAUDE.md §9 the browser result is part of Definition of Done, and this case is named
for exactly the control it does not check — so AC bullet 3's browser half is unarmed.

**Fix.** Port the vitest loop into the spec:

```js
for (const control of await card.locator("button, a").all()) {
  await expect(control).toHaveAttribute("href", /^\/system\/business-master\//u);
}
```

---

### M-2 — NOT_READY is unreachable for the most likely cause of NOT_READY

`server/src/handlers/supplier-lookups/businessMasterReadinessHandler.js:64-65`, via
`server/src/modules/businessMaster/BusinessMasterReadinessService.js:22-33`

The handler's docblock says it deliberately avoids `assertReady()` because "呢條 route 嘅工作正正係
報告 NOT_READY". That is true of `assertReady`, and `schemaReady` is one of the three parts the page
renders by name ("資料表尚未建立或版本不符"). But `inspect()` queries `currencies` and `payment_terms`
**unconditionally and before** computing `schemaReady`, with no `try`. Only the `schemaInspector`
call at `:35-39` is guarded. If the Business Master tables are absent — the ordinary way for
`schemaReady` to be false — MySQL raises `ER_NO_SUCH_TABLE` and the route 500s.

Proved against the **real** service and the **real** handler with a database double that fails the
way MySQL fails:

```
$ node readiness_probe.mjs
THREW: ER_NO_SUCH_TABLE | Table 'erp_dev.currencies' doesn't exist
```

So the page falls into `readinessError` and shows a generic read failure, never the specific
"資料表尚未建立或版本不符" that AC bullet 3 asks for. The only reachable `schemaReady: false` is the
narrow case where the tables exist but are structurally incompatible.

Nothing can see this, because `supplierLookupHandlers.test.js:9-13` replaces `handler.readiness`
with `{ async inspect() { return readiness; } }` after construction. Every readiness test asserts
against a hand-written object; the real service never runs on this path. That is the same shape as
REV-020's M2 (a fake recorder meaning the real audit service never ran).

**Fix**, and it stays inside the module boundary — `server/src/modules/businessMaster/**` is not a
Supplier write path, so the service itself cannot be changed here:

```js
async execute() {
  let result;
  try {
    result = await this.readiness.inspect();
  } catch {
    result = { status: "NOT_READY", providerContract: BusinessMasterProvider.contract,
               schemaReady: false, hkdReady: false, permissionsReady: false,
               activeCurrencyCount: 0, activePaymentTermCount: 0 };
  }
  …
}
```

with a test that drives the real `BusinessMasterReadinessService` over a throwing database double.
If that is judged to over-report (a transient DB outage would read as "not ready"), the minimum is
to narrow the handler's docblock claim, since it currently promises more than the code delivers.

---

### L-1 — a policy-name typo survives both the new test file and the module's declared gate

`server/src/handlers/supplier-lookups/businessMasterReadinessHandler.js:23`

S4 renames `hasPermission` to `hasPermissions`. `supplierLookupHandlers.test.js:36-37` destructures
`policy.options.permissions` and never looks at `policy.name`, so the targeted suite stays green.
The `supplier-phase-001-server` suite — the module's own 298-test gate — does not include
`applicationFactory.test.js` either.

It is caught, loudly, one layer out:

```
$ node --test … server/test/applicationFactory.test.js
ℹ tests 7   ℹ pass 4   ℹ fail 3
  Error: Unsupported authorization policy for get /api/v1/supplier-lookups/business-master: hasPermissions
```

`authorizationPolicyRegistry.js:131` throws at route registration, and `:120` does the same for
missing policies, so the framework fails closed at boot rather than silently unauthorised.
**Non-blocking.** One line would close it locally: `assert.equal(policy.name, "hasPermission")`.

### L-2 — no browser case for the denied user

AC bullet 1 says 「直接URL與API仍分別由guard／server拒絕」. C1 and C2 prove the page metadata half is
armed, and the route guard is framework-tested generically, but nothing binds the two for this page
and no `@technical` case exercises a denied actor.

I verified it myself with a throwaway spec (removed afterwards), signed in as a holder of
`supplier.view` + `business_master.view` but **not** `supplier.settings`:

```
REV028_URL:                 http://127.0.0.1:5203/403
REV028_MENU_HAS_SETTINGS:   0
REV028_TOGGLE_COUNT:        0
REV028_SETTINGS_CALLS:      (none)
```

Correct on all four counts — redirected, absent from the menu, no toggle, and no Supplier API call
attempted. `buildMenu.js:17` and `routeGuard.js:27` both run `can(session, page.requires)`, so the
menu and the URL are held by the same metadata C1/C2 pin. **Non-blocking**, but that evidence is
mine, not the suite's; it costs about eight lines to make it the suite's.

### L-3 — the policy and the empty schema are redefined rather than imported

`businessMasterReadinessHandler.js:18` and `:22-25`

`server/src/handlers/supplier-settings/settingsSchemas.js:6` already exports a byte-equivalent
`EMPTY_OBJECT_SCHEMA`, and the same file exports `SUPPLIER_SETTINGS_POLICY`. The new handler defines
both again locally, and `supplierLookupHandlers.test.js:39-43` then deep-equals the two policies so
they cannot drift. Recording rather than raising: the duplication is deliberate, the drift is
guarded, and importing across two handler directories has its own cost. A future reader should know
the guard is a test, not the type system.

### L-4 — every Playwright run dirties the working tree

`client/test-results/` and `supplier-browser.xml` (repo root) are produced by
`playwright.config.js:9` and `:24` and are **untracked but not ignored** — `git status` shows both as
`??` after any run. Neither is committed, which is right, and `.gitignore` is an
`approval_required_paths` entry, so the author's decision not to touch it holds and was the correct
call.

But DoD asks for a clean tree while §9 mandates browser runs, and those two pull against each other
on every future supplier task. Worth an HD to add the two entries, or a config change putting both
under an already-ignored directory.

### L-5 — the new service test is outside the module's declared client gate

`00_project_profile.json` → `supplier-phase-001-client` runs
`test/pages/suppliers test/services/supplier.test.js`. That positional filter matches
`supplier.test.js` literally and **not** `supplierSettings.test.js`, which is why the suite reports
49 and not 52. I confirmed both numbers:

```
test/pages/suppliers + test/services/supplier.test.js   →  11 files, 49 tests   (the declared gate)
test/pages/suppliers + test/services/supplier           →  12 files, 52 tests
```

So the three assertions that hold `signed: true` and the "never the owner's endpoint" rule sit
outside the module's own gate. They do run in CI — `.github/workflows/ci.yml:114` runs
`npm run test:coverage`, which is the full 544 — so this is a gate-completeness issue, not a
coverage hole. The profile lives under `docs/supplier_management/**` and is writable here; widening
the filter to `test/services/supplier` is a one-word change.

*Also noted, not a finding:* `supplier-client-ui` points at
`client/test/supplier-management.vitest.config.js`, which does not exist. That entry is identical on
`origin/main`, so it is pre-existing and not a TASK-027 regression.

---

## Claims, and how each was established

| Claim | Verdict | How |
| --- | --- | --- |
| Page gated on `supplier.settings` alone | **Verified** | C1/C2 die; browser probe redirects a `supplier.view` holder to `/403` with no menu item and no API call |
| The route requires exactly `supplier.settings`, nothing weaker or wider | **Verified** | S1/S2/S3/S5 die; **runtime registration log** shows `authType:"jwt"`, `permissions:["supplier.settings"]`, `match:"all"` |
| Saving demands reason, password, an approved device, and the loaded version | **Verified** | C3/C4/C5/C6/C7/C14 die; e2e asserts the `X-Device-*` header and `version: 4` on the wire |
| A VERSION_CONFLICT is not retried | **Verified** | C8 dies |
| …and the page shows the **server's** value, not the user's click | **FALSIFIED as tested** | mutation A survives both suites; see **H-2** |
| Dependency card is read-only, no Supplier write to the catalog | **Verified by vitest only** | mutation B dies in vitest, **survives Playwright**; see **M-1** |
| …and names which part is missing when NOT_READY | **Verified** | C9/C10 die; e2e asserts the chip and the named part separately |
| Handler projects a whitelist; `checkerIds` cannot leak | **Verified** | S6 dies; S7 dies; response schema is closed and validated at runtime (`BaseRequestHandler.js:195`) |
| Handler reports NOT_READY rather than failing closed | **Partly true** | S8 dies, but the real service throws when the tables are absent; see **M-2** |
| No code path calls `/api/v1/business-master/*` from the Settings page | **Verified** | C15/S11 die; the page imports no Business Master service; e2e asserts it across a full ON→OFF session |
| 298/298 server | **Verified** | re-ran the exact profile argv with `DB_INTEGRATION_TESTS=1`: `tests 298, pass 298, fail 0, skipped 0` |
| 49/49 supplier client suite | **Verified** | 11 files / 49 tests — and see **L-5** for what is not in it |
| 544/544 full client | **Verified** | 69 files / 544 tests, 0 fail |
| lint clean, client build clean | **Verified** | both exit 0 |
| 6/6 Playwright technical | **Verified** | 6 passed against real Chromium and the real dev server on 5203 |
| Seven targeted mutations all killed | **Accepted, and superseded** | I did not re-run the author's seven; my 29 include all seven shapes, and two of mine survive |

Full server suite, for completeness: **1747 tests, 1744 pass, 2 fail, 1 skipped**. Both failures are
Item Management and environmental — `TC-016` asserts `DB_ADMIN_USER is required for recovery
integration setup` (unset in the supplied `.env`) and `TC-001` compares `item_categories` DDL against
drift in the shared `erp_dev`. Neither is reachable from eight added files, none of which is a
migration. *Accepted on reasoning; I did not re-run the full suite at the parent commit.*

---

## Module boundary

Clean. All eight changed paths fall inside `allowed_write_paths`:

| Path | Allowed by |
| --- | --- |
| `server/src/handlers/supplier-lookups/**` | listed explicitly — HD-022's "no manifest edit, no stranded approvals" claim is **correct as stated** |
| `client/src/pages/suppliers/**`, `client/src/services/supplier*.js` | listed |
| `client/test/**`, `client/e2e/**`, `server/test/**` | listed |

No `approval_required_paths` entry is touched: `.gitignore` and `client/config/menu.js` are both
untouched, confirmed from the commit's file list. The menu decision holds for a second reason — pages
are discovered by `import.meta.glob` (`discovery/pages.js:5`) and `menu.group: "suppliers"` already
exists in `menu.js`, so no edit was needed to make the page appear.

HD-022 is honoured exactly: Business Master is not modified at all, the route is Supplier-owned, and
it is authorised with a Supplier permission. Design §6.7's row describing a direct UI call is the
stale standing exception HD-022 records; I did not re-litigate it and the code matches the decision
rather than the stale row. HD-022's own open note — that `SupplierBasicForm.vue` and
`SupplierPaymentDefaults.vue` still call Business Master directly — remains open and untouched here,
which is the right scope call for a task whose AC is the Settings page.

---

## DEF-018

**Independently reproduced, exactly as recorded.** `PasswordReasonDialog.vue:73` puts the confirm
button in `<q-card-actions>`, outside the `<q-form>` opened at `:51`, with no `type="submit"` and no
`form` attribute. The form then holds two text inputs and zero submit buttons — the case where HTML
implicit submission does not fire.

Throwaway probe (removed afterwards), filling both fields and pressing Enter in the password field:

```
DEF018_UPDATE_CALLS:         0
DEF018_DIALOG_VISIBLE:       true
DEF018_SUBMIT_BUTTONS_IN_FORM: 0
DEF018_INPUTS_IN_FORM:       2
DEF018_TOGGLE:               false
```

The claim is true. Not fixed here, correctly — `client/src/framework/ui/**` is outside the Supplier
module entirely, not merely approval-required.

**The browser test does not enshrine the broken behaviour.** `supplier-settings.spec.js:184-192`
walks the tab order to the confirm button and presses Enter *there*; it makes no assertion that Enter
in a field fails, so when the framework owner fixes the dialog the test keeps passing unchanged.
That is the right shape.

---

## Acceptance criteria

| T27 criterion | Status |
| --- | --- |
| 只有 `supplier.settings` 可看到／進入頁面；直接 URL 與 API 各自由 guard／server 拒絕 | **Met.** C1/C2 die; runtime log confirms the route policy; browser probe confirms `/403`. L-2: no shipped browser case for the denial |
| Toggle 保存要求 reason、password、approved device 及 version | **Met**, six mutations die on it |
| conflict 重載後要求重新確認 | **Code is correct; unverifiable as tested** — H-2 |
| Currency／Payment Term 只顯示 readiness 及唯讀連結；無 create／update／deactivate 或 Supplier write | **Met in code and in vitest; unverified in the browser** — M-1. Naming the missing part is met, with the M-2 gap on `schemaReady` |
| Verification: focused client tests, client build, Playwright per §9 | **Run and green**, all re-run by me |
| DoD 1.4 #1 — 新增行為有先失敗後通過的測試，error／edge paths 已覆蓋 | **Not met.** H-1 (settings-read failure never rendered), H-2 and M-1 (controls with no failing test) |
| DoD 1.4 #2 — focused, regression, lint, build | **Met** |
| DoD 1.4 #4 — 無重複邏輯、dead code、debug output、敏感資料洩漏 | **Met.** See "no leak" below; L-3 is the one duplication, and it is guarded |

### No secret leak, and I checked rather than assumed

- `POST /api/v1/supplier-settings/update` registers with `logging.bodyCapture: "none"` — read out of
  the **runtime registration log**, not the source. Nothing carrying `reason` or `password` reaches
  the log files; a grep for a `"password"` key across `server/logs/**` returns nothing.
- Both fields travel in the POST body. Neither reaches a URL, a query string, a toast or a route.
- The client cannot display a server internal: `errorHandler.js:70-71` serialises only
  `publicCode`/`publicMessage`, and an unhandled handler error is forced to
  `INTERNAL_SERVER_ERROR` / `"Internal server error"` (`BaseRequestHandler.js`, `errorHandler.js:31`).
  So `readinessError.value = error.message` at `SupplierSettingsPage.vue:69` can only ever render a
  public string. *Established by reading the error path, not by an HTTP probe.*
- H-1's crash message is a **client-side** `TypeError`, not server data — it discloses nothing, but
  it is still a raw JS string in front of a user.

---

## What is done well

- **The handler follows the established pattern exactly.**
  `new BusinessMasterReadinessService({ database, checkerIds: ["supplier"] })` is what
  `createSupplierHandler.js:27`, `supplierUpdateHandlers.js:35`, `supplierLifecycleHandlers.js:46`
  and `approvalHandlers.js:60` already do. A new route directory, and zero new wiring idiom.
- **The whitelist projection is load-bearing, not decorative.** S6 and S7 both die, and the test
  comment correctly identifies that the closed response schema turns a leak into a 500 — "兩個都唔想
  要" is the right reading.
- **The permission reasoning is right and pinned from both ends.** Design §4.3 says the catalogue has
  no implicit inheritance; the handler does not assume a `supplier.settings` holder also has
  `supplier.view`, and `supplierLookupHandlers.test.js:39-43` pins it against the settings handler so
  the two cannot drift apart. S1, S2, S3 and S5 all die.
- **The vitest read-only assertion is genuinely strong.** The author replaced a text-substring ban
  after it proved wrong, explained why in the test itself, and the structural replacement kills a
  write button. That the *Playwright* copy kept only half of it is M-1 — but the thinking was right.
- **DEF-018 was found by probe and raised rather than absorbed.** The author proved it, routed it to
  the framework owner, kept the fix out of a module that does not own the file, and wrote the browser
  test around the real keyboard path instead of around the bug.
- **HD-022 is followed to the letter.** Business Master is untouched, `VIEW_POLICY` is not widened,
  and the Business Master audit route is not handed to `supplier.view` holders.

## What I tried that found nothing

Recording these so the clean result means something: a permission wider than claimed or bypassable
by role (S1–S5, C1–C2, the runtime registration log, and the denied-user browser probe); the password
or reason in a log, URL, toast or error body (log grep, `bodyCapture`, the `publicMessage` path); a
write request to the Business Master catalog from the Settings page (C15, S11, the import list, and
the e2e whole-session network assertion); an unregistered or misprefixed route
(`handlerConventions.test.js`, plus the live registration record); a response schema that would
reject a legitimate runtime value (S7/S9/S10, and the `required` list is exactly the seven projected
keys with `providerContract` a static string constant); and a manifest or approval-path violation
(all eight files checked against `allowed_write_paths`). None of these turned anything up.

## Recommended path

H-1 and H-2 are both small. H-1 is a `v-else-if` plus an error state and two tests. H-2 is one word in
each of two fixtures, and I have already shown the corrected e2e fixture passes on clean code and
kills the mutant. M-1 is four lines ported from the vitest test. M-2 needs a decision — handle the
throw or narrow the claim — and is the only one worth a conversation.

The two ledger entries that state the browser test pins the server-value behaviour should be
corrected alongside the fixture, since the next reviewer will otherwise inherit the same false
assurance.
