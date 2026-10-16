# Customer local operations execution — 2026-10-16

Sam explicitly designated this machine as the acceptance environment and requested
actual independent operating checks, not further document-only alignment. Frozen
checkout: e9ce220cc28e42fed292bd32317bc0f81fd29872; executable source fingerprint
87e3e848740a55aba7bc30e552062c9887b4d37f5fdce53e30acf32c66918f76.
Existing DESIGNfa4dbd1e/PLANa1d5e05a are not silently replaced. HD-014 contract drift
blocks whole-module baseline adoption/PR244 merge, not these explicitly requested
independent local diagnostics. No product or existing repository-test implementation,
fake provider or
formal whole-module acceptance/sign-off. RPO/RTO timing acceptance remains waived;
complete downstream integration remains BLOCKED.

## Cases defined before execution

All data synthetic. New owned MySQL instance, loopback13369, unique private runtime;
new ops and recovery-source schemas plus an empty recovery destination only. Existing
immutable migrations, existing test scripts, fresh ephemeral credentials/keys. No
shared3306 reset, existing user/schema changes, real notifications or installed tools.
Existing script fixtures may mock authorization/scanner where explicitly noted;
their success does not certify the mocked boundary. Cleanup is owner-only.

| Case / reference | Priority / risk | Preconditions / data | Steps / expected assertions / evidence | Initial status |
| --- | --- | --- | --- | --- |
| LOP-001 / TC-081, local TC-083 | P0; bank exposure, audit tamper, revoked sessions remain usable | Fresh migrated own ops schema; real fresh actor and random fixture SQL account; NULL-currency bank | Run existing customerOperationalGuards integration case. Exact named grants, bank create/mask/audited reveal/update/deactivate, stale permission/audit INSERT denials, corrupt GCM safe422/event, verified owned session revocation and fixture cleanup. Retain actual node counts/error codes. Real DB/service/crypto; capture is not alert delivery. | NOT RUN |
| LOP-002 / TC-085 integrity subset | P0; incomplete or wrong-key restore accepted | New migrated synthetic source and empty destination on owned13369; approved runtime naming guard | Existing customerLocalRestore script: actual mysqldump/mysql, nonempty Customer/address/contact/approval/bank/file/import/audit samples, table counts/hashes and migration inventory, six-member manifest, four damaged-set refusals, six wrong/missing-key denials. Script's local timing output is incidental, not RPO/RTO acceptance. Scanner/authorization fixtures do not prove actual scanner or deployed IAM. | NOT RUN |
| LOP-003 / TC-080 local logging and storage/crypto checks | P1; secret leakage, plaintext files, unreadable corruption | Isolated OS temp directories, synthetic marker/key data; existing file logger and storage tests | Existing Logger/SystemLogger tests write and read actual JSONL; existing crypto/file tests verify masking/redaction, encrypted persistence/recovery, private permissions, tamper/symlink rejection and cleanup. Capture actual assertions/counts; not external receiver or secret-store certification. | NOT RUN |
| LOP-004 / bank maintenance and attachment persistence | P0; rotation loss or partial/duplicate persistence | Own migrated ops schema; existing synthetic fixtures | Existing bank/attachment DB integration tests exercise persisted encryption, key rotation/reindex, duplicate/default constraints, replay/finalize/recovery and real transaction audit. Capture actual test results. Attachment clean-scanner and actor fixtures are explicit, not real malware/IAM acceptance. | NOT RUN |
| LOP-005 / real scanner, alert delivery, rollout | P1; runtime dependencies not really exercised | Actual ClamAV/receiver and chosen app release pair/config needed | Verify real scanner clean/reject/unavailable behavior, actual alert fire/reset and compatible deployed rollback only when genuine configured dependencies and authorized target are available. Never substitute a fixture and label it PASS. | NOT RUN |

## Execution results

Additional critical cases defined before their executable diagnostic is written:

| Case / reference | Priority / risk | Preconditions / data | Steps / expected assertions / evidence | Initial status |
| --- | --- | --- | --- | --- |
| LOP-006 / DES-012, local scanner outage | P0; scanner absent but upload accepted | Real ClamdScanner client, loopback3310 verified unavailable, fresh private storage roots and synthetic PDF/ephemeral keys | Run real storage.stage with real network client and no injected scanner. Expect ECONNREFUSED and no staged/final object, roots0700; no clean/infected success claim. | NOT RUN |
| LOP-007 / DES-011/023, local TC-080 | P0; real Customer failure leaks secrets or loses correlated event on disk | Own migrated ops DB; real actor/roles/fresh authorization/CustomerBankService/crypto/audit; real SystemLogger/Logger/FileLogWriter using existing config in new private directory | Create synthetic Customer/bank, corrupt stored GCM tag, expect422 and no successful reveal audit; flush real logger, read exactly one correlated fixed-reason JSONL event, verify no account/key markers and file0600/directory0700. Restore tag, actual reveal succeeds with correlated audit; successful reveal adds no unreadable log. Cleanup only owned fixtures. SQL administrator used for setup; not deployed-role or real alert delivery certification. | NOT RUN |

Pending consolidated actual results below.

LOP-008 (P0; TC-081 / DES-017): before execution, characterize the existing Currency
locking-read privilege precondition on this owned MySQL. New random account receives
only table SELECT; ordinary Currency read must work. Invoke the actual BusinessMaster
provider in a transaction and capture the known SELECT-only locking denial1142/42000;
compare Currency rows unchanged, close connections and drop only the new account.
Do not grant Currency UPDATE or change provider code. Passing this diagnostic means
the limitation is reproduced, not that full runtime Currency/approval is accepted.
Initial status NOT RUN.

## Actual results (local assertion evidence, not whole-module sign-off)

All eight chartered cases now have an explicit disposition. LOP-001/002/003/004/
006/007 executed and their scoped assertions PASS. LOP-008 reproduced the expected
privilege denial; its diagnostic PASS exposes a BLOCKED full Currency/approval
least-privilege workflow. LOP-005 remains BLOCKED for genuine scanner clean/reject,
delivered/reset alerts and chosen compatible rollback deployment.

| Actual batch | Executed / PASS / FAIL / SKIP | Duration | Evidence scope |
| --- | --- | --- | --- |
| Existing8 logger/crypto/storage/config/scanner-protocol files |37/37/0/0 |575.723875ms | Actual JSONL and private encrypted files; scanner protocol fixtures remain fixtures |
| Existing4 real MySQL bank/attachment/operational files |14/14/0/0 |1031.769958ms | Real DB, rotation/reindex, constraints, fresh permission, audit failure, default/decision races and account/session revocation |
| Existing restore integrity script |3/3/0/0 |1507.635375ms | Actual dump/import,20 Customer-table hashes,87 migrations,6 manifest members,4 damaged-set refusals and6 bad/missing-key denials;5 audit rows |
| New isolated one-off boundary diagnostic |3/3/0/0 |289.183458ms | Real scanner connection refusal before any file; real bank->SystemLogger->private JSONL; real SELECT-only Currency provider lock denial |

Total57 executed nodes PASS,0FAIL/0SKIP; this is not57 completed formal acceptance
cases. The initial2-node diagnostic run also passed but is not double-counted.
No product code, existing test, schema definition or CI configuration was edited.

The new LOP-007 used real actor/role rows and fresh authorization, actual crypto,
real audit and system logger/file writer. Flipped stored GCM byte -> safe422,
exactly one request-correlated BANK_INTEGRITY_FAILED event on disk, no account/key
markers, file0600/directory0700, no failed-reveal success audit. Restored tag ->
actual plaintext result only to authorized caller plus exactly1 correlated reveal
audit, no extra unreadable event. It used the owned SQL administrator for setup/
service execution, so it is not deployed runtime-role certification or alert delivery.

LOP-006 used the real ClamdScanner network client (no injected connection/response):
127.0.0.1:3310 returnedECONNREFUSED, storage.stage rejected and left0 object files;
all roots0700. Real clean/infected malware scan still requires genuine ClamAV.
LOP-008 used the real Business Master provider and a new random SELECT-only SQL
user: ordinary HKD read worked, transaction locking read failed1142/42000, Currency
rows unchanged, no UPDATE/other privilege granted. This is a concrete permission
compatibility limitation, not an assertion that the full operating role works.

[Sanitized results](local-operations-20261016-results.json) bind these runs to source,
runtime and limits. The one-off script is retained privately under the owned runtime
for reproduction; it contains no literal credentials and creates synthetic keys in
memory. It is not a product patch. Existing restore timing output is incidental to
the unchanged integrity test; HD-013 waiver remains effective, not rerun acceptance.
No raw DB dump, secret key value, SQL password or private file bytes are exported.
The results JSON lists every source test path/hash and exact argv/cwd with secret
environment values redacted. [Selected original output](local-operations-20261016-output.txt)
preserves observed node names/counts/durations from identified tool returns;
SHA256 f695c6b7cece2262a961efb85fee5c3c774cd0c67b35c0361f16c04a4b490161.
This is an excerpt transcribed after execution/cleanup, not a complete raw stdout
archive or a rerun. No absent full-log capture is claimed. The private diagnostic
is newly authored test code; existing repository tests and products are unchanged.

## Cleanup and consolidated inputs

Actual fixture SQL users/sessions, ops Customers and new pipeline actor/role rows
were0 after execution. Restore source2/destination1 Customers were expected synthetic
samples/loss marker. Verified exact13369/datadirvvrvRm/mysql; dropped only the3 own
schemas, verified0 remaining, SHUTDOWN succeeded/server exited0, listener/PID absent,
removed only that stopped datadir. Secret command stores cleared; retained only
small private config/log and credential-free diagnostic script (SHA256
e64d6dc55142cca441966976ac61e5994253505791bcb6c90b0e0b882baceb28).

To continue actual local operations verification, obtain these together:

1. Real ClamAV host/port, or permission to start existing Docker Desktop and create
   an isolated genuine ClamAV container with network image/signature downloads and
   additional local memory/disk usage. No infrastructure start/install was inferred.
2. Actual monitoring/alert rules and test receiver, or approval to establish an
   isolated genuine local monitor/receiver pipeline (no external messages). A mock
   HTTP response cannot certify alert fire/reset.
3. Previous app commit/tag for rollback compatibility, or confirmation to use
   Customer PR242 mergef4d50bd5 as the prior test version. This does not assert
   compatibility in advance or authorize production rollback.
4. Authorization to remediate the observed least-privilege/locking-read issue
   through a reviewed non-Business-Master-write solution. Default: preserve
   read-only ownership, do not grant Currency UPDATE, full Currency/approval
   runtime proof stays BLOCKED.
5. HD-014 authority for Customer/Sales contract/design/plan reconciliation proposal
   and subsequent exact-baseline approval. This blocks whole-module baseline/merge,
   not the independent checks actually executed above.

Local DB accounts and synthetic keys can be generated privately; Sam need not
supply production keys or another shared DB password. No renewed RPO/RTO timing
approval is requested. Full downstream integration stays BLOCKED; no complete
Operations/Security/business/release sign-off is inferred.
