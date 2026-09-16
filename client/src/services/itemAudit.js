import { httpClient } from "@/framework/http/HttpClient.js";

export const service = { name: "itemAudit" };

/** Item Management 變更紀錄的唯讀查詢 API。 */
export default {
  async list({ page, rowsPerPage, from, to, actor, target, action, targetType }) {
    const result = await httpClient.get("/api/v1/item-audit/logs", {
      params: {
        page,
        pageSize: rowsPerPage,
        from: from || undefined,
        to: to || undefined,
        actor: actor || undefined,
        target: target || undefined,
        action: action || undefined,
        targetType: targetType || undefined
      }
    });

    return { rows: result.items, rowsNumber: result.total };
  }
};
