# Supplier Management — PHASE-002 TASK-030 Independent Review (REV-030)

## Decision

**`CHANGES_REQUESTED`** — **0 Critical, 1 High, 2 Medium, 5 Low, 3 Nit.**

> **I found no product defect.** Every behavioural claim in the commit message is true of the
> shipped code, and I established the load-bearing ones by mutation rather than by reading. The
> block is entirely about what the tests can and cannot catch.
>
> **H-1 is the fifth consecutive instance of this module's signature failure: a control that exists,
> works, and has no test that can fail.** The detail's "mark what differs" marking — named in T30's
> second acceptance criterion and in design §7.6 — is asserted by `expect(body.text()).toContain("已變更")`.
> That string is already on the page before the diff table is consulted, because the stale chip
> reads 「提交後已變更」. I deleted the marker entirely and both layers stayed green. I then inverted
> it, marking *every* field as changed — the direction that actively misleads an approver — and both
> layers stayed green again. The browser case named "shows the difference" never looks at the
> marking either.
>
> **I proved this is a test gap and not a broken feature, in four cells.** Strengthening the
> assertion to read the two rows separately passes against the shipped product, and kills both
> mutants. The remediation is five lines in `approvals.test.js`; no product change is needed. I have
> written the exact assertion into H-1 below.
>
> **M-1 is the same shape, spread thin.** Five of the six `notifyError` paths added by this commit
> have no test at all. One of them matters more than the rest: I replaced the panel's policy-read
> failure handler with `policyKnown = true; requireApproval = false` — that is, treating an unknown
> activation policy as "no approval needed", the precise thing HD-024 and the code's own comment say
> must never happen — and the suite stayed green. The server half of that same rule **is** tested:
> my matching server mutation died immediately. The client half is unguarded. There is no security
> bypass, because the server stays authoritative and answers `400 APPROVER_REQUIRED`; the cost is
> that a future edit can quietly reintroduce the posture HD-024 was written to forbid.
>
> **On HD-024 the implementation matches the decision exactly, and I checked all three of its
> claims by mutation, not by reading.** Adding `FOR SHARE` to the lookup dies. Defaulting a missing
> settings row to `false` dies. Widening the permission list by one entry dies, and so does flipping
> `match: "any"` to `"all"`. This is the best-tested part of the change.
>
> **The browser layer is not decoration here, and I can show it.** I removed `emit-value` from the
> reassign select — a defect where the page sends an option object where the API demands an integer.
> The vitest suite stayed green, because it assigns `wrapper.vm.reassignTarget` directly and never
> touches the select. Playwright failed. That is a real browser-only kill and it justifies the
> suite's existence. Which makes **M-2** the more pointed gap: the create page's approver selector —
> the acceptance criterion that motivated HD-024 and the new route in the first place — has no
> browser coverage at all.

## Provenance

| Item | Value |
| --- | --- |
| Reviewer | REV-030, fresh agent, no prior involvement in this module |
| Source commit reviewed | `1cf40ca230d60ca31275ee17c1913c6db2fc3685` (`1cf40ca`), diffed against `9b47061` |
| Head at review | `30f4f5bf9eb6fde625e18a53fbc818681a63c836` (`30f4f5b`) — ledger and evidence only; I confirmed it touches no source file |
| Source fingerprint | `bc8d0d32aab04b7b5a13326147475e6845fdd81d0e52157b4830a0227c52ff23` — **recomputed independently** with `harness_core.fingerprint`; matches `state.baseline.source_fingerprint` and the `code_commit` in all four evidence `run.json` files |
| Design baseline | `e4083319e526682f70b40a0b2676ae5b50cc72d8f03e9e07c6d6fbb671f211e4` — recomputed via `Context.baselines()`, unmoved since REV-029 |
| Plan baseline | `a0d41e31d887447d669d0f8252991e43fcdd273eb9eadcbe0d211468092bd154` — recomputed, unmoved |
| Branch / worktree | `codex/supplier-task-030` @ `/Users/sam/Documents/workspace/erp-app-worktrees/supplier-task-030` |
| Tree at start | clean |
| Tree on exit | clean apart from this report; all probes ran from `/private/tmp`, every mutation reverted with `git checkout --`, `git status --porcelain` empty before and after each batch |

Source diff reviewed, `9b47061..1cf40ca`: `supplier-approvals.spec.js` (+241, new),
`SupplierApprovalPanel.vue` (+110, new), `SupplierApprovalsPage.vue` (+288, new),
`SupplierCreatePage.vue` (+33/−4), `supplierApproval.js` (+56, new), `approvals.test.js` (+243,
new), `create.test.js` (+67), `activationPolicyHandler.js` (+55, new), `SupplierSettingsService.js`
(+19), `supplierLookupHandlers.test.js` (+46). No migration, no schema, no permission catalogue
change.

### Module boundary

Clean. I listed the changed paths against `00_module_manifest.json` `allowed_write_paths` rather
than against the brief's summary. All ten files match a listed pattern —
`client/src/services/supplierApproval.js` under `client/src/services/supplier*.js`, and
`server/src/handlers/supplier-lookups/**` is listed in its own right, which is why HD-024 needed no
manifest edit and stranded nothing. **Nothing outside the boundary changed.**

---

## The mutation run

**24 distinct mutations, 26 executions** (two were run in both layers). Applied one at a time, file
restored between each. Baselines reproduced by me before starting: vitest **562 pass / 70 files**;
`supplierLookupHandlers.test.js` **9 pass**; the module server suite **305 pass / 0 fail**;
Playwright `--project technical` **15 passed**; `npm run lint` exit 0; `npm run build --workspace
client` exit 0.

**17 killed, 7 survived.**

### Survivors

| # | Mutation | vitest | Playwright | Finding |
| --- | --- | --- | --- | --- |
| **M1** | delete the `・已變更` span and the `bg-orange-1` row class | green | green | **H-1** |
| **M1b** | `changed: detail.value.changedFields.includes(field)` → `changed: true` | green | — | **H-1** |
| **M13** | panel policy-read failure → `policyKnown = true; requireApproval = false` | green | — | **M-1** |
| **M14** | drop the panel's policy-failure `notifyError` | green | — | **M-1** |
| **M15** | drop the panel's approver-load `notifyError` | green | — | **M-1** |
| **M17** | drop the page's detail-load `notifyError` | green | — | **M-1** |
| **M18** | drop the page's reassign-options `notifyError` | green | — | **M-1** |

### Killed

| # | Mutation | Killed by |
| --- | --- | --- |
| M2 | drop `assignedApprover?.id === session.user?.id` from `canApprove` | `only the assigned approver may decide` |
| M3 | drop `!detail.value.stale` from `canApprove` | vitest stale case **and** the Playwright stale case |
| M4 | approve without `version` | `approving asks for the password and sends the request version` |
| M5 | reassign lookup without `excludeUserId` | vitest + Playwright `excludeUserId` assertions |
| M6 | success notification → a bare `"操作成功"` | three cases asserting `SUP-007` |
| M7 | `isRequester` always true | `the requester sees withdraw, and the approver does not` |
| M8 | send `approverUserId` regardless of policy | `does not offer an approver, or send one, when the policy is off` |
| M9 | remove the create page's "pick an approver" guard | `sends the chosen approver, and refuses to submit without one` |
| M10 | panel renders whatever the policy says | the policy-off create case |
| M11 | panel drops `excludeUserId: session.user?.id` | `offers an approver selector that excludes the actor` |
| M12 | panel never emits `policy` | the policy-on create cases |
| **M16** | **remove `emit-value` from the reassign select** | **Playwright only — vitest stayed green** |
| M19 | withdraw carries a password | vitest exact-args **and** the Playwright `password` assertion |
| S1 | missing settings row → `return false` | `a missing settings row is an error, never a silent no-approval-needed` |
| S2 | lookup takes `FOR SHARE` | `the policy read does not lock the settings row` |
| S3 | add `supplier.view` to the lookup's permission list | `the activation policy lookup is reachable by…` |
| S4 | `match: "any"` → `"all"` | the same case |

M16 deserves its own line. Sending the whole option object where
`APPROVAL_REASSIGN_SCHEMA.approverUserId` demands `{ type: "integer", minimum: 1 }` is a live 400,
and only the browser suite sees it. The vitest case reaches past the select
(`wrapper.vm.reassignTarget = 3`, `approvals.test.js:222`) and therefore cannot. The two layers are
genuinely covering different things here, which is the author's claim about the browser cases and
it holds up.

---

## Findings

### H-1 — the diff's "what changed" marking has no test that can fail, in either direction

`client/src/pages/suppliers/SupplierApprovalsPage.vue:97` (`changed:`), `:249` (row class), `:250`
(the `・已變更` span).
Tests: `client/test/pages/suppliers/approvals.test.js:101`;
`client/e2e/supplier-management/supplier-approvals.spec.js:149-165`.

T30's second acceptance criterion is "detail顯示snapshot與current diff", and design §7.6 says the
detail marks what differs. The control is implemented and it is **correct** — I verified that
separately, below. It is simply not tested.

The vitest case is named `shows the submitted snapshot beside the current Supplier and marks what
changed` and its marking assertion is:

```js
expect(body.text()).toContain("已變更");
```

The fixture for that case sets `stale: true`. `SupplierApprovalsPage.vue:234` therefore renders
`<q-chip … label="提交後已變更" />`, which contains `已變更`. The assertion is satisfied by the chip
before the diff table is reached — the same class of vacuous match as the 「提交時」/「提交時間」 wait
the author found and fixed in the browser helper, moved one layer down. The Playwright case asserts
the banner and `Evergreen Trading`, and never looks at the marking at all.

**Reproduction — four cells, all run:**

| product | assertion | result |
| --- | --- | --- |
| shipped | as written | green (562 / 15 passed) |
| **M1** — span and row class deleted | as written | **green, both layers** |
| **M1b** — `changed: true` for every field | as written | **green** |
| shipped | strengthened (below) | **green — the control works** |
| **M1** | strengthened | **red** (1 failed / 12 passed) |
| **M1b** | strengthened | **red** (1 failed / 12 passed) |

The fourth row is the one that matters: the shipped product passes the strengthened assertion, so
this is a missing test, not a broken feature, and the fix is test-only.

**Concrete fix** — replace `approvals.test.js:101` with:

```js
const rows = body.findAll("tbody tr");
const named = rows.find((r) => r.text().includes("名稱"));
const coded = rows.find((r) => r.text().includes("Supplier Code"));
expect(named.text()).toContain("已變更");
expect(coded.text()).not.toContain("已變更");
```

The second assertion is the one that kills M1b; without it, "mark everything" still passes. Please
add the equivalent to `supplier-approvals.spec.js:162` as well — a row-scoped locator rather than a
page-wide `getByText` — since the browser case carries the same name and the same gap.

### M-1 — five of the six new error paths have no test, and one of them reverses a recorded decision

- `client/src/components/suppliers/SupplierApprovalPanel.vue:58-62` — policy read fails
- `client/src/components/suppliers/SupplierApprovalPanel.vue:43-48` — approver load fails
- `client/src/pages/suppliers/SupplierApprovalsPage.vue:110-115` — detail load fails
- `client/src/pages/suppliers/SupplierApprovalsPage.vue:152-155` — reassign options load fails

Only `run()`'s catch (`SupplierApprovalsPage.vue:132-137`) is covered, by `a version conflict
reloads instead of retrying`. No test in either suite mocks `activationPolicy`, `eligibleApprovers`
or `get` rejecting. §1.4 Definition of Done requires "error／edge paths已覆蓋"; four new ones are
not.

The one to fix first is the panel's policy-read failure. The code comment at
`SupplierApprovalPanel.vue:59` states the posture explicitly — 「政策讀唔到：唔顯示 selector，亦都唔
假設答案」 — and HD-024 records the same rule for the server side, citing SEC-007. **M13** replaced
that handler with `policyKnown.value = true; requireApproval.value = false`, i.e. an unreadable
policy silently means "no approval needed". All 7 create cases stayed green.

Note the asymmetry, because it is the argument for fixing this rather than waving it through: the
**server** half of that identical rule is tested, and tested well — S1 (`return false` on a missing
settings row) died against `a missing settings row is an error, never a silent
no-approval-needed`. The client half has no such guard.

**Impact is bounded and I want to be accurate about it:** there is no approval bypass. With the
policy silently off, the create page submits `activate: true` with no `approverUserId` and the
server answers `400 APPROVER_REQUIRED` — I traced that path and the server is authoritative exactly
as HD-024 says. The cost is a regression risk against a decision that was deliberate enough to be
recorded, with nothing to catch it.

**Reproduction:** apply M13 or M14 or M15 or M17 or M18 (table above); run
`npm test --workspace client -- --run test/pages/suppliers/create.test.js` (or
`approvals.test.js`); observe green.

**Fix:** one case per component. Mock the service to reject; assert the selector stays hidden, that
`supplierService.create` is not called with an `approverUserId`, and that `notifyError` fired.

### M-2 — the create page's approver flow, the criterion that motivated HD-024, has no browser coverage

`client/e2e/supplier-management/` contains `supplier-approvals.spec.js` and
`supplier-settings.spec.js`. Neither loads `/suppliers/new`. I grepped the whole `client/e2e` tree
for 「啟用審批」 as rendered by the panel, 「提交審批」, `approverUserId` and `activation-policy`: the
only hits are the reassign body in the approvals spec and the *settings* page's own unrelated
heading.

T30's first acceptance criterion is the create page. It is the criterion that could not be met at
all before HD-024, and the reason the new route exists. `SupplierCreatePage.vue` is modified by this
commit, so CLAUDE.md §9 applies: a frontend change is not complete on unit tests and build success,
and "the affected user flow has been verified end-to-end" is part of its completion rule.

The unit coverage of this flow is genuinely good — M8 through M12 all died, covering both halves of
the control (the panel's `v-if` guard *and* the `@policy` wiring that arms the page's payload). So
this is not an unverified control in the H-1 sense. It is a Definition-of-Done gap, and M16 is the
reason not to dismiss it: the unit layer demonstrably cannot see a whole class of Quasar wiring
defect that the browser layer catches on the first click. The create page has an approver `q-select`
with `emit-value map-options` (`SupplierApprovalPanel.vue:83-96`) and the create test drives it with
`approver.vm.$emit("update:modelValue", 2)` (`create.test.js`), which is the same shortcut that let
M16 through on the other page.

**Fix:** one `@technical` case in a `supplier-*.spec.js` file — policy on, pick an approver from the
real select, assert the `POST /api/v1/suppliers` body carries `approverUserId`; and the policy-off
counterpart asserting the section is absent and the field is not sent.

### L-1 — reject is disabled on a stale request; the service allows it, and a browser assertion locks the divergence in

`client/src/pages/suppliers/SupplierApprovalsPage.vue:81-85` and `:266-267` —
`canApprove` gates **both** the 批准 and the 拒絕 button, and includes `!detail.value.stale`.

The claim under review is that the stale rule uses "the same comparison the service enforces". For
approve, that is exactly true and I verified the predicate is literally the same one:
`SupplierApprovalService.js:278` computes `stale` as `supplier_version !== current_supplier_version`,
and `:612` rejects the decision on the same inequality. Good.

For reject it is not. `SupplierApprovalService.js:588` reads:

```js
if (command.status !== "approved") return;
```

— the stale check is skipped entirely for reject and withdraw. Design §7.6 likewise names approve
only: 「snapshot stale 時禁止 approve」. So the UI refuses an action the service would accept, and
`supplier-approvals.spec.js:164` (`await expect(page.getByRole("button", { name: "拒絕" })).toBeDisabled()`)
asserts the divergence as intended behaviour, which means it will not be noticed later.

**Why this is Low and not higher.** I checked reachability rather than assuming it. A pending
request cannot currently go stale: `SupplierAdminService.js:342` invalidates the request on an
approval-significant change, `:356` re-syncs `supplier_version` on a non-significant one, `:444`
invalidates on a code change, `SupplierIdentifierService.js:79` invalidates, and no other
`UPDATE suppliers … version = version + 1` exists in the module. I also checked
`LIFECYCLE_COMMANDS`: no command lists `pending_approval` in `allowedFrom`, so lifecycle cannot bump
the version of a pending Supplier either. Both the service's check and the UI's are defensive, and
the service says so in its own comment at `:579-582`. Additionally the requester keeps an exit —
`isRequester` does not consult `stale`, so 撤回 stays available. Worth aligning the predicate and the
browser assertion with the service; not worth blocking on.

### L-2 — `readActivationPolicy` duplicates `getActivationPolicy` in a file with a written history of exactly that drift

`server/src/modules/supplier/SupplierSettingsService.js:81-88` and `:90-101`.

The brief asked whether the second exported reader belongs here and whether it duplicates the first.
It belongs here — it is a settings read, the file owns settings reads, and putting it in the handler
would put SQL in a handler. But it is a copy: same `SELECT`, same column alias, same
`supplierConflict("SUPPLIER_SETTINGS_MISSING", …)`, same `fromRow` projection. The only difference
is the `FOR SHARE` suffix.

This matters more in this file than it would elsewhere, because the file's own comment at
`SupplierApprovalService.js:410-412` records that a rule duplicated three times in this module had
already drifted, and that "H-A 就係第四份唔見咗". Two readers of the same setting can drift the same
way — change the error code or the projection in one and the other keeps the old behaviour silently.

One runner parameter removes it without adding an abstraction:

```js
async function activationPolicy(runner, { lock }) { … }
export const readActivationPolicy = (database) => activationPolicy(database, { lock: false });
export const getActivationPolicy = (connection) => activationPolicy(connection, { lock: true });
```

S2 already guards the lock half from the handler side, so the risk is the error and projection half.
Author's call; the duplication is six lines and §2 of the project guidelines cuts the other way.

### L-3 — the `FOR SHARE` rationale now documents the function that deliberately does not lock

`server/src/modules/supplier/SupplierSettingsService.js:60-70`.

The new function was inserted between `getActivationPolicy`'s existing JSDoc block and
`getActivationPolicy` itself. The result is two stacked comment blocks above `readActivationPolicy`:
the pre-existing one, which opens 「用 `FOR SHARE` 而唔係 `FOR UPDATE`」 and explains the locking
trade-off, and the new one, which explains why this function does **not** lock. They contradict each
other and both attach to the non-locking function; `getActivationPolicy` at `:90` is now
undocumented. Move the original block back down to `:89`.

### L-4 — `fieldErrors.approverUserId` is set but nothing renders it

`client/src/pages/suppliers/SupplierCreatePage.vue:130`.

`fieldErrors.value = { ...fieldErrors.value, approverUserId: "請選擇審批人" }` is written, but
`fieldError()` (`:62`) is passed only to `SupplierBasicForm`, and `SupplierApprovalPanel` declares no
`fieldError` prop (`SupplierApprovalPanel.vue:15-19`). `summaryIssues`/`unmatchedFieldErrors` is
populated only on the server-error path at `:113`, not here. The message never reaches the user; the
user sees `summaryMessage` at `:131` instead, which is what `create.test.js` asserts. Either wire the
field error into the panel's `q-select` (better — it puts the message on the control the user has to
fix) or drop the line. As written it is dead state that reads as if it does something.

### L-5 — the commit message's server test count reconciles with nothing I measured

The message says "259 supplier server". The recorded evidence
(`evidence/20260918T071904-a9595ae13204/run.json`) says `total: 305, passed: 305`, and re-running its
exact command reproduces **305 pass / 0 fail**. Narrowing to `server/test/supplier*.test.js` plus
`server/test/integration/supplier*.integration.test.js` gives **251**. I could not find a grouping
that yields 259. The evidence is right and the run is genuinely green; only the narrative number is
off. The other three counts in the message are exact: **562** client, **15/15** Playwright, lint and
build clean — all reproduced.

### Nits

- **N-1** `client/test/pages/suppliers/approvals.test.js:96` — `await button(body, "").exists();` is
  a no-op. `""` matches the first button unconditionally, `.exists()` is not awaited-on-anything and
  its result is discarded, and there is no `expect`. Delete the line.
- **N-2** `client/test/pages/suppliers/approvals.test.js:222` — `wrapper.vm.reassignTarget = 3`
  reaches past the select into component internals. M16 is exactly what that shortcut costs. The
  browser suite covers it today, so this is a preference, not a gap.
- **N-3** `client/src/components/suppliers/SupplierApprovalPanel.vue:65-70` — the 300 ms search
  debounce has no `onUnmounted(() => clearTimeout(searchTimer))`. Leaving the create page mid-typing
  fires `loadApprovers()` against an unmounted component, which can surface a `notifyError` on a page
  the user has already left.

---

## Claims: verified empirically vs. accepted on reading

**Verified by mutation or by re-running the suite (I broke it and watched it fail):**

| Claim | How |
| --- | --- |
| Selector appears only when the policy is on | M10 |
| Selector excludes the actor | M11 |
| `approverUserId` sent only when the policy is on | M8 |
| The page refuses to submit without an approver | M9 |
| The policy→page wiring is armed, not just present | M12 |
| Queue opens on `scope=mine`, switches to all/unassigned | re-ran both suites; M-free assertions discriminate (SUP-008 present/absent) |
| Stale request cannot be approved | M3, both layers |
| Only the assigned approver can decide | M2 |
| Reject and reassign demand a reason as well as a password | re-ran; `requireReason: true` asserted at both layers |
| Withdraw goes through the Supplier route and carries no password | M19 |
| Decisions carry the request version | M4 |
| Reassign lookup excludes the requester | M5 |
| Success notifications name the Supplier Code | M6 |
| The lookup does not lock | S2 |
| A missing settings row is an error | S1 |
| The lookup answers to any of mgmt/approval/settings | S3, S4 |
| 562 client / 15 Playwright / lint / build | re-ran all four, green |
| 305 module server tests | re-ran the evidence command, green |
| Source fingerprint, design and plan baselines | recomputed with `harness_core`, all three match |

**Verified by reading only (stated so you can weigh it):**

- The `stale` predicate is the same on both sides — `SupplierApprovalService.js:278` vs `:612`. I
  read both; I did not construct a live stale request, because I established it is unreachable
  through current write paths (see L-1) and building one would have meant writing to the DB outside
  the suite.
- The server's own authority on approver rules — `#assertActorMayDecide` at `:558-576`
  (`APPROVAL_NOT_ASSIGNED`, `APPROVER_MUST_DIFFER`, `APPROVAL_PERMISSION_LOST`). Covered by the T29
  suite, which I ran but did not mutate; T29 is not this review's subject.
- That the lookup route is actually reachable. I did not issue an HTTP request; I read
  `handlerRegistry.js:10-32`, which discovers handlers by recursive directory scan with no manifest,
  so a file in `handlers/supplier-lookups/` exporting a `BaseRequestHandler` subclass is routed by
  existence.
- Password handling. I grepped the three new client files for `console`/`logger` (none), confirmed
  all three decisions are POST bodies and `buildUrl` (`HttpClient.js:235-250`) only ever serialises
  the `params` object, and confirmed the success notifications interpolate only `supplierCode` and a
  fixed outcome string. **No password or reason reaches a URL, a log, a toast or an error body.**
- Schemas vs. runtime values. `pageSizeOptions` is `[10, 20, 50, 100]` and
  `APPROVAL_QUEUE_QUERY_SCHEMA.pageSize` allows `maximum: 100`, so the table cannot ask for a page
  size the API rejects. `excludeUserId` is `{ integer, minimum: 1 }` and both call sites pass
  `undefined` when the user is absent, which `buildUrl` drops rather than sending. **I found no
  schema that would reject a legitimate runtime value.**

**Not attempted:** I did not try to reproduce the author's own mutation ledger ("18 killed, 14 across
both layers, 4 aimed at the browser cases"). I ran my own 24 and report those. My M16 independently
confirms that browser-only kills exist on this change, which is the substance of that claim.

## What I tried that found nothing

Recording these so the absence is informative rather than assumed:

- **A permission wider than claimed.** S3 and S4 both die, so the lookup's three-permission `any`
  list is pinned by test. The queue page requires `["supplier.view", "supplier.approval"]`, matching
  `SUPPLIER_APPROVAL_POLICY` in `approvalSchemas.js:10-13`. This is *narrower* than §7.2's table,
  which lists `supplier.approval` alone for the page — but wider is the dangerous direction and the
  narrower choice is argued in the page header and correct against §6.4, since a `supplier.approval`
  holder without `supplier.view` would land on a page that 403s on every request. Not a finding.
- **A decision sent without a version.** M4 dies; all four call sites (`approve`, `reject`,
  `reassign`, `withdraw`) pass `request.version`, and I confirmed against the schemas that `version`
  means the *approval request* version, not the Supplier version, matching `#decide`'s check at
  `:508`.
- **A non-assigned actor able to decide.** M2 dies at the UI; `#assertActorMayDecide` blocks it at
  the service regardless. The reassign card is shown to any viewer of a pending detail, which looks
  wide until you read §6.4 — this period has no `approval.admin`, and cross-user reassign is
  explicitly granted to all `supplier.approval` holders.
- **A second vacuous wait of the 「提交時」 shape.** I read every Playwright locator in the new spec.
  `openDetail` waits on the diff table's `aria-label`, which exists only on the detail. `Evergreen
  Trading` appears only in the diff's current column (the header shows `Evergreen`). The scope
  switches wait on row content that changes between scopes. The notification waits are scoped to
  `.q-notification`. I found no second instance. The gap I did find (H-1) is the opposite shape — a
  *missing* assertion rather than a prematurely-satisfied wait.
- **Artifacts or probes escaping into the tree.** `playwright.config.js:30` writes reports and
  artifacts to `/private/tmp/supplier-management-playwright`, and `testMatch: "supplier-*.spec.js"`
  narrows discovery. I ran the browser suite three times and `git status --porcelain` was empty after
  each. All of my own probes ran from the scratchpad; none were written into the repo.

---

## Checkpoint J：T28–T30

On what I can see, two of the three bullets are met and one is short.

- **「Approval domain、API及UI happy／negative flows通過」— partly met.** Domain and API pass: 305/305
  with `DB_INTEGRATION_TESTS=1` against real MySQL. UI happy flows pass at both layers. The negative
  flows are where it is short: stale, non-assigned, cancelled dialog, version conflict, missing
  reassign target and policy-off are all covered and all mutation-proof, but the four failure paths
  in **M-1** are not covered at all, and **H-1** means one positive-path control is not covered
  either.
- **「Queue scopes、self rule、snapshot diff及reassign audit完成」— met except for snapshot diff's
  verification.** Scopes verified at both layers. Self rule enforced in the UI (`isRequester`,
  `canApprove`) and in the service (`APPROVER_MUST_DIFFER`). Reassign carries reason, new approver
  and version, and the audit write is T29's, which passes. The snapshot diff *renders* correctly —
  I verified the marking works with a strengthened assertion — but nothing in the repository proves
  it, which is H-1.
- **「Client build與server lint通過」— met.** `npm run build --workspace client` exit 0,
  `npm run lint` exit 0 across the repo.

**What Checkpoint J would still be waiting on:** H-1's assertion, and — if the checkpoint is read
alongside CLAUDE.md §9 rather than separately from it — M-2's create-page browser case. Both are
test-only. Neither requires a product change, and I have specified both.

Beyond the checkpoint, note that T31 remains the formal acceptance exit for SUP-CAP-02: settings/
activation races, double-approve, post-JWT permission revocation, disabled approver, IDOR and
unassigned reassign under real MySQL. Nothing in T30 pre-empts it, and nothing I found here moves
it.

## What is done well

- **HD-024 is implemented exactly as recorded, and it is the best-tested code in the change.** All
  four of my server mutations died, including the two subtle ones — the lock and the missing-row
  default. The handler answers one boolean and the response schema is `additionalProperties: false`
  with a single property, so `version`/`updatedBy` cannot leak into a route a creator can reach.
- **The author found and fixed a vacuous wait in his own work, and said so in the commit message.**
  The 「提交時」/「提交時間」 collision is precisely the failure mode I was sent to hunt, and it was
  already caught and replaced with a detail-only `aria-label` wait. Likewise the reassign options
  were moved off `@focus` — an unreachable load timing — onto detail open, with the reasoning
  written down. That reasoning is correct, and M5 and M16 both depend on that move to be able to
  kill anything.
- **Both halves of the create-page control are armed and tested separately.** M10 (the panel's own
  `v-if`) and M12 (the `@policy` emit that arms the page's payload) die independently. That
  guard-versus-wiring distinction has produced a High in this module before; here it is handled.
- **The password is confined to the POST body throughout.** Four separate paths, no logging, no
  query parameters, no echo into any notification.
- **The withdraw route is modelled correctly** — the requester's action, on the Supplier route,
  `supplier.mgmt`, no password — and both layers assert the absence of the password rather than just
  the presence of the rest.

## Verification story

- **Tests reviewed:** yes, adversarially and by mutation rather than by reading. 24 mutations, 26
  executions, 17 killed, 7 survived; all 7 survivors are written up, with a four-cell negative
  control for H-1 proving the shipped control works and that the proposed assertion kills both
  mutants.
- **Suites re-run:** yes, all of them, independently of the recorded evidence. vitest 562/562 (70
  files); `npm run lint` exit 0; `npm run build --workspace client` exit 0; the module server suite
  305/305 with `DB_*` sourced from `server/.env` and `DB_INTEGRATION_TESTS=1`; Playwright
  `--project technical` 15/15 on its own dev server at 5203.
- **Browser validation:** yes — I ran the browser suite rather than reading it, three times
  (baseline, M1, M16), and used it to establish both a survivor (M1) and a browser-only kill (M16).
  The create-page flow could not be validated in a browser because no spec covers it; that is M-2,
  reported as a blocker-adjacent gap rather than silently skipped.
- **Security checked:** yes. No password or reason in any log, URL, toast or error body. No
  permission wider than §6.4 or HD-024 allows, pinned by S3/S4. No decision sent without a version.
  The reassign lookup excludes the requester at both call sites. No non-assigned actor can decide in
  the UI, and the service refuses independently. The only security-adjacent finding is M-1's
  untested SEC-007 posture on the client, which the server's authority prevents from becoming a
  bypass.
- **Boundary checked:** yes, against the manifest rather than the brief. All ten changed source
  files are inside `allowed_write_paths`. No migration, no schema, no permission catalogue.
- **Tree on exit:** clean apart from this report. `git status --porcelain` verified empty after every
  mutation batch and again at the end. No Playwright artifacts in the working tree — the config
  writes them outside the repo — and no probe files anywhere in it.
