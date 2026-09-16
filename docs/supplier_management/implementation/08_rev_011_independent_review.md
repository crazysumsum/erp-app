# Supplier Management — REV-011 Independent Review of PR #108

## Decision

`APPROVED`

| Severity | Open findings |
| --- | ---: |
| Critical | 0 |
| High | 1 |
| Low | 4 |

The reviewer scoped its approval explicitly: *this candidate loses no history, fabricates no evidence, and may bind design baseline `e4083319`*. It is **not** a claim that the MERGE_READY gate is satisfied. It approved rather than requesting changes because the HIGH is a ledger-accuracy defect fixable in the follow-up commit the author already owed, and because requesting changes would deadlock — `run_check.py --execute` cannot regenerate evidence until an APPROVED review binds `e4083319`.

## Provenance

| Item | Value |
| --- | --- |
| Reviewer | `agent-skills:code-reviewer` — a fresh separate-agent instance, not the REV-007/008 or REV-009/010 instances |
| Author | Claude Opus 5 |
| Method | `SEPARATE_AGENT` |
| Reviewed candidate | PR #108 head `9991187` on `codex/supplier-bookkeeping` |
| Design baseline | `e4083319e526682f70b40a0b2676ae5b50cc72d8f03e9e07c6d6fbb671f211e4` |
| Plan baseline | `a0d41e31d887447d669d0f8252991e43fcdd273eb9eadcbe0d211468092bd154` |
| Authorization | User message on 2026-09-16: 派 reviewer 審 #108 |

## Was any history or authoritative content lost? — No, established from git

The reviewer refused the author's characterization and read the deleted content from history itself.

- Only **two** files were ever deleted. Both are genuine placeholders: `result: BLOCKED`, `exit_code: null`, all five counts zero, empty `cases`, and `limitations` stating the suite was not executed.
- **The decisive check:** each placeholder's `artifacts[].sha256` and `bytes` match the surviving narrative document exactly — `d54bce5e…`/6798 and `8113a5b0…`/2223 — and those documents are byte-identical between `main` and HEAD. Every byte the deleted records pointed at is preserved.
- **Six of the eight removed entries never had a file at all.** `git log --all` shows zero commits ever touching entries `02`–`07` at the doubled path. Their removal removed dangling pointers, not content.
- Reference counts for all eight narrative documents are identical between `main` and HEAD. `00_implementation_readiness.md` did not lose its only anchor — it moved from `evidence_files` into the removal observation.
- `reviews` is byte-identical. `approvals` (23/23), `pending_decisions` (14/14) and `external_actions` (36/36) are strict supersets with every original byte-equal.
- The HD-016 removal observation enumerates all eight paths verbatim, names the bypassed rule, and does not understate the action.

## Is anything still unenumerated? — Yes, one more class

The reviewer grepped every consumer of `baselines()` and traced each. The approval and review enumerations are **provably complete**: executing `approval_valid()` against `main` returns exactly the author's five, and exactly `REV-009` and `REV-010` bound `2dc22f70`. `phase_exception_approvals` and `na_approvals` are both empty, closing off `harness_trace.py`.

The miss is `_observation()` at `harness_checks.py:237-243`, which filters on `spec_baseline == baselines()['plan']`. **0 of 29 observations** now pass — author-confirmed by execution. Two were live at `main`. This is why the scoped PHASE-001 gate returns `CI_MISSING_OR_STALE` ×4 and `PR_REVIEW_MISSING`, neither of which was disclosed.

In fairness, the reviewer noted `_observation()` also requires `code_commit == HEAD`, so the CI observation would be stale from the commit change regardless. The baseline move is one of two independent causes.

## HIGH-1 — the state file affirmatively denied blockers that exist

`00_harness_state.json` `next_safe_action` asserted REV-010's stranding was "the only remaining gate blocker." The reviewer ran the gate. Scoped to PHASE-001 it returns **11 issues across 5 codes**:

```
REVIEW_NOT_SATISFIED x1   COMMIT_CHANGED      x1
REQUIRED_RUN_MISSING x4   CI_MISSING_OR_STALE x4
PR_REVIEW_MISSING    x1
```

The PR body disclosed `REQUIRED_RUN_MISSING` only.

**Failure scenario:** the next agent resumes from `next_safe_action`, regenerates only the run evidence as instructed, re-runs the gate, and is blocked by five undisclosed issues — the exact "missed one more thing" loop this is the third review of.

**Corrected.** `next_safe_action` now lists all five codes, and an observation records the observation-ledger stranding alongside the already-disclosed `run.json` staleness.

## LOW findings

**LOW-1 — the PR body was inaccurate about `defects`.** Nine `risk_approval_id` values *were* rewritten to the `APPROVAL-HD-017-*` equivalents. This is permitted — `state_tool.py:58-60` requires only an ID superset, not field immutability — the superseded approvals are retained, and all nine are MEDIUM/LOW. But the PR body's "every original is retained; none is rewritten" is true of `approvals` and **false of `defects`**. Corrected here and in the PR body.

**LOW-2 — the ledger contradicted itself.** An earlier observation said `evidence_files` "had held six repo-relative paths." It held eight. Superseded by a correcting observation rather than edited.

**LOW-3 — committed evidence embeds absolute paths.** 159 `file=` attributes in the server JUnit XML, and both `run.json` `command` arrays, embed `/Users/sam/Documents/workspace/erp-app-worktrees/supplier-bookkeeping/…`. No secret, but it commits a developer username and local layout and makes the artifact machine-specific. **Not fixed here:** changing the suite contract in `00_project_profile.json` would move the plan baseline again and strand this very review. Recorded as `DEF-014` for a change that is already moving the baseline for another reason.

**LOW-4 — `.gitignore` declaration is Supplier-only.** Supplier is now the only one of eight modules declaring `.gitignore` in `approval_required_paths`. Any other module editing it still gets `OUTSIDE_MODULE` and faces the same baseline-move cost. Recorded as `DEF-015` for cross-module attention.

## Secret scan — clean, and more thorough than the author's

The reviewer scanned all 16 new files (66 KB), dumping every `.log` in full and parsing both XMLs. It searched for passwords, `DB_*`, connection strings (`mysql://`, `jdbc:`), `Authorization`/`Bearer`, JWT-shaped `eyJ…` triples, base64/hex blobs ≥40 chars, `sk-`/`ghp_`/`gho_`/`github_pat_`/`aws_` prefixes, emails, IPs and `UPPER=value` assignments.

**No secret values.** Every hit is a test case name describing security behavior, a sha256 digest, or a source filename. The only `system-err` body is a benign Vue Router warning. Zero emails, IPs and env assignments. It judged the author's report accurate and, if anything, understated in the number of name-only hits.

## Evidence integrity — independently re-derived

`evidence_issues()` on all five records raised only the disclosed `EVIDENCE_SPEC` (stale baseline) and `EVIDENCE_NOT_PASS` on the retained failure. Critically, `REPORT_METADATA_MISMATCH`, `ARTIFACT_TAMPERED`, `EVIDENCE_COMMAND_ACTUAL`, `TOOL_PROBE_MISMATCH` and `TEST_COUNTS` **all stayed silent** — the harness re-parsed the XML, re-hashed every artifact and re-checked argv against the suite contract.

The reviewer then re-ran both suites itself: client `40 passed (40)`, server `pass 159, fail 0, skipped 0` against `erp_dev`, creating and dropping nothing. Exact match to the recorded evidence. **Nothing is fabricated.**

It also confirmed `.gitignore` in `approval_required_paths` is the correct lever: `harness_checks.py:116-121` shows `needs_approval` short-circuits the `allowed_write_paths` check via `elif`, converting `OUTSIDE_MODULE` into a SCOPE-approval requirement, and `check_boundary(ctx,'main')` returns zero issues. `APPROVAL-HD-017-SCOPE` resolves `subject='.gitignore'` → `True`; the superseded `HD-016-SCOPE` → `False`.

## What the reviewer credited

- The removal record as "exemplary" — it names the bypassed rule, lists all eight paths in order, identifies which revisions introduced which entries, states the author's own responsibility for `02`–`07`, and records the placeholders' contents before deletion.
- Registering the `exit 127` lint FAIL rather than dropping it: "registering evidence that indicts your own run is the right instinct."
- The enumeration that *was* done: "I tried to break it against `main` and could not."

## Coverage gaps

- The four PHASE-002/003/004 suites were not run — no evidence exists and they are not required for a PHASE-001-scoped gate.
- The harness scripts were not audited for correctness, only for how they consume baselines.
- The `d0295f10` source fingerprint was not independently re-derived.
- The application was not run and no UI behavior is in scope; the reviewer confirmed from `git diff --name-status` that this change touches no product source, no tests and no schema.
