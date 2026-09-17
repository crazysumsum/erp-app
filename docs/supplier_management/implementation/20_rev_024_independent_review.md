# Supplier Management — PHASE-002 TASK-028 Third Remediation Review (REV-024)

## Decision

`CHANGES_REQUESTED` — **0 Critical, 2 High, 2 Medium, 3 Low, 1 Nit.**

> No new defect in shipped behaviour. This is the second consecutive round that introduces none.
> What it does introduce is two load-bearing invariants with no test holding them, one of which
> is the fix this commit is named after.

## Provenance

| Item | Value |
| --- | --- |
| Reviewer | `agent-skills:code-reviewer`, fresh separate agent, no prior context |
| Reviewed commits | `d956a62` (code) and `55d9cac` (provenance), against `074cfba..55d9cac` |
| Branch | `codex/supplier-task-028` |

## H1 — the fix this commit is named after had no regression test

Reverting the settings/currency hoist left the suite at **246 pass, 0 fail**, while the
reviewer's own probe measured **41 `ER_LOCK_DEADLOCK` in 960 iterations** of that order.

Worse, the reason no test could catch it: **every integration test on the branch stubbed both
locks.** `businessMaster` and `approvalRequired` were faked everywhere, so no test had ever
taken a real `currencies FOR UPDATE` or `supplier_settings FOR SHARE` — the precise pair behind
two of this branch's three High findings.

Fixed with two tests that take the real locks. One replays the three-way interleaving
(`createSupplier` / `#changeStatus` / `updateSettings`) and asserts no deadlock. The other
drives the real `SupplierAdminService` with the real `BusinessMasterProvider` and observes the
statements it issues, asserting settings precedes the currency lock — **that** one turns red
when the hoist is reverted. Stated precisely because the distinction matters: the interleaving
test proves the order is safe, the observation test proves `createSupplier` is what takes it.
Only the second discriminates.

## H2 — the `activationRequested &&` short-circuit was unheld

Removing it left the suite green. The resulting behaviour: with the policy ON, a plain draft
create opens a pending request against a `draft` Supplier. That request can never be decided —
`#assertRequestStillCurrent` rejects a non-pending Supplier — and
`uq_supplier_activation_pending` then blocks the genuine submission. Now tested.

> **CORRECTED by REV-025 M2.** This section originally said the blocked submission surfaces as
> `SUPPLIER_CODE_TAKEN`, "an error naming a field that is fine". That is false.
> `SUPPLIER_CODE_TAKEN` comes only from `createSupplier`'s own `duplicateEntry` catch; the
> genuine submission goes through `#changeStatus`, which has **no catch at all**. Reproduced:
> `code: ER_DUP_ENTRY, publicCode: undefined` — an unmapped `INTERNAL_SERVER_ERROR`. The real
> symptom is worse than the one recorded, so this understated rather than flattered, but it was
> still written into the permanent ledger by a process whose rule is to verify before recording.
> This is the fifth claim of the author's found false across three rounds.

## Two claims of mine the reviewer found FALSE, both confirmed and corrected

1. **"every one of the eleven mutations now turns the suite red"** — false. The `requestNote`
   rename landed at **two** sites and only `createSupplier`'s had a test; reverting the
   `#changeStatus` submit site — the path `T29`'s API will drive — stayed green. Verified
   myself: `192 pass 0 fail` with it reverted. Now tested. The reviewer also noted `sameUser`'s
   null guard does not discriminate, while being careful to say it could not construct an input
   where behaviour differs; that is accurate and it is not claimed as covered.
2. **"removing the draft write turns 13 tests red"** — false. It turns **4** red. Verified
   myself. This is the same species as `REV-023`'s `L7` (a pass count wrong by one), and is
   corrected in the open for the same reason.

## M2 — the Business Master lock has no documented position and occupies three

Design §2.6 fixes `supplier_settings → suppliers → requests → child → audit` and never mentions
`currencies`/`payment_terms`. In code it is taken before `suppliers` (`createSupplier`), between
`suppliers` and `requests` (`updateSupplier`, `#changeStatus`), and after both (`#decide`). That
is the same shape as the two cycles already found. The reviewer could not construct a cycle
from it — **2880 iterations, 0 deadlocks, with a negative control that produced 41** — but the
rule that has failed twice remains unwritten. Recorded as `HD-019` rather than by editing the
design, which would move both baselines.

## L1–L3 and the Nit

`L1` and `L2` are the corrections above. `L2` also: the module-load guard's test grepped the
source for the throw's message, so neutering the condition stayed green — the guard is now an
exported function the test executes. `L3` an unmentioned behaviour change on the identifier
path: it previously forced `draft` and returned `true` even with no open request, and now
returns `false`; unreachable through any code path, but it was not disclosed. Nit: with
`activate: true`, `SUPPLIER_SETTINGS_MISSING` now surfaces ahead of `CURRENCY_NOT_ACTIVE`.

## What the reviewer verified

246/246 across five runs with zero variance; lint and client build clean; `TASK-026` genuinely
merged (`gh pr view 110` → `MERGED`, `mergeCommit 074cfba`, which is `main`'s head) before its
status was changed; all three recorded review counts match their documents; the extra version
bump on the `updateSupplier` and `changeSupplierCode` paths is correct and not a double-bump
problem, since both UPDATEs are in one transaction and the optimistic guard runs on the first;
no cycle constructible across the eight paths modelled; `erp_dev` byte-identical before and
after.

On the provenance commit: *"Accurate on every number I could check, and notably unsoftened: it
records the author's own method failures rather than only the code findings."*
