# Supplier Management — PHASE-002 TASK-029 Independent Review (REV-026)

## Decision

**`CHANGES_REQUESTED`** — **0 Critical, 1 High, 2 Medium, 6 Low.**

> No defect ships in this commit. Every behaviour I could reach behaves as the design and the
> acceptance criteria require, and I confirmed that end to end over real HTTP against real MySQL
> rather than by reading. What blocks is narrower and it is the same shape this branch has been
> caught by four times: **three security controls in the new code have no test that can fail.**
> Of 38 targeted mutations, **27 were killed and 11 survived** (enumerated below — the count is the
> length of that enumeration and nothing else). Two survivors are one-line deletions that re-open
> horizontal-privilege holes while the suite stays at 93 pass, 0 fail; I drove both mutants through
> the real HTTP stack and got `200 OK` where the clean code gives `404` and `403`.
>
> The fix is test-only plus one defensive line. No behaviour needs to change.

## Provenance

| Item | Value |
| --- | --- |
| Reviewer | `agent-skills:code-reviewer`, fresh separate agent, no prior context |
| Reviewed commit | `e5bffc5220f15c2b43292189bd2ef6da7c92dffc`, diffed against `9588655` (`origin/main`) |
| Source fingerprint | `42947fa190439de60578d96b5d3a139025157be02f36faf19f7a823b9df40ee4` |
| Spec baseline | `a0d41e31d887447d669d0f8252991e43fcdd273eb9eadcbe0d211468092bd154` |
| Branch / worktree | `codex/supplier-task-029` @ `/Users/sam/Documents/workspace/erp-app-worktrees/supplier-task-029` |
| Working tree on exit | only `docs/supplier_management/00_harness_state.json` (the author's) and this report |

---

## H-1 — the withdraw Supplier-scope guard depends on one untested handler line, and disables itself when that line is gone

`server/src/handlers/suppliers/supplierApprovalWithdrawHandler.js:53`
`server/src/modules/supplier/SupplierApprovalService.js:467`

The guard is written as a *conditional*:

```js
if (input.supplierId !== undefined && Number(probe.supplier_id) !== Number(input.supplierId)) {
  throw supplierNotFound(input.supplierId);
}
```

`#decide` is shared by approve, reject and withdraw, and approve/reject legitimately carry no
`supplierId`, so the `!== undefined` arm is structural rather than gratuitous. But its consequence
is that the guard is armed **only** by handler line 53, and nothing tests that line.

Deleting `supplierId: Number(req.input.params.id),` from the handler:

```
M37 withdraw handler loses the route supplierId :: pass=93 fail=0 SURVIVED
```

(suite: `supplierApprovalService` + `supplierApprovalHandlers` + `handlerConventions` +
`supplierAdminService` + `integration/supplierApproval`, `DB_INTEGRATION_TESTS=1`.)

Driven through the real stack — `createApplication`, real JWT, real `erp_dev` — with the requester
posting Supplier **A**'s `requestId` to Supplier **B**'s route:

| | route `/suppliers/:B/approval/withdraw`, body `{requestId: <A's>}` |
| --- | --- |
| clean `e5bffc5` | `404 SUPPLIER_NOT_FOUND`; request A still `pending`, Supplier A still `pending_approval` |
| one line deleted | `200 {"id":3487,"status":"withdrawn","supplierId":8139,"supplierStatus":"draft"}`; **request A withdrawn, Supplier A knocked back to `draft`** |

The service-level test at `supplierApprovalService.test.js:658` does hold the guard — it calls
`withdrawRequest({...context, supplierId: 8})` directly. That is the covered half. The half that
decides whether the guard exists at runtime is the handler, and the only assertions the handler
has are on its `static api` block. The author's own ledger entry lists "the withdraw Supplier-scope
guard removed" among the ten killed mutations; that mutation was aimed at line 467, which is
tested, not at line 53, which is not.

**Required fix.** Two parts, both small:

1. A test that reaches the guard *through the handler*, so the wiring is load-bearing. Either
   drive `WithdrawSupplierApprovalHandler#execute` with a stub service and assert the passed
   command carries `supplierId` from `req.input.params.id`, or add an HTTP-level integration case.
2. Make the service refuse to run the withdraw path without a scope, so a lost caller line is loud
   rather than silent. `withdrawRequest` is the only entry point that should ever carry one, and
   approve/reject do not go through it:

```js
withdrawRequest(input) {
  if (input.supplierId === undefined || input.supplierId === null) {
    throw new TypeError("withdrawRequest requires the route supplierId to scope the request");
  }
  return this.#decide(input, "withdraw");
}
```

---

## M-1 — `assertActorFresh` can be deleted from all three new read paths with the suite fully green

`server/src/modules/supplier/SupplierApprovalService.js:185`, `:241`, `:286`

`hasPermission` in `framework/authorization/authorizationPolicyRegistry.js` decides from **token
claims**. The DB re-read that §1.4's fourth guard and SEC-009 rely on is the
`await this.authorize(this.database, {...})` line at the top of `listRequests`, `getRequest` and
`listEligibleApprovers`. Remove all three and nothing notices:

```
M22 listRequests skips assertActorFresh        :: pass=92 fail=0 SURVIVED
M23 getRequest skips assertActorFresh          :: pass=92 fail=0 SURVIVED
M24 listEligibleApprovers skips assertActorFresh:: pass=92 fail=0 SURVIVED
```

Reproduction, over real HTTP: seed an approver with `supplier.view` + `supplier.approval`, issue
their JWT, then `DELETE FROM user_roles` for that user, leaving the token untouched.

| | `GET /api/v1/supplier-approvals` | `GET /api/v1/supplier-approvals/:id` |
| --- | --- | --- |
| clean `e5bffc5` | `403 PERMISSION_STALE` | `403 PERMISSION_STALE` |
| authorize removed | `200`, full queue (`items=1`) | `200`, full detail body |

The control is correct today and I verified it fires. What is missing is any test that would notice
its removal — and the read paths are precisely where it is easiest to lose, because unlike the
decision paths they do not need the actor object for anything else.

**Required fix.** One test per read path asserting the injected `authorize` is called (the existing
`readHarness` already injects one — record the invocation and assert it), plus at least one case
where a rejecting `authorize` propagates instead of the query running.

---

## M-2 — `scope=mine` is never tested against a client-supplied id, which is the only thing the claim is about

`server/src/modules/supplier/SupplierApprovalService.js:197`

The commit message says the queue "defaults to `scope=mine` bound to the actor rather than to any
client-supplied id", and `supplierApprovalService.test.js:506` carries the message
`"mine must bind the actor, not a client-supplied id"`. That test never supplies one:

```js
await service.listRequests({ ...reader });                       // no requesterId
assert.deepEqual(params.slice(0, 2), ["pending", 2]);            // actorId === 2
```

So the assertion cannot distinguish the actor from a client value that happens to be absent:

```
M1 mine binds client requesterId  (params.push(actorId) -> params.push(requesterId ?? actorId))
   :: pass=92 fail=0 SURVIVED
```

`requesterId` is a real, client-settable query parameter (`APPROVAL_QUEUE_QUERY_SCHEMA`), so the
mutant is not hypothetical: `?scope=mine&requesterId=<someone else>` would read another approver's
queue. The author's ledger lists "the mine scope dropping its actor binding" as killed — that
mutation removes the condition entirely, which the `assigned_approver_id = ?` regex does catch. The
property actually claimed is untested.

**Required fix.** Add a case that calls `listRequests({ ...reader, scope: "mine", requesterId: 999 })`
and asserts the approver parameter is still the actor.

---

## Low

- **L-1 — the identifier multiset length check is only tested in one direction.**
  `SupplierApprovalService.js:145`. Dropping `a.length === b.length &&` survives (`M8`, 92/0). The
  existing test covers *removal* (submitted 1 → current 0), where `b[0]` is `undefined` and the
  `every` fails anyway. The *addition* direction is what the length check exists for; I confirmed
  by direct call that the shipped code reports `['identifiers']` for an added identifier and the
  mutant would report none. One extra case closes it.
- **L-2 — five more read-path mutants survive.** `requestedTo` flipped to `>=` (`:210`), `DISTINCT`
  dropped (`:300`), `ORDER BY r.requested_at DESC, r.id DESC` flipped to `ASC` (`:229`), and
  `identifierKey` (`:138`) losing either `issuerCountryCode` or `identifierValueMasked` all leave the
  suite green. I verified `DISTINCT` is genuinely load-bearing on real MySQL — a user holding
  `supplier.approval` through two roles appears exactly once — but nothing asserts it, and page
  ordering is the property the two-page partition test depends on without stating.
- **L-3 — `changedFields` never diffs `identifierCount` / `identifiersTruncated`.**
  `SupplierApprovalService.js:152-160`. With more than `MAX_SUMMARY_IDENTIFIERS` (50) identifiers the
  submitted snapshot slices an *unordered* 50 (no `ORDER BY` at submit, `SupplierAdminService.js:544`)
  while `getRequest` slices the first 50 by `id` (`:261`), so the two can be different subsets and the
  detail would report `["identifiers"]` permanently. Unreachable in normal operation, because every
  identifier write calls `invalidateForSignificantChange` (`SupplierIdentifierService.js:79`) and
  kills the pending request outright — which also makes the multiset logic mostly a historical-view
  concern rather than a queue concern. Worth a comment rather than code.
- **L-4 — a missing approval request is reported as a missing Supplier.** `SupplierApprovalService.js:259`
  returns `supplierNotFound(id)` with the *request* id and the message 「找不到這個供應商」. The status
  code is right and nothing leaks; the label is wrong. (The withdraw mismatch at `:468` correctly
  passes the supplier id.)
- **L-5 — the read routes' auth strength is asserted as an absence.**
  `supplierApprovalHandlers.test.js:60,75` assert `api.authType === undefined`. That the resolved
  route is therefore `jwt` comes from `server/config/api.js`, which no approval test reads. I
  confirmed the resolved behaviour over HTTP — all five new routes answer `401 Unauthorized Access`
  with no token — so this is a wording matter, not a hole.
- **L-6 — the DEVELOPER evidence names the parent commit.** All three `run.json` under
  `evidence/20260917T0900*` carry `"code_commit": "95886556…"`, i.e. `9588655`, which does not contain
  the code the runs exercised; the `source_fingerprint` (`42947fa1…`) does match. This is the known
  pre-commit pin behaviour and the ledger says so explicitly, but a reader of the evidence alone
  would be misled.

---

## The mutation run

38 mutations, applied one at a time with the file restored between each, re-running
`supplierApprovalService.test.js`, `supplierApprovalHandlers.test.js`, `handlerConventions.test.js`,
`supplierAdminService.test.js` and `integration/supplierApproval.integration.test.js` with
`DB_INTEGRATION_TESTS=1` (baseline 93 pass / 0 fail; 92 before `handlerConventions` was added to the
set). Two further mutations are excluded from the count and from this table because they were
defective rather than informative: one failed to apply against the handler's Chinese `description`
string, and one introduced an unused constant instead of changing the policy, so it proved nothing —
recorded here rather than quietly dropped, because "the mutation I wrote was a no-op" is the exact
error the author's own ledger records against the first pass of their ten.

**Survived — 11:**

| # | Mutation | Site | Finding |
| --- | --- | --- | --- |
| 1 | `scope=mine` pushes `requesterId ?? actorId` | `SupplierApprovalService.js:197` | M-2 |
| 2 | `sameIdentifiers` drops the `a.length === b.length` guard | `:145` | L-1 |
| 3 | `identifierKey` drops `issuerCountryCode` | `:138` | L-2 |
| 4 | `identifierKey` drops `identifierValueMasked` | `:138` | L-2 |
| 5 | queue `ORDER BY` flipped `DESC` → `ASC` | `:229` | L-2 |
| 6 | `listRequests` skips `assertActorFresh` | `:185` | M-1 |
| 7 | `getRequest` skips `assertActorFresh` | `:241` | M-1 |
| 8 | `listEligibleApprovers` skips `assertActorFresh` | `:286` | M-1 |
| 9 | `requestedTo` filter flipped `<=` → `>=` | `:210` | L-2 |
| 10 | `DISTINCT` dropped from the approver lookup | `:300` | L-2 |
| 11 | withdraw handler loses `supplierId` from the route param | `supplierApprovalWithdrawHandler.js:53` | **H-1** |

**Killed — 27:** scope allowlist bypassed; status allowlist bypassed; `COUNT` narrowed to status
only; `COUNT` total replaced by `rows.length`; `toApprovalUser` null check removed (deleted user → id
0); `stale` forced `false`; `LIKE` escaping removed; approver cap 100 → 1000; withdraw scope guard
removed at the service; approver lookup drops `u.status = 'active'`; approver lookup predicate
`supplier.approval` → `supplier.view`; offset `(page-1)*pageSize` → `page*pageSize`; `excludeUserId`
ignored; `changedFields` drops `defaultCurrencyCode`; `unassigned` filter dropped; detail `404`
turned into `null`; detail identifiers query unscoped from its Supplier; `requesterId` filter
ignored; a 4th field added to the approver projection; a 13th field added to the queue summary;
approve drops `jwt-password`; approval policy relaxed to `match: "any"`; approval policy drops
`supplier.approval`; queue `pageSize` cap 100 → 5000; queue scope default `mine` → `all`; withdraw
policy swapped off `supplier.mgmt`; identifier comparison made order-sensitive.

---

## What I verified empirically, and what I accepted on reading

**Verified by running it.**

| Claim | How |
| --- | --- |
| 282/282 server tests, lint clean, client build clean | Re-ran the exact `run.json` command contract with `DB_INTEGRATION_TESTS=1` against `erp_dev`: **282 pass, 0 fail, 0 skipped**. `npm run lint` exit 0. `npm run build --workspace client` exit 0. The full server suite is 1731/0 fail (273 skipped without integration env); the one failure under `DB_INTEGRATION_TESTS=1` is `itemRecoveryAcceptance.integration.test.js` needing `DB_ADMIN_USER`, pre-existing and outside this module. |
| `scope=mine`/`all`/`unassigned` behave as design 6.4 says | Real HTTP: `mine` returned only the request assigned to the actor; `all` returned both; `unassigned` returned only the `assigned_approver_id IS NULL` one with `assignedApprover: null`. `?scope=everyone` → `400 REQUEST_VALIDATION_FAILED`. |
| paging and `COUNT` use the same filter | `M30` (`total: rows.length`) and `M26` (requesterId filter dropped) both die; the integration test partitions 3 rows across two pages with `total=3` on both. |
| `stale` uses the same comparison `#assertRequestStillCurrent` enforces | Read both sites (`:274` vs `:595`) — identical `Number(supplier.version) !== Number(request.supplier_version)`. `M6` (`stale: false`) dies. Note `#assertRequestStillCurrent` *also* rejects on supplier status and on Business Master defaults, so `stale === false` is necessary but not sufficient for approvability; the detail does return `supplierStatus`, so the UI can see the rest. |
| identifiers diffed as an order-insensitive multiset | Confirmed the submit-time query (`SupplierAdminService.js:544`) has no `ORDER BY` and selects the same three columns `getRequest` does, so the justification is real. `M7` (sort removed) dies. |
| eligible approver lookup decides from real rows, returns three fields, capped at 100 | `M13` (`p.name` → `supplier.view`), `M12` (`u.status` filter dropped), `M29` (4th field added) and `M10` (cap → 1000) all die. Real-MySQL probe: a user granted `supplier.approval` through a second role is listed exactly once; a user without it is absent. |
| no approval response can carry bank plaintext | The schema walker test is non-vacuous (`M31`, an extra field on the summary, dies). Independently: no new file mentions `bank` in any form, and both snapshot builders are whitelists. |
| withdraw is requester-only and 404s a foreign `requestId` | Verified over HTTP on the clean code (`404`, no state change, no audit row) — **and** shown to be one deleted line away from `200`. See H-1. |
| LIKE metacharacters stay literal | Real MySQL, through the HTTP route: `q=A_B` matched `"A_B Ltd"` and **not** `"AXB Ltd"`; `q=100%` matched `"100% Co"` and **not** `"100X Co"`. `M9` (escaping removed) dies. |
| deleted users project as `null`, not user 0 | Deleted the requester's account and re-read the detail over HTTP: `requester: null`, `200`. `M5` dies. |
| HD-020 | No `/approval/submit` route exists — established by `grep -rn "approval/submit" server/src/` returning nothing, **not** by the HTTP response, because this framework answers an unknown route with `401` exactly as it answers an unauthenticated known one. Withdraw lives at `/api/v1/suppliers/:id/approval/withdraw` under `handlers/suppliers/`, which is what `handlerConventions.test.js` requires. Matches the recorded answer. |
| module boundary | All 21 changed paths fall inside `docs/supplier_management/**`, `server/src/modules/supplier/**`, `server/src/handlers/supplier*/**`, `server/test/**`. Nothing outside. |
| response schemas accept real values | Drove a *decided* request (non-null `decided_at`, `decided_by`, `decision_reason`, `version 3`, supplier `active`) through both the queue and the detail: `200` both times under strict response validation (`coerceTypes: false`). `BIGINT UNSIGNED` epoch columns arrive as numbers and pass `type: "integer"`. |
| the author's 10/10 mutation claim | Reproduced in substance: the ten mutations they name do die. The claim is true as written; what it does not say is that two of the ten were aimed at the covered half of a two-part control (see H-1, M-2). |

**Accepted on reading, not proven.**

- HD-018 and HD-019 (the `FOR SHARE` deviation and the unsequenced Business Master locks). Standing
  ANSWERED exceptions; this commit adds no lock, so I checked only that the new code does not
  contradict design 2.6 — the three read paths take none, and the one new line in `#decide` sits
  between the unlocked probe and the `suppliers FOR UPDATE`, ahead of the request lock, which is the
  documented order. I did not re-run the deadlock experiments.
- That `loadPermissionNamesForUser` and the approver lookup agree on eligibility. I compared the two
  queries by eye — same three tables, same joins, the lookup adding only `u.status = 'active'`, which
  `assertEligibleApprover` checks separately — rather than constructing a user the selector offers
  and the submit path then rejects.
- Coverage floors (`npm run test:coverage`). Not run.
- Client-side consumption of these endpoints. T30 has not landed; there is no client code to drive.

---

## What I tried that found nothing

Recording these because the absence is the evidence.

- **SQL injection / unparameterised interpolation.** Every user-controlled value in the three new
  queries is a `?`. The only two interpolations are `${where}`, assembled purely from fixed literal
  fragments, and `LIMIT ${MAX_ELIGIBLE_APPROVERS}`, a module constant. `escapeLikeTerm` moved rather
  than changed (`git show` confirms the body is identical apart from a `String()` wrapper), and its
  callers pair it with `ESCAPE '\\'` correctly at the SQL-text level — which I checked by observing
  real matching behaviour, not by reading the escape count.
- **Information disclosure through the queue or detail.** No query touches `supplier_bank_accounts`,
  `users.email`, `password_hash`, `failed_login_attempts`, `locked_until` or
  `must_change_password`; I checked the live `users` DDL for exactly which fields exist to be leaked.
  Adding a 13th field to the summary or a 4th to the approver row is caught. Both routes are gated on
  `supplier.view` + `supplier.approval` (and the lookup on `mgmt` **or** `approval`), which I checked
  with three separate tokens: a `supplier.view`-only user gets `403 Forbidden` on the queue and on the
  approver lookup, and a `supplier.view` + `supplier.mgmt` user gets `403` on the queue. I did not
  drive an under-privileged token at the detail or the three decision routes; those four share
  `SUPPLIER_APPROVAL_POLICY` with the queue, and the handler test proves the policy object is the same
  one, so I treated the queue result as covering them.
- **Cross-Supplier enumeration through the withdraw route.** The one real attack path; it is closed
  on the shipped code. See H-1 for the caveat.
- **Response schemas that would reject a legitimate value at runtime.** The specific shapes I went
  looking for — a nullable column declared non-null, a `BIGINT` arriving as a string, an enum missing
  a status the DB can hold — are all absent. `decidedAt`, `requester`, `assignedApprover`, `decidedBy`
  and `defaultPaymentTermId` are all correctly nullable; `SUPPLIER_STATUSES` covers every value the
  `suppliers` table can hold including `blocked` and `archived`; `summary` survives both an object and
  a string from the driver, and a corrupt value degrades to `null` rather than a 500.
- **N+1 and unbounded reads.** `listRequests` is two queries regardless of page size; `getRequest` is
  two regardless of identifier count. The only unbounded read is `getRequest`'s identifier query
  (`:261`, no `LIMIT`, where the sibling read at `SupplierAdminService.js:786` uses `LIMIT 100`) — it
  must read every row to produce `identifierCount`, and identifiers per Supplier are inherently small,
  so I am not raising it as a finding.
- **Interaction between the unlocked reads and the locked decision path.** I could not construct a
  problem. The reads take no lock and the decision re-locks and re-validates `version` inside its own
  transaction, so the worst outcome of a stale read is the conflict the design already specifies.
- **Test assertions that match substrings or assert on test-constructed data.** I re-checked the
  `/LIMIT 100\b/` anchor REV-025's round introduced (correct — `\b` does reject `LIMIT 1000`, and
  `M10` dies because of it) and the two integration tests that run against shared `erp_dev`. Neither
  depends on a global count: `mine` is asserted as an exact set only because its approver is freshly
  seeded, `unassigned` narrows to seeded ids, `all` narrows by `requesterId`, and the approver lookup
  filters to its own two users. I ran the integration file repeatedly alongside the full parallel
  suite and saw no variance.

---

## Acceptance criteria

| T29 criterion | Status |
| --- | --- |
| Queue defaults `mine`; `all`/`unassigned` paged server-side; eligible lookup returns only id/username/displayName | **Met** in behaviour, verified over HTTP. The `mine` binding is under-tested (M-2). |
| Approve/reject/reassign use `jwt-password`; block routes stay device-password; each policy demands `view` + `approval` exactly | **Met**, and non-vacuously: `M32`, `M33`, `M34` and `M38` all die. |
| Only the assigned approver decides; any approval holder may reassign with a reason; no bank plaintext in an approval response | **Met** (the first two land in T28 code and are held by its tests; the third verified here). |
| AC-012 — a Supplier edited after submission cannot be approved, and the UI can see it | **Met**; `stale` matches the service predicate and the integration test drives a real rename. |
| DoD 1.4 #1 — "新增行為有先失敗後通過的測試" | **Not met** for the three controls in H-1, M-1 and M-2. |
| DoD 1.4 #2, #3 — focused tests, regression, lint, client build, real-MySQL verification | **Met**, re-run independently. |
| DoD 1.4 #4 — no duplicate logic, dead code, debug output or unrelated refactor | **Met**. The `escapeLikeTerm` move is a genuine second caller, not a speculative extraction. |
