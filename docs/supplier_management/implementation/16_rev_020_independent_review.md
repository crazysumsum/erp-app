# Supplier Management — PHASE-002 TASK-026 Independent Review

## Decision

**`APPROVED`** — **0 Critical, 0 High, 2 Medium, 3 Low.** "Ready to open as a PR. Neither Medium
is a live defect; both sit on behaviour I independently verified correct."

All findings were remediated before the PR was opened rather than deferred.

## Provenance

| Item | Value |
| --- | --- |
| Reviewer | `agent-skills:code-reviewer`, fresh separate agent, no prior context |
| Author | Claude Opus 5 |
| Method | `SEPARATE_AGENT` |
| Worktree | `/Users/sam/Documents/workspace/erp-app-worktrees/supplier-task-026` |
| Branch | `codex/supplier-task-026`, based on `main` at `00819b9` |
| Reviewed commit | `b3bb4c1` (the whole of TASK-026) |
| Design baseline | `e4083319e526682f70b40a0b2676ae5b50cc72d8f03e9e07c6d6fbb671f211e4` |
| Plan baseline | `a0d41e31d887447d669d0f8252991e43fcdd273eb9eadcbe0d211468092bd154` |

## The three design judgements, all upheld

**`FOR SHARE` over `FOR UPDATE` — right lock, and no deadlock.** Established empirically as well
as structurally: six workers × sixty iterations interleaving all three real lock orders under
`innodb_deadlock_detect=1` gave `{ok: 360, deadlocks: 0, timeouts: 0}`. Nothing holds a settings
lock while wanting a `suppliers` lock, so no cycle is constructible.

> It delivers exactly what AC-013/FR-SET-005 need: once an activation has read the policy, a
> settings write cannot change the answer under it… `FOR UPDATE` would additionally serialize
> every supplier create and activate on one row and buy nothing.

**Wiring `approvalRequired` belongs in this task.** The reviewer's reasoning is stronger than the
author's: AC3 says the policy must be "供create／approval／import共用", so wiring create *is* the
acceptance criterion, and leaving it unwired "would have shipped T27's toggle as a silent
no-op — worse."

**Throwing on a missing settings row — direction right, type wrong.** Fail-closed-loud beats
fail-open-silent for SEC-007, but the raw `Error` became an opaque 500 on create and activate
while the same condition gave a clean 409 on the GET. Fixed (L1).

## Findings, all remediated

### M2 — the production audit recorder never ran, and AC-037 depends on it

Both test layers injected a fake `audit`, and the integration fake ran its own hand-written
INSERT — so its comment that a wrong column "would have surfaced as a MySQL error here" was true
only of the test's SQL. Proved by mutation: deleting `"setting."` from `ACTION_PREFIXES` left
**all 188 tests green**.

Fixed: one integration test now drives the real `SupplierAuditLogService` and reads the row back
before the rollback. The same mutation now fails with
`TypeError: Unsupported Supplier audit action setting.update`.

### M1 — this commit inverted the documented lock order on the activation path

`#changeStatus` took the `suppliers` row lock and only then read the policy, which takes a
settings lock — the reverse of design §2.6's `settings → suppliers → requests → child → audit`.
Latent, not live: `TASK-028` adds `supplier_activation_requests` writes to this same transaction
and its verification is a manual lock-order review. Fixed by hoisting the policy read above the
row lock; `createSupplier` already had it right.

### L1 — raw `Error` where a domain error belongs → fixed

### L2 — a test name that overclaimed, hiding an unreachable guard

"a stale version is refused by real MySQL, not only by the in-memory check" never reached
MySQL's guard: the in-memory check throws first, and the unit fake returned `affectedRows: 1`
unconditionally, so the `WHERE version = ?` guard and its `affectedRows === 0` branch were
unreachable from any test. Renamed honestly, and a unit test now simulates the lost update only
that guard can catch. Removing the guard turns it red.

### L3 — `SUPPLIER_SETTINGS_MISSING` on both paths and `SUPPLIER_SETTING_EMPTY` now covered

### Nit — `password` in the reserved-key set was dead and contradicted its own comment → removed

## What the reviewer verified TRUE

Both T26 verification commands and lint; the client build; **the full developer suite 188/188 on
every one of five runs**, and 10/10 on the settings + migrations contention pair specifically;
the no-scan test going red on an injected `suppliers` read; the handler test going red when
*either* composition root drops the wiring; that a renamed column fails at both test layers, so
the fake does not absorb SQL drift there; that the routes actually register and resolve through
the real handler registry with the right auth types and permissions; and an end-to-end run of the
real service plus the real audit recorder against MySQL in a rolled-back transaction.

Not verified: runtime enforcement of AC-036 (the handler test asserts policy metadata; nothing
drives a request through the authorization middleware), and `jwt-device-password` end to end. UI
is correctly out of scope — T27 owns the Settings page.

## Recorded for the PR, not defects

- **`AC-037` is only partly discharged.** Its first half, "新提交使用審批流程", is `TASK-028`'s
  work; today a new submission throws `SUPPLIER_APPROVAL_NOT_READY`. `T26`'s own acceptance
  criteria do not claim it, but its traceability line lists `AC-037`.
- **`T27` before `T28` is a sequencing hazard.** `T27` depends on `T04` + `T26`, not `T28`, so
  once the Settings UI lands an admin has a working toggle that, turned ON, fails every
  activation until `T28`. Default is OFF and it is reversible. `T27` should gate the toggle, or
  `T28` should land first.
- **The code deviates from the letter of design §2.6.** See `HD-018`.
