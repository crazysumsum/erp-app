# REV-116 — independent review of the payment-term display fix (DEF-038, HD-130 A)

- **Reviewer:** `agent-skills:code-reviewer` (a separate agent; I did not write this change)
- **Baseline:** branch `claude/supplier-def038-payment-term` at `ea4e93a3`, reviewed as `git diff origin/main..HEAD` (base `dc0f3f3e`)
- **Verdict:** **CHANGES_REQUESTED**
- **Open Critical / High:** 0 / 0. Two Medium, one Low, six Info.

## What the reviewer confirmed

- **Suites:**
  - Server suite: 709 passed, 0 skipped.
  - Client Supplier suite: 186 passed.
  - Technical Playwright: 50 passed.
  - UAT-031 on the real backend: passed.
  - eslint: exit 0.
- **Schema:** proved through the real `ResponseValidator` (Ajv strict).
  - Accepted: the field absent, `null`, an Active object, an Inactive object.
  - Rejected: a missing `name`, an extra `version`, a wrong enum, a wrong type.
  - Production validation is on.
- **Every detail path:** update, code change, activate and suspend return the field. Clearing the term gives `null`. Create omits it and the page reloads with GET.
- **No orphan term:** a term ID that cannot be named cannot occur, because `fk_suppliers_payment_term` is `ON DELETE RESTRICT`. The page would show 「—」.
- **Security:** only id, code, name and status are exposed. Spreading the whole provider term (mutant S4) is rejected by `additionalProperties`. Detail stays behind `supplier.view`.
- **Performance:** one primary-key read per detail, after commit, outside the transaction. No N+1.
- **Mutants:** all six server mutants failed.

## Disposition

The standing instruction is to fix every review finding as recommended.

| Finding | Disposition |
| --- | --- |
| M-1: an Active term was labelled 「（已停用）」 and disabled whenever it was missing from the loaded Active list (options loading, failed, or beyond the first 100). | The extra option is added only when the term is missing from the list. Its mark and `disable` follow `current.status === "INACTIVE"`. A vitest case covers an Active term while the options are pending and after they fail, and expects a plain, enabled label. The old behaviour fails it. |
| M-2: the Supplier list column and the approval diff still print the internal ID. | Recorded as DEF-040, with decision HD-133. Not added to this PR, as recommended. |
| L-1: four client mutants survived, and UAT-031 did not check the inactive mark. | Vitest asserts: an Active term shows plainly in the overview and the editor, with exactly one option; an ID with a null term shows 「—」, not the ID. UAT-031 now expects 「code — name（已停用）」 on the overview and in the editor. Mutants C3, C4, C5, C6 and C9, and the old M-1 behaviour, are all red. |
| I-1: saving the editor with an unchanged inactive term is refused (409 `PAYMENT_TERM_NOT_ACTIVE`), and the term field is not marked. | This predates the change. Recorded as DEF-041, with decision HD-134. |
| I-2 to I-6 | No change. |

## Verification after the fixes

- Client Supplier suite: 21 files, 189 passed. eslint exit 0.
- Mutants rerun:
  - Red in UAT-031 on the real backend: C3 (overview without the mark) and C4 (option without the mark).
  - Red in vitest: C5 (always marked), C6 (null term shows the ID), C9 (option added for an Active term), and the M-1 regression (option disabled because it is missing from the list).
  - Files restored and checked with `cmp`.
