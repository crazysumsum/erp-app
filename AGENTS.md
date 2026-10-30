# Project agent rules

## CI test admission — Sam's instruction, 2026-10-30

Before adding ANY test case to routine CI, explain the proposal to Sam and obtain
his explicit approval. This applies to every agent and to unit, integration,
browser, regression, performance and capacity tests. Adding a test to an existing
file or an automatically discovered glob counts, even without a workflow change.
New test jobs/steps and increases in data, concurrency, samples or execution
frequency also require approval before inclusion.

Present one consolidated proposal with:

- The business risk and the gap in existing coverage; why existing evidence is insufficient.
- The cases, data volume, concurrency, repetitions and acceptance thresholds.
- The trigger scope: every PR, affected paths, scheduled or pre-release.
- Estimated case/job duration, effect on the CI critical path and runner cost.
  Label estimates and unknowns honestly; do not run an unapproved load to estimate it.
- Alternatives, including reusing evidence or targeted local validation, and a recommendation.

Record Sam's actual decision and its approved scope in the relevant task/PR.
General feature authorization, TDD conventions, coverage requirements, another
agent's recommendation or silence do not constitute approval. Reuse an explicit
approval for the same scope; do not repeatedly ask for it or invent approval text.
While approval is pending, continue independent authorized work and use private
minimal functional reproductions outside CI discovery where useful.

Performance/capacity execution also requires Sam's prior approval of the content
and scale, including local runs and CI triggered indirectly by a push or PR.
On an actual performance/capacity failure or timeout, stop that validation batch
and explain the scenario, scale, measured result and reason to Sam before retrying
or changing the test. Do not treat an intentional fault-injection assertion as an
actual performance failure.

Preserve existing cases, assertions, coverage floors, CI and necessary review.
Do not delete/skip tests, reduce workload or relax thresholds merely to save time.
Sam has authorized separating existing large capacity cases into impact-scoped
jobs while retaining routine correctness/transaction/permission regression and
unchanged gates. Routine PR checks must contain no performance/capacity workload.
Run existing capacity only when a verified diff changes the case, its fixtures,
or its actual dependencies; shared runtime changes can select multiple scopes.
Apply this rule to main pushes too. Scheduled/manual execution is not permission
for an unconditional sweep: require a related-change baseline, otherwise run only
routine checks. Unknown paths/history must report unresolved impact, not silently
run all capacity or claim that a required workload passed.
Use the single CI capacity catalog for routine exclusions and affected-case
selection. Keep ordinary cases in mixed files and all coverage floors. This
direction does not approve other pending new workloads or dormant opt-in suites.
