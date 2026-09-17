# Supplier Management — PHASE-002 TASK-028 Independent Review (REV-021)

## Decision

`CHANGES_REQUESTED` — **0 Critical, 5 High, 6 Medium, 6 Low.**

## Provenance

| Item | Value |
| --- | --- |
| Reviewer | `agent-skills:code-reviewer`, fresh separate agent, no prior context |
| Author | Claude Opus 5 |
| Method | `SEPARATE_AGENT` |
| Branch | `codex/supplier-task-028`, based on `main` at `074cfba` |
| Reviewed commit | `44368ca` |
| Design baseline | `e4083319e526682f70b40a0b2676ae5b50cc72d8f03e9e07c6d6fbb671f211e4` |
| Plan baseline | `a0d41e31d887447d669d0f8252991e43fcdd273eb9eadcbe0d211468092bd154` |

## Why this review mattered

`T28`'s verification list has three items, and the third is *"Manual transaction review：lock
order符合settings→Supplier→request→audit"*. The author did not self-certify it and asked for it
to be done independently. **That is exactly where the implementation failed.**

## H1 — the lock order was inverted, and it deadlocked on real MySQL

`#decide` locked `supplier_activation_requests` before `suppliers`, the reverse of design §2.6
and of `updateSupplier`. The code comment three lines above claimed the correct order. The
reviewer crossed the two transactions on `erp_dev`:

```
both first locks held (T1 holds suppliers, T2 holds request)
RESULT: [ 'T1 acquired request', 'T2 ERROR ER_LOCK_DEADLOCK' ]
```

`withTransaction` has no deadlock retry and the module maps only `ER_DUP_ENTRY` and
`ER_ROW_IS_REFERENCED*`, so this surfaced as an opaque 500 on the most likely concurrent pair
in the feature — an approve racing an edit.

**The author's own lock-order test could not have caught it**: it asserted
`indexOf("supplier") < lastIndexOf("request")`, which passes under both orders because the
request is read twice.

## The other four High findings

- **H2** — `SUPPLIER_CREATE_SCHEMA` is `additionalProperties: false` with no `approverUserId`,
  while `createSupplierHandler` is wired live. Turning the policy ON made create-with-activate
  impossible: a 400 naming a field the API refuses.
- **H3** — design §4.5 lists the identifier set as approval-significant, but identifier writes
  did not invalidate. A submitter could add an identifier no approver saw and have the old
  snapshot approved. Security-shaped.
- **H4** — `reassignRequest` performed no actor authorization at all.
- **H5** — the invalidation path, half of acceptance criterion 2, had zero tests.

## Medium and Low

`M1` a non-significant edit bricked the request permanently; `M2` the note was read from
`approvalNote` while both schemas send `requestNote`; `M3` the `pending_approval` guard ran only
for approve; `M4` approve did not re-check activatability; `M5` no integration test — a column
renamed to `decided_bxy` passed 20/20 against the fake; `M6` the replay comparison used the
wrong target status. Lows: unbounded snapshot, the replay branch disclosing state before
authorization, a dead default reason, withdraw demanding a reason the spec does not ask for,
dead `approverEligible` scaffolding, and a comment contradicting its code.

## Remediation

All of it in `4d631bd`, including an integration test against real MySQL that reproduces the H1
interleaving: re-inverting the lock order makes it fail with `ER_LOCK_DEADLOCK`.
