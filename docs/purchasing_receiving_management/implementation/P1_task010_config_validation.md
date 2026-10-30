# TASK-010 — Purchasing Config and Shared Input Validation

Built on 2026-10-30 from main `1f5ea721`. Composite baselines moved `design d6103ad1 → 600d9d58`, `plan 24a86ab4 → 5b8a282f`; the only manifest change is two shared files added to `approval_required_paths`.

| File | Contents |
| --- | --- |
| `server/config/purchasing.js` | The §12.1 settings, env-overridable like every other module config |
| `server/src/modules/purchasing/normalizePurchasingConfig.js` | Positive safe integers; each setting may only be lowered from its §12.1 value (lookback days capped at 366); `transactionTimeoutMs ≤` the application request timeout; unknown settings rejected; frozen result |
| `server/src/modules/purchasing/purchasingValidation.js` | `positiveId`, `eventId`, `localDate`, `reason`, `notes`, `reference`, `onlyFields`, `requireItems` |
| `server/src/framework/configuration/applicationConfiguration.js` | +4 lines: the `purchasing` section is validated at startup |
| `server/test/configuration.test.js` | `purchasing` added to the two expected-section lists |
| `server/test/purchasing/purchasingConfig.test.js`, `purchasingValidation.test.js` | 11 new cases — **pending CI admission** |

## APR-006 — startup wiring

Sam chose option A on 2026-10-30: wire the Purchasing config into startup validation in this task rather than deferring it. That touches two shared files outside the module's write paths, so both were added to `approval_required_paths` and approved as `APR-006`; `APR-001`–`APR-005` were re-confirmed on the new digests. The wiring follows the Fulfillment (`eb44ea5b`) and Sales precedent.

Verified end to end through `validateApplicationConfiguration(defaultConfigurationSource())`, the call `createApplication.js:423` makes at startup:

| Environment | Result |
| --- | --- |
| defaults | starts, `maxPurchaseOrderLines` 100 |
| `PURCHASING_MAX_PURCHASE_ORDER_LINES=500` | refused: `ConfigurationError`, purchasing section |
| `PURCHASING_MAX_PURCHASE_ORDER_LINES=` (empty) | refused |
| `PURCHASING_TRANSACTION_TIMEOUT_MS=60000`, HTTP 30000 | refused: transaction would outlive the request |
| transaction 45000, HTTP 45000 | starts (boundary) |
| transaction 45001, HTTP 45000 | refused |
| **wiring line removed**, PO lines 500 | **starts with no purchasing section** — negative control: the refusal comes from this wiring |

The first probe of that negative control was itself wrong: it read `c.purchasing.maxPurchaseOrderLines`, so a missing section threw inside the probe and was reported as "refused". Fixed to distinguish the two outcomes before the result was trusted.

`configuration.test.js` then failed one existing case: with an invalid `application` section, `requestTimeoutMs` is unavailable, so Purchasing — like Sales — reports that it cannot verify its transaction bound. Kept strict, matching Sales and design §12.1, and added `purchasing` to that case's expected list. Fulfillment instead skips the check when the timeout is missing; doing that here would let the relation go unverified, which is exactly what mutant C6 guards against.

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

- 11/11 new cases pass; `configuration.test.js` 9/9 after the expected-list update.
- **Mutation sweep 23/23 RED** between a GREEN baseline and a GREEN restore, skips counted as failures.
- Lint exit 0. Full local server suite: only the 7 known environment failures (missing bank key rings), unchanged.
- `validate_traceability.py` STRUCTURE_PASS; `PLAN_READY` BLOCKED on HD-006 only.

## CI admission — pending

Sam's rule of 2026-10-30 (`AGENTS.md`, merged in #310 after this branch was cut) requires explicit approval before any test case enters routine CI, including through an automatically discovered glob or a PR's own CI run. This branch was therefore not pushed until the decision below.

**Decision — Sam approved option A on 2026-10-30.** Approved scope:

| | |
| --- | --- |
| Cases | All 11 new cases: `purchasingConfig.test.js` (4) and `purchasingValidation.test.js` (7), including the 1,000-sample `crypto.randomUUID()` loop |
| Existing cases | `configuration.test.js`: `purchasing` added to its two expected-section lists, required by the APR-006 wiring; no new case |
| Data / concurrency | In-memory only; no database, network or concurrency; one repetition; threshold all pass |
| Trigger | Every PR and push to main, through the server suite's automatic discovery |
| Measured cost | About 0.12 s wall per file locally, almost all Node startup; CI speed not measured, estimated under 1 s per job |

Rejected alternatives: B (reduce the UUID loop to 100, saving milliseconds) and C (keep the cases out of CI, leaving the validators every later write handler relies on without regression protection).
