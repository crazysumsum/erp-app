# CI capacity routing

Sam's instruction, 2026-10-30: move the audited 32 existing performance/capacity
definitions out of routine PR checks; run them only for related file changes;
tighten the existing capacity jobs; preserve every case, workload, assertion,
threshold, coverage gate and review. Do not add unapproved routine cases.

## Selection

`.github/scripts/capacity-cases.mjs` is the single catalog for routine exclusion
and affected-case execution. Its first 32 entries correspond to the audit. The
existing fourteen Fulfillment scenarios and two TC-042 scenarios are retained.
Parameterized names and nested child counts are explicit. No application test
body, data size or acceptance assertion is changed. Dormant opt-in Customer,
Item and Inventory performance suites remain disabled.

The scope job combines positive workload/provider paths with actual static
relative/alias imports, including fixtures and shared CSV/decimal helpers.
Dynamic handler/module discovery has explicit owner scopes. It reports the
changed paths responsible for each selected case. Pure prose, unrelated UI and
independent Purchasing math select no capacity. A shared runner/runtime change
can legitimately select all existing catalog entries. An unmapped namespace or
unavailable comparison history fails the scope check instead of starting a sweep.

PR, main push, schedule and manual runs without a baseline run functional CI.
Their server and client capacity jobs are deferred. A skipped job records no
non-functional PASS.

After the relevant UAT is complete, the coordinator verifies the acceptance
record and Sam's workload approval, then records the UAT reference, interval
and case IDs in the module handoff. In the repository Actions variable
`CI_POST_UAT_CAPACITY`, add one whitespace-separated
`<base SHA>:<accepted main SHA>:<catalog ID>` grant per approved case.
Dispatch CI on main at the accepted revision with the full ancestor SHA in
`capacity_base`. A moved head requires a reviewed grant for the new revision.
The selector checks both revisions, rejects unknown or unrelated IDs and runs
only the granted cases. Missing or stale grants fail before capacity execution.
Remove grants after the approved run. A baseline alone cannot authorize load.

## Local functional entrypoints

The server and client `test` / `test:coverage` npm scripts reuse the existing
`capacity-runner.mjs server-pattern` / `client-pattern` selectors. Catalog
validation, an empty selected name set, selector failure or empty output stops
before test discovery. Each selector runs in a separate process with
`NODE_V8_COVERAGE` cleared; the test process retains its original instrumentation.
There is no unfiltered fallback, second catalog or local capacity option.
Ordinary cases in mixed files, fixture isolation and rollback assertions remain.

Root `test`, `test:coverage` and `verify` accept no extra arguments and call the
workspace entrypoints. For targeted checks, select the workspace explicitly:

- Server `test` forwards Node test arguments; its catalog skip pattern still
  applies. Server `test:coverage` accepts no arguments and keeps the complete
  functional suite, 92/83/90 and the 39 per-file floors in the same command.
- Client `test` accepts only positional file paths. All options are rejected,
  including custom name filters, reporters, config files and interactive modes.
- Client `test:coverage` accepts no arguments, except the existing CI single
  `--testNamePattern=<pattern>` argument when it exactly equals the pattern
  generated from the same catalog. That argument is consumed before injecting
  the pattern once; Vitest rejects duplicate single-value options.
- Client `test:watch` exits with a diagnostic directing callers to a one-shot
  functional run. Interactive filtering could otherwise replace the exclusion.

These are deliberate local-command compatibility restrictions; they do not
change CI triggers, cases, data, workers, eight-shard coverage or browser gates.
The npm command wiring requires POSIX `sh` (macOS/Linux); native Windows command
shell compatibility has not been verified. Capacity execution remains subject
to the post-UAT accepted-main grant procedure above.

## Execution and unchanged gates

Routine server coverage keeps eight serial shards on separate MySQL databases.
Only catalogued names are excluded, including the two nested Customer contention
children. Ordinary cases in the same files still run. Client coverage likewise
excludes only the two catalogued large-data cases. Scope helpers run outside the
server V8 coverage instrumentation; application coverage configuration is unchanged.

The two unconditional Sales TC-032/035 steps are removed from shard 1. Existing
capacity now runs in selected server groups (`framework`, `customer`, `supplier`,
`sales`, `fulfillment`) with at most two capacity runners at once, plus a selected
client job. Each native group owns its database. The original Sales TC-032/035/042
TCP environment is retained; extracted native/Fulfillment groups retain the socket
and lifecycle configuration. Client capacity has no database service.

Customer capacity needs its parent and existing LOCAL-081-DML setup child to create
the shared Customer. The capacity selector runs that prerequisite and the selected
contention children, excluding unrelated siblings. Routine coverage continues to
run the parent and all functional children, including the session-revocation check.

Capacity runs without coverage, stops its batch on the first failure and does not
retry automatically. Node reports must contain exactly the selected named PASSes,
including required parents/setup and TC-035 children, with zero failures, skipped,
cancelled or TODO tests. Client reports must contain exactly the selected PASSes;
other cases filtered by Vitest may be pending but cannot substitute for a selected
case. The fixed required Test check rejects failed/cancelled/missing results and
unexpected skips; only an explicitly unselected capacity job may be skipped.

Global server floors remain 92% lines, 83% branches, 90% functions, with all existing
per-file floors. The raw eight-shard candidate/runtime identity checks remain.
Dependency audit, lint, build, mocked browser tests and the real Fulfillment P1 and P2
browser gates remain. Each browser suite must pass both flows on shard 1. No additional routine test registration is added:
the existing six scope/gate tests are updated, and the five coverage-rule tests are
unchanged. Further private filter probes are outside CI discovery.

## Original routing validation record

- Local existing CI rules: 11 passed.
- Private zero-load native runner proof: all catalog names, parameterized/nested
  selection, Customer setup, no unrelated capacity, rename/history decisions and
  exact-result gates checked. Inverting the routine selector was caught; restored.
- Local client functional coverage: 126 files, 1,042 passed, exactly two capacity
  cases excluded. Production build and lint passed.
- Independent review identified overly broad recognition of unknown namespaces;
  the owner classification was narrowed. Dynamic handler prefixes were also
  checked against the actual repository directories.
- Actual candidate CI is required before merge, particularly for native Customer
  setup, the real client capacity reporter and unchanged server coverage floors.
  The shared CI routing change itself selects the existing approved catalog;
  this does not authorize any new workload or altered scale.

Existing performance failure/timeout handling still applies: stop and explain the
scenario, data/concurrency, measured failure and cause to Sam before retrying or
altering a test. Do not lower floors or restore capacity to routine checks to make
a failed coverage gate green.
