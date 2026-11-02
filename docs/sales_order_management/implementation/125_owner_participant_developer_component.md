# Owner Archive participant developer component

## Implemented behavior

The owner participant requires the actual active RR/context plus a private fixed read-only authorization callback. Prepare observes and hashes the complete12 owner classes under actual owner locks, rejects OPEN/UNKNOWN and each Fulfillment/Shipment last_business_updated_at>=cutoff. Archive validates the complete expected manifest, copies missing exact original rows into immutable mirrors in500-row batches, reads back all counts/business hashes/metadata, clears only the guarded technical Shipment pointer, routes retained terminal operation outcomes, and deletes explicitly in reverse FK order. No Inventory writes or own transaction/connection/commit.

Existing identical same-batch/time mirrors may resume with a COMPLETE revalidated Active source: compare exact source hash, stored hash and metadata, insert missing rows only; divergent/foreign rows conflict without overwrite. Partial Active deletion is not repaired speculatively. Durable owner replay validates its12 mirrors/routing plus exact owner counts/hashes in the Sales manifest. Mirror-derived Active IDs and polymorphic Audit targets must be absent, including new residual Audit IDs after roots disappear. The real Sales coordinator must separately validate its six archives/absence/hashes before whole-order replay.

Native DATE fields use explicit DATE_FORMAT in the fixed column projection; the canonical hashing contract still rejects Date objects and no global driver/timezone setting changes. Existing fixture defaults stay unchanged; the added optional synthetic Shipment date exercises a real non-null DATE.

## Actual checks and repairs

Final `p4-participant-native-r8.log` SHA256fcec99dfeb2ed2b18de25699b28134c2aa708a02fbe3374a041e108494c342d2:19PASS (18DB+1shape-unit),0FAIL/0SKIP. Includes real Inventory Allocate/Issue/Reverse owner history in all12 classes, copy/readback/route/delete with caller rollback, late mirror failure, lost private authorization after final deletion, same complete persisted Sales/owner fixture replay,504 mixed Audit rows through actual500/4 insert+delete batches, identical partial/full mirror recovery, exact cutoff refusal, changed hash/foreign batch/foreign SO original-ID conflicts and residual Active Audit refusal. The six Sales effects in this component replay test are a clearly labelled native fixture coordinator, not the real production job.

Genuine behavior RED runs are preserved: recovery/cutoff13PASS4FAIL, residualAudit13PASS5FAIL, foreignSO18PASS1FAIL; no setup errors reclassified as product RED. The original new-file module-not-found RED is retained as initial missingimplementation evidence. Older intermediate PASS runs do not qualify final source.

Non-null DATE regression executed against immutable product21b7916 plus only new test/fixture overlay:21PASS1FAIL, native Date object observed. Fixed Current native22PASS0FAIL0SKIP (`d2b5094c…`). Scoped ESLint0.

Separate exact-six-file closing proof `p4-participant-def022023-r2-closing-reviewer-proof.json` SHA25623151008739e5a67b7dafc54dfd8da2a3b510ff53c77a29105201156fa8a27a7 resolves DEF022/023 with no required findings. All findings, failed logs and historical approvals remain. Raw evidence is private outside Git.

## Mandatory check is still BLOCKED

The unchanged standard `sales-fulfillment-participant-native` suite ran against source fingerprint2f053efb77442aa190d61c7d05eea76fe856f350f13c54379f1041082a448bac and PLANec0fae97. Registered evidence `evidence/20261023T052945-9dca4fe42cc3/run.json` records19 discovered JUnit tests,19passed,0failed/skipped/notrun and exit0, but resultBLOCKED because complete required TC047/048/049 evidence is still absent. No labels were added to fake complete cases and the minimum/case contract was not lowered.

No TASK/Phase DONE, P4 PR/currentCI/mainmerge, real scheduler/WeakMap authority or whole-writer protocol is qualified here. Finish fixed private runtime and real Sales coordinator, audit/print/denied writer membership/fencing, full joint tests including unknowncommit, original full regressions/browser/coverage/capacity/restore/currentCI/whole-phase review and unchanged Gate before the already-authorized main merge.
