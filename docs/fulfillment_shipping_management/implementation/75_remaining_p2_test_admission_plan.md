# CI-P2-REMAINING-001 — remaining P2 verification proposal

Status: PROPOSED, not approved for new regular CI cases or capacity execution. The first15 Draft cases remain separately APPROVED under CI-P2-DRAFT-001 and are not requested again. No shared CI change is authorized until this proposal receives Sam's actual decision. Product development follows approved TASK025–033; the present request concerns additional verification footprint under Sam's new cost policy.

## Additional functional cases:22 maximum

| Slice / case identities | Count | Purpose / planned assertions | Dataset and execution |
|---|---:|---|---|
| LOOKUP-PARENT-ACTIVE; LOOKUP-CHILD-VERSION; LOOKUP-HTTP-PERMISSION | 3 | Parent Customer binding; nullable country/default/active records; valid Contact and stale/wrong-owner/purpose; strict HTTP and fresh permission | One SO/SKU/Line, up to3 address/contact choices; native/HTTP, no timing samples |
| CONFIRM-INTENT; CONFIRM-TERMINAL-WITNESS; CONFIRM-START-ROLLBACK | 3 | PhaseA durable intent/replay/race; immutable public-version witness after later Draft/P3 changes, missing/malformed witness refusal and UINT32 headroom; atomic late failure | One picked Fulfillment/Shipment, up to2 connections; private prototype exists, not CI-admitted |
| ISSUE-ATOMIC; ISSUE-ROLLBACK; ISSUE-OWNER-PROOF; ISSUE-FRESH-GUARDS | 4 | Issue/Consume/Sales/Claims/snapshots commit once; failures at Inventory/Sales/snapshot/audit stages; exact receipt/source/version mismatch; address/contact/item/actor/stock guards | Normally one SO/SKU/Line; atomic success uses2 lines/2 buckets. Rollback case has at most4 independent fail stages, not unbounded iteration |
| RECOVERY-LEASE; RECOVERY-OUTCOME; RECOVERY-REVOKED-FAILURE | 3 | Same-event crash/expiry/two-worker fencing/abort; confirmed/unknown outcome, never infer null as zero; trusted failure-only bookkeeping after fresh revocation with no Issue bypass | One small Shipment, up to2 worker connections; no sustained concurrency load |
| CLIENT-CONTRACT; CLIENT-POLL-LIFECYCLE; CLIENT-ERROR-RECOVERY | 3 | Exact wire requests/weight; original status URL, bounded polling/unmount/terminal stop; safe202/409/403/503 states and preserved input | Pure client tests with deterministic scheduling, no live load |
| SHIPMENT-INQUIRY-DOCUMENT; SHIPMENT-DOCUMENT-SAFETY | 2 | Filters/allowed actions and immutable snapshot projection; private/no-store, XSS/filename, no prices/bank data, unconfirmed document refusal | One2-line Shipment; unit/native HTTP as applicable |
| CONFIRM-HTTP-OUTCOME; OPERATION-HTTP-VISIBILITY | 2 | Exact200/202 and same-event/idempotency conflict; original status lookup permission/target visibility and safe bounded output | One small Shipment, no performance benchmark or request flood |
| BROWSER-SHIPMENT-HAPPY; BROWSER-SHIPMENT-RECOVERY | 2 | Real Draft→Confirm→SHIPPED/cancel-recreate/print, and stale/permission/unknown recovery; navigation/refresh, focus,375/768/1024/1440 states, console/network | Real Playwright with2 small lines/buckets; resize the same flows, no repeated business writes per viewport, no100/5000 browser workload |

Total additional22 functional cases (including2 real browser flows). All test names/file placement will be reconciled to this exact scope before CI inclusion. These are a maximum count, not permission for unrelated loops or extra fixtures; changed case purpose/load/frequency requires another explicit decision. Existing P0/P1 and first15 assertions are retained. Shared helpers must not introduce accidental extra file-level Node cases.

Existing P0/P1 owner tests do not exercise the new cross-module Confirmation coordinator, original-event recovery, trusted failure-only transition, client polling or actual Shipment document experience. These22 provide the minimum distinct delivery-slice boundaries; they are not substitutes for the required original large-quantity checks below.

### Finite subscenario budget within those22 cases

A case count alone does not bound execution cost. The following are maximum independent scenarios, not an instruction to create every possible Cartesian combination. Every database scenario uses at most one small SO/Shipment fixture, except the explicitly two-line atomic/browser flows. Fresh fixtures for mutually exclusive terminal states are counted separately. At most two connections/workers are active in any functional scenario. No random repetition, timing distribution or sustained load is included.

| Case | Maximum scenarios / business attempts and explicit boundary |
|---|---|
| LOOKUP-PARENT-ACTIVE | 1 fixture; read active/default/nullable/empty projections, up to3 child choices, zero Confirmation attempts |
| LOOKUP-CHILD-VERSION | 3 small fixtures for stale version, wrong owner and removed purpose; at most1 refused attempt each |
| LOOKUP-HTTP-PERMISSION | 1 fixture; at most6 small HTTP reads for strict input/parent binding/permission changes |
| CONFIRM-INTENT | 2 fixtures; one double-start pair on the same event and one Confirm-versus-Cancel pair, at most4 PhaseA calls total |
| CONFIRM-TERMINAL-WITNESS | 3 fixtures for original FAILED replay after Draft edit, SUCCEEDED replay after later state, and malformed/missing history; at most6 replay/refusal reads; no new Issue |
| CONFIRM-START-ROLLBACK | 1 fixture; exact late audit fault then same-event retry,2 PhaseA attempts |
| ISSUE-ATOMIC | 1 two-line/two-bucket fixture;1 Issue completion plus1 same-event outcome replay; includes zero-picked Line preservation where applicable |
| ISSUE-ROLLBACK | 4 fixtures, one exact failure at each Inventory/Sales/snapshot/audit boundary;1 failed completion per fixture, no retry sweep |
| ISSUE-OWNER-PROOF | 3 fixtures for exact member/source mismatch, forged/foreign transaction receipt, stale owner version; at most1 refused completion each |
| ISSUE-FRESH-GUARDS | 7 fixtures for stale address, stale Contact, Item/Serial rejection, revoked actor, concurrent Inventory adjustment, incompatible Reallocate attempt, and concurrent replacement Create; at most1 Confirmation per fixture and1 competing command where relevant |
| RECOVERY-LEASE | 4 fixtures for native deadlock rollback, native lock-timeout rollback, two-worker expired-lease fencing, and renewal/AbortSignal/shutdown; at most2 worker attempts per fixture. Native lock tests keep the normal transaction budget and use deterministic barriers; shorter session lock-wait timeout is fault injection, not a raised transaction ceiling |
| RECOVERY-OUTCOME | 3 fixtures for post-PhaseA crash, committed result with lost acknowledgement, and genuinely indeterminate rollback/commit; at most2 original-event recovery attempts per fixture; no new event or inferred null→zero |
| RECOVERY-REVOKED-FAILURE | 3 fixtures for trusted failure-only finalization, interrupted failure-recording transaction then recovery, and transient retry exhaustion. At most2 native attempts per fixture; bounded exponential-backoff/jitter/cap/renewal timing is checked with deterministic clocks, not real sleeps or repeated load |
| CLIENT-CONTRACT | 1 deterministic pure scenario covering wire requests, exact weight and rejected malformed responses; zero live writes |
| CLIENT-POLL-LIFECYCLE | 3 deterministic schedules: success, failure and unmount/abort; at most4 mocked status reads each, no new event/automatic Confirmation resubmit |
| CLIENT-ERROR-RECOVERY | 1 pure scenario covering the finite202/409/403/503 status map and preserved input; zero live writes |
| SHIPMENT-INQUIRY-DOCUMENT | 1 two-line fixture; at most8 filter/detail/document reads,1 Confirmation setup |
| SHIPMENT-DOCUMENT-SAFETY | 1 two-line fixture; at most4 reads for unconfirmed refusal, escaped snapshot/filename, exact private/no-store and sensitive-field exclusion;1 Confirmation setup |
| CONFIRM-HTTP-OUTCOME | 2 fixtures: actual successful200 and controlled unfinished202; at most4 command requests total including same-key/event replay/conflict. Assert202 response within the existing3,000ms window; this is a small functional deadline check, not a load benchmark, and a real deadline failure stops for Sam report |
| OPERATION-HTTP-VISIBILITY | 1 fixture; at most6 bounded status reads for original/foreign target, fresh permissions and safe output; no new business effects |
| BROWSER-SHIPMENT-HAPPY | 1 two-line fixture; one cancelled Draft plus replacement,1 successful Confirmation,2 document views; same flow resized at4 widths |
| BROWSER-SHIPMENT-RECOVERY | 3 small fixtures for stale source, revoked access and pending/unknown outcome; at most1 initial Confirm per fixture plus original-event reads, no automatic resubmit; deterministic test boundary for pending state, real running app and network/console validation |

These limits are admission ceilings. A newly discovered mandatory gap outside them requires an updated scope/cost decision; it is not silently omitted or hidden by appending more subtests to an admitted name. Existing TC definitions, including native races, failure-recording interruption, deadlock/lock-timeout and HTTP response limits remain required. Source-level fault injection must be reviewed, narrowly test-owned and absent from production switches.

## Three bounded capacity scenarios — separate from every-PR CI

Propose one local developer verification cycle on the final source/PLAN, outside coverage, using a separately invoked versioned file `server/test-support/fulfillmentP2CapacityGate.mjs` that is not auto-discovered by regular Node CI. The manifest/profile must explicitly register the exact path/command,3 scenario IDs/minimum3/zero skipped before execution. Do not create a new CI job/step or change the PM-owned impact router as part of this proposal.

1. CAP-P2-ISSUE: one SO with100SKU Lines,50 original Reservations per Line,5000 Claims/Allocations,100 Balance buckets. One Confirm business attempt; verify complete Issue/Consume/Sales/Claim/snapshot/operation conservation, document projection and exact original-event replay. Retain each original Reservation identity; no new Reservation generation loop.
2. CAP-P2-ROLLBACK: the same100/50/5000 bound with5000 Balance buckets, one deliberate exact native last-batch fault and one same-event recovery attempt after confirmed rollback. Verify complete before/after facts and all snapshots/audit/receipts; timeout or another guard is never accepted as the intended fault.
3. CAP-P2-UNKNOWN: the same100/50/5000 bound, one confirmed commit followed by a simulated lost acknowledgement and one original-event recovery/lookup attempt. Verify no duplicate effects and complete source-outcome proof. No repeated crash sweep or latency sampling loop.

Maximum three fresh large datasets, four Confirm business attempts (success, intended rollback, recovery success, committed-success/unknown response) and two outcome-only checks (the CAP-P2-ISSUE replay and CAP-P2-UNKNOWN recovery). Required Allocate/Pick setup remains separate transactions under the same original20s ceiling. This is not5000 concurrent users or repeated Reservation creation after the SO fixture is established. Whole-case deadlines include fixture/setup/reconciliation and are not transaction budget increases. Exact datasets and fault boundaries need independent implementation/security review before execution, even after human load approval.

Each whole capacity scenario has a180second test-process ceiling including fixture/setup/reconciliation; the three-scenario cycle therefore has at most9minutes of case execution plus process startup/cleanup. Every individual business transaction still has the original20second limit. A setup Allocation/Pick capacity timeout is also an actual capacity failure and immediately stops the batch; only the exact intentional native injected fault is an expected refusal.

No P95 claim can come from these single attempts. Full production-scale NFR/soak/formal acceptance remains at its approved later gate. A genuine capacity/performance failure immediately stops for Sam report; no automated retry, sampling increase, deadline relaxation or quiet workload reduction.

## Runtime/cost estimate and uncertainty

Measured reference only: admitted Draft6 native cases13.754s,3 HTTP6.818s, first private lookup functional probe is not a capacity measurement. Remaining22 cases are not implemented/measured in full, so the following figures are estimates:

- Additional small native/client/HTTP work under coverage: approximately4–8minutes total test work, including the finite negative/race scenarios above. This supersedes the initial2.5–5minute combined estimate, which had not fully budgeted those mandatory subscenarios.
- Two real Playwright flows: approximately2–4minutes total, including their bounded fixtures and isolated setup/teardown.
- Total regular-CI added work for these22: approximately6–12minutes of summed test/runner work, not a measured bound or guaranteed critical-path increment. At the existing4server shards and existing browser job, scheduling/file redistribution means the actual whole-run increase can be smaller or larger. No new runner/job is requested; the additional billed usage is the additional work on existing runners. Previously observed main5feb fullCI22m03s is historical; latestmain41fb additionally changes existing capacity routing, so neither figure is a measured new-candidate baseline.
- Three separately invoked local capacity scenarios: approximately3–8minutes total including large fixture creation/reconciliation, not additional routine-PR work. Not yet measured; the finite case ceiling is9minutes plus startup/cleanup, and every actual business transaction retains20seconds.

No increase in pool/concurrency/DB resources or input limits is proposed. Keep existing coverage floors. If new high-risk P2 per-file coverage floors are registered, use the existing collected coverage output/checker, without another test run or job. The first admitted candidate must report actual end-to-end CI and slowest shard elapsed times.

### Real browser wiring in the existing step

Latestmain's real Fulfillment browser lane is the existing `server-tests` shard1 step `Run real Fulfillment P1 browser flows on an owned UUID database`; the separate mocked e2e job does not replace this native lane. Its P1 config currently matches only `p1.spec.js` and its raw JUnit requires exactly2 P1 cases. New P2 browser cases therefore need explicit wiring; merely adding a file does not execute them.

This proposal includes coordinating the minimal shared workflow change with the project manager owner, then extending that same existing step to run the existing P1 command unchanged once, followed by a separate `p2.playwright.config.js` command for exactly the2 proposed P2 flows. Use separate owned fixture namespaces and report directories/files. Preserve the original exact2 P1 assertion and separately require exact2 P2 plus zero failure/error/skipped in each raw report; no broad minimum or combined4 assertion may hide missing P1/P2 discovery. Reuse the existing Chromium install, runner and database service; do not add a step/job, rerun P1 twice, modify the capacity impact router or lower coverage. New P2 config/spec stay under the approved module browser path. The2–4minute browser estimate above includes this sequential extra P2 work on shard1, which may directly lengthen its critical path.

## Options

A (recommended): approve only this exact maximum22 additional functional cases for existing regular verification/CI, including the minimal existing browser-step extension and owner coordination above (no new CIjob/step/capacity routing), and the separately invoked three local capacity scenarios once on the final candidate, after independent implementation/runtime review. All original P2 gates remain required; this does not authorize merge or waive existing mandatory CI.

B: approve only22 functional cases; continue source/small-case work, but hold the three capacity scenarios and final P2 completion/draftPR gate until their explicit load approval.

Targeted-local-only alternative: keep these new cases outside regular discovery while performing private minimal functional validation; preserve all existing CI and first15 admitted cases. This avoids their routine-CI cost, but leaves new P2 regular-CI admission and the final complete validation/draftPR gate unresolved; old P0/P1 evidence cannot stand in for new Confirmation behavior.

Trigger scope: the20 regular server/client cases follow existing discovery, and2 P2 browser flows use the explicit existing-step extension above, in ordinary candidate CI. This proposal adds no new path router or scheduling frequency. The three large scenarios are explicit local final-candidate developer checks only. Existing14 Fulfillment capacity cases remain unchanged in latestmain's PM-owned impact-scoped CI job; this request neither adds P2 load to that job nor waives the14. Estimates above are incremental to, and do not include, the first15 or existing required regression/capacity work.

If no option is approved, keep only private minimal functional preparation; do not add these cases to regular CI or run the capacity load. No default admission is inferred from elapsed time or general P2 authority.
