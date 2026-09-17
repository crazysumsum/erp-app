# Supplier Management — PHASE-002 TASK-028 Second Remediation Review (REV-023)

## Decision

`CHANGES_REQUESTED` — **0 Critical, 1 High, 3 Medium, 9 Low.**

> `b8837e3` is the first round in three that did not introduce a new defect. I tried hard to
> find one — every fix listed in the commit message was examined, and every one of them is
> correct.

## Provenance

| Item | Value |
| --- | --- |
| Reviewer | `agent-skills:code-reviewer`, fresh separate agent, no prior context |
| Reviewed commit | `72e0ec2` (diff `4d631bd..72e0ec2`, read against `074cfba..72e0ec2`) |
| Branch | `codex/supplier-task-028` |

## The finding that mattered most was structural

> The invalidation rule is implemented three times in two services… They have **already
> drifted**: the identifier copy bumps `version/updated_at/updated_by`, the two admin copies do
> not. H-A was a missing fourth copy. The derived field map fixes the *list* and leaves the
> *duplication*. The coherent shape is a single `SupplierApprovalService` method owning both
> writes, with the three call sites supplying only `changedFields`.

Acted on in `d956a62`. `invalidateForSignificantChange` owns both writes; removing the draft
write turns **13** tests red, so the single owner is load-bearing rather than decorative.

The reviewer judged `SupplierApprovalService` itself coherent — the split between
connection-taking collaborators and transaction-owning commands is the right boundary, and
`#decide` as one parameterised path over a frozen `DECISIONS` table is the right shape. "It is
not a pile of guards."

## H1 — a second, different lock cycle, reproduced

`createSupplier` took the Business Master currency lock (X) **before** `supplier_settings` (S),
while `#changeStatus` takes settings first. InnoDB will not grant S past a waiting X, so an
`updateSettings` queued between them closes a three-way cycle across three live paths.

Reproduced on `erp_dev`, before and after the one-line hoist:

```
old    {"t1":"ER_LOCK_WAIT_TIMEOUT","t2":"ok","t3":"ER_LOCK_DEADLOCK"} | deadlock: true
fixed  {"t1":"ok","t2":"ER_LOCK_WAIT_TIMEOUT","t3":"ER_LOCK_WAIT_TIMEOUT"} | deadlock: false
```

Pre-existing from `TASK-026` rather than introduced here — but `T28`'s verification asserts this
exact lock order, and the branch claims compliance in a code comment.

## M1 — the derived field map moved the seam and made the failure worse

Forgetting a `COLUMN_TO_INPUT_FIELD` entry maps the column to `undefined`, so every comparison
is against `""` and **every pending Supplier loses its approval on any edit**, with
`changedFields: [undefined]` in the audit. The old drift under-enforced silently; the
replacement over-enforced silently.

And the guard test was `assert.ok(owner, …)` where both branches yield a non-empty string — it
could not fail. Fixed with a module-load assertion and a test that reads the mapping from source.

## M2 — the version arithmetic had no discriminating test

Both off-by-ones left the suite green, and either makes **every** approval impossible forever.
No test anywhere did submit-then-approve as a round trip; the integration tests all seeded the
request by hand. One now goes through `activateSupplier` and approves what it produced.

## M3 — needed a structural assertion, not a behavioural one

Widening `activate.allowedFrom` to admit `pending_approval` only changes which error surfaces,
because `assertSupplierActivatable` rejects it independently. No behavioural test can catch it,
so the registry is pinned directly.

## Lows

`L1` identifier response fields (the C1 class, unguarded); `L2` the activatability filter's
scope unpinned; `L3` the invalidation version bump; `L4` audit written before the child lock;
`L5` a test title asserting the opposite of its body; `L6` a vestigial block; `L7` **the commit
message said "239 pass" when the count was 238**; `L8` the replay branch returning before
`assertExpectedVersion`; `L9` missing `REV-021`/`REV-022` provenance in the ledger — which this
document set and revision 105 close.

## Verified by the reviewer

All eight previously-claimed mutations discriminate, independently re-derived; the suite is
238/238 across six runs with no variance; `erp_dev` byte-identical before and after; every
supplier projection swept against its response schema with **zero** remaining undeclared fields;
lint and client build clean; `AC-012` confirmed end to end on real MySQL.

## Disposition

`d956a62` lands the restructure, the H1 hoist, M1, M2, M3 and the Lows. Eleven mutations now
turn the suite red with the test files byte-identical. `L7` is corrected in that commit message
rather than silently: the count was 238, not 239.
