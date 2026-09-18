# Supplier Management — PHASE-002 TASK-029 Remediation Review (REV-027)

## Decision

**`APPROVED`** — **0 Critical, 0 High, 0 Medium, 2 Low. No blocker.**

> All nine REV-026 findings are closed, and I established each one by probe or by mutation rather
> than by reading the diff. **All 38 of my original mutations are now killed, up from 27.** I applied
> 13 further mutations aimed at the remediation itself; 11 died and the 2 survivors are a
> message-only revert with an identical public contract, which I do not count as a gap.
>
> The control that mattered is now load-bearing from both ends. Cutting the withdraw handler's
> wiring at `e5bffc5` produced `200 OK` and knocked a Supplier to draft through another Supplier's
> route. The same cut at this head produces `500` and **no state change at all** — the request stays
> `pending` and the Supplier stays `pending_approval` — and the suite goes red in two places.
>
> I independently reproduced the sort-order subtlety the author flagged: the first version of the
> added-identifier test genuinely could not reach the guard it was written for.

## Provenance

| Item | Value |
| --- | --- |
| Reviewer | REV-026's reviewer, re-engaged per the HD-013 precedent rather than a fresh agent |
| Reviewed head | `f96a67bd…` (`f96a67b`); the only commit with source changes is `270a84fd2020a5c635f89e08d612692c666fc795` |
| Source fingerprint | `db75b8ec973da289c250e8747926d19279657f5ee9628ae204a745e149101890` |
| Previously reviewed | `e5bffc5` at fingerprint `42947fa1…` (REV-026) |
| Spec baseline | `a0d41e31d887447d669d0f8252991e43fcdd273eb9eadcbe0d211468092bd154` |
| Branch / worktree | `codex/supplier-task-029` @ `/Users/sam/Documents/workspace/erp-app-worktrees/supplier-task-029` |
| Tree at start | clean, as the coordinator said it would be |
| Tree on exit | clean apart from this report |

Source diff reviewed: `SupplierApprovalService.js` (+25/−10), `supplierErrors.js` (+13),
`supplierApprovalHandlers.test.js` (+37), `supplierApprovalService.test.js` (+136/−10). No handler
and no schema changed; the withdraw handler is byte-identical to the one I reviewed.

---

## The mutation run

51 mutations, applied one at a time with the file restored between each, re-running
`supplierApprovalService.test.js`, `supplierApprovalHandlers.test.js`, `handlerConventions.test.js`,
`supplierAdminService.test.js` and `integration/supplierApproval.integration.test.js` with
`DB_INTEGRATION_TESTS=1`. Baseline for this set: **102 pass, 0 fail** (was 92).

### My 38 original mutations, re-run in full

**38 killed, 0 survived** — against **27 killed, 11 survived** at `e5bffc5`.

I re-ran all 38 rather than only the 11 survivors, exactly to check the remediation had not bought
the new coverage by weakening something that used to die. Nothing regressed: every mutation that
died before still dies, and each of the 11 survivors now dies in a named test.

| Former survivor | Now killed by |
| --- | --- |
| `scope=mine` pushes `requesterId ?? actorId` | `scope=mine ignores a client-supplied requesterId…` |
| `sameIdentifiers` drops the length guard | `an added identifier is a change, not just a removed one` |
| `identifierKey` drops `issuerCountryCode` | `two identifiers that differ only by country or by value…` |
| `identifierKey` drops `identifierValueMasked` | `two identifiers that differ only by country or by value…` |
| queue `ORDER BY` flipped to `ASC` | `the date filters bound the range they name…` |
| `listRequests` skips `assertActorFresh` | `every read path re-reads the actor…` **and** `a rejected actor stops the read…` |
| `getRequest` skips `assertActorFresh` | both of the same two |
| `listEligibleApprovers` skips `assertActorFresh` | both of the same two |
| `requestedTo` flipped `<=` → `>=` | `the date filters bound the range they name…` |
| `DISTINCT` dropped | `a user who holds the permission through two roles is listed once` |
| withdraw handler loses the route `supplierId` | `the withdraw handler passes the route Supplier id into the command` |

### 13 new mutations aimed at the remediation

**11 killed, 2 survived.**

| # | Mutation | Result |
| --- | --- | --- |
| N1 | `withdrawRequest`'s `TypeError` removed | killed — `withdraw refuses to run unscoped…` |
| N2 | the scope comparison short-circuited to `false` | killed — `withdraw refuses a request that belongs to another Supplier` |
| N3 | `listRequests` passes `claimedPermissions: []` to `authorize` | killed — the new test asserts the **arguments**, not just the call |
| N4 | `getRequest` passes a hard-coded `actorId: 1` to `authorize` | killed — same |
| N5 | date bounds bound to each other's parameter, SQL text unchanged | killed — by the pre-existing param-order assertion, not by the new SQL-text one |
| N8 | `config/api.js` default `authType` flipped to `public` | killed — the new L-5 pin |
| N9 | `supplierApprovalRequestNotFound`'s public code changed | killed — `a missing request is a 404…` |
| N10 | the withdraw requester check removed | killed — `only the requester may withdraw` |
| N11 | the `pending_approval` status gate removed | killed — `no decision may be taken on a Supplier that has left pending_approval` |
| N12 | scope compared against `input.id` instead of `probe.supplier_id` | killed, 3 tests |
| N13 | handler sends the body `requestId` as the scope | killed — `the withdraw handler passes the route Supplier id…` |
| N6 | detail 404 reverted to `supplierNotFound` | **survived** |
| N7 | `#decide` probe 404 reverted to `supplierNotFound` | **survived** |

N3/N4 are the ones I cared about most: they are the "reaches the control by a different route"
shape — a test that asserts *a* call happened would pass while the wrong claims went to the guard.
The new test deep-equals the argument, so both die. N5 is worth naming honestly: the new
`the date filters bound the range they name` test is a **SQL-text** assertion and would not have
caught a parameter swap on its own; what killed N5 was the older
`the queue pages and counts on the server` param-order assertion. The control is covered — just not
by the test written for it.

N6/N7 survive because L-4's fix is message-only and deliberately keeps `statusCode: 404` and
`publicCode: "SUPPLIER_NOT_FOUND"`; nothing asserts a public message anywhere in this module, so a
revert is invisible. I verified the contract claim directly rather than trusting it (see L-4 below)
and am not raising it: a test pinning a human-readable string would be worse than the drift risk.

---

## Every REV-026 finding, and how I established closure

### H-1 — withdraw scope guard — **CLOSED**

Two independent halves now hold it, and I checked both.

1. **The wiring has a test.** `supplierApprovalHandlers.test.js:154` drives
   `WithdrawSupplierApprovalHandler#execute` with a stub service and asserts `passed[0].supplierId === 7`
   came from `req.input.params.id` while `passed[0].id === 11` came from the body. `M37` (delete the
   wiring) and `N13` (send the body id instead) both die on it.
2. **The service refuses to run unscoped.** `SupplierApprovalService.js:452-457` throws a `TypeError`.
   `N1` dies on `withdraw refuses to run unscoped, so a lost caller line is loud`.

Re-ran my real-HTTP cross-Supplier probe — `createApplication`, real JWT, real `erp_dev`, requester
posting Supplier **A**'s `requestId` to Supplier **B**'s route:

| | response | request A | Supplier A |
| --- | --- | --- | --- |
| `e5bffc5`, wiring intact | `404 SUPPLIER_NOT_FOUND` | `pending` | `pending_approval` |
| `e5bffc5`, **wiring cut** | `200 {"status":"withdrawn"…}` | **withdrawn** | **draft** |
| head `f96a67b`, wiring intact | `404 SUPPLIER_NOT_FOUND` | `pending` | `pending_approval` |
| head `f96a67b`, **wiring cut** | `500 INTERNAL_SERVER_ERROR` | `pending` | `pending_approval` |

That last row is the finding closed. The `500` is the right answer — a missing scope is a wiring
fault, not user input — and it discloses nothing (`"Internal server error"`, no detail).

I also confirmed the `TypeError` breaks no caller: `withdrawRequest` has exactly **one** product call
site, `supplierApprovalWithdrawHandler.js:49`, which always supplies the route id. The other
occurrences are five test call sites (all updated) and the stub in the handler test. A live
legitimate withdraw over HTTP still returns `200` with the Supplier moved to `draft`.

### M-1 — fresh authorization on the three read paths — **CLOSED**

`M22`, `M23`, `M24` each now die in two tests. `N3` and `N4` confirm the assertion is on the claims
passed, not merely on the fact of a call, and `a rejected actor stops the read` asserts
`queries.length === 0`, so the guard has to run *before* the query rather than beside it.

Re-ran the revoked-role probe at head: seed an approver, issue their JWT, `DELETE FROM user_roles`,
then call with the untouched token — `403 PERMISSION_STALE` on both the queue and the detail, same
as before the remediation. Behaviour unchanged; only the ability to notice its loss is new.

### M-2 — `scope=mine` actor binding — **CLOSED**

`supplierApprovalService.test.js:719` now calls
`listRequests({ ...reader, scope: "mine", requesterId: 999 })` and locates the approver placeholder
by counting `?` before it rather than assuming a position. `M1` dies. `actorId` is 2 and the supplied
id is 999, so the two cannot be confused. It also asserts `params.includes(999)`, so the mutant
cannot pass by dropping the requester filter instead — `M26` confirms that separately.

### L-1 — added-identifier direction — **CLOSED, and the author's caveat independently confirmed**

This is the one worth spelling out. With the length guard removed, I computed
`approvalSummaryChanges` directly for both orderings:

```
kept=business_registration, added=tax (sorts AFTER)   -> []              <- mutant hides the change
kept=tax, added=business_registration (sorts BEFORE)  -> ["identifiers"] <- mutant survives
```

The shipped test uses the first ordering (`kept` is `business_registration`, the addition is `tax`),
which is the only one that reaches the guard. The author's account of the first attempt is accurate
in every particular, and they raised it themselves rather than letting it pass — on a branch whose
ledger counts twenty claims recorded stronger than their evidence, that is worth recording.

I went looking for the same mistake in the other seven new tests and did not find it. The two
identifier-key cases each hold `a.length === b.length` constant at 1, so they test `identifierKey`
and not the length guard; `a rejected actor` would fail on either the missing rejection or the
query count; the handler-wiring test asserts the specific value rather than the presence of a key.

### L-2 — the five other surviving read-path mutants — **CLOSED**

`M19`, `M20`, `M21`, `M27`, `M28` all die. Two caveats I am recording rather than raising:

- `a user who holds the permission through two roles is listed once` asserts `/SELECT DISTINCT/`
  against the SQL string. It kills `M28`, which is what matters, but its name promises a behaviour
  it does not construct. The real two-role case is exercised only by my own probe (a user granted
  `supplier.approval` through two roles appears exactly once over real MySQL), not by any test.
- `the date filters bound the range they name` is likewise a text assertion; see `N5`.

### L-3 — why `identifierCount` / `identifiersTruncated` are not diffed — **CLOSED**

A comment at `SupplierApprovalService.js:159-162`, which is the right treatment for a condition that
is unreachable while identifier writes invalidate the request. Nothing to test.

### L-4 — a missing request reported as a missing Supplier — **CLOSED at the site I named**

`supplierApprovalRequestNotFound` is used at `:263` (detail) and `:479` (the `#decide` probe). I
verified over real HTTP that the client contract is genuinely unchanged — every route still answers
`404` with `publicCode: "SUPPLIER_NOT_FOUND"`, only the human-readable message differs. See L-7 below
for what the partial application left behind.

### L-5 — the framework `jwt` default is now pinned — **CLOSED**

`supplierApprovalHandlers.test.js:65` asserts `apiConfig.defaults.authType === "jwt"`. `N8` (flip the
default to `public`) dies on it, so the pin is real and not a tautology.

### L-6 — evidence naming the parent commit — **CLOSED**

All three new records under `evidence/20260918T0128…`, `…0129…` name
`270a84fd2020a5c635f89e08d612692c666fc795` and fingerprint `db75b8ec…`, which is the commit that
contains the code they exercised. I reproduced the recorded count exactly: **291 passed, 0 failed,
0 skipped** from the same command contract.

---

## New findings

### L-7 — the not-found message fix is four-fifths applied, so reassign now disagrees with its four siblings

`server/src/modules/supplier/SupplierApprovalService.js:636` (and `:496`)

There are four "approval request not found" sites in this service. Two were converted, two were not:
`:496`, the post-lock re-read inside `#decide`, and `:636`, which is **`reassignRequest`'s only
not-found path** and is directly reachable from `POST /api/v1/supplier-approvals/:id/reassign`.

Probed with a request id that does not exist, over real HTTP:

```
GET  /supplier-approvals/:ghost            404 SUPPLIER_NOT_FOUND "找不到這個審批申請"
POST /supplier-approvals/:ghost/approve    404 SUPPLIER_NOT_FOUND "找不到這個審批申請"
POST /supplier-approvals/:ghost/reject     404 SUPPLIER_NOT_FOUND "找不到這個審批申請"
POST /supplier-approvals/:ghost/reassign   404 SUPPLIER_NOT_FOUND "找不到這個供應商"   <-- odd one out
POST /suppliers/:ghost/approval/withdraw   404 SUPPLIER_NOT_FOUND "找不到這個審批申請"
```

REV-026 L-4 named `getRequest` specifically, so this is not a missed fix — it is a new inconsistency
the partial fix created within one API group. Status and public code are identical everywhere, so no
client breaks. **Non-blocking**; fold `:636` (and `:496` for symmetry) into whatever touches
`reassignRequest` next. `:491`, which really is a missing Supplier, correctly keeps `supplierNotFound`.

### L-8 — one assertion in the new handler test cannot fail

`server/test/supplierApprovalHandlers.test.js:171`

```js
assert.ok(!("requestId" in passed[0]) || passed[0].requestId === "req-1");
```

Either branch satisfies it, so it asserts nothing. The three assertions above it carry the test and
kill `M37` and `N13`, so nothing is lost — but a line of this shape in a file whose whole subject is
"assertions that look like controls" is worth deleting or tightening to
`assert.equal(passed[0].requestId, "req-1")`. **Non-blocking, Nit-adjacent.**

---

## Suites and checks, re-run

| Check | Result |
| --- | --- |
| Evidence command contract, `DB_INTEGRATION_TESTS=1` | **291 pass, 0 fail, 0 skipped** — matches the recorded evidence exactly (was 282) |
| `supplierApprovalService` + `Handlers` + `handlerConventions` | 71 pass, 0 fail (was 62) |
| Full server suite, no integration env | 1467 pass, 0 fail, 273 skipped (was 1458) |
| `npm run lint` | exit 0 |
| `npm run build --workspace client` | exit 0 |
| Mutation baseline set | 102 pass, 0 fail |

The +9 tests are exactly the 2 added to the handler file and the 7 added to the service file. No test
was removed or weakened; I diffed the test files rather than only counting.

Not run, and not claimed: `npm run test:coverage` and its floors.

---

## DEF-017 routing

Out of my scope and I agree with where it was put, with one correction to the reasoning. The record
says the `itemConcurrency` "Last-active race" is "not reachable from any file this branch changes".
That is slightly stronger than the truth: `itemConcurrency.integration.test.js` calls
`createApplication`, which discovers and **loads** every handler including the four this branch adds,
so the branch's modules are in that process. What is true, and sufficient, is that the test drives
item routes only, shares no service or table with the approval code, and the failure observed — `500`
in place of `409` on a concurrency race — is not a failure mode a module-load or a supplier-side
change can produce. Correctly routed as an Item Management defect.

---

## Acceptance criteria

| T29 criterion | Status |
| --- | --- |
| Queue defaults `mine`; `all`/`unassigned` paged server-side; eligible lookup returns only id/username/displayName | **Met**, and now held: `M1`, `M17`, `M29`, `M30`, `M35`, `M36` all die |
| Approve/reject/reassign use `jwt-password`; block routes stay device-password; each policy demands `view` + `approval` exactly | **Met**, `M32`/`M33`/`M34`/`M38`/`N8` all die |
| Only the assigned approver decides; any approval holder may reassign with a reason; no bank plaintext in an approval response | **Met** |
| AC-012 — a Supplier edited after submission cannot be approved, and the UI can see it | **Met** |
| DoD 1.4 #1 — 新增行為有先失敗後通過的測試 | **Now met.** This was the sole reason REV-026 withheld approval. All three controls fail first and pass after, demonstrated by mutation rather than asserted |
| DoD 1.4 #2, #3 — focused tests, regression, lint, client build, real-MySQL verification | **Met**, re-run independently |
| DoD 1.4 #4 — no duplicate logic, dead code, debug output or unrelated refactor | **Met**. The new error helper has two callers and does not duplicate `supplierNotFound`'s contract |

## Findings I could not confirm closed

None. All nine are closed, each by a mutation that now fails or a probe that now behaves
differently, not by reading the diff. The two items I am least able to over-claim are recorded
plainly rather than dropped: L-4's fix is message-only and no test can see it revert (`N6`/`N7`
survive by design), and two of the new L-2 tests assert SQL text under behavioural names, with the
actual behaviours covered — one by an older assertion (`N5`), one only by my own probe (`DISTINCT`).
