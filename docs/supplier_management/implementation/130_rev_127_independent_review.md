# REV-127 — independent review of the cross-phase UAT cases (UAT-047, UAT-055) and the UAT-026 clock fix

- **Reviewer:** `agent-skills:code-reviewer` (a separate agent; I did not write this change)
- **Baseline:** branch `claude/supplier-uat-cross-phase` at `0176ec39`, reviewed as `git diff origin/main..HEAD` (base `6cdc2eec`)
- **Verdict:** **CHANGES_REQUESTED**. 4 Required, 6 Optional, plus Nits, and three points for the Product Owner.

## What the reviewer confirmed

- **UAT-047 is keyboard-only.** It has no click, fill or programmatic focus.
  - A `tabindex=-1` mutant fails reachability.
  - The focus-visible diff is real: removing the focus helper fails it, and so does removing the field focus ring.
  - Status is checked as text, and the list states work as in UAT-054.
- **UAT-055 filters discriminate.** Mutants that ignore the actor, the action or `from`, and a constant OFFSET, are killed.
- **The plaintext controls hold.** Trace, screenshots and the failure aria snapshot are off, and comparisons are booleans.
- **The UAT-026 clock fix still discriminates.** Deadline mutants of −1 s and +1 s are killed.

## Disposition

| Finding | Disposition |
| --- | --- |
| R1: UAT-055 took screenshots before checking for plaintext. A mutant putting the full number in the bank audit detail got into a screenshot. | Every screenshot in the spec now goes through a guard. The guard waits until nothing is revealed and checks the page for every fictional account created in the worker. That mutant now fails at the masked-detail assertion, before any screenshot. |
| R2: the CLERK's console and network were not checked during PHASE-002. A `console.error` mutant survived. | Checked at the end of each viewport. The mutant fails ("CLERK console and network"). |
| R3: "every entry has a request id" and the Audit detail were not shown. Mutants for a missing id and for an empty detail survived. | Every row on pages 1 and 2 must have a UUID or `import-<job>` request id. The bank row's detail must show the masked number, and an edit row its `notes` change. Both mutants fail. |
| R4: the target filter depended on test order; `to` was untested; actor and dates were set only through the URL. | A decoy Supplier with its own reveal is added. Actor and dates are typed in the UI and checked in the URL. "To yesterday" must be empty. The target-ignored, `to`-ignored and unbound-actor mutants all fail at their own steps. |
| O1: a keyboard-chosen currency was not checked. | The chosen value is asserted. |
| O2: focus visibility was checked on two controls only. | A dialog field (the reveal password) is added. |
| O3: the import audit was not tied to the case's Supplier, and 07 asks for one Supplier with every audited action. | One Supplier now has create, approval submission and approval, suspension, edits, a Bank account and reveal, and an import that updates it. The import's write is found under that Supplier with request id `import-<job>`. |
| O4: the date check can cross midnight. | Stated in the spec; not changed. |
| O5: the full-page screenshot cuts off the detail column. | Stated in the TC map. The detail values are asserted. |
| O6: UAT-026's 29 s margin is now about 800 ms. | Kept. The measured delay is under 10 ms; the fallback, pausing before 確認查看, is noted. |
| Nits | Fixed: the joined TC-map paragraph is split; the "(wip)" commit is kept, because rewriting history would orphan the commit SHAs that the ledger observations already record; the target comment is corrected. The empty-field message stays a non-empty check linked through `aria-describedby`. |

While fixing R3, an immediate read after navigation raced the table load. It now polls. That race had made the unbound-actor mutant fail at the wrong step.

## Points for the Product Owner (HD-146)

1. **「開啟詳情」 in UAT-055.** The Audit page shows each row's masked detail inline, with no separate detail view; design §7.2 says only "masked detail". The question is whether the inline row, plus the same entry in the Supplier's 變更紀錄 tab, is accepted.
2. **The drawer menu.** UAT-047 opens each step by URL. Should keyboard use of the drawer menu be part of the happy path?
3. **The AUDITOR role.** 07 names VIEWER/AUDITOR, and the UAT fixture has no AUDITOR role, so the case runs as VIEWER. The single-Supplier precondition is now met.
