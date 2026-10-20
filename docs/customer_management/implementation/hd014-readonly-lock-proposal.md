# HD-014 / least-privilege remediation investigation

Sam: `1-3 我批准不用做，只需要推進4-5項`.
Items1–3 acceptance drills are WAIVED_BY_HUMAN, never technical PASS. Scanner
fail-closed, actual logging, encryption, permissions, CI and operating controls stay
required. HD-013 remains; complete downstream integration remains BLOCKED.
HD-014 authorizes the proposal/review; future exact DESIGN/PLAN adoption is separate.

Observed baseline: main4439014e9a9d03f233e858e56f93617e787ecb8c integrated at
dee50a2763c6e0f3cd8b7cf63c0884a2b275859b. No product patch yet.

## Critical diagnostic cases defined before execution

Owned MySQL26.7 on loopback13369, private socket, new synthetic schema/account only.
No shared3306, real Customer data, migration, privilege expansion or production use.

| ID / priority | Requirement and risk | Data / precondition | Steps and expected result / evidence | Initial status |
| --- | --- | --- | --- | --- |
| LOCK-001 / P0 | SEC least privilege; avoid giving catalog write rights | Synthetic Currency/Term rows, new account granted only SELECT | Actual existing provider fails1142 with exclusive lock; compare ordinary SELECT and shared-lock candidate. Shared lock must succeed while UPDATE/DELETE/INSERT remain1142. Capture version/grants/error codes; not fixed-provider acceptance. | NOT RUN |
| LOCK-002 / P0 | DES-017 current-state protection | Two SELECT-only readers plus owner writer; independent connections/transactions | Shared readers coexist; owner UPDATE must hit bounded lock timeout while readers hold locks, succeed after rollback; shared read after an older repeatable-read snapshot must see newly committed version. Both tables; no arbitrary sleep. Capture actual outcomes. | NOT RUN |
| CONTRACT-001 / P1 | DES-017 Sales diagnostic vs authoritative snapshot | Existing Customer provider and Sales precheck unit tests, no DB fixtures | Execute existing unit tests for bounded/deduplicated/missing/inactive/safe projection and consumer invalid/hold paths. Inspect final confirmation uses locked provider; no inference of full downstream integration. Retain stdout/counts and limitations. | NOT RUN |

## Candidate boundary (not adopted)

Read-only reference assertions should use shared current locking reads, while owner
mutation/impact-preview locks stay exclusive. Prefer `LOCK IN SHARE MODE` syntax to
avoid silently removing the documented MySQL5.7 compatibility. A plain SELECT or
granting UPDATE/DELETE/LOCK TABLES is not an acceptable substitute. Require actual
SELECT-only and concurrency tests before selecting this approach; modern local
MySQL does not prove execution on5.7 or8.0 before8.0.22.

Potential shared-product scope: BusinessMasterProvider.js and
BusinessMasterRepository.js only, their repository/provider tests, and a real
least-privilege regression. Consumers Customer, Supplier and Sales must regress;
no consumer ownership, public projection, admin privilege or data mutation changes.
Shared scope and changed canonical baselines require Sam approval before editing.

Official rationale: [MySQL locking reads](https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html)
distinguishes SELECT-only shared locks from FOR UPDATE privilege requirements and
states shared locks block changes until transaction completion. Actual execution,
not documentation alone, decides local feasibility.

## Actual diagnostic results and limitations

LOCK-001/002: one executable test PASS,0FAIL/0SKIP on MySQL26.7.0, Node26.6.0.
Both actual existing provider assertions failed1142/42000 under a new SELECT-only
account. Candidate shared SQL succeeded; two shared readers coexisted; all three
INSERT/UPDATE/DELETE attempts were denied1142. Owner UPDATE timed out1205 while
readers held locks, succeeded after rollback, and shared current read returned
version2 while an older repeatable-read ordinary snapshot still returned1.
This proves candidate SQL feasibility, not the unimplemented provider fix or full
Customer/approval workflow. Synthetic minimal catalog tables, not full migrations.

CONTRACT-001:31 existing unit tests PASS,0FAIL/0SKIP (101.617791ms), including
CustomerLookupService, Sales precheck and Business Master consumer contract tests.
Actual final confirmation code still calls locked `getSalesSnapshotInTransaction`
via `prepareSalesDocument`; dynamic blocked-after-precheck regression remains planned.
These unit fixtures do not certify live downstream integration or deployed grants.

Exact commands from /private/tmp/erp-customer-operations-readiness:

```
node --test /private/tmp/customer-lock-probe.c898BU/probe.test.mjs
node --test server/test/customerLookupService.test.js server/test/sales/phase3/salesImportPrecheck.test.js server/test/business-master/consumer-contract/providerContract.test.js
```

Private credential-free probe script SHA256
4816e83930c943e5cd3ff3ca4318c63a32abb0be1437c6bf9d9220feb11608;
[captured stdout/tool results](hd014-lock-probe-output.txt) SHA256
e74a025592e478857439bcb0b39433f5615ed4f2919f2e259db2d4cd0cb6f296.
Output captured directly before runtime cleanup, not reconstructed afterward.
Two initial executions failed in cleanup SQL because `schemas` was an unquoted
reserved alias (1064), despite completing diagnostic assertions. Preserve both
failures; correcting that alias and closing admin before final assertion produced
the final2123.5185ms PASS. No product change or hidden failed-run deletion.

Confirmed only owned schema/account counts0, exact datadir/port identity, SHUTDOWN,
server exit0 and removal of its stopped datadir. Private config/log/probe remain;
no existing3306, user/schema, production data, scanner/alert/rollback environment
or other services touched. No reusable credentials exported.

Independent reviewer /root/customer_task011_review requested explicit lock modes,
lock order/no upgrades, additive provider version and mutable-state final-confirm
regressions. Canonical DESIGN/PLAN now include those requirements. Implementation
and new exact-baseline adoption await Sam; no agent-authored human approval.

Final independent re-review: APPROVE proposal only;0Critical/0High/0Required.
The initially inconsistent §6.10 method list/version wording was corrected and
actually re-reviewed by /root/customer_task011_review, not self-certified.
Reviewed proposed DESIGN:
`13a77ed225d0253eaac097b5e3bb13f60c6078d1019500b95e976dd6617af721`.
Reviewed proposed PLAN:
`b390c588a323b3c3677bb031f287cebefe2cb284571e901d56aa3f14814f44db`.
One consolidated HD-016 decision remains: adopt these exact baselines and permit
only the two named shared Business Master files for the specified shared-read
repair. Recommended: approve this narrow repair, with actual regression and normal
CI/review/merge gates. Alternative: retain current implementation and its runtime
least-privilege blocker; do not grant catalog DML or remove locking. Default until
Sam answers is no product edit/adoption/merge. Existing HD-013/015 waivers remain
accepted decisions; their new-PLAN association awaits this baseline adoption,
not a renewed request to perform waived acceptance. Current approval validator
therefore honestly reports TC-086/087/088 NA_APPROVAL_STALE; structural, boundary
and diff checks PASS. Do not relabel this as complete implementation verification.
