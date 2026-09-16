# Supplier Management — REV-010 Independent Re-verification of PR #107

## Decision

`APPROVED`

| Severity | Open findings |
| --- | ---: |
| Critical | 0 |
| High | 0 |

Supersedes `REV-009` for gate purposes. This is the review that binds design baseline `2dc22f70`.

## Provenance

| Item | Value |
| --- | --- |
| Reviewer | `agent-skills:code-reviewer` — the same fresh instance that produced `REV-009`, resumed with its own context |
| Author | Claude Opus 5 |
| Method | `SEPARATE_AGENT` |
| Reviewed candidate | PR #107 head `38acd73` on `codex/supplier-contract-pin` |
| Design baseline | `2dc22f70754ee9fe3f880cec40b2408c2c7cd3c3dcf48875f1a856a3d3138743` |
| Plan baseline | `14cb9ebc0d6e954ae7cc266cd3ed8882a00c01cbb10bc75992049036469c3574` |
| Authorization | User messages on 2026-09-16: 派 reviewer 審 #107, and a批準，b補一個 risk approval |

The reviewer re-derived each item rather than reading the author's summary.

## HIGH from REV-009 — resolved

The reviewer executed `approval_valid()` against the worktree rather than reading the JSON. All nine deferrals return `True` with `subject=<defect id>`: `DEF-003`…`DEF-008`, `DEF-010`, `DEF-011` → `APPROVAL-HD-015-RISK`; `DEF-012` → `APPROVAL-HD-015-RISK-DEF012`. Zero failures.

Both new records satisfy every clause in `harness_core.py:317-348` — `kind=RISK` with `baseline_kind=PLAN` as the `expected_kind` rule at line 327 requires, `baseline_sha256` equal to the current plan baseline, non-empty `source_ref`, `actor` outside the rejected set, and scope containing each defect id so the `subject` check at line 345 resolves.

**Nothing was rewritten.** Structural diff of `b0855a8` → `38acd73`: approvals 21→23, reviews 8→9, pending_decisions 13→14, evidence_files 6→7, with **zero removals or mutations**. `APPROVAL-HD-012-RISK`, `APPROVAL-HD-013-RISK` and `REV-008` all compare byte-identical and correctly still return `valid=False` — superseded, not falsified.

### The two-record split was endorsed

The reviewer stated it would have objected to merging them:

> Folding a new authorization into "re-affirm what you already approved" is exactly the consent-laundering this harness exists to prevent.

`HD-015-RISK` changes nothing about any defect and names the retained originals in its `source_ref`. `HD-015-RISK-DEF012` creates authorization that never existed.

### The DEF-012 authorization was checked for honesty

The reviewer confirmed it forecloses the "green means fixed" misreading, singling out the sentence stating that its CI re-run passes prove intermittency, not correctness. It verified the boundary claim by fnmatch — `server/src/services/idempotency/**` and `server/src/modules/item/**` are both outside `allowed_write_paths` — and confirmed the technical description matches `IdempotencyService.js:234-240` against the failing assertion at `itemCreate.integration.test.js:946`.

## MEDIUM from REV-009 — corrected statement verified as correct, not merely different

Every claim in the rewritten `DEF-013` was checked independently:

- `SKU_REFERENCED` is a real code at `server/src/modules/item/itemErrors.js:303` (`ITEM_REFERENCED` at 295), so naming it is accurate rather than invented.
- Zero call sites for either, confirmed again.
- `ER_ROW_IS_REFERENCED_2` handling exists at exactly one place in `server/src`: `ItemCatalogService.js:53`, the catalog path. `ItemAdminService.deleteSku` (1410) and `deleteItem` (1001) have none — so "surfaces as an unmapped driver error instead of `SKU_REFERENCED`" is right.
- The §5.11 no-`item_uoms` point and the §8.4 pre-existing-obligation provenance both hold.

The reviewer judged the added `item_sku_uoms`-row path — the case with no description path at all — to be the sharper version of the defect.

## Question 4 — is anything else stranded by the baseline move?

**Nothing.** The reviewer enumerated what is actually baseline-bound rather than guessing:

- **Approvals** — `has_approval(DESIGN)` and `(PLAN)` satisfied by HD-014; all RISK now valid. The SCOPE approvals (`HD-005-SCHEMA`, `HD-006-ERP-DEV`, both `SHARED-PATHS`, `HD-007`/`HD-008-SCOPE`) return `valid=False`, **but were already stale at `main`** — bound to `94a87f42` / `24cdb1e9` / `db1bdd80` / `b75280ba`, none of which was ever `d54764e4`. Pre-existing, not caused by this move. Recorded for separate handling.
- **`runtime.lease_ref`** — the only other structural approval reference. `harness_checks.py:145` tests it for truthiness only and never calls `approval_valid()`, so its stale HD-006 binding produces no gate failure. Pre-existing either way.
- **Run evidence** — `evidence_issues` (line 151) and the `REQUIRED_RUN_MISSING` filter (line 353) both key on the plan baseline, so this was the candidate most likely to bite. It does not: no `run.json` exists under `docs/supplier_management`, and running the gate against a `main` checkout produces an identical `REQUIRED_RUN_MISSING` and `EVIDENCE_INVALID` set. Vacuously unaffected, and already disclosed as the `evidence_files` bookkeeping bug.

The clean before/after: `main` shows `CONTRACT_DRIFT` and no `REVIEW_NOT_SATISFIED`; the branch shows the reverse. Exactly the disclosed trade, with nothing else moving.

## Recording this verdict cannot re-strand the baselines

The reviewer pre-empted a repeat of the episode that started this: it flipped `REV-009` to APPROVED in a scratch copy and recomputed. **Both baselines are unchanged** — `Context.baselines()` excludes state by design, per the comment at `harness_core.py:306`. Recording an APPROVED verdict therefore cannot invalidate `HD-014` or `HD-015`.

## Merge preconditions stated by the reviewer

1. As committed at `38acd73`, no APPROVED review bound `2dc22f70`, because `REV-009` was recorded `CHANGES_REQUESTED`. **This document and its state record are that commit.**
2. CI was 3/4 with the MySQL integration job still pending at review time. Green CI on the exact final head remains required.

## Residual nit — corrected

The rewritten `next_safe_action` had dropped the sentence "DEF-013 must be resolved as part of TASK-038" that revision 82 carried. The linkage survived in `DEF-013.source_ids`, but the prose pointer is restored.

## Coverage gaps

- The application and test suites were not run — correctly out of scope for a documentation and bookkeeping change.
- The human approval message was not independently authenticated beyond its recorded transcription.
- The reviewer did not wait for the pending CI job.
- The pre-existing SCOPE-approval staleness and the two cross-module drifts (Purchasing pinning Supplier's provided contract at `983f351f` against Supplier's actual `a9f64493`; `permission-catalogue` drifted in four manifests) were not audited. All three are on the record for separate handling.
