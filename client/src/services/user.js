import { httpClient } from "@/framework/http/HttpClient.js";

export const service = { name: "user" };

/**
 * 用戶管理同自助改密碼嘅 API。路徑同回應形狀集中喺呢度，見
 * docs/user_management/design_spec.md §3.1、§3.4。
 *
 * `create`／`assignRoles`／`resetPassword` 三支後端要求 authType
 * "jwt-device-password"（JWT + 已核准設備嘅簽章 + 當下密碼），所以要帶
 * `signed: true`——呢三支同時做緊「製造權限」嘅事（新增帳號、配角色、重設
 * 密碼），值得要求呢台機一定要係已核准嗰台（見 §5.2）。`disable`／`enable`
 * 淨係斷存取，用返 jwt-password（body 帶 password 就夠，唔使簽章）。
 */
export default {
  /**
   * 分頁清單，DataTable 嘅 fetch 形狀（page/rowsPerPage/sortBy/descending/
   * filter）加多一個 `status` 篩選——UsersPage 自己喺 fetch closure 度帶
   * 埋現時揀嘅狀態，DataTable 唔識呢個欄位。`filter` 對應後端嘅 `q`
   * （帳號／顯示名稱嘅 LIKE 搜尋，見 §3.3）。
   */
  async list({ page, rowsPerPage, sortBy, descending, filter, status }) {
    const result = await httpClient.get("/api/v1/users", {
      params: {
        page,
        pageSize: rowsPerPage,
        q: filter || undefined,
        status: status || undefined,
        sortBy: sortBy || undefined,
        descending
      }
    });

    return { rows: result.items, rowsNumber: result.total };
  },

  /** 單一用戶詳情，含角色——配置角色對話框開啟前用嚟攞 expectedRoleIds。 */
  get(id) {
    return httpClient.get(`/api/v1/users/${id}`);
  },

  /** 新增用戶。`password` 係操作者自己而家嗰個密碼，`newUserPassword` 係幫呢個新帳號設嘅初始密碼。 */
  create({ username, displayName, newUserPassword, roleIds, password }) {
    return httpClient.post("/api/v1/users/create", {
      body: { username, displayName, newUserPassword, roleIds, password },
      signed: true
    });
  },

  /** 改顯示名稱。username 建立之後不可改（§3.1），所以呢度冇呢個欄位。 */
  update(id, { displayName }) {
    return httpClient.post(`/api/v1/users/${id}/update`, { body: { displayName } });
  },

  disable(id, { reason, password }) {
    return httpClient.post(`/api/v1/users/${id}/disable`, { body: { reason, password } });
  },

  enable(id, { reason, password }) {
    return httpClient.post(`/api/v1/users/${id}/enable`, { body: { reason, password } });
  },

  /** 整組覆蓋用戶嘅角色（compare-and-set，見 §3.1）。 */
  assignRoles(id, { roleIds, expectedRoleIds, reason, password }) {
    return httpClient.post(`/api/v1/users/${id}/roles/assign`, {
      body: { roleIds, expectedRoleIds, reason, password },
      signed: true
    });
  },

  /** 管理員重設用戶密碼。 */
  resetPassword(id, { newUserPassword, reason, password }) {
    return httpClient.post(`/api/v1/users/${id}/password/reset`, {
      body: { newUserPassword, reason, password },
      signed: true
    });
  },

  /**
   * 使用者自己改密碼。`password` 係現時密碼（`jwt-password` strategy 喺
   * schema 驗證之前讀走佢），`newPassword` 先係呢支 handler 真正處理嘅
   * 欄位（見 §3.4）——兩個名特登唔對稱，因為 strategy 讀嘅欄位名係固定嘅。
   */
  changeOwnPassword({ password, newPassword }) {
    return httpClient.post("/api/v1/user/password/change", { body: { password, newPassword } });
  }
};
