# TASK-029 — Transfer API developer increment

## Current result

Seven approved Transfer HTTP routes are implemented using the existing inquiry/transaction services and standard dispatcher. JWT actors, fixed view/operation policies, idempotency, path-owned IDs, strict request/response schemas, paging, header/retained-line versions and complete Receive validation are preserved. No domain transaction, migration, permission seed, shared configuration, dependency or approved design/PLAN changes.

Authority: Sam「同意繼續」/ APR-126, existing HD101 scoped recovery. Head `869ac07abdd3879254c351d857be911d71e68b6b`; source `caf576fa738762dabb7faafe471c1ea95370138f21913ad5cf885084258c96f6`; DESIGN `c8dc42b3fea72c2f6ab8a2bead404a25e65bb2ca9addcf15814d570b9a4c1cb1`; PLAN `11b815650cfb7851c5c096fe14fb7a2cff84ef3d28cd6d8afb1ae99d3ef8ad9a`.

TASK-029 remains **IN_PROGRESS**. This is the API increment, not task completion, complete-P3 approval, formal technical acceptance or UAT. Client/Transfer UI and actual Playwright verification have not been implemented/executed in this increment. No commit, push, PR, CI, merge, new-main adoption or later-task work.

## Actual developer verification

| Original configured check | Current-source observed result | Native evidence |
| --- | --- | --- |
| `inventory-p3-api` | 8 PASS, 0 failure/skip/not-run; real HTTP and socket-only MySQL26.7.0, actual70-entry migration ledger | [run](../evidence/task029-inventory-p3-api-33c42273ca/run.json) |
| `inventory-p3-unit` | 22 PASS, 0 failure/skip/not-run | [run](../evidence/task029-inventory-p3-unit-a76d66d349/run.json) |
| `inventory-developer` | 159 PASS, 0 failure/skip/not-run | [run](../evidence/task029-api-nondb-7ab1ee9a7a/inventory-developer/run.json) |
| `inventory-p3-server-coverage` | 2129 PASS, 0 failure/skip/not-run; original root-only command and native LCOV | [run](../evidence/task029-api-nondb-7ab1ee9a7a/inventory-p3-server-coverage/run.json) |
| `inventory-p3-coverage-floors` | Exit0; all34 original high-risk file floors pass; same root-run LCOV producer/consumer | [run](../evidence/task029-api-nondb-7ab1ee9a7a/inventory-p3-coverage-floors/run.json) |
| `lint` / `client-build` | Both exit0 | [lint](../evidence/task029-api-nondb-7ab1ee9a7a/lint/run.json), [build](../evidence/task029-api-nondb-7ab1ee9a7a/client-build/run.json) |

Real API cases exercise Draft replacement/cancel, full Dispatch→Receive conservation, invalid whole-line sets, path/warehouse ownership and stale versions, quarantine/reason boundaries, anonymous/view-only/freshly revoked permissions, HTTP/domain replay and late Audit rollback/retry. Invalid commands compare all seven Inventory business tables; HTTP request bookkeeping is excluded from business effects. [Cases defined before automation](task029-api-developer-cases.md).

Initial focused unit execution actually failed because the handler module did not exist; after implementation the same focused files passed22 tests. This initial direct invocation was not a registered native report and is not indexed as one.

## Retained failures and corrections

First native API run: [3 PASS / 5 FAIL](../evidence/task029-inventory-p3-api-23ce558a27/run.json). Requests exhausted the existing20-per-second IP limiter. Test requests now schedule against the actual configured steady rate; the real limiter and all status/business assertions remain enabled and unchanged.

Second native API run: [7 PASS / 1 FAIL](../evidence/task029-inventory-p3-api-86966a1b30/run.json). The schema-only application user could not CREATE a fault trigger with binary logging enabled. The fixture now uses the already-guarded private instance's administrative connection only for CREATE/DROP trigger, closes it in `finally`, and leaves all real HTTP operations on the non-global application user. No SUPER grant, binary-log relaxation, authentication bypass or production setting change.

All owned schemas, synthetic application users, daemons, sockets, temporary roots, port leases and sleep guards were removed after each native attempt. Original failed runs remain retained/indexed; only schema-valid native `run.json` reports enter the active evidence index.

## Self-review and remaining scope

SELF_REVIEW by Codex /root, not independent Sam review: correctness matches §5.6 using the existing under-lock whole-document checks; readability follows existing Inventory handler/schema patterns; architecture preserves domain ownership without extra abstractions; security binds JWT identity and fixed permissions, rejects injected fields, and keeps actual revocation checks; performance reuses bounded paging/100-line caps without new production queries. No unresolved critical/high findings in this API increment.

Next: implement the existing client service and Transfer UI (Draft full-line editor/unsaved guard, Dispatch confirmation, read-only InTransit, every-line destination Bin/status receipt), then component tests and actual Playwright browser/console/network verification. UI DoD cannot be inferred from the current build.

Old source44 evidence remains historical and is not relabelled as current-source proof. Full-server DB/coverage and later-task/full-P3 checks must be rerun at their applicable gates. Four capacity cases remain NOT_EXECUTED and mandatory at full-P3/release boundaries; no waiver. Before future publication, refresh/integrate main and verify the resulting candidate, then obtain actual required review/CI/merge authority.
