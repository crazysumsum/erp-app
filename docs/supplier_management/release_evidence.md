# Supplier Management — release evidence and sign-off

**Release status: NOT RELEASE-READY. Nothing on this page is signed.**

This is the sign-off sheet that T51 AC 4 asks for. It does not copy the evidence.
- The evidence, case by case, with its files and the work that remains, is in [`testing/06_task051_completion_boundary.md`](testing/06_task051_completion_boundary.md) (groups A, B and C).
- How to deploy and roll back is in [`operations.md`](operations.md).

A role signs only when everything it reviews is complete on the **same candidate commit**. Signing on a developer-stage run, or on another commit's CI, does not count.

## What each role reviews

| Role | Reviews | Must be true before signing |
| --- | --- | --- |
| BA / Product Owner | Group B and the business UAT (UAT-001…055); the known limitations below; the deferred defects | Business UAT executed by the business roles; every limitation accepted or fixed |
| Technical Lead | Group A; traceability (`08_traceability.json`, matrix generated); the CI on the candidate; the reviews | The harness formal stages ran in TEST_AND_VERIFY on clean pins (HD-147 B) |
| QA | Every suite's result against its own count, skip and required-ID rule; TC-136 | `verify_gate` passes on the candidate |
| Security | The Bank suites (TC-062…077); TC-111…120; the key handling in `bank_operations.md`; break-glass accounts | The Bank security smoke passes. **HD-157:** the target-environment run and TC-135's break-glass audit are waived; the local results stand. Whether to check break-glass accounts before go-live is the Product Owner's call at release (see the HD-157 limitation below). |
| Operations | `operations.md`; UAT-044 and UAT-045; the local parts of TC-128 and TC-130…135 | UAT-044 and UAT-045 pass. **HD-157:** the production parts of TC-128, TC-130, TC-132…135 and TC-006 (restore drill RTO/RPO, deployed-environment smoke, alert delivery, staged rollout, production rollback) are waived; the local results stand (see the HD-157 limitation below). |

## Known limitations (to be accepted or fixed before release)

| Limitation | Where it is recorded |
| --- | --- |
| Rolling back across migration 0103 loses the order users set, and needs a maintenance step | `operations.md` §2.1 |
| DEF-034: one 10,000-row import applied 9,999 rows once, under load; not reproduced since; cause unknown | `testing/04_defect_register.md` |
| Deferred defects DEF-004, 007, 008, 012…019 and 023 (HD-116 risk approval) | `testing/04_defect_register.md` |
| Downstream cases blocked until Purchasing, Receiving and AP ship their parts | Boundary page, group B |
| All evidence so far is local and developer-stage; none is from a production-like environment | Boundary page, groups A and C |
| **HD-157 (2026-10-30): production verification waived.** The Product Owner decided that the C-group cases that passed locally count as passed, with no production-like re-test, and set NFR-005 (for-SKU) to 3 s. So before production, nobody has verified: capacity on production hardware (TC-128, TC-085); network faults in the deployed topology (TC-130); alert delivery to on-call (TC-132); the restore drill's RTO ≤ 4 h and RPO ≤ 15 min (TC-133; NFR-011 now rests only on UAT-045); the deployment timeline and staged rollout (TC-134, TC-135); break-glass accounts (TC-135); and the production rollback (TC-006). Problems there would first show in production. Accept at release. | `00_harness_state.json` HD-157; `06_technical_test_cases.md` §0 |
| The rehearsal fingerprint does not compare table options, CHECK constraints, generated columns, FK column mapping, index prefixes or privileges | `testing/t51_rehearsal/README.md` |
| Production itself is only checked read-only. The write smoke runs on a restored copy (HD-148 B), so the first real write in production is a user's | `operations.md` §5 |
| The smoke has run only locally; neither mode has run against a production-like environment | `operations.md` §5 |
| §14.4's "schema hash matches the expected one" is not compared: there is no release baseline hash. The release's own schema inspectors are used instead, and TC-135 records a digest with nothing to compare it to. | `operations.md` §5 |
| The `copy` smoke runs the app with the admin account, so the deployment account's grants on new tables are not exercised | `operations.md` §5 |

## Sign-off

| Role | Name | Candidate commit | Date | Decision |
| --- | --- | --- | --- | --- |
| BA / Product Owner | | | | NOT SIGNED |
| Technical Lead | | | | NOT SIGNED |
| QA | | | | NOT SIGNED |
| Security | | | | NOT SIGNED |
| Operations | | | | NOT SIGNED |
| **Release approval** (separate from the five above) | | | | NOT GIVEN |
