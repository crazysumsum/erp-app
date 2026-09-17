# Supplier Management — PHASE-002 TASK-028 Remediation Review (REV-022)

## Decision

`CHANGES_REQUESTED` — **1 Critical, 2 High, 3 Medium, 5 Low.**

Every one of them was in the remediation, not in the original implementation.

## Provenance

| Item | Value |
| --- | --- |
| Reviewer | `agent-skills:code-reviewer`, fresh separate agent, no prior context |
| Reviewed commit | `4d631bd` (diff `44368ca..4d631bd`, read against `074cfba..4d631bd`) |
| Branch | `codex/supplier-task-028` |

## C1 — a shipped endpoint returned 500 for every caller

`updateSupplier` returned `approvalInvalidated`, which design §4.5 requires, but
`SUPPLIER_DETAIL_SCHEMA` is `additionalProperties: false` and response validation is
`enabled: true, validateInProduction: true` in every environment.

```
FAIL | what updateSupplier actually returns -> [{"keyword":"additionalProperties"}]
```

Any user editing any supplier's phone number got `INTERNAL_SERVER_ERROR` **over a write that
had already committed**. Introduced by `44368ca`; REV-021 missed it.

## H-A — `changeSupplierCode` left the request permanently stuck

Design §4.5 lists Supplier Code first and AC-012 names it. Reproduced end to end: no
`approval.invalidate` audit, the Supplier stayed `pending_approval`, the request could never be
approved (snapshot mismatch) and could never be re-submitted (`allowedFrom: ["draft"]`).

Root cause: the exported `APPROVAL_SIGNIFICANT_COLUMNS` and the enforced
`SIGNIFICANT_UPDATE_FIELDS` were two hand-maintained lists that had drifted — and the comment
claiming Supplier Code could not be changed in that service was false forty lines above
`changeSupplierCode`.

## H-B — seven claimed fixes had no discriminating test

Each was disabled in turn with the suite left green:

| Fix disabled | Result |
| --- | --- |
| H3 identifier invalidation | 171 pass, 0 fail |
| M1 re-pin call site | 171 pass, 0 fail |
| `updateSupplier`'s invalidation branch | 171 pass, 0 fail |
| M2 `requestNote` | 171 pass, 0 fail |
| M6 replay target status | 171 pass, 0 fail |
| H2 create schema | 171 pass, 0 fail |
| `sameUser` null-safety | 171 pass, 0 fail |

## Medium

`M-A` the M6 fix regressed idempotency for a re-sent activate against an already-active
Supplier under policy ON; `M-B` the activatability re-check sat behind an optional dependency
nothing wires, so a composition root that forgot it would silently lose the rule; `M-C` the
identifier invalidation was invisible to its caller and did not bump the Supplier row.

## Remediation

`b8837e3`. All eight mutations now turn the suite red with the test files byte-identical.
