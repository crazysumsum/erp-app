# Customer PHASE-004 implementation progress

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
TC-081 least-privilege proof (TASK-033) and TC-083 default contention subset
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

These prove only local developer subsets. TASK-033 remains IN_PROGRESS pending
real alert delivery/reset, integrated privilege/security evidence and TASK-032.
TASK-034 remains BLOCKED; the 100-command contention case does not replace the
approved50k/20-worker mixed-load benchmark or approval-decision contention.
TASK-035's existing local restore evidence remains separate from production
RTO/RPO/provider reconciliation and Operations/Security review. TASK-036 may update
handoff/blocker inventory, but full handoff/acceptance cannot complete yet.

### Local execution results — 2026-10-15

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
Final test SHA256:
`81ccdaa45d58f3091e0d16c990c8b44a5173e8ca513df12dbb21c39362c86feb`;
source fingerprint:
`bfdc1ccd41fb9738378ba7112e4e109a3d3c208575ef1e3db774beb0b7e49011`.

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
| LOCAL-083-DEFAULT | PASS |100 commands released together into the normal bounded pool, two addresses with version1; exactly2 winners (one per address),98 VERSION_CONFLICT,0 unexpected DB/timeouts. Exactly1 shipping default, each child version2, root+2, exactly2 successful update audits. This is100 contenders, not100 physical DB connections, and not the50k/20-worker mixed-load or approval-decision test. |
| Customer/Sales-Customer regression | PASS | Final source73 selected files,293 executed test nodes,0FAIL/0SKIP,19.044s. Includes real DB/HTTP root, party, lookup, search/index, bank, import/export, attachment and Sales snapshot/contract cases; no claim that unselected module/acceptance cases ran. |
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

Remaining conditional work is environmental/integrational: real downstream
consumers/provider readiness, alert receiver delivery/reset, deployed runtime/
migration/emergency role and session-revocation evidence, approval contention,
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
