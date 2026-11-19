# TASK-024 approval browser spec: CI admission proposal, 2026-11-12

**Status: proposal, no decision yet.** Sam decides. The receipt draft is
`.github/test-admissions/purchasing-task024-approval-browser.json`. Its
`decision` field is a conditional reference to Sam's future answer and
approves nothing. The `ci.yml` wiring exists only on the local candidate
branch (`ef6f4e59`, by the TL). It is not published or activated: nothing is
pushed and no digest is registered before Sam decides.

## Business risk and coverage gap

- **Risk:** the TASK-024 approval UI is a separation-of-duties control. A
  maker submits, an assigned approver re-enters a password, and a lost or
  uncertain approval must not be re-sent as a new decision.
- **Existing evidence:** the jsdom tests (`purchasing-task024-client.json`)
  mock every service, and the server integration tests call the API without a
  browser.
- **The gap:** neither runs the pages against the real API. Nothing in CI
  checks:
  - device binding at login;
  - the real lookups;
  - the real idempotency layer;
  - the UI's uncertain-result lock with a real server.
- **Why local runs are not enough:** they are not a gate. The former private
  C3 runner has been retired (Sam, 2026-11-12: 「改回一般測試」).

## Cases and workload

| Item | Value |
| --- | --- |
| Cases | 1 Playwright test, `purchasing-approval-flow.spec.js`. It runs 3 sequential browser contexts and 11 numbered steps: settings #1–#2, U1 #3–#6 with the PO creates, U2 #7–#11. |
| Data per run | Inserted into the already-migrated `erp_dev`, all with a unique suffix:<br>- 4 users (1 disabled bootstrap) and 3 roles;<br>- 1 supplier, 1 item, 1 UOM, 1 SKU and 1 SKU-UOM;<br>- 3 device approvals through `approveDevice.js`;<br>- 2 POs of 1 line each, created by the run.<br>It also resets `purchasing_settings` row 1 to approval off. |
| Concurrency | 1 worker and 1 context at a time. |
| Repetitions | 1. No retries. |
| Threshold | The junit report has exactly 1 testcase and no failure, error or skipped element. No timing threshold. |
| Fault injection | Step #8 aborts the approve response with `page.route` after the server commits. This is a deliberate functional assertion, not a performance test. |

## Trigger scope

The proposal is to run it in server-tests **shard 1**, inside the existing
step "Run real Fulfillment P1 and P2 browser flows on owned UUID databases".
That step already has:

- the real MySQL service;
- the migrated `erp_dev`;
- Chromium installed.

The step runs after coverage and after the shard identity record. The spec
would therefore run on every admitted PR dispatch, on every push to main, and
on the weekly Monday schedule.

The TL owns the `ci.yml` lines (TL 952e2aad, 20d0bf7a, 3004169d):

- one `npx playwright test --config client/e2e/purchasing-receiving-management/playwright.config.js` line;
- `PURCHASING_TEST_API_PORT=53003` and `PURCHASING_TEST_CLIENT_PORT=53004`;
- the same Python junit assertion the Fulfillment P1 and P2 runs use.

## Duration and cost

- **Measured locally:** 14.3 s, 12.8 s and 13.0 s over 3 runs at `9c1680fb`.
  These runs used a private mysqld on an already-migrated database. The time
  excludes migrate and the Chromium install, which already happen in shard 1.
- **Not measured in CI.** The increase to shard 1's wall time is unknown and
  is not guaranteed to match the local figure. Whether shard 1 is on the
  critical path is not measured either.
- No new job, no new service and no capacity workload.

## Alternatives

| Option | Effect |
| --- | --- |
| A. Admit as proposed (recommended) | The real approval path is gated per PR on one shard. The cost was 12.8–14.3 s locally; the CI cost is not measured. |
| B. Main pushes and the weekly schedule only | PRs are not gated. A regression is found after merge. |
| C. Local only, like item-management's executable UAT | No CI cost. No gate; the result depends on someone running it. |

**Recommendation: A.** It is the only real-browser evidence for the TASK-024
approval controls, and it reuses an existing step and database.

## What the decision covers

- The spec and config blobs in the receipt;
- the two pinned scripts;
- the shard 1 trigger above.

It does not cover any other Purchasing workload, including TASK-045.
