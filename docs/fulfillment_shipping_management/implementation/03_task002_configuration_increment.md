# TASK-002 2A — Configuration and startup validation

Result: **DEVELOPER_VERIFIED initial increment**. TASK-001 inventory is DONE; TASK-002 remains IN_PROGRESS, and P0 is not complete or merge-ready.

## Change and baseline

Five primary files add the eleven design §12.1 settings, a strict immutable normalizer, actual global startup validation, the exact configuration-section expectation and focused behavioral tests. Unknown fields, malformed sections/types, nonpositive/fractional/unsafe integers, specified line/allocation/page/export/date-window caps and inconsistent paging are rejected. No business entry point or database schema was added.

Tested source fingerprint: `05112382dd94124fd6f2c28492c68ca2e24dfc6a7c77bc35e750681dd1e413ed`; base HEAD `b0f05c40ece885925cf6938bf7457407ff12e366` plus the five files. Current DESIGN `8618ff250af0b61d64f5beac528e529bb2224964f8986a02f4c4d8f6043c66ff`, PLAN `6a954bdfa3361e6e21a244c7ebb0109c512ec40230ffc4285fa8320d13ce88ed`. The isolated branch remains `codex/fulfillment-p0-foundation`.

## Actual developer verification

- TDD RED: five new behavioral cases failed on the old source because the global startup configuration ignored Fulfillment, including an attempted database initialization instead of early validation. That initialization failed; no database migration/data write was performed. The final bootstrap fixture explicitly uses an owned temporary directory with a nonexistent UNIX socket, so it cannot contact a shared database even if startup validation regresses.
- GREEN focused configuration regression: **54 PASS / 0 FAIL / 0 SKIP** (Fulfillment, global sections, generic normalizers, Inventory and Sales settings).
- Broader application-factory/secret regression first produced **14 PASS / 4 FAIL**, attributable to missing Customer/Supplier test key rings and sandbox localhost EPERM. No assertion or product code was weakened. A private wrapper supplies matching randomly generated ephemeral test key rings only in subprocess memory and uses fake DB resources, an absent owned socket and automatically allocated localhost ports. Re-run of the combined seven suites in the permitted localhost environment: **72 PASS / 0 FAIL / 0 SKIP**.
- Focused native Node coverage of `normalizeFulfillmentConfig.js`: **100% lines / 100% branches / 100% functions**, five actual tests. This is not the full repository coverage gate.
- `npm run lint`, `git diff --check` and module path boundary checks: PASS.
- Independent R9 by `/root/fulfillment_independent_review`, method `SEPARATE_AGENT`: **APPROVED**, 0 open CRITICAL/HIGH/MEDIUM, exact source fingerprint above. Reviewer independently ran three configuration suites: **49 PASS / 0 FAIL / 0 SKIP**, including invalid-env real bootstrap.

The wrapper installs no dependency, persists no key and changes no test script/threshold. Tests create/close their own ephemeral API servers; no persistent service or DB runtime was allocated. Backend-only source changed; browser/frontend behavior was not changed or claimed verified by these tests.

## Coordination and remaining gates

Sales coordination document112 now records actual HD-009 A1 and acknowledges the exact0088–0099 inventory. Its unchanged0088 owner-native regression is **13 PASS / 0 FAIL / 0 SKIP** in its own runtime, retained as Sales handoff evidence; this is not P0 native acceptance. The adopted writer map preserves Sales0089/0090 and removes its duplicate0091–0093 installers from the eventual P4 candidate. P0 has not yet transferred or executed0088.

Remaining TASK-002 work: constants/reason allowlists, server public errors/client mapping, permission catalogue/idempotent seed and their required native/UI-relevant verification. Operation/worker pool, timeout, lease and private-path relationships must be completed before their related activation; this increment establishes typed startup configuration only. All provider owner-contract proofs, Checkpoint0B, minimum lifecycle installation proof, complete P0 native/coverage/CI/review gates and later formal Technical/UAT execution remain required. No P0 PR, deployment or live schema activation has occurred.

Next safe action: continue TASK-002 2B/2C under the recorded scope, retaining the single complete P0 PR boundary. Reconcile the next committed HEAD with this unchanged source fingerprint before resuming. Do not mark TASK-002 DONE or proceed to TASK-003 until its entire acceptance criteria pass.
