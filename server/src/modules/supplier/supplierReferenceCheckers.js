import { openPurchaseOrderChecker, purchaseOrderReferenceChecker } from "../purchasing/PurchasingSupplierReferenceCheckers.js";
import { SupplierReferenceService } from "./SupplierReferenceService.js";

// 下游模組嘅引用檢查（設計 §4.7、FR-STATUS-004；TL ruling 4）。五個建構 SupplierAdminService 嘅地方
// 都用呢個 factory，令「被引用就鎖 Code」同「有未完成流程就唔准封存」喺所有 handler 都生效。
export function createSupplierReferenceServices() {
  return {
    references: new SupplierReferenceService({ checkers: [purchaseOrderReferenceChecker] }),
    openFlows: new SupplierReferenceService({ checkers: [openPurchaseOrderChecker] })
  };
}
