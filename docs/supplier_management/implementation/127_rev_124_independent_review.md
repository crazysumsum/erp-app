# REV-124 — independent review of the DEF-046 and DEF-047 fix (HD-141 A, HD-142 A)

- **Reviewer:** `agent-skills:code-reviewer` (a separate agent; I did not write this change)
- **Baseline:** branch `claude/supplier-def046-047` at `4c63fe3e`, reviewed as `git diff origin/main..HEAD` (base `2fb7fcf8`)
- **Verdict:** **CHANGES_REQUESTED**. The runtime code is correct and no security defect was found. The findings are in documentation, the decision record and the tests.

## What the reviewer confirmed

- **One report per committed operation.** It holds across a deadlock retry, and nothing is reported on failure. A scratch probe over the five operations, with the COMMIT failing once and failing always, confirmed it.
- **Roles come from the database read in `assertActorFresh`.**
- **The log context is ids only.** The metrics line holds numbers only.
- **The query is bounded by an index.** The `IN (?)` list expands correctly in mysql2, and the role `EXISTS` is a covering lookup.
- **The client wording fix is static text.**
- **Real backend:** UAT-030 produced exactly two `privileged_use` events for its two successful operations, and none for the wrong-password attempts.

## Disposition

The standing instruction is to fix every review finding as recommended.

| Finding | Disposition |
| --- | --- |
| R1: HD-142 A included a denied count. It was not built, and the narrowing was not disclosed. 403s in the request log mix permission denials with wrong-password re-authentication and carry no actor. | Not silently narrowed. The register now says no denied count is kept and where denials appear today. The system log's `http.request_failed` `error.code` does separate `AUTHORIZATION_DENIED` and `BANK_PERMISSION_LOST` from `PASSWORD_INVALID`, though without the actor. A durable count needs a source that does not exist (denials roll back, and most are refused by the route policy before the service runs), so this is put to the Product Owner as **HD-143**. |
| R2: "each metrics line counts bank use since the previous one" is false with several instances, and buckets can be missed across a restart. | The counts now use epoch-aligned five-minute buckets. Each run reports the last whole bucket and carries `bucketStart`, so instances report the same bucket and can be deduplicated. The code, the job comment, the test message and the register now describe the overlap and the restart gap, and name the per-event log as the authority. |
| R3: dropping the role filter survived, because the officer had no role at all. | The officer now holds a non-admin role. The "any role" mutant fails the integration test. |
| R4: a failure at or after COMMIT, and a deadlock retry, were untested. Report-inside-transaction mutants survived (create, update, reveal). | Taken from the reviewer's probe: all five operations, with the COMMIT failing once (a retried success reports once) and failing always (nothing reported). The create, update and reveal mutants now fail it. |
| O1: the consequences of judging by the current role. | Stated in the code and the register: a role revoked later under-counts, a role granted later over-counts, a deleted user drops out, and the per-event log has none of these biases. |
| O2: which event to page on. | The per-event `supplier.bank.privileged_use`; the alert is a per-bucket summary. Stated in the code and the register. |
| N1: the window boundary was untested. | Both bucket edges are pinned: start included, end excluded, plus the millisecond before the start. Moving either edge fails the test. |
| Nit: the comment named the `(action, occurred_at)` index. | Reworded to "bounded by the occurred_at index". |

## Verification after the fixes

- Server unit tests (`supplierBankService`, `supplierObservability`): 35 of 35 pass.
- `supplierObservability` integration with `DB_INTEGRATION_TESTS=1`: 2 of 2 pass, 0 skipped.
- Mutants killed:
  - E: any role counted;
  - F: start edge exclusive;
  - F2: end edge inclusive;
  - A3: update report inside the transaction;
  - C3: reveal report before decryption;
  - K: create report inside the transaction.
- eslint exits 0.
