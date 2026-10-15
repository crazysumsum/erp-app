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

## Disposable least-privilege and default-contention developer check

Use `server/test/integration/customerOperationalGuards.integration.test.js` only on
an explicitly owned, migrated disposable MySQL. From `server/`, with DB connection
variables and explicit DB_ADMIN_USER/DB_ADMIN_PASSWORD supplied privately:

```sh
DB_INTEGRATION_TESTS=1 node --test --import ./test-support/testEnv.js test/integration/customerOperationalGuards.integration.test.js
```

The fixture administrator creates/drops one random SQL user and canary tables;
the runtime fixture receives only named-table DML, never audit UPDATE/DELETE or
DDL. The real Customer services verify idempotency, fresh permissions, audit and
100 default-address contenders through a10-connection bounded pool. The separate
100-command approve/reject case uses the existing integration DB_USER privileges,
not the TC-081 role, and supplies the transaction helper's policy snapshot fixture
without changing the shared settings singleton. It does not certify least-privilege
Currency locking, the public settings/submission path or deployed role policy. All fixture
data/account cleanup is owner scoped; a failed cleanup is a failed test, not PASS.
The extended fixture also exercises real nullable-currency bank create/list/reveal/
update/deactivate, encrypted persistence, masked responses and correlated append-only
audit. Withdrawing bank-view permission or audit INSERT must deny plaintext without
changing the bank row. Corrupting the stored GCM tag must yield safe422 plus one fixed,
correlated unreadable event; the capture is not a real alert receiver.

The fixture drops only its random SQL account and explicitly kills only its enumerated
connections after verifying their exact user and schema. It asserts the held connection
is unusable, new login is denied and no fixture account/session remains. This verifies
local revocation mechanics, not deployed emergency-access policy. [MySQL DROP USER](https://dev.mysql.com/doc/refman/8.4/en/drop-user.html)
does not terminate already connected sessions; [KILL CONNECTION](https://dev.mysql.com/doc/refman/8.4/en/kill.html)
is required to close those sessions explicitly.

Never supply deployed administrative credentials or use this as a provisioning
script. This local TC-081/083 subset does not prove deployed privilege separation,
emergency access policy, integrated races or full downstream readiness. Non-null bank
Currency locking remains outside this narrowly granted fixture; do not add Currency
UPDATE or global privileges to make it pass.
See [post-waiver security results](phase-PHASE-004-report.md#post-hd-013-local-security-results).
See [current local results](phase-PHASE-004-report.md#local-execution-results--2026-10-15).

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

## Formal operations / recovery readiness — 2026-10-15

Current HD-013 decision supersedes the RPO/RTO acceptance blockers in this historical
assessment: Sam explicitly stated `RPO/ RTO 不用做驗收了，我批準通過。` TC-086/087
formal measurement acceptance is WAIVED_BY_HUMAN / APPROVED, not technical PASS;
the timing objectives remain NOT_PROVEN and no further timing acceptance run is
required. Timing measurement alone must no longer block Customer acceptance.
Backup/key/file/audit integrity, other operating/security controls, real downstream
reconciliation, whole-module acceptance and release gates are not waived. TASK-035
therefore remains IN_PROGRESS; full downstream integration stays BLOCKED.

Latest observed main is `80aee6561a3c51d44d3aec04b280f46cef40adbe` (PR238).
Its actual merge/cleanup receipt is
[comment6187285228](https://github.com/crazysumsum/erp-app/pull/238#issuecomment-6187285228).
State200 is a pre-merge cache, not an unperformed merge. Approved DESIGN/PLAN stay
unchanged; this continuation is IMPLEMENT developer preparation under TASK-033/035.

| Gate / requirement | Missing evidence before formal acceptance | Independent preparation allowed now |
| --- | --- | --- |
| Recovery set / DES-024, TC-085 | Proven DB/key/config/private-object version linkage and representative restored Customer, address/contact, approval, bank, both attachment classes, import and audit samples | Extend the existing isolated logical restore fixture; restricted manifest with hashes/counts, schema/app identity and key IDs only; test incomplete/corrupt sets before importing |
| RPO <=15min / TC-086 | Actual scheduled backup/log-shipping cadence, durable confirmed-write checkpoints, measured loss at the selected recovery point during representative failures | Record fixture checkpoints and exact loss-window calculation; a single synthetic loss marker does not establish production cadence or worst-case loss |
| RTO <=4h / TC-087 | Incident declaration through environment provisioning, key retrieval, files/DB restore, real provider reconciliation, safe readiness and smoke, at representative volume | Include local preflight in the local timer and separate measured local steps from unexecuted external response/provisioning/provider steps |
| Operating controls / TC-080/081/088 | Delivered and reset alerts, real storage/ClamAV/key-management configuration, deployed least-privilege runtime including bank/approval/worker paths, separate migration/emergency access and session revocation, deployment/rollback evidence | Reuse local guards/runbook; do not claim a local fake receiver/scanner or fixture SQL account proves deployed controls |
| Integrated recovery / TASK-030..036 | Ready real downstream consumers and contracts, complete reference reconciliation and mixed-load/full regression, reviewed Operations/Security recovery evidence and actual formal acceptance | Keep full downstream acceptance BLOCKED; local success is not technical acceptance, business UAT or release approval |

No production environment, backup vendor, retention/legal-hold policy, privileges,
alert destination or accountable Operations/Security sign-off is selected here.
Those require actual deployment configuration/evidence, not another code assertion.

Critical developer cases, defined before automation/execution (initial NOT RUN):

| ID / priority | Requirement / risk | Preconditions / data | Steps | Expected result / evidence | Initial status |
| --- | --- | --- | --- | --- | --- |
| LOCAL-035-SAMPLES / P1 | DES-024, TC-085; empty tables conceal missing recovery samples | Fresh task-owned loopback13369 MySQL, migrated synthetic source and empty restore; existing scanner/authorization fixtures explicitly retained | Add address/contact with default purposes and a historical approval decision; dump/restore; compare all Customer table counts/hashes, sample ownership/defaults, decision actors/status and correlated audit | Nonempty sample tables restore exactly with valid user/Customer links; bank/files/import/key-failure assertions remain; sanitized actual results | NOT RUN |
| LOCAL-035-SET / P0 | DES-024, TC-085; partial, corrupt or wrong-version backup accepted | Same owned runtime; quiescent fixture; restricted manifest anchored in test memory, separate0600 key backup | Inventory dump, key-file digest and private object bytes; record schema/app/config identity, verify key IDs/member hashes; inject missing object, changed byte, missing key backup and changed key-version ID before DB import | Every damaged set rejected before destination tables exist, intact set proceeds; schema names reconcile after import, not a pre-import application/config compatibility check; exact counts/hashes and denial count exported without secrets; not a signed/off-host production manifest | NOT RUN |

No frontend behavior changes; Playwright is not needed for this backend-only slice.

### Local readiness execution result

Both chartered cases passed as local developer checks on MySQL26.7.0/Node26.6.0.
The final restored-source run executed3 tests (including2 safety guards),3PASS,
0FAIL/0SKIP in1196.789ms after the reviewer-requested explicit assignee assertion. All20 Customer tables reconcile by count/hash; address,
contact, both default-purpose mappings and historical approval each contain1 sample,
with separate requester/approver links and matching approval audit (5audit rows total).
All83 migration names reconcile. Six manifest members cover the dump, separate key
file,2attachment objects and2import objects;4damaged-set attempts fail before any
destination table exists; existing6missing/wrong-encryption-key checks remain.

Measured local loss window176ms, local recovery624.720ms including0.719ms intact-set
preflight. These are one-Customer, quiescent, same-host fixture measurements, NOT
production RPO/RTO. The timer does not cover incident detection/response, environment
provisioning, off-host/secret-store retrieval or real downstream readiness. Backup
encryption, scheduling/log shipping/PITR and representative-volume recovery remain
unverified. The local manifest is not a signed production backup tool. Historical
approval is a direct SQL fixture, not an exercised public approval workflow.

[Sanitized execution evidence](phase4-restore-readiness-results.json) retains the
initial empty-address RED failure, fixture-only unsupported audit-action failure,
corrected GREEN, expected mutation-control failure and final restored-source PASS.
Disabling member read/hash validation causes `Missing expected rejection`; mutation
was removed. Related crypto/storage16, audit4 and approval/party15 tests pass, lint/build pass (existing
chunk-size advisory), traceability/boundary validators pass their narrow local gates.
No raw dump, secret key values, SQL password or private file contents are exported.
Actual separate review, final-head CI and merge receipts are still required; see the
resulting PR timeline for publication/merge state rather than replaying a cache.
TASK-033/035 remain IN_PROGRESS; TASK-030/031/032/034/full downstream acceptance
remain BLOCKED, TASK-036 PENDING. No Technical Acceptance/UAT/release sign-off.
