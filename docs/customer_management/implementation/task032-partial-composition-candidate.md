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
is a source-level conclusion, not an executed runtime observation.

## Evidence and limits

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

TASK-032 remains **PARTIAL**. Archive/delete protection, missing-provider
fail-closed behavior and full downstream acceptance **BLOCKED** are preserved.
