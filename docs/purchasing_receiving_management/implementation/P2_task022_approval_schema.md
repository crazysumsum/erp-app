# TASK-022 — Approval and status history schema and services

**Status: code complete; PR not opened.** Verified on a private MySQL on 2026-11-05: migrations from empty, 12 integration cases, and a 66-mutant sweep with all survivors fixed. The local full suite was stopped before finishing, so CI is the full functional evidence.

Built on 2026-11-05 from main `b1d98732`. Design §3.3, §4.4, §4.7, §4.8, §4.16, §8.3; FR-SET, FR-APPROVAL, AC-001～002, AC-012～017; `TC-004`, `TC-009`.

## APR-011 — migration scope

Sam approved on 2026-11-05: 「批準，限選 A」, answering the schema proposal for `0117_create_purchase_order_approvals.js` and `0118_create_purchase_order_status_history.js`, including the CHECK constraints added beyond the design and a trigger rejecting DELETE on approvals.

## HD-020

Sam chose option A. §4.7 caps `approval_snapshot` at 64KiB. The proposal estimated that a 100-line PO without notes comes close to that. Measured JSON size afterwards: about 32KB for a typical 100-line PO, about 47KB with a 50-character note on each line, and about 629KB at every column's maximum. So a PO without notes fits, but a 100-line PO with longer notes exceeds 64KiB and could not be submitted with approval on. The cap is 1MiB, enforced by a CHECK. To be folded into §4.7 at the next design revision.

## Choices within the design

- **In-transaction service methods.** The caller verifies the actor, claims the event, locks the PO and Lines, changes PO status, revalidates Supplier and SKU, and writes Audit and history. TASK-023 connects these to commands and routes.
- **History is not written yet.** Existing create and submit paths start writing it in TASK-023. The system is not live (HD-006), so this leaves no gap.
- **Approve recomputes the snapshot** from the frozen PO and compares its hash, so a snapshot that has separated from its PO cannot be approved.
- **A requester who is no longer usable blocks approval.** §5.7 has no code for this, so `PO_APPROVER_INVALID` covers both people, with a message asking for withdrawal and resubmission.

## Open question for TASK-023

§5.4 gives the settings update `jwt-device-password`; TASK-023's criteria say `jwt-password`.

## Unapproved capacity execution

On 2026-11-05 the local `npm run test:coverage` ran from 13:50 to 14:10 HKT and was stopped when the PM asked about its scope. That command has no capacity exclusion; only CI skips the catalog. It executed 28 catalog cases with no approval from Sam: 26 passed and 2 failed in under 1 ms, so those 2 measured nothing. The cases are in Fulfillment (100 lines and 5000 members), Sales TC-032 (50 users), Suppliers' 100-contender LOCAL-083 and the 50 MiB upload TC-004. Earlier full-suite results in this module's records came from the same command, and are not capacity evidence either. The results are not used as capacity evidence, and no threshold or test changed.
