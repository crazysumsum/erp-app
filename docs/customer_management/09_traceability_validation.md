# Customer Management Harness 2.0 Validation Report

## HD-010 approved implementation verification (2026-10-15)

Sam approved the exact DESIGN/PLAN below and scoped executable-profile alignment
and a new local run. Five new regressions failed under the former settings and
passed after alignment; an inclusive-boundary mutation was detected and restored.
Customer/safety regression:260 passed,2 explicit extended-runtime skips,0 failures.
Enabled actual capacity suite:5 passed,1 failed,0 skips; latency PASS,plan FAIL.
Lint and client build passed (existing chunk-size warning only). Historical PR#228
report/JSON bytes are unchanged. No CI setting, product query or index changed.
Formal acceptance and the complete module gate remain blocked; current-candidate
review and required PR CI are still required before test/evidence publication.

## Historical pre-approval amendment validation (2026-10-15)

DESIGN `8462e9c2bc9909f413bb0063de29b44bcbe205d8bfd1209c254ff5d1090f9944`;
PLAN `55ea357b07fb39cc1131b61757b95ca4aa07b246a8dbabfddfecb914e79ba247`.
Actual `render_traceability.py --write` completed; the generated view is unchanged
because IDs/relations are unchanged. `validate_traceability.py --check-approvals`
returned STRUCTURE_PASS; module-boundary comparison against `3faf93e5` returned
LOCAL_CHECKS_PASS; `git diff --check` passed. These checks do not approve the new
DESIGN/PLAN or prove capacity. Independent review approved this documentation-only
amendment; HD-010 remains open. No executable test, runtime or CI execution was
requested by this design-stage change. Historical validation below is not current
approval or retest evidence.

Actual `verify_gate.py --gate PLAN_READY` remains BLOCKED: HD-010 is open,
the revised DESIGN/PLAN have no current human approval and DEF-034001 is HIGH/OPEN.
The generic helper also reports the pre-existing repository-relative evidence paths
as missing because it resolves them again beneath the module root (duplicating
`docs/customer_management/`). The actual referenced files exist; no historical
reference was erased or rewritten to conceal this helper/path-base mismatch.
This amendment does not claim a green PLAN_READY or authorize implementation.

## Baselines

| Item | Observed value |
| --- | --- |
| Module | `customer-management` |
| Mode | `REVIEW_AND_ALIGN` |
| Recovery/mode-entry commit | `0996cb7e85e377981121d2d9b0fd7e99ff8eb1a7` |
| Latest integrated default commit | `46c1235dfd169e15da38e0de1b5ce1818dbabb0d` |
| Reconciled worktree commit before final metadata checkpoint | `e132d6b3b369206b20d8283d67e4c81f04cb6f58` |
| Design baseline | `484247af6f600529bc2cd4c57e1f5d5bc65d4d8f99b781643594d095cda759cd` |
| Plan baseline | `a3d723db8ca0438fd7b4fa4cfa1edd44ff73448736419f4ae85a2238f67f43d1` |
| Source fingerprint | `62ef02ad56115eef399dedb2e8d40c955544eaae1a8bce325fe65a2aab0727e1` |
| State revision | `5` |

## Actual local commands and results

| Check | Result | Scope / limitation |
| --- | --- | --- |
| `render_traceability.py ... --write --json` | `RECORDED` | Regenerated `08_traceability_matrix.md` from the typed ledger. |
| `validate_traceability.py ... --check-approvals --json` | `STRUCTURE_PASS`; zero issues | Formal definitions, typed relations, suite mappings and generated-view equality only; not semantic approval or execution evidence. |
| `state_tool.py inspect ... --json` | `LOCAL_CHECKS_PASS`; zero issues | Current design/plan/source/worktree observations equal state revision 5 before the final documentation-only commit. |
| `validate_module_boundary.py ... --base 46c1235... --json` | `LOCAL_CHECKS_PASS`; zero issues | Against the latest integrated default, all topic changes are within `docs/customer_management/**`; path consistency only. |
| Markdown relative-link check | `LINK_PASS`; zero missing targets | Checks local Markdown file targets; external authority and anchor semantics still require review. |
| No-loss source comparison | `REQUIREMENT_NO_LOSS=true`; `DESIGN_NO_LOSS_WITH_LINK_MIGRATION=true` | Former full bodies match the recovery commit, except the intentionally migrated design link to the surviving canonical in-file section. |
| `git diff --check` | PASS | No whitespace errors. |

## Structural inventory

- Requirements: 100 FR + 15 NFR + 14 SEC = 129.
- Designs: 25.
- Phases: 4.
- Tasks: 36.
- Technical cases: 90, all specifications only; no execution result.
- UAT cases: 59, all `NOT_RUN`; UAT-059 makes control-owner acceptance of cross-cutting NFR/security outcomes explicit.

## Alignment-time gate result (state revision 5)

At state revision 5, `verify_gate.py ... --gate PLAN_READY --json` correctly returned `BLOCKED` for five governance reasons:

1. `HD-001` sensitive-permission delegation decision is open.
2. `HD-002` legal-hold/retention decision is open for destructive purge.
3. No current baseline-bound DESIGN approval.
4. No current baseline-bound PLAN approval.
5. The recorded review is `SELF_REVIEW`, not the required independent review.

This was an honest governance blocker, not a structural failure. At that validation point, no CI, product test, Playwright flow, Technical Acceptance, business UAT, PR, merge or release action was run or claimed. The documentation package was subsequently merged through PR #86 without changing product or test execution status.

## HD-001 decision and technical-gate checkpoints (state revision 8)

On 2026-09-14, Sam accepted HD-001 as Product Owner for DESIGN baseline `484247af6f600529bc2cd4c57e1f5d5bc65d4d8f99b781643594d095cda759cd`. The checkpoint records `APPROVAL-RISK-001` and marks HD-001 answered; it does not claim Security/Backend technical approval.

Post-decision local results:

- `state_tool.py inspect ... --json`: `LOCAL_CHECKS_PASS`; zero issues.
- `validate_traceability.py ... --check-approvals --json`: `STRUCTURE_PASS`; zero issues.
- `verify_gate.py ... --gate PLAN_READY --json`: remains `BLOCKED`; after HD-003 is recorded, the open decisions are HD-002 and HD-003 in addition to missing current DESIGN approval, missing current PLAN approval and missing independent review.
- TASK-020 / PHASE-003 remain blocked by HD-003 pending named Security/Backend technical assurance, independently of Product Owner risk acceptance.

## HD-002 no-purge checkpoint (state revision 9)

On 2026-09-14, Sam accepted the conservative HD-002 disposition as Product Owner: this release excludes automatic destructive purge and crypto-shredding for Customer master data, bank data, attachments and audit records. The existing seven-year minimum remains, while any future purge requires written Legal/Compliance policy and a reopened design gate.

The checkpoint records `APPROVAL-RISK-002` and marks HD-002 answered. It does not represent Legal/Compliance approval or authorize deletion. `PLAN_READY` remains blocked by HD-003, missing current DESIGN approval, missing current PLAN approval and missing independent review.

## Product Owner DESIGN approval checkpoint (state revision 10)

On 2026-09-14, Sam directly approved all Product Owner design approvals for exact DESIGN baseline `484247af6f600529bc2cd4c57e1f5d5bc65d4d8f99b781643594d095cda759cd`. The checkpoint records `APPROVAL-DESIGN-001` and does not claim PLAN approval, independent review or Security/Backend technical assurance.

After this checkpoint, `PLAN_READY` remains blocked only by HD-003, missing current PLAN approval and missing independent review.

## Final human approval and planning gate (state revision 12)

On 2026-09-14, Sam explicitly approved the exact PLAN baseline `a3d723db8ca0438fd7b4fa4cfa1edd44ff73448736419f4ae85a2238f67f43d1`, the independent HUMAN design review and HD-003 Security/Backend technical assurance. State history preserves REV-001 `SELF_REVIEW` and adds REV-002 `HUMAN`; it does not rewrite reviewer provenance.

The state machine first recovered `BLOCKED -> DESIGNING` at revision 11. With all decisions answered, current DESIGN/PLAN approvals and REV-002 recorded, `verify_gate.py ... --gate PLAN_READY --json` returned `LOCAL_CHECKS_PASS` with zero issues. Revision 12 then transitioned to `PLANNED`.

This completes the planning governance gate for the exact recorded baselines. It is not implementation, test, CI, UAT, release or deployment evidence; entering `IMPLEMENT` remains a separate explicit mode authorization.

## Publication authorization (state revision 13)

On 2026-09-14, the user explicitly authorized pushing `codex/customer-hd001-risk-acceptance`, creating a PR to `main` and merging it. State records separate `PLANNED` push, PR and merge actions with idempotency keys. This authorization publishes planning-governance documents only and does not start `IMPLEMENT`.

The branch push was confirmed and PR #87 was created against `main`; GitHub reported the PR `OPEN` and `MERGEABLE` before the authorized merge attempt.
