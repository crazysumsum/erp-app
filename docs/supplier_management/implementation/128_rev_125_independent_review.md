# REV-125 — independent review of the UAT evidence-file change (REV-123 O6)

- **Reviewer:** `agent-skills:code-reviewer` (a separate agent; I did not write this change)
- **Baseline:** branch `claude/supplier-uat-evidence-files` at `90f3e6ff`, reviewed as `git diff origin/main..HEAD` (base `f10107ab`)
- **Verdict:** **APPROVED** (two Optional items and four Nits)

## What the reviewer confirmed

- **Full run:** the full UAT config gives 34 passed and 7 skipped. junit references 63 screenshots, all of which resolve, and holds no account-shaped number.
- **Deleting the original after `attach` is safe.** Playwright 1.63.0 awaits the copy into `attachments/` before it reports the attachment, and nothing reads the original afterwards.
- **A failed test still lists its screenshots.**
- **The PHASE-003 plaintext guards still run before every screenshot.**
- **The check can fail.** With `evidence()` reverted to `attach({ body })`, a run leaves 0 files and 0 references.

## Disposition

| Finding | Disposition |
| --- | --- |
| O1: screenshots from tests ending in `test.fixme` are on disk but not in junit (9 of 72). | The TC map now says so. No code change: junit drops skipped tests' output. |
| O2: a repeated name in one test silently overwrites the earlier screenshot. | `evidence()` now refuses a repeated name. The reviewer's mutant (UAT-001's "detail" renamed "created") fails with `duplicate evidence name: created`. |
| Nit: the ledger's full-run figures were not observed at the commit recorded. | A new observation records a full run at `3047dbd2`: 34 passed, 7 skipped, 63 references, 0 missing, 0 account-shaped strings. The earlier entry is kept. |
| Nit: `baseline.worktree` names an old worktree. | Updated to this branch's worktree. |
| Nit: the alias `screenshot` reads like the `screenshot` option. | Renamed to `captureEvidence`. |
| Nit: junit paths are local to the machine, and `os.tmpdir()` may be purged. | Stated in the TC map. Whether 07 requires the screenshots to be kept elsewhere is a separate question, not raised here. |
