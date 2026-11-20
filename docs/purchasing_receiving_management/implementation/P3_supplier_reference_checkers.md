# Supplier reference and open-flow checkers (2026-11-19)

Purchasing's task entry for the two checkers that Supplier calls before it changes a Supplier Code, archives a Supplier or hard-deletes one.

## Where the decision comes from
- **Contract:** TL ruling 4 (`tech-lead-handoffs/purchasing-cross-module-rulings-20261117/RULING.md`, sha256 `94762244…fb19`).
- **Lock edge:** ruling A (`tech-lead-handoffs/supplier-po-edge-ruling-20261118/RULING.md`, sha256 `26fada00…7d7a`).
- **Who writes it:** the Supplier owner writes both sides and the Purchasing owner reviews (PM decision, agentmsg `944798c4`).
- **Scope:** a one-off SCOPE grant from the TL (agentmsg `a2b1a1e2`). It covers this file, the new checker file and its unit test. Purchasing `03`, `05` and `08` are not changed.

## What was added
- **File:** `server/src/modules/purchasing/PurchasingSupplierReferenceCheckers.js`. It has no import from Supplier and reuses `OPEN_PO_STATUSES` and `HISTORICAL_PO_STATUSES` from `PurchasingBusinessMasterImpactChecker.js`.
  - **`purchaseOrderReferenceChecker`, name `採購單`:** every classified PO of the Supplier.
  - **`openPurchaseOrderChecker`, name `未完成採購單`:** only the POs in `OPEN_PO_STATUSES`.
- **The read:** one statement on the caller's connection, `SELECT status, COUNT(*) … FROM purchase_orders WHERE supplier_id = ? GROUP BY status FOR SHARE`.
  - The locking read is required, because Supplier's snapshot opens before its row lock (ruling 4.3).
  - A status that is neither open nor historical throws, so the Supplier operation is refused, never treated as clear.
  - A count that is not a non-negative safe integer also throws.
- **Names shown to the user:** Supplier shows the checker names to the user (`name：count`), so they are readable.

## Locks
- The order is Supplier row → PO rows. It can deadlock with the PO → Supplier writers: draft update, submit, approve and reject. Ruling A accepts that.
- InnoDB rolls back one side. Supplier answers 409 `CONCURRENT_OPERATION`, and Purchasing keeps its existing `CONCURRENT_OPERATION` mapping. Neither side adds a retry.
- **Not verified here:** the real lock range of `GROUP BY … FOR SHARE` on MySQL 26.x, and the plan it uses (`idx_po_supplier` is intended). Proving them needs a two-connection case and an EXPLAIN assertion, which were not added.

## Tests
- `server/test/purchasing/purchasingSupplierReferenceCheckers.test.js`, 4 unit cases:
  - the statement and its parameters;
  - the open-status filter;
  - unclassified statuses fail closed;
  - an invalid count is refused.
- The Supplier side holds the route-level cases.

## Still to do
`05_development_tasks.md` gets the formal task text at the next planned Purchasing receipt rebind, which is before the 029 schema change. It is not edited here because 6 receipts list it.
