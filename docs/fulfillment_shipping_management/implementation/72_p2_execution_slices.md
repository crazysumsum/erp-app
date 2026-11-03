# P2 execution slices and evidence preparation

Status: engineering preparation, not implemented or verified. Authority: current Sam P2 instruction; approved PHASE-003 TASK024–033. Exact entry main5febef80; its postmerge CI41004788896 all13 jobs actuallySUCCESS. No P2 PR yet.

## Ordered slices

1. TASK024–025 / Checkpoint2A: strict Draft CRUD and source-owned Address/Contact lookups; actual picked complete saved source, Fulfillment→Shipment lock order, active pointer/unique effective FK, operation replay, no Inventory/Sales DML. Validate complete saved Lines including zero-picked short lines; no free-text address or premature snapshot. Weight contract HD025 awaits actual decision. Native concurrent Create, Cancel/Create, stale child versions, wrong Customer/purpose/inactive/no address, atomic rollback and current projection errors.
2. TASK026–028 / Checkpoint2B: Phase A durable SHIP intent then Phase B. Preserve actual approved RC metadata checks and Inventory operation preclaim ordering before Sales roots; full saved source reread under locks/CAS is mandatory. Phase B atomically posts exact Issue batch, applies same-transaction Inventory receipt to Sales, consumes Claims, snapshots and marks SHIPPED. Permanent rejection only after proven full rollback, using a separate CAS failure-recording transaction. Unknown commit remains recoverable. New HTTP202 3second response boundary must not detach unowned work or raise20second DB timeout.
3. TASK029–030 / Checkpoint2C: bounded cluster lease recovery using original event/hash/initiated actor/target, no new event; atomic expiry takeover, abort, retry/backoff and no competing worker. Recovery recomputes immutable intent from durable operation identity and frozen SHIPPING fields with exact hash verification. Confirm outcome lookup uses actual source outcome before inferring success/failure. Shipment inquiry and document projections must be bounded and explicit; only confirmed snapshots may enter Delivery Note.
4. TASK031–033 / Checkpoint2D: client request parity, bounded same-operation polling/unmount abort, Draft list/form/cancel/recreate, Confirm summary/unknown states, private no-store A4 documents. Real Playwright happy/error/stale/permissions/refresh/responsive/console/network evidence required. No client eligibility/stock calculations; no P3 mutation entry.

## Developer evidence contract work

Retain all existing P0/P1 suites and thresholds. Before executing P2 suites, enumerate actual test files/case IDs and reviewed deterministic commands, minimum discovered cases, zero forbidden skips, isolated runtime ownership, JUnit uniqueness and raw preservation. Existing generic fulfillment-technical profile is a historical broad server/test command with formal TC IDs; it cannot be claimed as adequate new P2 DEVELOPER evidence without verifying actual discovery. Add explicit native P2 and real P2 Playwright coverage through normal reviewed profile/traceability updates; do not weaken existing contracts or relabel older results. Native fixture namespaces must obey current safety guard, original MySQL26.7/pool/20s settings and restricted owned schema credentials.

Failure evidence must distinguish intentional exact native fault rollback from timeout/other rejection; timeout is never a valid fault proof. Keep full100lines/50members-per-line/5000 members where applicable, exact set/quantity/ID/CAS checks and all original safety/coverage. Any genuine capacity/performance failure stops execution for user report, with no retries or threshold changes. Do not automatically rerun P0/P1 same underlying collection twice under two suite labels.

## Publication boundary

All10 tasks, checkpoints, independent owner/source/test review, full developer validation and exact published-candidate mandatoryCI must pass before draftPR creation. Re-fetch main and review integration impact at final freeze. No P2 merge, production migration, deployment or formal UAT sign-off is implied by draftPR authority.
