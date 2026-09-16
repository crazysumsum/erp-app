import { SUPPLIER_STATUSES } from "./supplierConstants.js";
import { supplierConflict } from "./supplierErrors.js";

const TRANSITIONS = Object.freeze({
  draft: new Set(["active", "pending_approval", "archived"]),
  pending_approval: new Set(["active", "draft"]),
  active: new Set(["suspended", "blocked", "archived"]),
  suspended: new Set(["active", "blocked", "archived"]),
  blocked: new Set(["suspended"]),
  archived: new Set(["suspended"])
});

export function transitionSupplierStatus(from, to) {
  if (!SUPPLIER_STATUSES.includes(from) || !SUPPLIER_STATUSES.includes(to)) {
    throw supplierConflict("STATUS_TRANSITION_INVALID", "供應商狀態轉換不正確", { from, to });
  }
  if (from === to) return { from, to, changed: false };
  if (!TRANSITIONS[from].has(to)) {
    throw supplierConflict("STATUS_TRANSITION_INVALID", "目前供應商狀態不允許這項操作", { from, to });
  }
  return { from, to, changed: true };
}

export function assertSupplierDeletable(status, referenceSummary) {
  if (status !== "draft") {
    throw supplierConflict("SUPPLIER_DELETE_NOT_ALLOWED", "只有未被引用的草稿供應商可以永久刪除", { status });
  }
  if (referenceSummary.total !== 0) {
    throw supplierConflict("SUPPLIER_REFERENCED", "供應商已有引用，不可永久刪除", referenceSummary);
  }
}
