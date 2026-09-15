# Business Master UAT Test Report

## Scope and Baseline

- Business scenarios: Currency and Payment Term administration, validation, lifecycle impact, permissions, concurrency, accessibility/responsiveness, production-readiness continuity, and recovery continuity
- Baseline commit: `c3972422d20c56e9656aef9f894b91d7162c79c7`
- Source fingerprint: `d407db985203a648d5051ecf73718c6519e9fda8659e17658b5cdf302071d532`
- Automated environment: local isolated Playwright/Chromium with synthetic fixtures
- Automated execution: `2026-09-14T08:56:53Z`–`2026-09-14T08:57:01Z`
- Authorized local staging/restore execution: `2026-09-14T17:23:43+08:00`–`2026-09-14T17:41:08+08:00`

## Execution Summary

| Metric | Count |
|---|---:|
| Planned P1 UAT cases | 11 |
| Execution PASS | 11 |
| Execution FAIL | 0 |
| Execution BLOCKED | 0 |
| Execution NOT_RUN | 0 |
| Business ACCEPTED | 11 |
| Business REJECTED | 0 |
| Business PENDING_USER_ACCEPTANCE | 0 |

## Per-case Status

| Cases | Method | Execution result | Business acceptance | Evidence / next action |
|---|---|---|---|---|
| UAT-001–UAT-009 | Playwright browser automation | PASS (9/9) | ACCEPTED as part of Sam's module-level Business Acceptance | `evidence/20260914T085653-a30e74de7806/run.json` |
| UAT-010 | Codex executed the exact local workflow authorized by Sam; Sam reviewed and attested the result | PASS | ACCEPTED | `evidence/20260914T093900-manual-uat-staging-restore/execution-observations-detail.json`; redacted screenshots in the same directory. |
| UAT-011 | Codex executed full-schema backup/restore, migration rerun, provider/readiness and parity checks; Sam accepted the documented limitations | PASS | ACCEPTED | `evidence/20260914T093900-manual-uat-staging-restore/execution-observations-detail.json` |

The actor checklist, completed objective observations, accepted limitations, and imported human decisions are in `testing/09_manual_uat_execution_pack.md`.

## Preserved Infrastructure Attempt

The first UAT attempt, `evidence/20260914T085628-a7d05d9a8f74/run.json`, failed before test discovery because the restricted sandbox rejected binding the local Vite server to `127.0.0.1:5202` with `EPERM`. This was classified as an execution-environment failure, not a product defect. The latest formal attempt ran the same approved suite and immutable baseline in an authorized local execution context and passed 9/9. Both records are retained for auditability.

## Defects and Change Requests

- Product defects: none observed. One initial CORS failure was traced to the local API start command omitting the repository-supported `CLIENT_URL` value; the corrected local process passed the same flow.
- Change requests: none raised.
- `03_defect_report.md` and `06_change_request_summary.md` are omitted because there are no corresponding records.

## Gate and Acceptance Conclusion

- UAT execution: `PASS` for UAT-001–UAT-011.
- Harness `UAT_EXECUTION`: `LOCAL_CHECKS_PASS` at corrected state revision 56.
- Harness `BUSINESS_ACCEPTANCE`: `LOCAL_CHECKS_PASS` at corrected state revision 56.
- Business acceptance: `ACCEPTED` by Sam, bound to commit `c3972422d20c56e9656aef9f894b91d7162c79c7`.

The Business Acceptance does not constitute release approval or production deployment authorization.

Release approval was subsequently granted by Sam and the `RELEASE_APPROVAL` gate returned `LOCAL_CHECKS_PASS` at state revision 59. Production deployment remains a separate, unexecuted operational action.

## Harness Bookkeeping Recovery

Sam explicitly approved removal of exactly three attachment/detail paths that had been accidentally appended to the runner-only `evidence_files` index at state revision 55. No evidence was deleted: the redacted detail JSON and both PNG images remain in `evidence/20260914T093900-manual-uat-staging-restore/`. The correction is recorded as `ACTION-STATE-RECOVERY-001`.
