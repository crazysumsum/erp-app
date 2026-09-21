# Supplier Management — PHASE-002 TASK-028 Fourth Remediation Review (REV-025)

## Decision

**`APPROVED`** — **0 Critical, 0 High, 2 Medium, 3 Low. No blocker.**

> This round introduced no shipped defect — the third consecutive round that introduces none. Of
> 36 targeted mutations I applied across `SupplierApprovalService`, `SupplierAdminService`,
> `SupplierIdentifierService` and `SupplierSettingsService`, **32 were killed** by the existing
> suite.

The first APPROVED on this branch, after five rounds.

## Provenance

| Item | Value |
| --- | --- |
| Reviewer | `agent-skills:code-reviewer`, fresh separate agent, no prior context |
| Reviewed commit | `92e02aa`, against `074cfba..92e02aa` |
| Branch | `codex/supplier-task-028` |

## M1 — the create submit path's snapshot version was untested → fixed here

Mutating `supplierVersion: 1` → `2` in `createSupplier` left the suite at 250 pass, 0 fail. The
reviewer then drove `createSupplier({activate: true})` under policy ON and approved the request
it opened: clean it passes, mutated it throws `APPROVAL_REQUEST_STALE`. **Every Supplier created
through create-with-activate would be permanently unapprovable, silently, with the suite green.**

This is the third time on this branch that version arithmetic has been green and broken, and the
second time a fix landed at two sites and was tested at one — the same shape as `REV-024`'s
`requestNote` finding. The route is live: `createSupplierHandler` calls it, and this branch added
`approverUserId`/`requestNote` to `SUPPLIER_CREATE_SCHEMA` specifically so it works.

Fixed with an integration test that creates with `activate: true` and approves what it produced.
Re-running the mutation now turns it red.

## M2 — a false symptom, written into the permanent ledger

The `H2` narrative in the commit message, the ledger observation and `20_rev_024…md` all claimed
the blocked submission surfaces as `SUPPLIER_CODE_TAKEN`. `SUPPLIER_CODE_TAKEN` comes only from
`createSupplier`'s own `duplicateEntry` catch; the genuine submission goes through
`#changeStatus`, which has **no catch at all** — confirmed independently. The reviewer reproduced
it:

```
GENUINE_SUBMIT_ERROR code= ER_DUP_ENTRY  publicCode= undefined
```

An unmapped `INTERNAL_SERVER_ERROR`. The defect `H2` describes is real and the test holds it
correctly; only the stated symptom was wrong. The real one is worse than the recorded one, so
this understated rather than flattered — the reviewer noted it is the first of the five false
claims that runs against the author's own interest. Corrected in all three places.

No defensive `ER_DUP_ENTRY` mapping was added to `#changeStatus`: with the short-circuit in
place, two concurrent activates serialize on the `suppliers` row lock and the second takes the
replay branch, so the unique index cannot be reached in normal operation. Mapping a state that
cannot occur would be speculative.

## L3 — a test that could not fail, costing 70% of the suite's wall clock → removed

> its body issues only inline raw SQL on three fresh connections and imports nothing from
> `src/`, so *no* production change can turn it red. It characterizes InnoDB, not this branch.

It was also satisfied by a lock-wait timeout rather than by the absence of a deadlock, and cost
3.3s of the file's 3.8s. Removed, with a comment recording where the cycle was actually measured
(`REV-023`: 41 deadlocks in 960 iterations of the old order; `REV-024`: 2880 iterations, 0
deadlocks, of the current one). The file now runs in 0.49s. What guards the branch is the
observation test, which drives the real service and does turn red on the hoist revert.

## L1 and L2

`L1`: the `assertSupplierActivatable` call in `createSupplier` is unreachable — the normalizers
already reject empty values, `status` is the literal `"draft"`, and the currency has already been
asserted `ACTIVE`. Left in place as defence in depth rather than tested, since a test for
unreachable code asserts nothing. `L2`: the invalidation default reason is now tested.

## What the reviewer verified

12 consecutive full-suite runs at 250/250 with zero variance; every number and every "turns red"
claim in the commit message independently confirmed; the observation test genuinely takes a real
`currencies FOR UPDATE` and `supplier_settings FOR SHARE`, with its statement order dumped; the
`.catch(() => {})` cannot produce a false pass because the two `notEqual(-1)` guards fire first;
module-load behaviour byte-for-byte unchanged by the export refactor; `HD-019`'s positional
claims correct line by line; `erp_dev` byte-identical including `supplier_name_grams`.

On `HD-019`: accurate, but it names only `changeSupplierCode` for the audit-tail inversion when
several paths share it. The conclusion is unchanged — nothing anywhere takes a lock on
`supplier_audit_logs` — and the wording is corrected in this round's ledger entry.

## Acceptance criteria

`AC1` met; `AC2` met, and the "Supplier version" half now holds on **both** submit paths rather
than one; `AC3` met; `AC-012` and `AC-013` met. Verification item #3 was upgraded from "partially
met" to **substantially met**, with the two remaining gaps both on the record as `HD-019`, OPEN
by design.
