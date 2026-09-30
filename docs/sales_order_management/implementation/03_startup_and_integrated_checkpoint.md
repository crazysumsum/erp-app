# Startup and integrated developer checkpoint

Mode: IMPLEMENT; partial TASK-001..008 candidate. Not READY_FOR_TESTING, formal acceptance or a Phase merge candidate.

## Approved delta and observed baseline

Sam answered “核准補充 startup 整合 scope” in the current chat. This approves the four-line `applicationConfiguration.js` wiring and related short-timeout/startup tests. Sales configuration now fails before database creation when invalid. The module manifest adds that exact shared path. A minor command-discovery correction changes the foundation command from a bare directory to the literal native Node glob `server/test/sales/*.test.js`; no cases, skip policy or thresholds changed. [Official Node test CLI documentation](https://nodejs.org/api/test.html#running-tests-from-the-command-line) describes quoted glob discovery.

Latest main `2eccf588343a4c2bc22d578666bfc1f5732c5e37` was integrated without conflicts at `ced0a7dfd720e2c07d805afd85dd1be04b146e93`. Current candidate DESIGN: `995fae117d0b6557af40bda0f07fabe1dc78555c7df44161d17efdb6e3be667f`; PLAN: `84dee454bbdadb3b818f12ce5b481dce70235b87321c4f27adbf8148fd8abead`. The requirements, business design, task boundaries and formal cases remain unchanged. Historical approval hashes remain intact; the startup scope decision does not grant fresh global design/risk approval.

## Dependency reconciliation

Inventory now implements single-line Sales reservation create/release/cancel adapters; the required batch contract remains absent. Its design additionally enforces the greater of caller minimum life and SKU sales-life policy, uses fixed downstream permissions and reserves migrations 0063–0066. Main has applied source migration 0063 and its catalogue/seed includes `sales.operation`; no Sales migration was created or executed here.

The actual Inventory design hash is `6fc91e710adc48ec56fb567fa24b8b378741f0b48ffcb115d2a54c08927844ce`; permission-catalogue hash is `993050217aefdf40b8a91102d2ce5725a3fdbc8a4b85b0adf71782f4d721c24f`. The manifest's old dependency pins are retained as stale, rather than silently claiming contract approval. TASK-009/010 and full Phase readiness remain blocked. Item Sales lookup helpers and Fulfillment provider remain absent.

The previous DEC-007 proposal for Sales 0065 is superseded because Inventory owns 0065/0066. Revised owner decision DEC-010 proposes 0067 for missing Sales permissions, retaining the existing operation seed. No allocation is assumed while that question is pending.

## Developer verification and independent review

- Startup test observed RED before wiring and GREEN after wiring; it rejects invalid Sales wait before pool creation.
- Integrated focused command passed 162 tests, zero failures, zero skips: upload limits/configuration, transfer/failure modes, application factory/dispatcher, directory permissions, catalogue/startup guard, Inventory provider contracts and Sales primitives.
- Literal glob independently discovered 11 Sales tests, all passed, zero skips; the bare-directory failure was reproduced separately.
- Lint, client production build and whitespace checks passed. No frontend source or active Sales route/job/UI was added.
- Reviewer Codex `/root/sales_readiness_review`, SEPARATE_AGENT, read-only, approved the four-file startup/discovery delta against the above DESIGN/PLAN hashes; no code defects identified. Prior scoped upload and primitive reviews are retained in earlier checkpoint reports. This is code-review evidence, not provider-owner approval or formal acceptance.

Local diagnostic logs are private under `/private/tmp/sales-startup-*.log`, `/private/tmp/sales-foundation-discovery-*.log` and `/private/tmp/sales-foundation-client-build.log`; raw evidence and test key material are not published. Synthetic fake-DB/ephemeral HTTP tests do not prove full MySQL integration. No local schema or persistent port lease was allocated.

## Remaining gates

TASK-002..008 remain IN_PROGRESS until their complete DoD is verified. Numeric memory limits (proposed heap 16 MiB/external 32 MiB/RSS 64 MiB), Sales migration owner allocation, complete runtime authorization/resources, current full mandatory CI, refreshed provider/design approval and TASK-009..011 remain outstanding. A draft PR preserves a reviewable checkpoint; no partial Phase merge is authorized.
