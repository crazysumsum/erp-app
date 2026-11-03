# TASK-013 — Sequence, Operation and Audit Services

Built on 2026-11-03 from main `89c5a067`. No schema and no manifest edit; baselines unchanged (design `08a08a3d`, plan `d1c00718`). Design §2.5–2.7, §8.1, §12.2; `TC-003`, `TC-009`.

| Service | Contract |
| --- | --- |
| `PurchasingSequenceService.nextNumberInTransaction(tx, {documentType, localDate, nowMs})` | `PO`/`GR` only. Upserts the month row, reads it `FOR UPDATE`, returns `{number, yearMonth, sequenceNo}` as `PO-YYYYMM-000001`. Beyond 999999 it throws `DOCUMENT_SEQUENCE_EXHAUSTED`, never a seventh digit or a reset. `localDate` is the APP_TIME_ZONE date the caller computes. |
| `PurchasingOperationService.claim` / `complete` / `run` | Claim inserts the event row inside the business transaction; a duplicate key re-reads it `FOR UPDATE`. Same hash, command and actor replays the stored result; anything else is `PURCHASING_EVENT_CONFLICT`. `run()` is the existing `withTransaction()` and maps an unknown COMMIT to `TRANSACTION_OUTCOME_UNKNOWN` and deadlock or lock timeout to `CONCURRENT_OPERATION`. |
| `PurchasingAuditService.record` | Constructor-injected `auditDetailMaxBytes`. Each action has a fixed target type and detail field set; nothing else is written. The insert shares the business transaction, so a failed audit rolls the whole command back. |

The canonical hash sorts keys, keeps decimal strings verbatim (`"1.50"` ≠ `"1.5"`), drops `password` at any depth, includes the command type, and refuses non-integer numbers, class instances and sparse arrays.

## Choices within the design

- **Another actor reusing an eventId is a conflict**, not a replay, so one user never receives another's result. §2.7 names only the hash.
- **Allowlists hold only what the next tasks use**: commands `CREATE_`, `UPDATE_`, `COPY_PURCHASE_ORDER`; audit actions `purchase_order.created`, `.updated`, `.copied`; result projection `{id, number, status, version}` for POs. Each later task adds its own entries.
- **Deferred §2.2 responsibilities**: persisting REJECTED audit in its own short transaction arrives with the first command that rejects (TASK-014/TASK-015); operation lookup by eventId (BR-042) with TASK-033.
- The upsert is `ON DUPLICATE KEY UPDATE document_type = document_type`, equivalent to §4.3's `VALUES(document_type)`, which MySQL deprecates. It still performs the unchanged UPDATE that TASK-012's `>=` trigger allows.

## Verification

`server/test/integration/purchasingServices.integration.test.js`, 10 cases, all through the real `MySqlDatabaseService.withTransaction()`: two need no database (hash, error mapping); eight run on MySQL. Every transaction ends in ROLLBACK except the concurrency case, which must commit to prove `FOR UPDATE`: a transaction whose snapshot predates another's committed allocation still receives the next number. That case leaves one `purchasing_document_sequences` row per run in a random month after 2100 (the table refuses DELETE) and asserts only relative values, so reruns pass.

Mutation sweep, 23 mutants over the three services: all RED. The first pass left two survivors, removing `FOR UPDATE` and the audit field-set check; the concurrency case and two detail cases (an extra numeric field, a missing field) were added for them.

Local: lint clean; the Purchasing, configuration, Business Master and Supplier MIG files show the same 11 environment-only failures on this branch and on `origin/main` (no `JWT_SECRET` in a worktree), and 10 more passing cases here.

## CI admission

Proposal of 2026-11-03: the one new file, 10 functional cases, routine trigger in the existing MySQL jobs, about 0.18 s locally, no new job and no capacity. Sam's decision the same day: "我作為project owner 批準你幫我發digest", a one-time project-owner authorization for the agent to publish the digest of `.github/test-admissions/purchasing-task013.json`, which pins only `purchasingServices.integration.test.js`. Receipt `purchasing-task012` stays in force: none of its ten pins changed.
