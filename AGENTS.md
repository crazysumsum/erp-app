# Project agent rules

## Operating scale and decision authority — Sam's instruction, 2026-11-04

Design for a mid-sized e-commerce company processing 500–1,000 orders per day
with at most 20 users. Use these figures for all architecture and implementation
decisions. Prefer the simplest design that meets the business requirement. Add
complexity only when a concrete requirement or observed bottleneck justifies it.

Sam has delegated architecture and technical decisions to the project technical
lead and system architect. Route cross-module technical questions to the lead.
If you cannot resolve a technical issue, Sam authorizes you to message the
`Tech Lead & architect` chat (`01a1a418-5ea4-7ea0-86f1-f678f614682c`) directly
for a decision. Include the blocker, what you tried and the decision you need.
Bring decisions with a material business impact to Sam before proceeding, with
the options, impact and recommendation. Examples include changing how orders are
fulfilled, when stock is committed, or what costs the business must take on.
Follow the explicit approval requirements below for CI and capacity testing.

## Temporary suspension of per-case test admission — Sam's decision, 2026-11-19, extended 2026-11-24

In force from 2026-11-19 until production go-live, planned for mid-December
2026. It ends when Sam declares go-live complete; then the section below
applies again in full unless Sam decides otherwise. On 2026-11-19 the PM asked:
「是否暫停逐案測試准入 7 天，功能測試改為普通 PR 加功能 CI 加一次評審？」 Sam
answered: 「暫停 7 天」. On 2026-11-24 the PM asked: 「逐案測試准入的暫停（11-26
日終到期）是否延續到正式上線？」 Sam answered: 「延續到上線」.

During this period, adding or changing functional tests (unit, integration,
browser, regression) needs no per-case proposal to Sam and no per-case approval
record. Merge on an ordinary PR, green functional CI and one review by someone
other than the author.

Unchanged: performance and capacity tests still need Sam's prior approval of
content and scale before execution or inclusion; routine CI contains no capacity
workload; do not delete or skip tests, reduce workload, or relax thresholds or
coverage floors. Only the CI administrator changes the admission gate, its
policy hashes or Actions variables. If the gate blocks a PR, contact the CI
administrator; do not work around it.

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
Finish feature implementation and affected functional regression, coverage,
CI and review, then arrange merge. Defer all non-functional validation until
the relevant feature has completed UAT, both locally and in CI. Record deferred
cases, workload, thresholds and owner for the post-UAT handoff. Keep functional
authorization, transaction integrity, idempotency and recovery checks in PRs.
Routine PRs, main pushes and schedules are functional only. After UAT, run
capacity only on main by explicit dispatch with a verified related-change
baseline and an external grant for the accepted revision and individual cases.
Unknown paths/history or unrelated grants block that post-UAT request.
Use the single CI capacity catalog for routine exclusions and affected-case
selection. Keep ordinary cases in mixed files and all coverage floors. This
direction does not approve other pending new workloads or dormant opt-in suites.

CI enforces this policy before executing PR tests. Follow
[the admission procedure](docs/ci-test-admission.md) for changes to tests,
fixtures, data, workers, discovery or CI wiring. Keep Sam's verified decision
with the exact workload and approved file versions. Only the trusted approval
administrator may publish its digest outside the PR. A feature agent must not
approve its own receipt, add a test-triggering workflow, modify admission
variables or dispatch around the controller. Reuse matching receipts.
