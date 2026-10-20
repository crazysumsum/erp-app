# TASK-058 independent Sales hash component

Scope: original DES-017 / TASK-058 fixed business-column row hashes and streamed table summaries only. This is a partial component; TASK-058 remains blocked on the actual same-transaction Archive coordinator/participant. It does not qualify P0, P4, CI, full-capacity performance or any merge Gate.

`server/src/modules/sales/salesArchiveHash.js` defines the six explicit Sales business-column contracts in the original mirror order. It excludes only archive metadata, normalizes exact SQL integers/DECIMAL/DATE/JSON/null values, and hashes UTF-8 JSON column/value pairs. It rejects unknown tables, missing or extra business fields, invalid persisted value types and unsafe identities. DECIMAL never goes through a floating-point conversion. The table function consumes a sync/async iterator in strictly increasing numeric original-ID order, writes `id:rowHash` plus LF into SHA-256 and retains constant row state; failed reads cannot return a successful partial summary. No SQL writer, schema modification, owner table access, job activation or dependency substitute is added.

## Actual component checks

- Expected RED: the new unit test failed for the absent module; private `sales-archive-hash-red-r1.log` retained.
- Final component native + unit run: **17 PASS, 0 FAIL, 0 SKIP**, private `sales-archive-hash-native-r2.log`. Includes 12 unit cases, one native parent and four native subcases. The native fixture creates and drops its exclusive nonce schema on the previously authorized socket-only MySQL 26.7.0 runtime, applies only through Sales 0090, and never installs the withdrawn owner prototypes.
- Native checks compare all six live/mirror column orders to the static catalog and copy/read back real Sales Order, Line and JSON Audit rows. They cover exact DECIMAL scales, DATE validity, nulls, JSON object order/fractions/arrays and mirror metadata exclusion.
- Related P4 unit + eligibility regression: **65 PASS, 0 FAIL, 0 SKIP**, private `sales-archive-hash-unit-regression-r1.log`; includes the 12 hash cases and is not additive to the 17-run count.
- Scoped ESLint: PASS on all three new source/test files.

Native suites retain the repository's explicit `DB_INTEGRATION_TESTS=1` execution convention. A run without the isolated DB setting is not native evidence. The listed qualification run enabled it and had zero skips.

Independent component review: `/root/def016_runtime_recovery_review`, **APPROVED with zero required findings**. Private proof `sales-archive-hash-component-r1-reviewer-proof.json`, SHA256 `7818669954c98de1d9605e6918324ee348ebe73df5d2e269ca0b5f9083b3daa1`, binds all three exact source/test hashes and the actual logs. All raw evidence stays private; no raw logs, credentials or browser state are committed. The remaining full original P4 checks, owner/joint native proofs, Playwright, current-candidate CI, phase review and standard merge Gate are unchanged.
