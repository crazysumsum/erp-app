# TASK-032 — Partial Customer reference composition candidate

2026-11-05. Local implementation only, based on the PM-selected reader commit
`2abe4015486698ed63f9c7b37aee0bef9ebcfabc`, whose parent is authoritative main
`d65051a3ecf17d95bc7d805e0638d9e2a0266825`. The reader commit is retained as an
ancestor, with no changes to its bytes. See the [source-owner handoff](task032-fulfillment-source-handoff.md).

## Composition and adoption

The new Customer-owned `createCustomerReferenceService` factory uses the existing
`createApplication` / `ServiceContainer` extension point:

```js
import { createCustomerReferenceService } from "../../../server/src/modules/customer/customerReferenceComposition.js";

// In an authorized trusted bootstrap, alongside its other existing options:
createApplication({
  serviceFactories: { "customer.references": createCustomerReferenceService }
});
```

The import above illustrates a repository-relative entry point, not an executable
deployment command. This candidate does not change the normal application entry
point or turn on this factory automatically. An adopter retains its other existing
service factories and options. Without selecting this factory, the existing empty
default and custom `serviceOptions` / overrides continue to behave as before.

The discovery scope must include the original `customer.references` registration.
A same-name `serviceOverrides` entry takes precedence over a factory. If discovery
omits this service, or an override supersedes it, selecting the factory does not
prove this composition was instantiated. Preserve those existing container rules;
adoption must verify the actual selected instance rather than infer it from options.

The selected factory resolves `mysqldatabase` through the same container's existing
async service access, so the real database service finishes initialization before
the reader is constructed. It returns the original `CustomerReferenceService`
class under the existing `customer.references` singleton registration. Startup
observation and actual Customer handlers therefore use the container's one shared
instance, not a second standalone registry. The reader uses that same database
service. No new service registration, dependency, endpoint, pool or configuration
protocol is introduced.

The factory fixes all five descriptors from the TL handoff: `sales`,
`fulfillment`, `returns`, `receivables`, and `payment-refund`. It registers only the
delivered real Fulfillment reader; it does not create placeholders for the four
missing owners. Caller options cannot reduce the required set or substitute a
provider in this factory; the existing timeout option remains available. Existing
registry code consequently yields overall `NOT_READY` / `UNKNOWN` while any of
those owners is missing, even if Fulfillment alone reports zero references. This
was a source-level conclusion at the initial checkpoint; the later scoped native
observation is recorded separately below.

## Initial source-only evidence and limits (historical)

The adopted reader SHA-256 is
`5bfe1ff0dbd222f376b3708393d1c1d158776789ead58704d3566c82cb1868d8`.
Its Fulfillment-owner review and prior SQLite / registry results are source-owner
evidence, not fresh Customer native-MySQL or composition validation. This slice
permits only local source and static checks; no database, app, test case, coverage
run, CI, push or merge is executed. Required coverage and independent review remain
gates before publication, not waived checks. No test, fixture, threshold, workflow,
canonical DESIGN/PLAN input or deployment configuration is changed.

## Named dependencies before enablement

- PM and Fulfillment owner: verify the target environment's four real source tables
  and retained-history scope, then arrange exact source/composition adoption. A local
  reader commit and SQL parse readiness do not prove production historical coverage.
- Customer and TL: agree and implement Customer-root-locked revalidation and the
  matching reference-writer serialization. This slice does not change transactions
  or declare the earlier pre-lock observation safe for destructive writes.
- Sales, Returns, AR and Payment owners: deliver their real compatible providers.
  Sales additionally needs durable historical customer association; current mutable
  draft headers cannot establish that a customer was never referenced.
- Customer / PM / trusted admission administrator: arrange scoped native-MySQL and
  composition validation, preserve all existing functional and coverage gates, and
  obtain applicable approval for test inputs, additional CI and publication.
- Archive open-business rules and full downstream technical/UAT acceptance remain
  separate. No nonfunctional validation runs before relevant UAT.

## Scoped native checkpoint — 2026-11-05

Sam explicitly approved the fixed v4 once, after Inventory, in PM chat
`01a0e71b-fccb-7c81-b9fe-ed817cc58e1f`, human turn
`01a1a96d-bf11-7b80-8f7a-d0712fcffff0`, user message
`01a1a96d-bf5b-70c3-9b4f-5b3bc1290b5a`, question
`call_d0449f49205e4fb0bdf20d1110b038db`. The actual answer was
`批准 v4 一次，排在 Inventory 之後`. Customer directly read that question/answer,
the TL's exact v4 source review and the PM's later actual GO before execution.
That decision authorized this single private functional run, not a new DESIGN/
PLAN baseline, test admission, CI, publication, merge or production enablement.

The unchanged source baseline was `781dd9be1242fe50b0cf8cadeba88e3d1280911d`.
The approved recipe SHA-256 was
`73c235592d3f6f92d6ab98dbf12db8682f1314a449cf4d1ce283c9b4a5fdc981`;
the once key was
`ed792df4308e320aaa733b52906673a472d76e4e536498a25f58e19265503d02`.
The sole execution ran on synthetic isolated MySQL at11:03:55–11:04:01 HKT.
Actual tool session60465/chunkab58ab reported final stdout PASS and exit0.

- Six scoped observations passed: shared initialized native DB; startup and
  actual handlers sharing the original singleton; the explicit native result;
  real archive HTTP refusal; real device/password delete HTTP refusal; independent
  before/after SQL proving no business change.
- Startup retained five descriptors: Fulfillment individually READY, four missing
  owners NOT_READY, overall NOT_READY. Explicit/archive/delete each completed with
  the exact five unique IDs: Fulfillment NO_REFERENCE/0/nonempty watermark, four
  UNKNOWN/null results, overall UNKNOWN. Both HTTP requests returned409 with
  `CUSTOMER_REFERENCE_CHECK_UNAVAILABLE`, tied to their own real completed result.
- One Draft customer remained present, draft/version1; all nine child projections
  and all six checked Sales/Fulfillment/Shipment source tables remained empty.
  Before/after snapshot digests matched; successful lifecycle operations/audits=0.
- Actual caps: fixtureSQL9, observer snapshots8, DB identity1, adminSQL4,
  source readiness4/aggregate3, HTTP2, registry calls3; one app/startup/factory and
  one admin connection. No retry, NFR workload or CI was executed.
- App/observer/admin/log handles closed, active requests and scheduler drained,
  pending0; owned MySQL exited normally0/null signal after its stop request.
  The owned schema was dropped and root removed, with separate filesystem absence
  readback. No forced stop or manual reclaim was needed; PM received actual release.

Private immutable evidence remains under
`/Users/sam/Documents/workspace/erp-app/.worktrees/customer-pm-handoffs/task032-runs/`
with the once key as basename; it is not copied into this PR:

| Evidence | SHA-256 |
| --- | --- |
| `.completion.json` | `bfa7564d2cc2bddb6f017fab120d934a77a9c5ed884371232bc0e06f01e01169` |
| `.result.json` | `1df543844426d387d878be32e3f9ba43c6e7ef625175f6b8848f6cd9a949b9ff` |
| `.jsonl` | `30259b9a1fbe8d710ffb005e9ca5b35666518e95d23db05bd1a5637402837b43` |
| `.once` | `135e8ff47046442a70cb8d76b3b6878042e3827b618da109d20698c6c7a2024d` |

The raw result intentionally stays `PENDING_PROCESS_EXIT`; the completion record
binds the separately observed actual exit0/stdout PASS. A file alone is not the
runtime completion authority. The once remains consumed. Earlier unexecuted recipe
revisions and Required findings are preserved privately, not relabelled as runs.

This closes only the approved native zero-source composition/refusal gap. It does
not measure V8 coverage or native positive/history-movement behavior, production
retention, writer races or all-provider availability. TL requires minimal direct
functional regression for the two new modules before normal CI adoption; exact
cases/test inputs and their admission still require the applicable Sam decision.
Current-candidate full coverage and ordinary CI are unexecuted, not PASS.

TASK-032 remains **PARTIAL**. Archive/delete protection, missing-provider
fail-closed behavior and full downstream acceptance **BLOCKED** are preserved.
