# TASK-002..004 developer checkpoint

Mode: IMPLEMENT; scope: opt-in Upload Framework foundation. Design and plan remain unchanged. Existing routes default to memory mode; no Sales route is registered.

Disk uploads reserve independent slot/byte capacity, stream with backpressure into private random request files, hash complete content and retain only a 64 KiB prefix. CSV prefix screening requires valid UTF-8 (allowing an incomplete trailing character only for a truncated prefix), rejects NUL/control bytes and does not assert a CSV signature. Full CSV parsing remains a later task.

Cleanup uses private request ownership, directory device/inode identity, a marker and generated filenames. It never follows symlinks or recursively deletes an unrecognized directory. The age-based cleaner runs before a new disk request directory is created and skips active request directories. Response completion, timeout, malformed multipart, disconnect, schema/handler failure and replay clean temporary files. Disk reservation remains held through request-file cleanup.

## Independent reviewer provenance

Reviewer: Codex `/root/sales_readiness_review`; provenance: SEPARATE_AGENT, read-only. Initial TASK-002/003 baseline: `43e1fb6b196b002b0cea21571fb50690e51a8aee`; final TASK-004 review: current uncommitted candidate following that baseline, before this checkpoint commit.

Disposition: APPROVE scoped implementation checkpoint. UPL-001..004 were HIGH findings and are resolved: unsafe writable ancestors; unsupported MIME cleanup; pre-aborted parser crash; premature byte reservation release. Reviewer independently reproduced and verified the pre-aborted fix; other regression results below were author-executed. This approval does not approve a numeric memory threshold, formal acceptance or partial Phase merge.

## Observed developer checks

- Upload/application/dispatcher regression: 92 passed, 0 failed, 0 skipped before the additional delayed-handler case. Log: `/private/tmp/sales-task004-regression.log`.
- Final fileTransferFailureModes: 12 passed, 0 failed, 0 skipped, including delayed-handler capacity -> 503 -> cleanup -> 201 recovery. Log: `/private/tmp/sales-task004-http-final.log`.
- `npm run lint`: passed; `git diff --check`: passed.
- Real HTTP checks use ephemeral localhost and fake database; generated private test encryption keys are neither exported nor committed.

Remaining: 50 MB isolated-process measurement and numeric threshold disposition; full workspace verification needs separately authorized isolated MySQL runtime. Formal TC-004..006, generic runner and Phase exit remain NOT_RUN/BLOCKED; TC labels in developer tests are trace references, not formal PASS.
