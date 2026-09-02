import { httpClient } from "@/framework/http/HttpClient.js";

export const service = { name: "audit" };

/**
 * 稽核查詢的 API。見 docs/user-management.md §3.1、§4.6。
 *
 * 唯讀，沒有 create／update／delete，所以頁面不用 useCrud——那是給有寫入
 * 動作的清單頁用的。
 */
export default {
  /**
   * 分頁清單，DataTable 的 fetch 形狀（page/rowsPerPage）加多時間範圍、操作者、
   * 對象、動作四個篩選欄位。後端固定照時間倒序排（§3.3），所以不帶
   * sortBy／descending。
   */
  async list({ page, rowsPerPage, from, to, actor, target, action }) {
    const result = await httpClient.get("/api/v1/audit/logs", {
      params: {
        page,
        pageSize: rowsPerPage,
        from: from || undefined,
        to: to || undefined,
        actor: actor || undefined,
        target: target || undefined,
        action: action || undefined
      }
    });

    return { rows: result.items, rowsNumber: result.total };
  }
};
