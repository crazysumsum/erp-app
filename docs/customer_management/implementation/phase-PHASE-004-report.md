# Customer PHASE-004 implementation progress

## Post-HD-013 independent security checks — execution charter

Latest main `52bb48ad35f1da41508c7bf608af4e67c630dae9` contains the approved
HD-013 waiver. TC-086/087 are WAIVED_BY_HUMAN / APPROVED; no timing acceptance
run is required or planned. DESIGNfa4dbd1e / PLANa1d5e05a remain unchanged.
PR241's actual closure is [comment6188463352](https://github.com/crazysumsum/erp-app/pull/241#issuecomment-6188463352);
state206 is a pre-publication cache, not an unperformed merge.

Continue TASK-033 developer preparation only, reusing the existing real-MySQL
operational guard fixture. Scope reaches its named SQL grants, synthetic role/data,
real CustomerBankService/crypto/fresh-actor/audit paths and owner-scoped cleanup.
No product, provider contract, schema, CI, deployed permission policy or key-store
change. Bank currency is legitimately NULL in this subset; non-null Currency locking
and approval least privilege remain unproven, not bypassed or certified. There is
no configured real alert receiver or installed ClamAV tool available for a delivered
alert/scanner acceptance claim. Graphify has no usable graph.json; source inspection
is used without rebuilding the unrelated whole-repository index.

Critical cases defined before automation/execution:

| Case / reference | Priority / requirement-risk | Preconditions / data | Steps | Expected result / evidence | Initial status |
| --- | --- | --- | --- | --- | --- |
| LOCAL-081-BANK / TC-081 | P0; FR-099, SEC-010..014, DES-014/021; sensitive service unusable or overprivileged | Fresh owned13378/MySQL, migrated synthetic schema, real fresh actor, random Customer bank account/key rings; exact named grants and INSERT-only audit | Exercise real bank create/list/reveal/update/deactivate using only owned-table SELECT/INSERT/UPDATE; compare masked output, persisted ciphertext and correlated audit | Normal commands work, plaintext only in authorized reveal result; no plaintext/key values in DB audit/telemetry; no global/schema/DDL/audit mutation/Currency grants | NOT RUN |
| LOCAL-081-BANK-DENY / TC-081, local SEC boundary | P0; stale role or failed audit leaks plaintext | Same owned fixture with a readable bank row | Remove synthetic bank.view permission; try stale and fresh insufficient claims; restore role; revoke audit INSERT, try reveal, restore only original grant | PERMISSION_STALE then BANK_PERMISSION_LOST; audit-write MySQL privilege denial prevents reveal result; denial paths add no successful reveal audit or bank mutation; fixture restoration succeeds | NOT RUN |
| LOCAL-080-BANK-DB / TC-080 local event subset | P1; DES-023, SEC-010..014; corrupt stored ciphertext leaks secrets or reports successful reveal | Same bank, actual stored GCM tag and service logger capture | Flip one stored tag byte as fixture admin; reveal through restricted SQL/runtime and real crypto; restore tag | BANK_ACCOUNT_UNREADABLE422, one request-correlated fixed BANK_INTEGRITY_FAILED event, no successful reveal audit or sensitive marker in captured telemetry; not alert delivery/reset | NOT RUN |
| LOCAL-081-SESSION / TC-081 | P0; revoked SQL account retains live sessions | Unique fixture SQL user with held verified connection and current successful reads; admin confirms every selected thread's exact user/schema | Drop only fixture SQL user, KILL only its enumerated verified connection IDs; verify disconnection, residual sessions/account, old connection and new login | Held connection closes, all owned user sessions/account0, old connection unusable and fresh login1045/28000 denied; no other session touched; no production/emergency-role policy claim | NOT RUN |

Only local developer evidence may be produced. TASK-033/035 remain IN_PROGRESS;
TASK-030/031/032/034/full downstream acceptance remain BLOCKED, TASK-036 PENDING.
No Technical Acceptance/UAT/release or Operations/Security approval is inferred.

### Post-HD-013 local security results

Executable testSHA256 `60e4111cf64457d7dad03df6c2342d4b7e2f8efa2f9f068b344db66785b5560d`,
source fingerprint `9bb750facdd83862da50991dd459b808022a115ba08bef701560c0ccfdea3d9b`.
[Sanitized execution evidence](phase4-operational-security-results.json) retains
initial failures, negative control, final assertions and limits; no plaintext bank
account, password, key material or raw DB export is published.

| Verification | Actual result | Scope / limit |
| --- | --- | --- |
| LOCAL-081-BANK | PASS: create/list/reveal/update/deactivate; persisted ciphertext, masked list,4 correlated bank audit actions; exact named grants including Customer bank SELECT/INSERT/UPDATE | Bank currency NULL only; audit INSERT-only; no Currency/DDL/global grant or product change |
| LOCAL-081-BANK-DENY | PASS: actual permission withdrawal gives PERMISSION_STALE/BANK_PERMISSION_LOST; audit INSERT denial1142/42000 returns no plaintext; bank/audit unchanged | Real actor refresh, SQL and transaction; fixture grant restored; not deployed policy certification |
| LOCAL-080-BANK-DB | PASS: actual stored GCM corruption yields422, exactly one safe correlated BANK_INTEGRITY_FAILED event, no successful reveal audit; restored row reveals normally | Captured event only, not real alert delivery/reset |
| LOCAL-081-SESSION | PASS: verified owned connection IDs explicitly killed after exact fixture SQL-user drop; old session unusable, new login1045/28000; accounts/sessions0 | Local mechanics only; no other user's session or production account touched |
| Existing contention | PASS:100 defaults ->2 winners/98 CAS conflicts/1 default;100 decisions ->1 transition/49 replays/50 opposite conflicts | Existing local TC-083 subset only; approval uses separate integration DB_USER, not restricted bank role |
| Final Customer/Sales-Customer regression |73 files,298PASS/0FAIL/0SKIP,20.655652s | Serial shared-schema runner, as CI; excludes performance/recovery, no RPO/RTO rerun |
| Lint / build / traceability | PASS / PASS / STRUCTURE_PASS with approval checks | Existing bundle-size advisory remains; no CI threshold/rule weakened |

Initial RED was the real bank INSERT denial under the prior narrower fixture grants
(5PASS/4FAIL including dependent cases and parent). Added only Customer bank
INSERT/UPDATE; corrected test predicates to actual statusCode and wrapped MySQL
cause. GREEN9PASS/0FAIL/0SKIP. Temporary unreadable-status422->500 mutation was
detected (7PASS/2FAIL including parent), then product source restored with diff0.
Lint found a promise-executor return and passed after its surgical fixture fix.
Initial wider regression correctly refused missing application bank keys, then
default parallel execution raced existing shared-schema migration/cleanup fixtures.
Ephemeral matching test keys and the existing CI-style serial runner resolved the
environment/invocation failures without product, timeout, floor or policy changes.

Actual post-run own fixture SQL accounts, sessions, canaries, users and Customers
are all0 on verified loopback13378/datadirTT2dab/mysql. Service is retained only for
postmerge recheck, then exact owned schema/service/datadir cleanup. Review/current
candidate five CI checks and normal merge are still pending at this checkpoint;
actual immutable-head/merge/cleanup receipts will be on the PR timeline.

Remaining executable boundary: local source/test preparation is complete for this
slice; TC-080 real alert delivery/reset needs an actual approved receiver, deployed
TC-081 privilege/security evidence needs real account/environment owners and real
scanner evidence needs the configured scanner. TASK-030/031/032/full integration
still need real ready Fulfillment/InvoicingAR/ReturnsRefund consumers. Do not invent
these integrations, grant Currency UPDATE, certify a capture as alert delivery or
change acceptance to PASS. HD-013 timing waiver is effective; TC-085 backup/key/file/
audit and other Operations/Security requirements remain. TASK-033/035 IN_PROGRESS,
TASK-030/031/032/034 BLOCKED and TASK-036 PENDING.

## Latest-main follow-through — execution charter (2026-10-15)

Observed authoritative main `392b9f9db0f36f5a3bbabf2854bf3ee20a7bf227`.
PR#237 is MERGED, with exact-head CI38691260886 five checks SUCCESS and actual
independent review. Its authenticated closure comment6186126920 confirms integrated
smoke and safe branch/worktree/runtime cleanup. DEF-034001/034002/027001 are CLOSED
for their scoped developer remedies; older OPEN/CI-pending statements below are
historical. Do not replay the state192 premerge next-action text.

No real Fulfillment, Invoicing/AR, Returns or Refund implementation/service was
found in main's module/service/handler inventory. Sales uses CustomerLookupService
for new_sale/history; a SalesFulfillmentGuardService is a guard, not a Fulfillment
consumer. An empty CustomerReferenceProviderRegistry reports NOT_READY/UNKNOWN,
not NO_REFERENCE. Existing design documents alone do not enable TASK-030/031/032.
Business Master already registers the Customer impact checker; no duplicate is
needed. Canonical DESIGN/PLAN and pinned contract bytes remain unchanged.

Continue existing approved IMPLEMENT developer preparation only: Customer-local
TC-081 least-privilege proof (TASK-033) and TC-083 default/decision contention subsets
(TASK-034). Use a fresh task-owned loopback MySQL, existing immutable migrations,
synthetic data and ephemeral fixture credentials. No shared3306, deployed account,
production permission policy, other-module product code or CI edit. Current source
scope is tests plus Customer reports/state/runbook. No mock READY provider, alert
receiver or Operations sign-off will be invented.

Critical cases defined before automation/execution:

| Local case / reference | Priority / requirement-risk | Preconditions / data | Steps | Expected result / required evidence | Initial status |
| --- | --- | --- | --- | --- | --- |
| LOCAL-081-DML / TC-081 | P0; FR-099, DES-021; runtime overprivilege or unusable least privilege | Fresh migrated own schema; admin fixture connection; unique restricted SQL user; real application actor/role and synthetic draft | Grant only named table SELECT/DML; run real CustomerService create, replay, read and update with real fresh-actor verification and append-only audit | One customer/operation per idempotent create; normal update/read; audit append and request correlation; no schema/global/admin grants; observed assertions and sanitized result | NOT RUN |
| LOCAL-081-DENY / TC-081 | P0; FR-099, SEC-010..014; audit tamper or DDL escalation | Same restricted SQL account, nonempty correlated audit and disposable canary | Attempt CREATE/ALTER/DROP, audit UPDATE/DELETE and role escalation as runtime; compare actual rows/shape; execute fixture DDL as isolated admin | MySQL privilege errors (not fake/transport errors); no audit mutation or shape loss; runtime still usable; controlled admin succeeds; cleanup own user/data | NOT RUN |
| LOCAL-083-DEFAULT / local TC-083 subset | P0; NFR-007, DES-007; duplicate default or lost update | Own schema; real CustomerPartyService, fresh actor, transaction wrapper and audit; two owned shipping addresses | Release 100 same-version competing default updates through a barrier and bounded normal pool; reconcile persisted purposes, versions and audit | Exactly one CAS winner per address, remaining VERSION_CONFLICT; exactly one final shipping default; no unexpected DB/timeouts; root/child versions and successful audit counts reconcile | NOT RUN |
| LOCAL-083-DECISION / additional local TC-083 subset | P0; NFR-007, DES-011; double approval decision or unlogged transition | Same owned DB; real CustomerApprovalService/actor/audit/BusinessMaster; separate requester/approver; pending request created through transaction helper with explicit approval-policy snapshot fixture (no shared settings write) | Release100 alternating approve/reject commands, distinct operation/request IDs, same request version; reconcile terminal request/Customer/operations/audit | Exactly1 non-replayed transition,49 same-terminal replay results,50 opposite-decision conflicts; no unexpected failures; one decision audit plus one matching Customer status audit, versions+1, no processing/duplicate decision | NOT RUN before automation/execution |

These prove only local developer subsets. TASK-033 remains IN_PROGRESS pending
real alert delivery/reset, integrated privilege/security evidence and TASK-032.
TASK-034 remains BLOCKED; the 100-command contention case does not replace the
approved50k/20-worker mixed-load benchmark or integrated acceptance.
The local default and decision subsets do not replace full/formal TC-083
approval/default contention acceptance on the integrated downstream baseline.
TASK-035's existing local restore evidence remains separate from production
RTO/RPO/provider reconciliation and Operations/Security review. TASK-036 may update
handoff/blocker inventory, but full handoff/acceptance cannot complete yet.

### Local execution results — 2026-10-15

Additional existing-case execution charter, defined before re-execution on the
extended immutable executable baseline6faac5fd / sourcefp5b3e5b55:

| Case | Preconditions / steps | Expected / limits | Initial status |
| --- | --- | --- | --- |
| Existing TC-028 / TASK-034 local capacity | New own MySQL13369/runtime, fresh migrated empty capacity schema; run unchanged `customerManagement.performance.test.js` with50k Customers,5k addresses/contacts,20workers,30s admission window | p95<=5000ms, no physical ALL,14 actual positive range branches, correct results/cleanup; no full downstream load/acceptance | NOT RUN on this executable baseline |
| Existing TC-064 / local import capacity | Separate fresh migrated import schema on same own instance; unchanged10k-row test, parallel real Customer HTTP sample | <10min, API p95<2s, no row-lock waits, bounded pool/heap; import actor/scanner assumptions are developer fixtures, not security acceptance | NOT RUN on this executable baseline |
| Existing LOCAL-035 / TC-085/086/087 | Fresh migrated named DR source plus empty restore schema; unchanged safety-guarded real mysqldump/mysql, DB/key/file/audit comparison and wrong/missing-key denials | Actual counts/hashes and local elapsed/loss window reconcile; no real scanner/provider/production DR or Ops/Security sign-off | NOT RUN on this executable baseline |

All use only fresh task-owned `/private/tmp/erp-customer-local-runtime.IcjivL`,
loopback13369 (observed unused), new named schemas and ephemeral credentials;
shared3306/production and existing13378 fixtures are not reset. No executable
script, schema, benchmark threshold or CI configuration changes are needed.

Latest-main reconciliation superseding the initial392b9f9d snapshot:
`985411544dc278ee451ec542fd9a14ce50133bab` (Supplier PR235) was fetched and
fast-forward integrated without conflicts or Customer diff changes. Its module
inventory still has no real Fulfillment/InvoicingAR/ReturnsRefund consumers.
Integrated source fingerprint
`e453c52d1ca54723c9e0d571725fc840c6cbf22f84cd4c91fce8ba2132033280`
passed the same73 files/293 nodes,0FAIL/0SKIP in18.724s, plus lint/build and
Customer-boundary checks. Supplier code was only inherited from main, not edited.

Developer verification only, not Technical Acceptance, UAT, Security/Operations
sign-off or release approval. Source starts at main392b9f9d; the only executable
change is `server/test/integration/customerOperationalGuards.integration.test.js`.
No application, migration, contract, dependency, CI or canonical DESIGN/PLAN edit.
Earlier default-only test SHA256 (PR238 initial75ad044f candidate):
`81ccdaa45d58f3091e0d16c990c8b44a5173e8ca513df12dbb21c39362c86feb`;
source fingerprint:
`bfdc1ccd41fb9738378ba7112e4e109a3d3c208575ef1e3db774beb0b7e49011`.

Final extended default+decision test SHA256:
`b6ae4f6e0cafd2bd81ab615313ed312f3dce71ca811484e6e19e64038225ffe9`;
integrated source fingerprint:
`5b3e5b55c3184d2a852f60cdfceacf765204acc042024ee475c732afebbd06eb`.
This source passed73 files/294 executed nodes,0FAIL/0SKIP in20.545s, including
all four local cases (five nodes including parent); final lint also passes.
Earlier293-node results remain scoped to the earlier default-only source.

### Current executable baseline capacity / import / restore recheck

On unchanged executable6faac5fd / sourcefp5b3e5b55, the chartered existing scripts
were actually executed. [Sanitized complete records](phase4-local-recheck-results.jsonl)
(SHA256 `8252fe8dd8dd9aa32df3ed884fb50fc4bbc194ca34912a93ddfec023ac8d8ed6`)
preserve every actual search-plan branch, metrics, restore hashes and initial
environment failures. No raw dump, file contents, account data or key rings exported.

| Existing local check | Measured result | Scope / limitations |
| --- | --- | --- |
| TC-028 capacity |17PASS/0FAIL/0SKIP;50k Customers,5k addresses/contacts,20workers,30.007s load;269,328 correct operations,0 errors. p95 list9.428042ms, exact3.148333ms, address3.240042ms, contact3.233583ms, all<=5000ms. Physical ALL0; all14 positive branches use expected range keys. | Actual10-connection pool,128MiB buffer pool, Node26.6.0/MySQL26.7.0, local hardware15 logical CPUs/24GiB; post-load plan probes are not latency samples. Not downstream/production load or final TASK-034 acceptance. |
| TC-064 import |1PASS/0FAIL/0SKIP;10k rows, precheck501.446ms + execution28,614.983ms =29,116.429ms;0failed/skipped rows.262 concurrent HTTP samples,0errors,p9514.146917ms; heap growth86,397,840bytes; row-lock wait delta0,maxwait0,connection growth1. | Existing direct import authorization fixture; real parallel Customer HTTP/API sampling and DB writes. No scheduler/distributed-worker/full downstream acceptance. |
| LOCAL-035 / TC-085/086/087 |3PASS/0FAIL/0SKIP including2safety guards; actual logical dump/restore plus20Customer-table count/hash comparisons;2attachment objects+2import objects;1bank row decrypts;4audit rows reconcile;6wrong/missing-key denials. Local loss window174ms,recovery673.580042ms. | One synthetic Customer, not50k/production restore. Bank authorization and clean-scanner fixtures remain; no real downstream/provider/scanner, off-host disaster/failover, production RPO/RTO or Operations/Security sign-off. `productionRtoRpo=NOT_PROVEN`. |

The first capacity/import attempt failed application startup because test bank key
rings were absent: capacity15PASS/1FAIL, import0PASS/1FAIL,0SKIP, no load/throughput
claimed. DR passed independently on that attempt. Supplied fresh matching Customer/
Supplier test-only key rings and reran the unchanged two scripts; thresholds, source,
CI and Supplier product code were not changed. These failures are retained as
environment-setup failures, not recast as product failures or successful measurements.

Capacity/import Customer fixture counts returned to0. DR source2 (including the
intentional post-backup loss marker) and restore1 matched expectations before
owner-scoped disposal. Only the four freshly created13369 schemas are cleanup
targets; they were dropped, the verified service exited0, its listener/PID are
absent, and only its owned datadir was removed (small private config/log retained).
Own13378 remains separate for post-merge checks. Full downstream
acceptance stays BLOCKED; these rechecks add current local evidence, not sign-off.

Prior to these reruns, actual separate reviewer `/root/customer_task011_review`
approved the extended default/decision core and then-current scoped documentation
(REV-062), after earlier privilege-oracle/documentation findings were corrected.
REV-064 separately approved the self-reference metadata correction. Neither
approval covered these later capacity/import/restore records. REV-065 then
independently approved the actual25-record evidence artifact and state199,
verifying14/14 expected range probes,0physical ALL, retained startup failures,
matching metrics/cleanup and no key/credential export. This is agent review, not Sam's business/Security/Operations
acceptance. Final PR-head mandatory CI and fresh-main merge observation remain
required; earlier75ad044f CI/review is not reused.
Publication note: this is a pre-merge checkpoint. Actual final-head CI, review,
merge and owned-resource cleanup receipts belong to the
[PR238 timeline](https://github.com/crazysumsum/erp-app/pull/238); inspect that
trusted source on resume before replaying any pending local external-action entry.

Environment: Node26.6.0; fresh MySQL26.7.0 loopback13378, own schema
`erp_customer_p4_test`, unchanged migrations through0082. A random temporary SQL
account has SELECT on13 named tables, INSERT/UPDATE on Customer/root operation/
address tables, INSERT-only audit, and purpose mapping DML. No schema-wide DML,
DDL, grant option or global admin grant. The test uses the real request context,
bounded10-connection pool/200 queue, transaction wrapper, fresh actor and audit;
neither authorization nor audit is mocked. Synthetic data only; no raw credentials,
key rings, audit contents or browser traces exported.

| Case / check | Actual result | Evidence and limit |
| --- | --- | --- |
| LOCAL-081-DML | PASS | Create/replay returns the same Customer and operation; exactly one root, two succeeded create/update operations, version2, persisted update and two correctly correlated audit rows. Draft/root/party subset only, not all Customer runtime capabilities. |
| LOCAL-081-DENY | PASS | All six CREATE/ALTER/DROP/audit UPDATE/audit DELETE/self-GRANT attempts return actual MySQL privilege errors (errno1044/1142/1227, SQLSTATE42000 accepted; no generic/transport failure accepted). Audit rows/canary shape unchanged; denied CREATE absent; runtime still reads; fixture admin CREATE/ALTER/DROP succeeds. |
| Privilege negative controls | EXPECTED FAIL, then restored | Initial audit UPDATE mutation fails with `Missing expected rejection` (2PASS/2FAIL nodes,0SKIP). Independent review removed unnecessary audit SELECT and fixed the non-USAGE global grant check. On the tightened fixture, audit UPDATE mutation fails on unexpected column SELECT denial (not accepted as proof of denied UPDATE); global `SELECT ON *.*` fails the grant check (0PASS/1FAIL/0SKIP). Exact INFORMATION_SCHEMA table/privilege/grantability equality and zero column grants now also reject an added audit SELECT (0PASS/1FAIL/0SKIP). All mutations removed. No product defect inferred from deliberately unsafe fixtures. |
| LOCAL-083-DEFAULT | PASS |100 commands released together into the normal bounded pool, two addresses with version1; exactly2 winners (one per address),98 VERSION_CONFLICT,0 unexpected DB/timeouts. Exactly1 shipping default, each child version2, root+2, exactly2 successful update audits. This is100 contenders, not100 physical DB connections or the50k/20-worker mixed-load test. |
| LOCAL-083-DECISION | PASS local developer subset |100 alternating approve/reject commands on one real pending request:1 non-replayed transition,49 same-terminal replays,50 opposite `APPROVAL_REQUEST_NOT_OPEN`,0 unexpected failures. Customer/request each advance exactly1 version; exactly1 decision audit plus1 matching Customer status audit with winner correlation;50 succeeded durable operations and no processing residue. |
| Customer/Sales-Customer regression | PASS | Final extended source73 selected files,294 executed test nodes,0FAIL/0SKIP,20.545s. Includes real DB/HTTP root, party, lookup, search/index, bank, import/export, attachment and Sales snapshot/contract cases; no claim that unselected module/acceptance cases ran. |
| Lint / client build | PASS | Existing repository lint/build succeed; pre-existing large-chunk build advisory remains, no UI code changed. |

Reproduce from `server/` against an explicitly provisioned disposable migrated DB:

```sh
DB_INTEGRATION_TESTS=1 node --test --import ./test-support/testEnv.js test/integration/customerOperationalGuards.integration.test.js
```

Supply existing DB_HOST/PORT/NAME/USER/PASSWORD and explicit DB_ADMIN_USER/
DB_ADMIN_PASSWORD privately. Fixture administration requires CREATE USER, named
table grants, own canary DDL and DROP USER; do not run against shared/production
data or grant deployed runtime users extra privileges. The suite removes only its
unique SQL user, canaries, synthetic actor/role and Customer data. Actual post-run
counts: Customers0, fixture SQL users0, canaries0, fixture actors0. The owned MySQL
service remains running for integrated post-merge verification; its shutdown and
PR-head CI/review observations must be recorded before closure.

Decision-case setup limitation: the first attempt used the narrower TC-081 SQL
role with extra SELECT-only Currency access. MySQL26.7.0 rejected Currency
`SELECT ... FOR UPDATE`; the suite correctly failed (3PASS/2FAIL nodes,0SKIP,
including parent). This was fixture insufficiency, not a double-decision product
defect. No extra Currency mutation/locking privilege was granted to that role.
The corrected contention case uses the existing integration DB_USER account
(CI's disposable erp_user), with real authorization/audit/provider code. It does
not prove least-privilege approval/Currency access or deployed privilege policy.
Its pending request is created through the real transaction helper with an
explicit policy snapshot fixture, without toggling the shared settings singleton;
the public settings/HTTP submission path is not covered by this case.
The synthetic application role includes `customer.approval` to make the separate
approver eligible; both actors' complete claims are freshly checked. This does not
expand the TC-081 SQL role: SELECT on13 named tables plus INSERT-only audit
(14 distinct tables total) is unchanged, with no Currency/approval-table or
global/schema privileges.

Remaining conditional work is environmental/integrational: real downstream
consumers/provider readiness, alert receiver delivery/reset, deployed runtime/
migration/emergency role and session-revocation evidence, integrated contention,
production-like consistent restore and Operations/Security review. Local proof
does not satisfy these dependencies; TASK-030/031/032/034 stay BLOCKED,
TASK-033/035 IN_PROGRESS, TASK-036 PENDING. No new Sam decision is required for
this local preparation and no readiness/sign-off is fabricated.

## Current scope

2026-10-15 / HD-011 approved scoped remediation supersedes the historical status
below. Planning PR#232 merged d69b267d; CustomerService.list now uses distinct
indexed candidate IDs plus ten forward indexes0082. Final source af7cbcb3...456e9
passes two unchanged50k/20-worker/30s capacity runs17/17 each, listp957.891083 and
6.992709ms; all14 actual positive branches use expected range keys and no physical
table ALL appears. Latest-main integrated sourcec6ca3645 additionally passes fresh
runs6/7,listp957.586708/7.463459ms,17/17 each and actual independent review;
DEF-034001 CLOSED scoped developer remediation, final PR-head CI/review pending;
TASK-034/full downstream acceptance remain BLOCKED. Separate frontend issues
DEF-034002/DEF-027001 remain OPEN; no full browser/module PASS is claimed.
[Current report](def034001-remediation-report.md) preserves all failures/limitations
and links exact metrics/plans. Historical HD-010/earlier statements are not current
HD-011 approval or verification status.

2026-10-15 / HD-010 approved retest:50,000 Customers,20 concurrent workers,p95<=5s.
The new run meets latency (list1,521.02ms; exact298.68ms; address305.74ms;
contact288.71ms), with1,508 correct operations and0operation errors. Actual list
COUNT/page still full-scan, so the combined case FAILS, DEF-034001 stays HIGH/OPEN
and TASK-034 stays BLOCKED. See the [new measured report](hd010-capacity-retest-report.md)
and [exact sanitized results](hd010-capacity-retest-results.json). Prior measurements
below remain unchanged; complete downstream acceptance stays BLOCKED.

2026-10-15 update: PR #225 is merged (`8bbb0d3d`); local TASK-034/035 execution
continues from refreshed main `66ddcb9a`. See the
[local measured report](local-capacity-restore-report.md) and
[sanitized results](local-capacity-restore-results.json). Capacity is FAIL with OPEN
HIGH DEF-034001; import and isolated restore pass only their local subsets.
TASK-034 is BLOCKED, TASK-035 IN_PROGRESS, and full downstream acceptance BLOCKED.
The earlier planning/preparation statements below are historical.

The 2026-10-14 default baseline is `d9714a34f39a507528fc4c138496531cd1d57c69`.
TASK-029 merged as PR #224; its head `210c9f1405091a1eb41f42d7d7bd5f0356f08b61`
passed all five mandatory CI jobs in run `38525426127`. Its branch/worktree were
removed after the merge.

Before TASK-033 slice publication completed, `main` advanced to
`fcfb172144f240db6a1d9b14cab1adbd0e4a597b` with two unrelated documentation changes.
It was integrated without conflicts; the unchanged Customer diff passed the 253
unit checks, lint and build again. CI must pass on the new final PR #225 head.

| Task | Work that can proceed | Remaining completion dependency |
| --- | --- | --- |
| TASK-030 / 031 / 032 | No additional consumer integration on this baseline. | Real Fulfillment, Invoicing/AR and Returns/Refund consumers and complete provider readiness. |
| TASK-033 | Customer-local safe telemetry, security regressions and operational runbooks. | TASK-032; integrated observability, alert delivery/reset, privilege and security checks. |
| TASK-034 | Existing 100k/50-worker fixture and load-test tooling can be inspected/reused. | TASK-029..033; integrated fixed-window load, contention/backpressure evidence and signed report. |
| TASK-035 | Consistent backup manifest and isolated restore procedure can be prepared. | TASK-021..033; actual DB/key/file/audit/provider reconciliation, RTO/RPO drill and Operations/Security review. |
| TASK-036 | Keep traceability and blocker inventory current. | TASK-029..035; complete regression/release-readiness and formal-test handoff. |

These are partial prerequisites within existing tasks, not a change to their
dependencies or acceptance criteria. TASK-033 is `IN_PROGRESS`; TASK-034..036
remain `PENDING`. The overall module remains `BLOCKED` for the downstream contracts.

## TASK-033 independent preparation

The bank reveal failure event now includes request correlation and one of three
fixed reasons: `BANK_KEY_UNAVAILABLE`, `BANK_INTEGRITY_FAILED`, `UNREADABLE`.
Exception message/code outside this allowlist cannot enter the event. Public 422
and transactional reveal/audit behavior are preserved.

The two TC-080 developer regressions first failed on the previous implementation,
then passed for missing key, bad GCM tag and an exception carrying a synthetic secret.
The focused bank/crypto/maintenance/handler/recovery suite passed 21/21 with zero
skips. After installing the exact lockfile in the isolated worktree, all 253 Customer
unit checks, repository lint and frontend build passed. These are developer checks,
not formal TC-080 acceptance or production alert
delivery evidence.

[Customer operations runbook](customer-operations-runbook.md) records the actual
maintenance commands, scheduler names, safe diagnostic fields, recovery ownership,
rollback restrictions and backup/restore preparation. It does not deploy alerting
or claim completed capacity/DR/UAT/release checks.

## Next safe work

Review and publish the TASK-034/035 local measurement evidence under the explicit
2026-10-15 instruction, with current CI before merge. Keep DEF-034001 open and
do not issue full capacity/restore sign-off. Complete integrated gates only when
the real provider set and remaining operational requirements are ready.

2026-10-15 current update: HD-010 evidence was merged in PR#230/main09487bc6.
Sam then authorized DEF-034001 remediation. A fresh unchanged50k/20 run still
failed both actual Customer scans (listp951662.13ms,alllatencypassed). Independent
review found that a correct remedy needs HD-011's explicit DES-019 candidate-ID
UNION/ten-index and synthetic-plan-row classification amendment. Current next
action is Sam's exact proposed DESIGN/PLAN decision, not replaying PR#230 or
closing the defect. [Diagnosis/proposal](def034001-remediation-report.md) retains
raw sanitized before evidence. No product fix/after measurement exists yet;
TASK-030/031/032 and full acceptance remain BLOCKED.
