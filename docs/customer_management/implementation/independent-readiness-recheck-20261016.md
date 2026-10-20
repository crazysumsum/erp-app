# Customer independent readiness recheck — 2026-10-16

## Scope and execution charter

Sam requests independently executable Customer work while Sales repairs DEF-033001;
no scope expansion, PR244 and complete downstream acceptance stay BLOCKED. Latest
main observed089dd45b; no Sales repair integrated. Current checkout2d1e49565f8e74b2a65434545a81ae5342820965,
DESIGN13a77ed225d0253eaac097b5e3bb13f60c6078d1019500b95e976dd6617af721,
PLANb390c588a323b3c3677bb031f287cebefe2cb284571e901d56aa3f14814f44db,
source fingerprint a8939571af7415b62b307d40d4080570cd86b7b5c18dea546ae2e23bb9b32a4d.
The fingerprint changed from397e1617 only because the Sales defect-register document
is outside Customer docs; executable sources/tests are unchanged. Historical results
keep their actual baselines, never relabelled as fresh execution.

The serial full suite did not enable the controlled LOCAL-035 restore case. Its
prior successful run predates HD016. This slice refreshes TASK-035 integrity evidence
on the pending candidate, not RPO/RTO acceptance, full-task completion or release.

| Case / priority | Preconditions / data | Steps / expected result | Evidence | Initial status |
| --- | --- | --- | --- | --- |
| IOP-035 / P0, TC-085 integrity subset | Fresh owned MySQL26.7 loopback13369, guarded runtime name; newly migrated source and empty separate destination; synthetic only | Execute unchanged customerLocalRestore.test.js with explicit enable. Actual dump/import; all Customer tables/migrations/defaults/approval/audit/key/file/import hashes reconcile;4damaged-set refusals before import;6wrong/missing-key denials;2no-connect safety guards pass. | Direct raw stdout and minimized metrics/counts; no raw dump/key export | NOT RUN |
| IOP-033 / P1, local TC-080/085 support | Existing unchanged Customer bank crypto, attachment/import storage and audit scripts; synthetic OS temp directories | Execute four existing test files; masking, encrypted read/write, unsafe file denial, redaction/audit allowlist assertions pass. No deployed IAM/scanner/alert claim. | Direct stdout/counts | NOT RUN |
| IOP-034 / P1, local TC-028/082 subset | Separate fresh migrated capacity schema on owned instance;50k Customers,5kaddresses/contacts;20workers;unchanged pool10;ephemeral startup keys | Run unchanged customerManagement.performance.test.js after other own tests finish:30s admission,all4operationsp95<=5000ms,0errors,actual list has no physical ALL and14positive branches use expected range indexes; fixture cleanup. | Direct stdout, exact plans/p50/p95/p99/resource observations | NOT RUN |

No product/test/CI/canonical spec change. No shared3306, production data, Sales
reproduction/fix, real scanner/alerts/rollback deployment or external notifications.
RPO/RTO HD013 and scanner/alert/rollback HD015 waivers remain human waivers, not
technical proof; existing local script timing assertions/output are incidental.
Restore fixture injects clean scanner and bank authorization; it does not prove those
real boundaries or operational secret custody/off-host retrieval/full downstreams.
Owner-only cleanup after actual observations, retain credential-free logs.

## Observed results

Actual3/3 restore,20/20 supporting checks and17/17 capacity/plan nodes PASS,
40PASS0FAIL0SKIP total. These are developer nodes, not40formal acceptance cases.
Restore actual1158.8515ms; supporting282.50875ms; capacity33995.728667ms overall.
Restore reconciled20Customer tables,87migration names,6manifest members,2attachment
and2import objects, default address/contact mappings, historical approval/actor/
assignee/audit links and5audit rows. Four damaged backup sets were refused before
import; six wrong/missing-key reads failed closed. No RPO/RTO timing acceptance.

Capacity preserved50kCustomers/5kaddresses/5kcontacts/20workers/pool10/30s admission:
30007.347791ms including drain,300,948 correct operations,0errors. List/searchp95
6.95525ms; exact2.173792ms; address2.654459ms; contact2.676917ms, each<=5000ms.
Actual COUNT/page/projection plans passed physical-table scan checks; all14positive
field branches used expected search-leading range indexes. Post-load probes are
not included as latency samples. No other own test/build/browser job overlapped
timed capacity; unrelated project activity/host was not exclusively reserved.
This remains service-only selective code-prefix capacity, not Sales/mixed-write/
HTTP/browser/production/full-downstream capacity.

[Minimized measurements, exact argv/env and evidence digests](independent-readiness-recheck-20261016-results.json)
retain actual source/spec/test hashes, counts, percentiles, plans and limitations.
Original credential-free logs remain under the named private runtime, not uploaded
raw dumps/keys or a permanent shared artifact archive. Test-generated private
backup/key/files were removed by the existing test. After verifying exact owned
datadir/port,3owned schemas,0other active sessions and capacity fixture count0,
dropped only those schemas, shut down ownMySQL06:18:40UTC (sessions exit0/socket
absent) and removed its exact stopped datadir. Shared3306 untouched.

## Remaining independently executable work

No newly unblocked product feature was found in the approved remaining task list.
TASK029 awaits Sales repair/integrated revalidation;030/031 require actual downstream
contracts;032 requires those providers;033/035 have local supporting evidence but
not full provider/owner completion;034 full mixed/downstream capacity remains
BLOCKED despite this local PASS;036 formal handoff requires the preceding gates.
The waived scanner/alert/rollback/RPO/RTO executions are not reopened or relabelled
technical PASS. Do not invent substitute providers or extra features to stay busy.
No Sales repair, source/test/CI/spec change, final CI PASS, taskDONE or release
sign-off is claimed. PR244 and complete downstream acceptance remain BLOCKED.
