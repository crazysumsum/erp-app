# Customer operations runbook

This is the Customer-owned preparation for TASK-033 and TASK-035 under DES-023
and DES-024. It does not complete either task, configure an external alert receiver,
or authorize production maintenance. TASK-032 provider readiness and the integrated
alert/restore drills remain required before release.

## Bank unreadable alert

Treat every `customer.bank.reveal.unreadable` event as P1, as required by DES-023.
Filter the system log by `event`, then correlate `context.requestId` with the
request log and the owner-scoped bank resource. The public response remains
`BANK_ACCOUNT_UNREADABLE` (422); no plaintext or successful reveal audit is emitted.

| `context.reason` | First check | Recovery and escalation |
| --- | --- | --- |
| `BANK_KEY_UNAVAILABLE` | Check whether the row's encryption key ID exists in the configured secret-store key-ring version. Inspect key IDs only. | Restore the matching approved key-ring version; never generate a replacement for an existing key ID. Escalate to the Security/Backend owner if the original key cannot be recovered. |
| `BANK_INTEGRITY_FAILED` | Preserve the ciphertext and metadata; compare owner/context and backup hashes without decrypt-export. | Escalate to Security/Backend. Recover a verified matching DB/key set in isolation before deciding an audited repair. Repeated reveal attempts do not repair ciphertext. |
| `UNREADABLE` | Use the request ID and deployment version to locate the failing code path. | Escalate to Backend; retain the generic response and fixed log reason. Do not add exception text, stack, account number or key material to telemetry. |

Verification: trigger missing-key, bad-GCM-tag and synthetic-secret exceptions with
the developer check below. Confirm one correlated event, safe 422, no commit and
no secret marker in captured output. Production alert delivery/reset still needs
the Operations-owned receiver and an integrated drill; a unit-test event is not
proof of a delivered page.

```sh
node --test --import ./server/test-support/testEnv.js server/test/customerBankService.test.js server/test/customerBankCrypto.test.js
```

Use only the stable event name and fixed `reason` values as aggregation labels.
Customer IDs, bank IDs and request IDs are log correlation fields, never metric
labels. Keep system logging enabled at a level that includes `warn`.

## Controlled key rotation and blind-index reindex

Provision independent encryption/lookup key rings through the approved secret
configuration. Customer and Supplier share the same rings; coordinate key retirement
with both owners. Keep old keys available until every affected domain and retained
backup can recover. Freeze key configuration during a batch series.

From `server/`, the existing bounded commands are:

```sh
node scripts/rotateCustomerBankEncryption.js --after-id 0 --batch-size 100 --reason 'approved rotation ticket'
node scripts/reindexCustomerBankBlindIndexes.js --after-id 0 --batch-size 100 --reason 'approved reindex ticket'
```

These mutate bank rows and append audit entries; run only against the explicitly
authorized environment with a controlled operator account. Record `processed`,
`lastId`, `remaining` and the ticket, then use the returned `lastId` for the next
batch. If `processed=0` but `remaining>0`, restart from zero after diagnosing rows
behind the cursor. Stop on integrity/key/duplicate failures; preserve the last
committed cursor. Do not bypass a duplicate or edit ciphertext manually. Retirement
requires a zero-old-key count plus compatible backup/key retention evidence.

## Attachment recovery and deletion failures

Use the scheduler job `customerAttachment.recover` (60-second interval, cluster
lease) and its counts: `failed`, `stageFailed`, `abandonedOperations`, `deleteFailed`.
Inspect only attachment/stage IDs, status, timestamp, size and stored hash; keep
sensitive filenames, paths and file content out of incident logs.

Check storage availability, scanner readiness, permissions and the configured
grace period. The recovery service verifies objects before activation, reconciles
stale stages and retries `delete_failed`. Let the bounded recovery path converge;
never set `active` directly or delete a possibly referenced object. Escalate persistent
failures to Backend/Operations. Clear the incident only after metadata/object
reconciliation and the relevant scheduler failure counts return to zero.

## Import stuck lease and file recovery

Inspect job ID, status, lease owner/expiry and aggregate row counts. Compare the
lease with a live worker before intervening. `customer.import.precheck` and
`customer.import.execute` run every 5 seconds; `customer.import.fileRecovery` runs
every 5 minutes. Expired work is reclaimed through the existing lease/CAS path.

Do not clear leases belonging to live workers or replay applied rows. Check DB and
source/result storage availability; preserve terminal row markers and audit.
Escalate a persistent stalled or `storage_error` job to Backend/Operations with safe
IDs and counts only. Verify reconciled terminal counts and a recoverable result
before closing the incident.

## Migration, settings and audit failures

Stop rollout on schema mismatch, a missing settings singleton or audit-write failure.
Check migration history against the deployed commit using the migration account;
compare the expected shape before resuming the restart-safe forward migration.
Applied migrations are immutable. Do not insert a guessed settings row, disable
audit, or grant runtime DDL/audit update/delete to restore availability.

Backend owns shape/transaction diagnosis; Operations owns DB credentials and
rollout. Revert only to a schema-compatible app or disable the affected capability.
Verify a successful normal command with its append-only audit record before recovery.

## Unauthorized sensitive access

Correlate request ID, route, safe denial code and the actor's fresh role/permission
state. Confirm the denial did not reveal resource existence or produce a mutation.
Escalate suspicious repeated attempts to Security. Retain access/audit evidence
under the approved policy; never attach a password, token, full request body or bank
plaintext to the investigation. Re-enable access only through the normal authorized
permission workflow.

## Isolated backup/restore preparation

Prepare a restricted manifest containing the immutable app/schema version,
backup timestamp/consistency point, DB/audit counts, key-ring version IDs and private
object counts/hashes. Store secret material separately in the approved secret store,
not in this manifest. Cover general attachments, Bank Sensitive attachments,
attachment stages, import sources/results and operation/lease records.

Restore into an isolated DB and private roots with background workers stopped.
Use the matching key versions; verify normal Customer, encrypted bank, General and
Bank Sensitive file, import outcome and audit-chain samples. Exercise missing/wrong
keys and preserve fail-closed behavior. Reconcile real provider references before
enabling destructive operations or background claims.

Measure RPO from the latest recovered confirmed write (target <=15 minutes) and RTO
from declared incident start through keys/files/audit/provider reconciliation and
successful smoke (target <=4 hours). A DB connection alone is not recovery.
TASK-035 remains incomplete until the integrated drill and Operations/Security
review exist. Keep retention/legal-hold rules in force; this runbook introduces no
purge or production restore.
