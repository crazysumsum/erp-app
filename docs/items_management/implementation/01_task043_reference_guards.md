# TASK-043 increment B — developer implementation, 2026-10-09

Status: `DEVELOPER_VERIFIED / MERGE_READY BLOCKED`. TASK-043 remains `IN_PROGRESS`.
Mode: `IMPLEMENT`; no current formal TC/UAT acceptance or release approval.

## Baseline and scope

- Base: `0feb9d712072048adb20afc470eb87abc8911475`.
- DESIGN: `59ee6cb3664ae1742e41b218ffd3bf223e396eb44a4aa24d82028ebb9cf7c16d`.
- PLAN: `9084e8e3435a3759f1e0445ee005ae41c3403fc7338242572fe8de1be39eff50`.
- Tested source fingerprint: `5c581c92d43c9edfbe7cf1c98949d843e145d2b1b500e18e46f4e39e2817a855`.
- Owner instruction: Sam, active task, 「好，請繼續開發TASK-043」.
- Branch/worktree: `codex/item-task-043-reference-guards` / `/private/tmp/erp-item-task-043-reference-guards`.

Permanent Item/SKU deletion and incompatible SKU UOM changes now report actual
installed reference table types. Real FK failures return public 409 errors; when a
reference disappears before discovery, the honest fallback type is `unknown`.
Archive guards inspect live stock (including quarantine), reservations, allocations,
backorders and open Sales documents. Zero stock and completed/cancelled history
remain readable and do not block archive; retained history still blocks deletion.
Single/bulk failures roll back status, version, mapping, barcode and audit together.
Existing permission, optimistic-version and reason policies remain in force.

Inventory transaction profiles/UOM resolution now use current locking reads in the
existing Item lock order. Nonlocking READ COMMITTED reference probes avoid taking
downstream locks after Item locks. Existing UOM IDs and historical snapshots remain
stable. No downstream code, migration, new endpoint, dependency or config changed.

## Actual developer verification

Private MySQL 26.7.0 instance: `/private/tmp/erp-item-task043-mysql.fnO6t8/mysql.sock`,
schema `erp_item_task043_20261009`, TCP/MySQLX disabled. Existing migrations applied
through 0079. This is disposable developer data, not shared MySQL or staging UAT.
Crypto environment values are public repository CI fixture keys, not owner secrets.

| Check | Observed result |
|---|---|
| Focused `itemErrors`, `itemLookupService`, new real-DB reference guards | 112 passed; 0 failed/skipped |
| Exact existing `item-server-technical` profile argv, externally executed | 478 passed; 0 failures/errors/skips; exit 0 |
| Scoped Item plus Sales Inventory-batch/customer-snapshot regression | 453 passed; 0 failed/skipped |
| Client `npm test --workspace client` | 105 files, 808 tests passed |
| `npm run lint` | Passed |
| `npm run build --workspace client` | Passed; existing large-chunk warning |
| Actual Playwright Item browser suite | 12 passed, 2 existing formal-UAT skips |
| `npm audit --audit-level=high` | Exit 0; 0 high/critical; existing Quasar low advisory GHSA-89vp-x45c-52cq |
| Module boundary / typed traceability / `git diff --check` | Local/structural checks passed |

The new browser flow verifies public 409 details, visible errors, unchanged version,
successful zero-stock archive and refresh state, with no relevant unexpected
console/request/server errors. Existing UAT-005/UAT-015 skips are not acceptance PASS.

New MySQL tests exercise actual migrated Inventory/Sales FKs, true FK error fallback,
both transaction orderings, stale RR snapshot/current read behavior, successful
unreferenced deletion, and the real Inventory receipt consumer (2 BOX = 48 EA).
Fixture scheduling hooks control timing, not business results. No fake Supplier table.
A deliberately inverted delete guard failed the successful-delete case; the guard
was restored and the focused suite passed on the source fingerprint above.

Supporting local artifacts: `/private/tmp/item-task043-focused.log`,
`/private/tmp/item-server-technical.xml`, `/private/tmp/item-task043-regression.log`,
`/private/tmp/item-task043-browser.xml`. They are developer observations, not harness
runner records or formal acceptance artifacts; transient paths are not durable CI.
An earlier broader command included out-of-scope Recovery acceptance integration:
493 passed and 1 environment failure (missing DB-admin/TCP recovery setup). That
failure is retained as an environment failure under this developer runtime, not a product fix
or a claimed passing recovery run.

## REV-019 — independent code/test review

Method: `SEPARATE_AGENT`; author `/root`; reviewer `/root/item_supplier_handoff_review`.
Reviewed base/design/plan and final source fingerprint above. Result: `APPROVED`,
zero open critical/high/medium findings. T043-R01 stale/unlocked Inventory projection
and T043-R02 lock ordering were resolved. Reviewer independently executed lookup/error
suites: 92/92 passed. MySQL/browser results above were author-executed, not reviewer
reruns. Product hashes approved:

- ItemAdminService: `845c27fb745fcb50f9c95d08337ab747668f6be007106a406e9bb6700737c9a4`.
- ItemLookupService: `ddc3cb2c26293b9461fcbe1e240effff9c2199366d73423f9e08dac5c0625d8e`.
- itemErrors: `0c8be39e0e0e54f8a0b96069d9c229c65af91759564cad7a4ae16a52c16d4463`.

## Remaining merge/acceptance work

The approved narrative already permits increment-B integration before Supplier C and
formal D. However, generic MERGE_READY currently selects PHASE-006 including the
unfinished aggregate TASK-043, and the server runner environment allowlist omits
DB_SOCKET_PATH and required CI test crypto keys. The external exact-argv run above
does not certify that runner contract. No gate waiver, fabricated DONE or approval.

Next: minimally reconcile the typed increment-B execution unit and test environment
allowlist/redaction without lowering checks; independently review and bind the new
PLAN to authentic owner authorization; execute configured checks and require current
candidate CI/review before merge. Retain open-PR branch/worktree until resolution.

Supplier-specific integration awaits real Supplier TASK-038 tables/implementation.
Inventory transfer/in-transit consumers are absent at this baseline. Current
TC-004/TC-005 and UAT-005/UAT-013 remain later-stage work; historical PASS is not rebound.
