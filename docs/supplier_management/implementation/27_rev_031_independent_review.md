# Supplier Management — PHASE-002 TASK-030 Remediation Review (REV-031)

## Decision

**`APPROVED`** — **0 Critical, 0 High, 0 Medium, 1 Low, 2 Nit. No blocker.**

> **All eleven REV-030 findings are closed, and all 24 of my original mutations now die, up from
> 17.** Every one of the seven survivors — the two H-1 marking mutants and the five untested error
> paths — is dead at the layer that owns it, and nothing that used to die has been revived. I re-ran
> the full set rather than only the survivors, precisely to check that.
>
> **H-1 is closed and I re-ran the four-cell matrix to prove it.** Deleting the marker and marking
> every field both now fail, in vitest *and* in the browser. The second half of the assertion — that
> the unchanged row is unmarked — is what kills the "mark everything" mutant, and it is present in
> both layers.
>
> **On L-1 the coordinator read the service correctly, and I established it by probe rather than by
> agreeing.** I drove `SupplierApprovalService` directly with a stale fixture. Approve is refused
> with `APPROVAL_REQUEST_STALE`; reject is **accepted** and lands the Supplier in `draft`, which is
> exactly where FR-APPROVAL-004 and AC-011 say reject lands; withdraw is accepted. Crucially the
> stale path does not weaken anything else — a non-assigned actor is still refused
> `APPROVAL_NOT_ASSIGNED`, and a reject with no reason is still refused `SUPPLIER_REASON_REQUIRED`.
> **Rejecting a stale request reaches no state the design forbids**, and it restores the sensible
> exit that the old predicate had removed.
>
> **On L-2 I did not take the equivalence on trust.** I captured the observable behaviour of both
> readers — exact SQL text, projection, error identity, driver-error propagation — at this head and
> at `1cf40ca`, and diffed the two captures. They are identical, including the `FOR SHARE` suffix,
> with one difference that is an artifact of my own introspection and not visible to any caller:
> `constructor.name` moved from `AsyncFunction` to `Function`, because the exported binding is now a
> thin wrapper. I checked that this cannot matter here: both still return a promise rather than
> throwing synchronously, `.length` is unchanged, and the two call sites that pass
> `getActivationPolicy` **by reference** into `SupplierAdminService` still satisfy the identity
> assertion at `supplierSettingsHandlers.test.js:46`. And the risky half is guarded by a test outside
> this task: making the transaction reader lose its lock kills two cases, including a real-MySQL
> concurrency test that takes the `FOR SHARE` and asserts a competing `FOR UPDATE` times out.
>
> **The 「已建立」 wait is not vacuous, and I proved it the only way that settles it.** The string
> comes from `SupplierCreatePage.vue:160`, inside a banner gated on `v-if="created"`, which is set
> only after a successful create — it is not the notification, which says 已啟用/已儲存. I made
> `created.value` never be set: the create browser case fails at the wait. It is load-bearing.
>
> **One new Low, and it is the same shape as the finding it came from.** The L-4 fix routes the
> field error to the control, and it works — but nothing asserts that it does. Three separate
> mutations survive: the page not passing the prop, and the panel dropping either binding. L-4 was
> "a control that is written and never rendered"; its remediation is "a control that is rendered and
> never tested". Four cells below, and a three-line assertion closes it. It does not block: the same
> message still reaches the user through the summary, which **is** tested.

> ### Something the coordinator should see before anyone runs `git add`
>
> **The worktree is not clean, and the change is not mine.** My first `git status` this round was
> empty, as promised. Partway through, `docs/supplier_management/00_harness_state.json` became
> modified — revision 133 → 134 — by another actor writing a CI observation for run 35320043450 and
> a new pending decision **HD-025**. I did not author it, I have not reverted it, and I have not
> committed it: destroying another agent's ledger write is not mine to do.
>
> It is benign in itself, but it is the **same mechanism that swept a probe into a commit in REV-029
> and turned CI red**. Anyone running `git add -A` in this worktree right now would commit that
> ledger write together with this report, under a message describing neither. It needs a deliberate
> `git add <path>` for each. I confirmed it does not move the source fingerprint: `fingerprint()`
> excludes the module docs path, and I recomputed `1fccad77…` with the file dirty and got the same
> value.

## Provenance

| Item | Value |
| --- | --- |
| Reviewer | REV-030's reviewer, re-engaged per the HD-021 precedent as the Product Owner asked |
| Reviewed head | `3403cb634802b702972dd69d009d216d678c4483` (`3403cb6`) — ledger and evidence only; I confirmed it touches no source file |
| Source commit reviewed | `00900fee4d04f9035bee008bddb08e73781b546b` (`00900fe`), diffed against `1cf40ca` |
| Source fingerprint | `1fccad77c70c37563b31495ea4a8bc3315c2db3b01e3d0a81de7ef77543936ab` — **recomputed independently**; matches `state.baseline.source_fingerprint` and the `code_commit` in all four new evidence records |
| Previously reviewed | `1cf40ca` at fingerprint `bc8d0d32aab04b7b5a13326147475e6845fdd81d0e52157b4830a0227c52ff23` (REV-030); now recorded in the ledger in full, three times, as the coordinator said |
| Design baseline | `e4083319e526682f70b40a0b2676ae5b50cc72d8f03e9e07c6d6fbb671f211e4` — recomputed, unmoved |
| Plan baseline | `a0d41e31d887447d669d0f8252991e43fcdd273eb9eadcbe0d211468092bd154` — recomputed, unmoved |
| Branch / worktree | `codex/supplier-task-030` @ `/Users/sam/Documents/workspace/erp-app-worktrees/supplier-task-030` |
| Tree at start | clean |
| Tree on exit | this report, **plus an uncommitted ledger write I did not make** — see the box above |

Source diff reviewed, `1cf40ca..00900fe`: `SupplierSettingsService.js` (+65/−?),
`SupplierApprovalsPage.vue` (+19/−?), `SupplierApprovalPanel.vue` (+12/−?), `SupplierCreatePage.vue`
(+1), `supplier-approvals.spec.js` (+70/−?), `approvals.test.js` (+39/−?), `create.test.js` (+37/−?),
plus my REV-030 report. Three of those touch product code. No migration, no schema, no permission
catalogue. All inside `allowed_write_paths`.

---

## Verification

Every number re-measured by me, not read from the ledger. **All of them reconcile with their stated
scope, which is the specific thing L-5 got wrong last round.**

| Suite | Claimed | Measured |
| --- | --- | --- |
| Client, full workspace | 566 | **566 pass / 70 files** |
| Client, evidence contract (`test/pages/suppliers` + `test/services/supplier.test.js`) | 71 | **71 pass / 12 files** |
| Server, evidence contract | 305 | **305 pass / 0 fail** (real MySQL, `DB_INTEGRATION_TESTS=1`) |
| Server, narrow supplier selection | 251 | **251 pass / 0 fail** |
| Playwright `--project technical` | 17/17 | **17 passed** |
| `npm run lint` | clean | **exit 0** |
| `npm run build --workspace client` | clean | **exit 0** |

All four new evidence records name `00900fe` and fingerprint `1fccad77…`, and their `result` is
`PASS`.

---

## The mutation run

**37 distinct mutations** — my original 24 re-run in full, plus 13 aimed at what the remediation
introduced. Applied one at a time, file restored with `git checkout HEAD --` between each.

**34 killed, 3 survived** — and the three survivors are one finding.

### My 24 original mutations, re-run in full

**24 killed, 0 survived** — against **17 killed, 7 survived** at `1cf40ca`. Nothing regressed.

| Former survivor | Now killed by |
| --- | --- |
| **M1** — marker span and row class deleted | vitest `shows the submitted snapshot…` **and** the Playwright stale case |
| **M1b** — `changed: true` for every field | the same two, via the "unchanged row is unmarked" half |
| **M13** — unreadable policy silently means no approval needed | `an unreadable policy hides the selector and never assumes no approval is needed` |
| **M14** — policy failure notifies nobody | the same case, on `notifyError` |
| **M15** — approver-load failure is silent | `a failed approver lookup tells the user instead of offering an empty list silently` |
| **M17** — detail-load failure is silent | `a failed detail read reports the failure instead of showing a half-open detail` |
| **M18** — reassign-options failure is silent | `a failed approver lookup leaves the reassign list empty rather than stale` |

The other 17 (M2–M12, M16, M19, S1–S4) were already dying and still die. M16 — removing `emit-value`
from the reassign select — remains a **browser-only** kill: vitest green, Playwright red. That
property is what makes M-2's closure worth having rather than ceremonial.

### The 13 new mutations

| # | Mutation | Result |
| --- | --- | --- |
| **L2-A** | transaction reader silently loses `FOR SHARE` | **RED** — 2 failures, incl. the real-MySQL lock-contention case |
| **R5** | lock suffix removed from the merged reader entirely | **RED** |
| **R5b** | lock applied unconditionally, so the lookup locks too | **RED** |
| **R1** | regress L-1: gate 拒絕 on `canApprove` again | **RED** (browser) |
| **R2** | let a stale request be approved, at the template | **RED** (browser) |
| **R2b** | the same, at the `canApprove` computed | **RED** (browser) |
| **R8** | remove the `data-field` hook the new assertion keys on | **RED** (browser) |
| **WAIT-PROBE** | success banner never renders (`created.value = null`) | **RED** (browser) — the 「已建立」 wait is load-bearing |
| **M8-browser** | create page withholds the approver | **RED** (browser) — the new create cases discriminate |
| **ORDER** | reorder `FIELD_LABEL` so 顯示名稱 precedes 名稱 | **RED** — the vitest row selector fails loudly, never silently |
| **R6b** | create page stops passing `:field-error` | **GREEN — survived** |
| **R7** | panel drops `:error="Boolean(fieldError)"` | **GREEN — survived** |
| **R7b** | panel drops `:error-message="fieldError"` | **GREEN — survived** |

---

## Status of every REV-030 finding

| # | Finding | Status | How I established it |
| --- | --- | --- | --- |
| **H-1** | diff marking had no test that can fail | **CLOSED** | M1 and M1b now die in **both** layers; four-cell matrix re-run below |
| **M-1** | five error paths untested | **CLOSED** | M13, M14, M15, M17, M18 all die; two new vitest cases per component, asserting the real thrown message rather than the `||` fallback |
| **M-2** | no browser coverage of the create flow | **CLOSED** | two new `@technical` cases; M8-browser proves they discriminate; the wait probe proves the wait is real |
| **L-1** | reject disabled on stale, diverging from the service | **CLOSED** | split into `canDecide`/`canApprove`; R1 and R2 die; service probe confirms the service accepts reject-on-stale |
| **L-2** | duplicated policy reader | **CLOSED** | merged to one `activationPolicy(runner, { lock })`; old-vs-new behavioural capture is identical; L2-A/R5/R5b all die |
| **L-3** | `FOR SHARE` rationale above the non-locking function | **CLOSED** | read the new file: each block now sits above the function it describes |
| **L-4** | field error written, never rendered | **CLOSED in product, but the fix is untested** | renders correctly (cell 1); R6b/R7/R7b survive → **new L-1 below** |
| **L-5** | "259 supplier server" reconciled with nothing | **CLOSED as a correction** | ledger now records 305 (evidence contract) and 251 (narrow); I re-measured both and got exactly those |
| **N-1** | no-op `button(body, "").exists()` | **CLOSED** | line deleted |
| **N-2** | `wrapper.vm.reassignTarget` reaches into internals | **ACCEPTED as recorded** | left deliberately; M16 shows the browser layer covers what it misses |
| **N-3** | search debounce not cleared on unmount | **CLOSED** | `onUnmounted(() => clearTimeout(searchTimer))` added |

### H-1's four-cell matrix, re-run at this head

| product | assertion | vitest | Playwright |
| --- | --- | --- | --- |
| shipped | as shipped | green (566 / 17) | green |
| **M1** — marker deleted | as shipped | **red** | **red** |
| **M1b** — everything marked | as shipped | **red** | **red** |

Both directions now die in both layers. At `1cf40ca` all four of those cells were green.

### L-1's service probe

I drove `SupplierApprovalService` with a fixture where `supplier.version = 6` and
`request.supplier_version = 5`, against a fresh control:

| case | service says |
| --- | --- |
| approve, fresh | ACCEPTED → request `approved`, supplier `active` |
| reject, fresh | ACCEPTED → request `rejected`, supplier `draft` |
| **approve, stale** | **REFUSED** `APPROVAL_REQUEST_STALE` |
| **reject, stale** | **ACCEPTED** → request `rejected`, supplier `draft` |
| withdraw, stale | ACCEPTED → request `withdrawn`, supplier `draft` |
| reject, stale, actor 99 | REFUSED `APPROVAL_NOT_ASSIGNED` |
| reject, stale, no reason | REFUSED `SUPPLIER_REASON_REQUIRED` |

The UI's new predicate matches the service on every cell. `draft` is the destination FR-APPROVAL-004
and AC-011 specify for reject, and `#assertRequestStillCurrent` still asserts
`supplier.status === "pending_approval"` before returning early, so reject cannot fire from a state
the machine forbids. **No consequence I can find that the author missed** — and the previous
behaviour had a real cost I should name: with both buttons disabled, a stale request had no exit
except the requester withdrawing, so an absent requester left it in the queue indefinitely.

---

## New findings

### L-1 (new) — the L-4 fix routes the field error to the control, and nothing asserts that it does

`client/src/pages/suppliers/SupplierCreatePage.vue:205` (`:field-error="fieldError('approverUserId')"`),
`client/src/components/suppliers/SupplierApprovalPanel.vue:95-96` (`:error`, `:error-message`).

Three mutations survive the whole client suite:

- **R6b** — the create page stops passing the prop
- **R7** — the panel drops `:error="Boolean(fieldError)"`, so Quasar never enters the error state
- **R7b** — the panel drops `:error-message="fieldError"`, so the message never renders

The existing assertion in `sends the chosen approver, and refuses to submit without one` is
`expect(body.text()).toContain("請先選擇審批人")`, which is the **summary** message
(`SupplierCreatePage.vue:131`). The field error is the different string `請選擇審批人` — note 請先 vs
請 — so the summary assertion cannot reach the control, and no other assertion does.

This is the same shape as the finding it remediates, one step along: L-4 was a control written and
never rendered; this is a control rendered and never tested.

**Four cells, all run:**

| product | assertion | result |
| --- | --- | --- |
| shipped | as shipped | green |
| shipped | strengthened (below) | **green — the control works** |
| **R6b** | strengthened | **red** |
| **R7** | strengthened | **red** |
| **R7b** | strengthened | **red** |

**Concrete fix** — three lines in the existing case, after the summary assertion:

```js
const errored = wrapper.findAllComponents(QSelect).find((s) => s.props("label") === "審批人");
expect(errored.props("error")).toBe(true);
expect(errored.props("errorMessage")).toBe("請選擇審批人");
```

**Why this does not block.** The user is still told: the summary message at `:131` carries the same
instruction and is asserted. The consequence of a silent regression is a worse error experience on
one control, not a lost rule, and the server remains authoritative either way. Low, matching the
severity of the L-4 it descends from.

### N-1 (new) — the vitest row selector binds by substring and leans on `FIELD_LABEL` ordering

`client/test/pages/suppliers/approvals.test.js:101-105`.

`rows.find((row) => row.text().includes("名稱"))` works only because 「名稱」's row precedes
「顯示名稱」's in `FIELD_LABEL`'s key order — the exact collision the author called out and solved
correctly in the browser layer with `data-field`. I checked the failure mode rather than assuming
it: the **ORDER** mutation, which swaps those two keys, turns the case **red**. So it fails loudly
rather than passing falsely, which is the right direction and is why this is a Nit.

Still worth tightening, because it costs nothing: `data-field` is rendered on the `<tr>` at the
vitest layer too, so `body.find('[data-field="supplierName"]')` is available and exact. It would make
the two layers assert the same thing the same way.

### N-2 (new) — a stale rejection is not distinguishable in the audit

`server/src/modules/supplier/SupplierApprovalService.js:530-545`.

Now that rejecting a stale request is a supported path, it is worth noting that the decision audit's
`detail` records only `before`/`after` request and supplier status. Nothing marks that the request
was stale when it was rejected, so the audit cannot later distinguish "rejected on the merits" from
"rejected because it had gone stale" — the `changedFields` that `approval.invalidate` records have no
counterpart here.

This is **pre-existing in T28's audit shape, not introduced by this commit**, and FR-APPROVAL-006 is
satisfied as written: submit, withdraw, approve, reject, reassign and invalidate all leave an audit
row with a timestamp. Raising it as an observation for T31's audit-consistency work, not as a defect
against T30.

---

## The two judgement calls the coordinator asked for

**Is `data-field` a reasonable test hook, or should a selector have been found that left the
template alone?** Reasonable, and I would keep it. The author's stated reason checks out — 「名稱」 is
a substring of 「顯示名稱」, so any row-text selector matches both rows, and my ORDER probe confirms
how thin that ice is. The alternatives are worse: a positional `nth()` selector is exactly what
CLAUDE.md §9 tells us to avoid, and there is no role or label that distinguishes two rows of the same
table. §9 names test IDs alongside roles and labels as a *preferred* stable selector, so this is the
sanctioned option rather than a concession. It is also now load-bearing rather than decorative — R8
kills the browser case — so it cannot be removed by accident.

**DEF-019 routing.** I agree with HD-025, and I am not raising it against this task. The reasoning
in the decision is the right reasoning: `server/test/**` being inside this module's
`allowed_write_paths` is a path check, and a path check is not module ownership. Fixing another
module's test from a supplier branch would make a supplier PR the thing that changed Item
Management's evidence, which is worse than re-running CI. Two data points worth adding for whoever
picks it up: it did **not** fire on `3403cb6`, which is consistent with the recorded reading that the
cause is deterministic while its appearance depends on file interleaving; and it is the one thing
standing between this branch and a first-attempt-green CI record, so the cost is real even though the
routing is right.

---

## Checkpoint J：T28–T30

**All three bullets are now met.**

- **「Approval domain、API及UI happy／negative flows通過」— now met.** This is the bullet REV-030
  reported short, on two counts, and both are closed. The positive-path control that had no test
  (H-1) now dies in both layers in both directions. The four uncovered failure paths (M-1) each have
  a case that asserts the real thrown message rather than the `||` fallback, and each corresponding
  mutant dies. Domain and API remain 305/305 against real MySQL.
- **「Queue scopes、self rule、snapshot diff及reassign audit完成」— met.** Unchanged from REV-030
  except that the snapshot diff's marking is now actually proven, which was the one gap.
- **「Client build與server lint通過」— met.** exit 0 both.

**What it is still waiting on: nothing.** The new L-1 is a test-only tightening on a control whose
user-visible message is already covered elsewhere, and I would not hold the checkpoint for it.

T31 remains the formal acceptance exit for SUP-CAP-02 — settings/activation races, double-approve,
post-JWT revocation, disabled approver, IDOR, unassigned reassign — and nothing here pre-empts or
moves it. The one item I would carry forward into it is N-2 above.

## What is done well

- **The remediation fixed the causes rather than the symptoms.** H-1 could have been closed by
  asserting a longer string; instead both layers got a row-scoped assertion *and* the negative half
  that kills the "mark everything" mutant — which is the half that actually does the work, and the
  author says so in the comment.
- **L-1 was accepted as a real divergence and traced to the service's own predicate** rather than
  argued away on reachability, and the browser assertion that had locked in the wrong behaviour was
  inverted rather than deleted.
- **The L-2 merge is the risky kind of change and it landed clean.** It touches a function that
  create, activate and import depend on, and it is byte-for-byte equivalent on every dimension I
  could measure. The `{ lock }` parameter is pinned from both sides — dropping the lock and forcing
  it both die.
- **The M-1 cases assert the thrown message, not the fallback.** `expect(notifyError).toHaveBeenCalledWith("網路錯誤，請檢查連線")`
  rather than `expect.stringContaining(...)` on the `||` default. That distinction is what makes the
  mutants die instead of passing on the fallback string.
- **Every count in the commit message reconciles with a named scope this time.** After L-5, the
  message now states 566 and 17/17 and the ledger states 305 and 251, and all four reproduce exactly.

## Verification story

- **Tests reviewed:** yes, adversarially. 37 distinct mutations, 34 killed, 3 survived — the three
  being one Low. All 24 REV-030 mutations re-run in full rather than only the survivors.
- **Suites re-run:** yes, independently of the ledger. 566 client (full), 71 client (evidence
  contract), 305 server and 251 server (both selections, real MySQL), 17/17 Playwright, lint exit 0,
  build exit 0.
- **Browser validation:** yes. Ten browser-layer executions, including four probes of the
  remediation itself. The 「已建立」 wait was proven load-bearing by making the banner it waits for
  never render.
- **Shared-code regression:** yes, specifically. Old-vs-new behavioural capture of both policy
  readers diffed to identical; the two by-reference call sites and their identity assertion checked;
  the lock guarded by a real-MySQL concurrency test that dies when the lock is dropped.
- **Security checked:** yes. No change to the permission surface — S3 and S4 still die. No password
  or reason in any log, URL, toast or error body. The split predicate does not widen who may decide:
  `canDecide` still requires pending **and** assigned, M2 still dies, and my service probe confirms a
  non-assigned actor is refused even on the stale path.
- **Boundary checked:** yes, against the manifest. All seven changed source files inside
  `allowed_write_paths`. No migration, no schema, no permission catalogue.
- **Tree on exit:** this report, plus the uncommitted ledger write described in the box at the top,
  which I did not author and deliberately did not revert. No probe files anywhere in the repository —
  all four probes ran from the scratchpad. No Playwright artifacts in the tree; the config writes them
  outside the repo.
