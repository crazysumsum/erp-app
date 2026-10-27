# DEC-037 — TC-032 completed-confirmation P95: 10 seconds

Sam directly authorized “門檻放寬至10秒。” in Sales chat 01a0f0e2-2647-7dc2-a1d4-a7cefa29d0f6, turn 01a17afc-2a8a-74b2-b13a-cab87ce4b395, userMessage 01a17afc-2ad7-7c71-8527-c1b5b675723f (2026-10-27).

This standalone corrective amendment changes only the two TC-032 confirmation P95 assertions from 3,000 ms to 10,000 ms and aligns their canonical requirements/design/tasks/test specification. It retains 50 distinct users, three rounds, 150 samples per scenario, 135 one-line and 15 hundred-line orders, the original zero/five warmups, nearest-rank quantile, actual recovery/backorder jobs, ten-connection pool, HTTP-to-terminal timing including asynchronous polling, zero hidden dependency failures and all terminal/reconciliation assertions.

The general NFR-003, TC-042/TC-055 and all P4 capacity/restore thresholds remain unchanged. The historical main2b TC-032 failures (3,511.553 ms / 4,921.045 ms against 3,000 ms) remain failures of their original contract. A later green reference run does not supersede those failures or prove a root cause. New evidence must use the amended candidate. This does not authorize the unapplied P4 readiness optimization or declare P4 complete; DEC-036 remains pending in its preserved worktree.

Base main: d805913bb22afad8b5eafef60920cfce73d0dd05. No production code, workload, schema migration source, dependencies, CI configuration or UI changes. Current-candidate CI and independent review remain required before merge. Any new performance failure stops further work for Sam's disposition.

Validation: pending actual execution and independent review; no acceptance or release sign-off.

Traceability reconciliation: four consumed contract pins were already stale on base d805; actual consumer files are byte-identical to that base. Separate review compared each old pinned version: Inventory additions concern proposed Purchasing, Customer additions concern deferred proposals/batch precheck, Item adds Fulfillment lookup, and catalogue adds other-module permissions. Existing Sales interfaces remain unchanged. Refresh only their observed manifest hashes plus the changed Sales design self-pin; adopt no proposed contract or P4 scope. Idempotency pin remains unchanged.

Developer verification (2026-10-27): both original scenarios actually passed in sequence on a newly created socket-only synthetic MySQL26.7.0 schema with 100 exact current-main migration ledger entries. No-confirmation-warmup P95 610.887541 ms; five-confirmation-warmups P95 558.562666 ms. Each scenario: 150 completions, zero excluded failures, original jobs/terminal/quantity reconciliation assertions passed. Separate name-filtered runs execute both original cases once in total; the counterpart is selected in the other invocation. Helper, migrations, framework SQL, HEAD and source fingerprint remained identical before/after. Raw evidence remains private; summarized results contain no credentials. This host result does not establish CI-runner performance or explain earlier main failures.

Lint, syntax, diff whitespace, traceability structure and module boundary checks passed. Independent preexecution/specification review approved with zero required findings (separate agent sales_archive_guard_review). Current-candidate CI remains pending.
