import { HISTORICAL_PO_STATUSES, OPEN_PO_STATUSES } from "./PurchasingBusinessMasterImpactChecker.js";

// Supplier 嘅引用／未完成流程檢查（TL ruling 4，purchasing-cross-module-rulings-20261117）。
// Supplier 改 Code、封存、永久刪除前，喺同一 transaction 數呢個 Supplier 嘅 PO。
// 用 FOR SHARE：Supplier 喺鎖 Supplier row 之前已經做過普通讀取開咗 snapshot，普通 COUNT 會睇漏
// 等鎖期間 commit 咗嘅 PO（ruling 4.3）。鎖序係 Supplier row → PO rows；同 PO → Supplier 嘅寫入者
// 有機會 deadlock，ruling A（supplier-po-edge-ruling-20261118）接受，由 InnoDB 揀一方 rollback。
// 未分類嘅狀態一律 throw：fail closed，唔會當成冇引用。
const OPEN = new Set(OPEN_PO_STATUSES), HISTORICAL = new Set(HISTORICAL_PO_STATUSES);
export const SUPPLIER_PO_COUNT_SQL =
  "SELECT status, COUNT(*) AS reference_count FROM purchase_orders WHERE supplier_id = ? GROUP BY status FOR SHARE";

async function purchaseOrderCounts(connection, supplierId) {
  const [rows] = await connection.query(SUPPLIER_PO_COUNT_SQL, [supplierId]);
  let open = 0, historical = 0;
  for (const row of rows) {
    const count = Number(row.reference_count);
    if (!Number.isSafeInteger(count) || count < 0) throw new Error("Invalid Purchasing Supplier reference count");
    if (OPEN.has(row.status)) open += count;
    else if (HISTORICAL.has(row.status)) historical += count;
    else throw new Error("Unclassified Purchasing PO status");
  }
  return { open, historical };
}

// name 會直接顯示喺 Supplier 封存畫面（「name：count」），所以用可讀名。
export const purchaseOrderReferenceChecker = Object.freeze({
  name: "採購單",
  async count(connection, supplierId) {
    const { open, historical } = await purchaseOrderCounts(connection, supplierId);
    return open + historical;
  }
});

export const openPurchaseOrderChecker = Object.freeze({
  name: "未完成採購單",
  async count(connection, supplierId) {
    return (await purchaseOrderCounts(connection, supplierId)).open;
  }
});
