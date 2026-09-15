# Sales Order Management Independent Design Review

## 0. Reviewer provenance

| Field | Value |
| --- | --- |
| Initial `review_method` | `SELF_REVIEW` by the v1 alignment agent; retained as historical review `REV-001` |
| Independent `review_method` | `HUMAN` |
| `author` | Legacy design authorship is not authenticated in repository metadata; the Harness 2.0 canonicalization was performed by the alignment agent |
| `reviewer` | Sam (ERP Product Owner), identified in this session |
| `reviewed_baseline` | File `03_design_spec.md` sha256 `f68844a0bf8238fdd90ce3be6392fc489fd5d44973f87a77780880f0e1275107`; binding harness composite design baseline `20cdd2410c9d7804aa2b287b4d74930602f2a00b0247c907c738632f48b5b95e` |
| Independent review | Completed and approved as a planning baseline on 2026-09-15 (`APR-DESIGN-001`) |
| Product implementation / tests | Not performed; no PASS claimed |

## 0.1 Review result

`APPROVED` as a planning baseline by human independent reviewer Sam on 2026-09-15. This approval covers the design as a
basis for planning and estimation only. It does **not** authorize entry to `IMPLEMENT`, test execution, UAT, Go-Live or
release, and it does **not** accept the five open `HIGH` findings on behalf of Product, Inventory, DBA, Security or
Operations — those remain `OPEN` and are tracked as `DEC-001`–`DEC-004` in `00_harness_state.json`.

## 1. Gate Summary

| Item | Result |
| --- | --- |
| Review perspectives | Principal/Solution Architecture, Security, Database, SRE/Operations, Senior Engineering, QA/Test |
| Open CRITICAL | 0 |
| Open HIGH | 2 (`DR-001`, `DR-002`) |
| Open MEDIUM | 0 |
| Gate status | **CONDITIONAL** |
| Meaning | Architecture is coherent for planning. The two remaining HIGH findings are genuine external dependencies on the Customer and Inventory modules, which do not exist in code. Implementation is authorized only for the scope that does not touch them. |

## 2. Architecture Summary and Major Trade-offs

The design chooses a modular monolith and shared MySQL transaction boundary, durable operation rows instead of a message broker, polling/leases for recovery, Active/Archive tables in the same instance, and explicit provider contracts. This fits the existing codebase and avoids speculative distributed infrastructure, but it concentrates correctness in contract ownership, global lock order, migration discipline and production-like MySQL tests.

## 3. Findings

### DR-001 — Required upstream providers do not exist on inspected main

- Severity: `HIGH`
- Related: FR-023–026, FR-043–061, FR-121–140; DES-003, DES-005, DES-017
- Evidence: repository inspection found no Customer, Inventory or Fulfillment module/provider implementation; Sales design names them as hard gates.
- Impact: snapshots, ATP, Reservation/Release and archive open-matter decisions cannot be implemented safely.
- Recommended action: approve versioned provider contracts, owners and contract tests before affected Phase entry.
- Disposition: `OPEN`

### DR-002 — Cross-module atomic transaction and lock order lack owner proof

- Severity: `HIGH`
- Related: FR-049–061, FR-062–075; DES-004, DES-005
- Evidence: batch Inventory methods/global lock order exist only in the proposed design.
- Impact: mismatched ownership or lock order can cause partial commitments, deadlocks or duplicate releases.
- Recommended action: Inventory owner and DBA review; prove two-client barriers, deadlock handling, rollback and commit-unknown recovery on real MySQL.
- Disposition: `OPEN`

### DR-003 — Planned 50 MB upload contradicts current in-memory implementation

- Severity: `HIGH`
- Related: FR-076–095; NFR-004/005/008; DES-010
- Evidence: current upload middleware collects all chunks into a Buffer and then concatenates before disk write.
- Impact: memory use scales with file size/concurrency; enabling Sales limits before foundation can exhaust the Node process.
- Recommended action: deliver opt-in disk-stream mode with bounded prefix validation, safe temp paths, abort/orphan cleanup and process-wide budgets before Sales CSV route.
- Disposition: `RESOLVED` — accepted 2026-09-15 by Sam (ERP Product Owner) as an implementation obligation, not an open external risk.
- Closure basis: the opt-in disk-stream design is approved as specified and is delivered by `TASK-002`–`TASK-005`. Proof is bound to mandatory `TC-004` (50 MB disk-stream memory bound), `TC-005` (traversal/symlink/type/size defense) and `TC-006` (abort/concurrency/orphan recovery). This becomes a `PHASE-001` exit criterion; the Sales CSV route must not be enabled before those cases pass on the candidate.

### DR-004 — Fresh authorization is not yet a Sales invariant in executable code

- Severity: `HIGH`
- Related: SEC-001–004, SEC-013; DES-013
- Evidence: JWT includes permission claims; fresh checks exist in selected admin services, but Sales commands/workers do not exist.
- Impact: revoked/disabled actors could otherwise continue sensitive operations or queued imports.
- Recommended action: common command-level helper used inside each Sales transaction; preserve initiating actor and reauthorize before every new business effect.
- Disposition: `RESOLVED` — accepted 2026-09-15 by Sam (ERP Product Owner) as an implementation obligation, not an open external risk.
- Closure basis: the common command-level fresh-authorization helper is delivered by `TASK-006` and proven by mandatory `TC-008` (fresh actor after revocation), with `TC-003` covering the permission catalogue and route matrix. This becomes a `PHASE-001` exit criterion. No external owner or module is required to close it.

### DR-005 — Source plan is based on a stale, untracked baseline

- Severity: `HIGH`
- Related: DES-018; PHASE-001
- Evidence: source branch is 13 commits behind current `main`; four source documents and this package are untracked; current migrations reach `0024`.
- Impact: migration sequence, paths and dependency assumptions may be wrong when implementation starts, and documents can be lost.
- Recommended action: commit the documentation, then create each implementation Phase from latest main and redo readiness/migration discovery before coding.
- Disposition: `RESOLVED` — closed 2026-09-15 by Sam (ERP Product Owner) on observed evidence.
- Closure basis: the documentation is no longer untracked or stale. The full canonical package was committed and merged to `main` at `d6b03f9`, so the loss risk is gone and Git history is the recovery point. The migration sequence has since advanced from `0024` to `0027`, which is exactly why re-discovery is `TASK-001`'s job and is proven by mandatory `TC-002` (fresh/upgrade migration proof). Each implementation Phase still starts from a freshly fetched `main` per the branch policy.

### DR-006 — Production workload distribution is assumed

- Severity: `MEDIUM`
- Related: NFR-001–007; DES-019
- Evidence: average 5/P95 20 lines and traffic shape are design test assumptions, not measured business data.
- Impact: capacity/index conclusions may be optimistic or wasteful.
- Recommended action: obtain anonymized distribution/peak rates or explicitly approve synthetic baseline before performance acceptance.
- Disposition: `RESOLVED` — synthetic baseline approved 2026-09-15 by Sam (ERP Product Owner).
- Closure basis: the existing assumptions are approved as the **approved synthetic performance baseline** for acceptance: average 5 lines / P95 20 lines per order, 10,000 SO/day, 24 months and 7.3 million Active headers (`NFR-001`–`NFR-007`). `TC-044`–`TC-055` generate test data to this shape. This is explicitly a synthetic baseline, not measured business data: if anonymized production distribution later becomes available and differs materially, the capacity model and performance acceptance must be re-run against it.

### DR-007 — Channel transport security and address handoff are deferred

- Severity: `MEDIUM`
- Related: FR-096–108; SEC-003/010; DES-011
- Evidence: no public route/auth mechanism or Fulfillment address contract is selected.
- Impact: no real platform Adapter can safely go live.
- Recommended action: keep core contract-only scope; reopen architecture/security gate for the first Adapter.
- Disposition: `RESOLVED` as a scope boundary — recorded 2026-09-15 by Sam (ERP Product Owner).
- Closure basis: Sales scope is **canonical Channel Intake only**. `FR-096`–`FR-108` and `DES-011` specify the internal canonical contract; no public route, no platform-specific transport authentication and no Fulfillment address handoff are in this baseline. No real platform Adapter may go live under this approval. The first Adapter requires a separate architecture and security gate with its own requirement/design change, and real Adapter UAT is explicitly outside the current planning baseline.

### DR-008 — Archive eligibility depends on future open-matter providers

- Severity: `MEDIUM`
- Related: FR-123/124/140; DES-003, DES-017
- Evidence: Fulfillment/Invoicing/Returns open-matter contracts are not implemented.
- Impact: treating missing as clear could archive an active business aggregate.
- Recommended action: fail closed and keep archive enablement disabled for integrations whose provider is absent/UNKNOWN.
- Disposition: `RESOLVED` — fail-closed accepted 2026-09-15 by Sam (ERP Product Owner).
- Closure basis: absent or `UNKNOWN` open-matter providers are treated as "not clear to archive", never as "clear". Archive enablement stays disabled for any integration whose provider is absent or `UNKNOWN`, so a missing Fulfillment/Invoicing/Returns contract can never cause an active business aggregate to be archived. Enabling archive for a given integration requires that provider to exist and is a separate `PHASE-005` decision.

### DR-009 — Shared-instance Archive has limited failure isolation

- Severity: `MEDIUM`
- Related: NFR-010, NFR-014–016; DES-001, DES-017, DES-020
- Evidence: Active and Archive tables share one MySQL instance.
- Impact: instance failure affects both tiers; RTO/RPO depends on one backup/recovery domain.
- Recommended action: accept simplicity only after timed recovery proof; monitor size/lock pressure and retain a migration path if evidence misses targets.
- Disposition: `DEFERRED` to `PHASE-005` acceptance — recorded 2026-09-15 by Sam (ERP Product Owner).
- Closure basis: shared-instance Active/Archive simplicity is not accepted up front. It is accepted only on the evidence of the timed recovery exercise in `TC-056`–`TC-060` meeting `NFR-014` (RTO <= 4h) and `NFR-015` (RPO <= 15m). Size and lock pressure are monitored, and a migration path to a separate instance is retained if the evidence misses those targets. This is a `PHASE-005` acceptance condition, not a `PHASE-001` entry condition.

### DR-010 — UAT catalogue is large and mixes operational actors

- Severity: `MEDIUM`
- Related: UAT-001–129
- Evidence: 129 cases include business UI, security, performance and recovery activities.
- Impact: business sign-off could be delayed or confused with engineering evidence.
- Recommended action: retain all cases, execute P0/P1 business scenarios by Phase, and treat OPS/infra evidence as Technical Acceptance prerequisites rather than fabricated business sign-off.
- Disposition: `RESOLVED` by split specifications

### DR-011 — Measurable RTO/RPO were absent

- Severity: `MEDIUM`
- Related: NFR-014, NFR-015; DES-020
- Evidence: original documents required backup/restore without objective recovery targets.
- Impact: DR acceptance was subjective.
- Recommended action: define measurable targets and timed restore cases.
- Disposition: `RESOLVED` — user approved RTO <=4h/RPO <=15m on 2026-09-10

### DR-012 — Broad future scope is correctly excluded

- Severity: `LOW`
- Related: requirement §2.2, design §0.4
- Evidence: tax, discount, approval, multi-warehouse, fulfillment execution, invoicing/payments/returns and purge are explicitly excluded.
- Impact: avoids hidden complexity; later introduction requires formal requirement/design change.
- Recommended action: preserve scope-change controls.
- Disposition: `RESOLVED`

## 4. Human Design Gate

- Gate status: **CONDITIONAL — scoped implementation authorized**.
- No unresolved CRITICAL finding exists.
- `DR-003`, `DR-004` and `DR-005` were re-dispositioned on 2026-09-15: they are implementation obligations bound to mandatory technical tests, not open external risks. `DR-006`, `DR-007` and `DR-008` were resolved as approved baselines or scope boundaries, and `DR-009` was deferred to `PHASE-005` acceptance evidence.
- `DR-001` and `DR-002` remain `OPEN` and are genuine external dependencies: the Customer, Inventory and Fulfillment modules do not exist in `server/src/modules/` on `main` at `d6b03f9`. This review still does **not** accept those risks on behalf of Product, Inventory, DBA, Security or Operations.
- Scoped authorization: `PHASE-001` `TASK-001`–`TASK-008` may be implemented, because none of them depends on a missing provider. `TASK-009` (Customer/Item provider contracts), `TASK-010` (Inventory batch reserve/release) and the `PHASE-001` exit gate remain **blocked**, as do `PHASE-002`–`PHASE-005`.
- No provider contract code may be written against a module that does not exist.

## 5. Harness 2.0 alignment note

This document was brought to the Harness 2.0 canonical set on 2026-09-15. The findings `DR-001`–`DR-012`, their
severities and their dispositions are unchanged from the v1 review; only reviewer provenance, the reviewed baseline and
the human gate record were added. The gate remains `CONDITIONAL` for implementation entry: planning and estimation may
proceed, and implementation of an affected Phase stays blocked until that Phase's entry criteria are met.
