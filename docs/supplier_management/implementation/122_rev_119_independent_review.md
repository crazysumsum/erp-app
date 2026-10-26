# REV-119 — independent review of submitting from the detail and withdrawing there (DEF-042, DEF-043, HD-138 A)

- **Reviewer:** `agent-skills:code-reviewer` (a separate agent; I did not write this change)
- **Baseline:** branch `claude/supplier-def042-043` at `c0f8748c`, reviewed as `git diff origin/main..HEAD` (base `78d1e3ee`)
- **Verdict:** **CHANGES_REQUESTED**
- **Open Critical / High:** 0 / 0. One Medium, four Low, several Info and nits.

## What the reviewer confirmed

- **Suites:** server 724 passed (0 skipped); client 199 passed; technical Playwright 50 passed.
- **UAT PHASE-002:** the rewritten copy passed 9 of 9 against this branch.
- **Browser probe:** the reviewer's own 10-case probe passed.
  - Archive and reactivate show no approver with approval on.
  - SYSTEM-ADMIN, who is not the requester, gets no withdraw button and the API refuses it (409 `APPROVAL_NOT_REQUESTER`).
  - A stale version after a reassignment gets 409 and recovers after a reload.
  - The list page can now submit for approval too.
- **Consistency:** every detail path goes through `getSupplier`, so `pendingApproval` appears on all of them.
- **Exposure:** a VIEWER sees exactly the decided fields (no request note, summary or decision data). The schemas are closed.
- **Mutants:** 12 of 21 were killed. Of the 9 survivors, three are equivalent:
  - S1: dropping the status filter (one pending request per Supplier is enforced by a unique key).
  - S4: running the query for every status (the status gate is only an optimisation).
  - C6b.

## Disposition

The standing instruction is to fix every review finding as recommended.

| Finding | Disposition |
| --- | --- |
| M-1: no test pinned which request the detail returns once a Supplier has more than one. Mutant S2 ("oldest request, any status") survived. If it regressed, a withdraw would replay the old request and report success while the Supplier stayed pending. | The DEF-043 integration test now withdraws, resubmits to another approver, and expects the new pending request (not the first one). It then withdraws again with the returned values and expects Draft. S2 is red. |
| L-1: the dialog did not recover when the policy changed or failed to load while it was open. | On `APPROVER_REQUIRED` / `APPROVER_NOT_REQUIRED` the dialog clears the approver and remounts the panel, which reads the policy again. Tested; the "no re-read" mutant is red. |
| L-2: confirm was enabled before the policy was known. | Activation cannot be confirmed until the panel has reported the policy. The panel now reports a failed read as `null`, and the server then decides. Tested; the mutant is red. |
| L-3: approver errors did not show on the approver field. | An error with `details.field === "approverUserId"` is passed to the panel's `fieldError`. Tested; the mutant is red. |
| L-4: C4, C5, C6, D2 and D5 survived. | New tests:<br>• with approval on, archive shows no selector and sends no approver (C6);<br>• a reopened dialog starts without the previous approver and cannot be confirmed before the policy is read (C4);<br>• a requester without `supplier.mgmt` sees no withdraw (D2);<br>• cancelling the confirmation withdraws nothing (D5).<br>C4, C6, D2 and D5 are red. C5 is now equivalent: the panel reports the policy, success or failure, on every open, and that report overwrites the flag. |
| Info: the create response has no `pendingApproval`, although the comment said "null otherwise". | Documented in the schema comment and the register: only the `getSupplier` responses carry it (GET, update, code change, status actions). |
| Info: the register cited UAT-052 while the rewrite was uncommitted. | Committed on `claude/supplier-uat-phase-002` (`e31a5918`). |
| Nits: a stray blank line and a second Quasar import in `lifecycle.test.js`. | Fixed. |
| Other Info (the reload after a withdraw remounts the tabs; data drift with no pending row; one extra indexed query) | No change. |

## Verification after the fixes

- Server suite: 724 passed, 0 skipped. Client: 203 passed. Technical Playwright: 50 passed.
- eslint and the client build: exit 0.
- UAT with the PHASE-002 spec from `claude/supplier-uat-phase-002`: 29 passed, 5 skipped (the PHASE-001 `test.fixme` cases).
- Mutants S2, C4, C6, D2, D5 and the new guards (L-1, L-2, L-3) are all red. Every file was restored and checked with `cmp`.
