# REV-117 — independent review of DEF-039, DEF-040 and DEF-041 (HD-132 B, HD-133 A, HD-134 A)

- **Reviewer:** `agent-skills:code-reviewer` (a separate agent; I did not write this change)
- **Baseline:** branch `claude/supplier-def039-041` at `a1d649d6`, reviewed as `git diff origin/main..HEAD` (base `bb48cb3e`)
- **Verdict:** **CHANGES_REQUESTED**
- **Open Critical / High:** 0 / 0. One Medium, four Low, several Info and nits.

## What the reviewer confirmed

- **Suites:** server 712 passed (0 skipped); client 192 passed; technical Playwright 50 passed.
- **UAT on the real backend:** 19 passed. UAT-048 fails at its DEF-037 step and 5 cases are skipped. UAT-003 now passes.
- **Extra real-browser check:**
  - The list shows 「code — name」 and 「（已停用）」.
  - Saving with a deactivated stored term marks the term field.
  - Clearing the term and saving again succeeds.
  - No console errors or unexpected responses.
- **DEF-039:** meets HD-132 B. Candidates are recorded only when there are any. Imports record none, as HD-052 and HD-075 intend.
- **Contract and security:** the response schemas are closed and additive, and the Audit detail key is on the allow-list.
- **Merge `1c604756`:** lost nothing. Every test from both sides is present.
- **Mutation sweep:** 21 mutants. S7, S9, S11, S12 and C2 survived.

## Disposition

The standing instruction is to fix every review finding as recommended.

| Finding | Disposition |
| --- | --- |
| M-1: the list does not do HD-133 A's "one batched read per page". It reads the Active list once, then one history read per term missing from it. The performance fixture never takes that path, and no test pins the read count. | **Recorded as a deviation and raised as HD-135.** A real batch needs a read by IDs in Business Master, which is not this module's code. A unit test (`supplierPaymentTermLabels.test.js`) pins the reads: one list read, history reads only for missing IDs, none without IDs. S11 is now red. The optional performance-fixture change is not made, because it would change the performance evidence's baseline; HD-135 asks whether to. |
| L-1: S7, S9, S12 and C2 survived. | The approval test now submits Active term A, has the Supplier currently on Inactive term B, and seeds an unrelated Active term C. It expects exactly A and B. The DEF-039 test uses a near match, not an exact one. A client test expects 「—」 when a term is not named. All four mutants are now red. |
| L-2: 「（已停用）」 was clipped in the list at 1280 px. | The term cell uses `EllipsisCell` (200px, with a tooltip of the full label), like the other long columns. |
| L-3: the register and the TC map still showed the pre-decision state. | Updated: DEF-039, DEF-040 and DEF-041 dispositions; the M-1 deviation; UAT-003 now passes. |
| L-4: the approval detail would throw without a Business Master provider. | `getRequest` returns `paymentTerms: []` when the service has no provider. |
| Nit: the JSDoc did not mention `warnedDuplicates`; the size limit relies on the 10-candidate cap. | JSDoc added, and a comment next to the cap. |
| Info: raw values in the Audit timeline; DEF-041 only on the editor; the 409 toast wording. | Outside the decisions' scope. No change. |

## Verification after the fixes

- Client Supplier suite: 21 files, 193 passed.
- New and changed server tests pass: DEF-039, the two DEF-040 integration tests, and the read-count unit test.
- eslint exit 0.
- The survivors S7, S9, S11, S12 and C2 are now red. Files were restored and checked with `cmp`.
