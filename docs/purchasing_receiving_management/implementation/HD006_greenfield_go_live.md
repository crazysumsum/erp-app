# HD-006 — Greenfield Go-Live

Answered by Sam on 2026-11-03.

## Decision

> 按全新系統上線做，只會導入客戶，供應商，item和inventory紀錄，其他紀錄一律不導入

The new system goes live empty of transactional history. Only Customer, Supplier, Item and Inventory records are imported; no purchase orders, goods receipts, reversals, previously received quantities or Purchasing audit history.

## What this resolves in OPEN-006

| OPEN-006 asks | Answer |
| --- | --- |
| Which open legacy POs are migrated | None |
| Legacy previously received quantities | Not applicable: no PO is migrated, so nothing received in the legacy system can be posted again |
| Cutover date | No Purchasing data is converted; the go-live date is set at release |
| Inventory Opening reconciliation owner | Purchasing has no received quantities to reconcile against opening stock. Opening stock arrives through the Inventory record import, whose reconciliation belongs to that import |
| Go-Live sign-off | Taken at the release approval gate (`TASK-044`, `RELEASE_APPROVAL`) as a recorded human approval |

The last three rows are the agent's reading of the decision, not Sam's words, and Sam may name a different reconciliation or sign-off owner.

## Consequences

- **Requirement §16.2 does not apply.** It is conditional ("如上線時已有舊系統未完成PO"); with no legacy PO migrated, no one-time PO import or migration tool is needed. This removes no mandatory requirement and adds none.
- **Legacy POs still open at go-live are handled outside this system**: either finished in the legacy system, or entered by users as new POs and received normally. §16.3's "freeze legacy open POs and in-transit receipts, name a cutover time and owner" remains an operational step of the go-live runbook.
- **The requirement and task texts still say OPEN-006 is open.** `01_requirement_spec.md` §18 and `TASK-044`'s acceptance ("OPEN-006未解決則阻擋Go-Live") must be updated to `DECIDED` before `TASK-044` runs, together with HD-009 to HD-014 at the next design revision. Editing them now would move the requirement and design digests and strand every approval again, so this pass records the decision in state only.
