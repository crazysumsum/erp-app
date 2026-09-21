# Supplier Management — DEF-001 / DEF-002 Remediation

## Scope and authority

| Item | Value |
| --- | --- |
| Decision | `HD-012` option (b) — fix DEF-001 and DEF-002, defer the rest |
| Risk approval for deferrals | `APPROVAL-HD-012-RISK` covering DEF-003…DEF-008 |
| Branch | `codex/supplier-defect-001-002` |
| Base commit | `b3e5aa90229762e9cfc18b5f9c042fbbfe6cf255` |
| Design baseline | `dcb74d3c781236860d85b4dc15e2efce4ea33b58b0ed9739241d2d2c8cd61445` |
| Plan baseline | `d54764e4e3b4cad5d907d6f4d906566df157b4cd4907e0f4e06533cef8d8c6bd` |
| Source fingerprint after fix | `13627f6cbc5eee6e9f2edba1080c563e9ef49d62a41b47846ff984191ba2a4e7` |
| Source findings | `REV-006`, `docs/supplier_management/implementation/02_checkpoint_h_independent_review.md` |

Both defects were independently re-verified against source before any code was changed. Both fixes were driven test-first: the new and updated tests were confirmed RED against the unmodified source and GREEN after the change.

## DEF-001 — completeness warning that no user action could clear

**Change:** `server/src/modules/supplier/supplierValidation.js`

`BANK_ACCOUNT_MISSING` is now emitted only when a caller explicitly supplies the flag:

```js
if (Object.hasOwn(input, "hasBankAccount") && !input.hasBankAccount) {
```

Bank accounts arrive in PHASE-003. No PHASE-001 caller can answer the question, so evaluating it produced a warning that was permanently visible on every supplier. `Object.hasOwn` is the idiom already used in this module (`SupplierAdminService.js:189`). When PHASE-003 call sites start passing a real boolean, the warning activates on its own, and the new test pins both halves of that behavior.

Design §456 lists Bank among the completeness warnings, so this defers the evaluation rather than removing it.

**Tests:** `server/test/supplierValidation.test.js` — the existing expectation that encoded the bug was corrected, and a new case `bank completeness is only evaluated once a caller can answer it` asserts that an otherwise-complete supplier gets no warning while `hasBankAccount: false` still does. `server/test/integration/supplierManagement.integration.test.js` likewise asserted the buggy behavior; it now asserts the warning is absent and that an unrelated warning is still present.

## DEF-002 — replay detection matched non-lifecycle audit rows

**Change:** `server/src/modules/supplier/SupplierAdminService.js`

The replay lookup matched `action LIKE 'supplier.%'`, and every audit action this module writes begins with `supplier.` — including `supplier.address.*`, `supplier.contact.*`, `supplier.identifier.*`, `supplier.update` and `supplier.code.change`. A new module-level `LIFECYCLE_ACTIONS` constant now bounds the query to the seven status transitions:

```js
`SELECT action FROM supplier_audit_logs WHERE supplier_id = ? AND action IN (${LIFECYCLE_ACTIONS.map(() => "?").join(", ")}) ORDER BY id DESC LIMIT 1`
```

**Test:** `server/test/supplierLifecycleService.test.js` — the fake connection now models the statement's bound action filter instead of returning a fixed row, so the test exercises the filtering rather than assuming it. The new case `replay detection ignores non-lifecycle audit rows written after the command` asserts that a genuine replay still succeeds when a contact and an address write sit on top of the transition, and that a wrong command on the same history is still rejected.

## REV-006 secondary claim — rejected, with reason

REV-006 additionally asked for `assertExpectedVersion` to run before the replay `return`, on the grounds that a client holding a stale version receives 200 instead of `VERSION_CONFLICT`.

**This was not applied.** Design §476 states that a status command redelivered while the target is already in the same state returns current state without a duplicate audit, and §1387 repeats it. A genuine replay necessarily carries the original, now-stale version, so requiring a version match would reject exactly the case the rule exists to permit. The pre-existing test at `server/test/supplierLifecycleService.test.js:85` already pins this: it replays a suspend with `version: 2` against a row at `version: 5` and requires success.

The fix therefore addresses the action-matching defect only.

## Verification

| Check | Result |
| --- | --- |
| `npm run lint` | exit 0 |
| `npm run build --workspace client` | exit 0 |
| `supplier-phase-001-server` | JUnit 159 testcases / 0 failures / 0 skipped (`min_tests` 157, `max_skipped` 0) |
| `supplier-phase-001-client` | JUnit 40 testcases / 0 failures / 0 skipped (`min_tests` 40, `max_skipped` 0) |

Server tests ran against the authorized test-only `erp_dev` schema with `DB_INTEGRATION_TESTS=1`. Test count rose from 157 to 159 because two cases were added.

## Browser validation

Playwright CLI against a server on `127.0.0.1:3000` and a client dev server on `127.0.0.1:5273`, both started from this worktree and stopped afterwards. Authenticated as synthetic system-admin `pw_def_0916` with approved device binding `4499` in `erp_dev`.

**DEF-001, through the real UI:**

- Creating supplier `DEF-0916-095339` showed exactly four completeness items and **no** 「尚未設定銀行帳戶」.
- Adding an ordering address cleared one (4 → 3), an orders primary contact cleared another (3 → 2), and an HK business-registration identifier cleared a third (2 → 1).
- `GET /suppliers/404` and `GET /suppliers/404/completeness` both returned `issues: []` and exactly one `PAYMENT_TERM_MISSING` warning.
- The residual payment-term warning cannot be cleared in this environment because Business Master has zero Active Payment Terms seeded. Payment term is optional by design (§77), so this is an environment data gap, not a Supplier defect.

**DEF-002, through the real UI plus an authenticated replay:**

- Supplier 404 was suspended through the UI confirmation dialog, advancing version 1 → 2.
- A second contact was then created through the UI, making `supplier.contact.create` the newest `supplier.%` audit row — the exact trigger condition.
- Replaying `POST /suppliers/404/suspend` with the original stale `version: 1` returned **200, status `suspended`, version still 2** — the designed §476 idempotent replay, with no duplicate audit and no version bump. Before the fix this sequence returned 409 `STATUS_TRANSITION_INVALID`.
- Negative path intact: `POST /suppliers/404/restore` on a suspended supplier still returned 409 `STATUS_TRANSITION_INVALID`.

**Browser health:** the final reloaded detail page reported 0 console errors and 0 warnings. The only network requests were `user/me`, the supplier read and the completeness read, all 200. Verified at desktop width and at 375×812.

## Residual state

- `DEF-001` and `DEF-002` are `RETEST`, not `CLOSED`: closure depends on the re-run independent review.
- `DEF-003`…`DEF-008` are `DEFERRED` under `APPROVAL-HD-012-RISK`.
- `REV-006` remains `CHANGES_REQUESTED`. Checkpoint H is still unsatisfied and `TASK-024` is still open until an `APPROVED` review bound to design baseline `dcb74d3c` exists.
- This work is not yet committed, pushed or opened as a PR, and has had no CI run.
