# Customer PHASE-004 implementation progress

## Current scope

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
