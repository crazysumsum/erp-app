# REV-085 — independent review of TASK-038 (PR #201)

- **Reviewer:** `agent-skills:security-auditor`, a separate agent independent of the author.
- **Baseline:** `62b34ecfc0044a907658358352b65828c239a3cc` on main `9fbbc1f0`.
- **Environment:** its own schema `erp_rev085` on a throwaway MySQL (REPEATABLE READ, pool of 10).
- **Verdict:** **CHANGES_REQUESTED.** Two High defects and one Medium defect, all reproduced on real MySQL.

## High

### H1: Item lookups run on a second pool connection inside open transactions

- **Where:** `update` calls `#assertPurchasable` or `items.findById` on every update, and `#recordSupply` calls `items.findById`. `ItemLookupService` uses the pool, not the transaction's connection.
- **Why it matters:** the framework assumes a request waits for at most one connection at a time (`applicationConfiguration.js`).
- **Reproduced:** 12 concurrent calls.
  - UOM-rebind updates: 9 of 12 failed with 503 "Timed out waiting for a MySQL connection" after 5 s.
  - `recordSupply`: 10 of 12 failed the same way.
- **Impact:** about 10 concurrent relation updates stall every request in the app.

### H2: concurrent first-time `recordSupply` deadlocks, and the retry can never fire

- **Cause:** `SELECT … FOR UPDATE` on rows that do not exist yet, followed by an `INSERT`.
- **Reproduced:** 15 rounds of 4 concurrent projections, on different Suppliers and SKUs.
  - 45 of 60 failed with a raw `ER_LOCK_DEADLOCK` (500).
  - `SHOW ENGINE INNODB STATUS` showed both transactions holding the supremum gap lock of `uq_supplier_sku_refs_supplier_sku`.
- **Why the retry never fires:** it requires the error message to name `supplier_supply_events`, and a deadlock message never names a table.
- **Fix, verified by the reviewer:** lock the Supplier first, then use plain reads; 60 of 60 succeeded.

## Medium

### M1: a partial update wipes stored fields

- **Cause:** every update field has a default, and the request validator runs with `useDefaults: true`, so `required` never fires.
- **Reproduced over HTTP:** `{relationshipStatus:"stopped",version:1}` cleared the Supplier Item Code and the MOQ.

### M2: the tests miss the risky surface

- **Untested:**
  - list;
  - real authorization (the service tests stub it);
  - the IDOR guard;
  - update on an archived Supplier;
  - concurrency and the retry;
  - a missing Supplier or SKU in `recordSupply`;
  - command validation;
  - the migration's rerun checks.
- **Reviewer's sweep:** 35 mutants, 8 killed. The author's "22 mutants, 20 killed" describes the author's own set only.

## Low

- **L1:** NFKC can lengthen a code past 190 characters (`ﷺ`×11 becomes 198). The result is a 500 on create, and a poison event in `recordSupply`.
- **L2:** the purchasable check and the insert can race. A SKU deactivated just after the check still got a `preferred` relation.
- **L3:** in `create`, the purchasable check runs before authorization, so a stale token learns whether the SKU exists and why it is not purchasable.
- **L4:** `event_id` uses the case-insensitive `utf8mb4_0900_ai_ci`, so "GR-x" and "gr-x" collide. The rerun check also ignores collations. Changing this is a schema change.
- **L5:** `recordSupply` ignores `purchaseSkuUomId` on an existing relation (it accepts another SKU's UOM), but rejects the same command with 400 on a new relation.
- **L6:** clearing the purchase UOM on an inactive SKU is refused as a "rebind".

## Info

- **No-op update:** it still bumps `version` and writes an audit entry.
- **Error code:** `supplierChildNotFound("skuRelation")` gives `SUPPLIER_SKURELATION_NOT_FOUND`.
- **Unused logger:** the constructor takes one, and design §6.8 asks for a low-sensitivity alert when the projection fails.
- **Test file names:** T38's Verification names files that do not exist, and the substitution is not recorded.
- **Suspended or blocked Suppliers:** only an archived Supplier blocks new relations. T39's acceptance criterion may expect suspended and blocked Suppliers to be blocked too (a Product Owner question).
- **List:** sorting falls back to `id`, and the SKU search matches exact codes only.
- **Locking:** `recordSupply` X-locks the Supplier row for every goods-receipt line.

## Verified

- **The migration:**
  - It matches HD-086, §5.11 and §5.11.1 exactly.
  - It refuses without the Item tables, or without `UNIQUE(id,sku_id)`, and creates nothing.
  - A rerun is a no-op, and a partial rerun completes the missing table.
  - It creates new tables only.
- **Idempotency:** concurrent identical events (2 and 5 callers) write once.
- **List:** the LIKE escaping, the exact SKU-code lookup, pagination and per-Supplier isolation all work.
- **Update:** cross-Supplier updates return 404, and updates on an archived Supplier return 409.
- **HTTP:** 401, 403, `PERMISSION_STALE`, the price-field refusal and the `pageSize` bound all behave as intended.
- **The carry-forward:** its two open items are accurate, and the "equivalent mutant" claim is correct.

## Environment and cleanup (reviewer)

- **Data:** only `erp_rev085` was used, and it was returned to empty. No scratch schemas remain.
- **Files:** every mutated file was restored, and `git status` is clean.
- **Processes:** no `pkill` was used, and nothing is left running.
- **Elsewhere:** no `.env` file was read, and nothing was done in git or on GitHub.

## Author's follow-up

- **Verified in the code:**
  - **H1:** the Item lookups run inside `withTransaction` and use `this.database`.
  - **H2:** the retry guard needs a table name in the error.
  - **M1:** `useDefaults: true` in `normalizeRequestValidationConfig.js`.
- **The findings** were taken to the Product Owner as HD-090. The answer: '全部按建議，L4 批准'.
- **What was fixed:**
  - **H1:** the Item lookups run before the transaction.
  - **H2:** `recordSupply` locks the Supplier first and then reads without locks, and deadlocks are retried.
  - **M1:** the update body has no defaults.
  - **M2:** tests now cover HTTP authorization (incl. list), IDOR, list search and paging, archived updates, concurrency above the pool size, concurrent projections, command checks, and the migration rerun checks.
  - **L1:** codes too long after NFKC are a 400, and the projection drops them.
  - **L3:** purchasability is reported after authorization.
  - **L4 (approved schema change):** `event_id` is `ascii_bin`, and collations are checked on a rerun.
  - **L5 A:** the projection does not set the UOM.
  - **L6:** clearing a UOM is not a rebind.
  - **Info:** projection failures are logged, and the 404 code is `SUPPLIER_SKU_RELATION_NOT_FOUND`.
- **Accepted:** L2, as a documented limitation; and suspended or blocked Suppliers keep relations.
- **Negative control:** the H1, H2 and M1 tests fail on the code before these fixes.
- **Mutation:** 46/46 killed (`62_task_041_carry_forward.md`).
