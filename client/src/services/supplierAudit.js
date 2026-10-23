import { httpClient } from "@/framework/http/HttpClient.js";

export const service = { name: "supplierAudit" };

/** Supplier 變更紀錄嘅唯讀查詢（設計 §6、§7.2；DEF-035）。銀行動作嘅 detail 由後端遮罩，前端照樣顯示。 */
export default {
  async list({ page, rowsPerPage, from, to, actor, target, action, targetType, supplierId }) {
    const result = await httpClient.get("/api/v1/supplier-audit/logs", {
      params: {
        page,
        pageSize: rowsPerPage,
        from: from || undefined,
        to: to || undefined,
        actor: actor || undefined,
        target: target || undefined,
        action: action || undefined,
        targetType: targetType || undefined,
        supplierId: supplierId || undefined
      }
    });
    return { rows: result.items, rowsNumber: result.total };
  }
};
