# TASK-010 — Purchasing Config and Shared Input Validation

Built on 2026-10-30 from main `1f5ea721`. Composite baselines moved `design d6103ad1 → 600d9d58`, `plan 24a86ab4 → 5b8a282f`; the only manifest change is two shared files added to `approval_required_paths`.

| File | Contents |
| --- | --- |
| `server/config/purchasing.js` | The §12.1 settings, env-overridable like every other module config |
| `server/src/modules/purchasing/normalizePurchasingConfig.js` | Positive safe integers; each setting may only be lowered from its §12.1 value (lookback days capped at 366); unknown settings rejected, including `transactionTimeoutMs` (HD-011); frozen result |
| `server/src/modules/purchasing/purchasingValidation.js` | `positiveId`, `eventId`, `localDate`, `reason`, `notes`, `reference`, `onlyFields`, `requireItems` |
| `server/src/framework/configuration/applicationConfiguration.js` | +4 lines: the `purchasing` section is validated at startup |
| `server/test/configuration.test.js` | `purchasing` added to the expected-section list |
| `server/test/purchasing/purchasingConfig.test.js`, `purchasingValidation.test.js` | 10 new cases (3 + 7) |

## APR-006 — startup wiring

Sam chose option A on 2026-10-30: wire the Purchasing config into startup validation in this task rather than deferring it. That touches two shared files outside the module's write paths, so both were added to `approval_required_paths` and approved as `APR-006`; `APR-001`–`APR-005` were re-confirmed on the new digests. The wiring follows the Fulfillment (`eb44ea5b`) and Sales precedent.

Verified end to end through `validateApplicationConfiguration(defaultConfigurationSource())`, the call `createApplication.js:423` makes at startup:

| Environment | Result |
| --- | --- |
| defaults | starts, `maxPurchaseOrderLines` 100 |
| `PURCHASING_MAX_PURCHASE_ORDER_LINES=500` | refused: `ConfigurationError`, purchasing section |
| `PURCHASING_MAX_PURCHASE_ORDER_LINES=` (empty) | refused |
| `REQUEST_TIMEOUT_MS=5000` | refused by the **database** section, not Purchasing — the case CI caught (below) |
| **wiring line removed**, PO lines 500 | **starts with no purchasing section** — negative control: the refusal comes from this wiring |

The first probe of that negative control was itself wrong: it read `c.purchasing.maxPurchaseOrderLines`, so a missing section threw inside the probe and was reported as "refused". Fixed to distinguish the two outcomes before the result was trusted.

## HD-011 — no Purchasing transaction timeout

The first push of this branch failed CI shard 2/4 in `databasePoolPressure.test.js` — "the database must give up before the route timeout does". That case sets `requestTimeoutMs` to 5000 to provoke the database cross-section error; the Purchasing section, holding §12.1's `transactionTimeoutMs: 30000` with an in-section `≤ requestTimeoutMs` check, failed first and the expected database error never appeared.

The test failure exposed a design defect, not only a test interaction:

- `applicationConfiguration.js` already enforces, as a cross-section check and strictly, that `database.acquireTimeoutMs + database.transactionTimeoutMs < application.requestTimeoutMs`. Its comment records that the factory default was once `5000 + 30000 > 30000`, so a transaction could still hold its connection after the route had answered 504.
- `MySqlDatabaseService.withTransaction` lets a per-call `timeoutMs` replace that default without a cap. §12.1's `30000`, passed per call, reproduces the fixed defect; the `≤` check let it through.
- No HTTP path in the codebase passes its own transaction timeout; only `SalesIntakeWorker`, a background worker, does.

**Sam chose on 2026-10-30 to drop the setting.** Purchasing HTTP transactions use `database.transactionTimeoutMs` (default 20000), already guarded by the correct check. The wiring is back to the Fulfillment pattern — `normalizePurchasingConfig(source?.purchasing)`, four lines — and the `configuration.test.js` multiple-sections case is unchanged from main. Configuring `transactionTimeoutMs` is rejected as an unsupported setting, which pins the decision. Rejected alternative: keep the setting at a 20000 default with a new cross-section check, which would have grown the shared-file change and added a second knob to keep consistent with the database's.

**This also records a verification gap of mine.** I ran the full server suite before wiring `applicationConfiguration.js`, and after wiring re-ran only `configuration.test.js` and the Purchasing files. A change to the shared startup path needs the full suite after the last edit. The suite has since been run after the fix, and with CI's bank key-ring variables set locally: 4,260 tests, 0 failures (1,312 MySQL-backed tests skipped locally). Those variables also make the two startup-path files that fail locally for lack of them — `applicationFactory.test.js`, `shutdownResources.test.js` — pass 12/12, so the "7 known environment failures" were not hiding anything.

## REV-004 — review of the scope change

`method: HUMAN`, author the TASK-010 implementation agent, reviewer Sam. It covers the one change between `d6103ad1` and `600d9d58`: the two `approval_required_paths` entries. `REV-003` stays as the review of `d6103ad1`.

## Decisions taken in the code

- Quantity scale, Unit Price scale and the 6-digit document sequence are **not** config. §12.1 lists them in the example object, but the same section says PO/GR format and similar rules are domain constants not overridable by environment, and they are bound to DB column precision. They stay in `purchasingConstants.js`; configuring them is rejected as an unsupported setting.
- `eventId` accepts only lowercase RFC 9562 UUIDs, a subset of what the Inventory provider accepts. Uppercase is rejected, not normalized, because `Idempotency-Key` must equal `eventId` exactly; a client using `crypto.randomUUID()` always passes (asserted over 1,000 samples).
- Text is measured in code points; lone surrogates and control characters other than tab/LF/CR are rejected, and single-line references reject those three as well (SEC-013). Validation errors carry only `{ field }`, never the submitted value (SEC-014).
- `onlyFields` is an allowlist, not a denylist: client totals, snapshots, factors, base quantities, status and warning flags are rejected because they are not listed.

## Deviations from the plan text

- `normalizePurchasingConfig.js` is not in `TASK-010`'s file list; every module keeps its normalizer in its own file and the configuration loader imports it from there.
- §10.2 lists CSV formula neutralization and stable column order under `purchasingValidation.test.js`; both belong to `TASK-039`.

## Verification

- 10/10 new cases pass; `configuration.test.js` 9/9; `databasePoolPressure.test.js` passes.
- **Mutation sweep 21/21 RED** after the HD-011 change (the three transaction-bound mutants removed with the setting; one added for `transactionTimeoutMs` being accepted again), between a GREEN baseline and a GREEN restore, skips counted as failures.
- Lint exit 0. Full local server suite with CI's key-ring variables: 4,260 tests, 0 failures.
- `validate_traceability.py` STRUCTURE_PASS; `PLAN_READY` BLOCKED on HD-006 only.

## CI admission — pending

Sam's rule of 2026-10-30 (`AGENTS.md`, merged in #310 after this branch was cut) requires explicit approval before any test case enters routine CI, including through an automatically discovered glob or a PR's own CI run. This branch was therefore not pushed until the decision below.

**Decision — Sam approved option A on 2026-10-30.** Approved scope:

| | |
| --- | --- |
| Cases | All 11 new cases: `purchasingConfig.test.js` (4) and `purchasingValidation.test.js` (7), including the 1,000-sample `crypto.randomUUID()` loop. After HD-011 one config case was removed with the setting, so **10** are admitted — a subset of the approved scope |
| Existing cases | `configuration.test.js`: `purchasing` added to its expected-section lists, required by the APR-006 wiring; no new case. After HD-011 only the first list changes |
| Data / concurrency | In-memory only; no database, network or concurrency; one repetition; threshold all pass |
| Trigger | Every PR and push to main, through the server suite's automatic discovery |
| Measured cost | About 0.12 s wall per file locally, almost all Node startup; CI speed not measured, estimated under 1 s per job |

Rejected alternatives: B (reduce the UUID loop to 100, saving milliseconds) and C (keep the cases out of CI, leaving the validators every later write handler relies on without regression protection).
