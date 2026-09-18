import { httpClient } from "@/framework/http/HttpClient.js";

export const service = { name: "supplierApproval" };

export default {
  /**
   * 建檔／啟用畫面用嚟決定顯唔顯示審批人選擇（HD-024）。伺服器仍然係權威：
   * 政策 ON 而唔帶 approver 會 400，OFF 而帶咗都係 400。
   */
  activationPolicy() {
    return httpClient.get("/api/v1/supplier-lookups/activation-policy");
  },

  /**
   * 設計 §6.4：只回 id、username、displayName。`excludeUserId` 用嚟排除自己 ——
   * BR-012／AC-009 唔准揀自己做審批人，而伺服器一樣會再驗一次。
   */
  eligibleApprovers({ q, excludeUserId } = {}) {
    return httpClient.get("/api/v1/supplier-approvers", {
      params: { q: q || undefined, excludeUserId }
    });
  },

  queue({ scope, status, requesterId, page, rowsPerPage } = {}) {
    return httpClient
      .get("/api/v1/supplier-approvals", {
        params: { scope, status, requesterId, page, pageSize: rowsPerPage }
      })
      .then(({ items, total }) => ({ rows: items, rowsNumber: total }));
  },

  get(id) {
    return httpClient.get(`/api/v1/supplier-approvals/${id}`);
  },

  // 設計 §6.4：三個決定都係 jwt-password。
  approve(id, payload) {
    return httpClient.post(`/api/v1/supplier-approvals/${id}/approve`, { body: payload });
  },

  reject(id, payload) {
    return httpClient.post(`/api/v1/supplier-approvals/${id}/reject`, { body: payload });
  },

  reassign(id, payload) {
    return httpClient.post(`/api/v1/supplier-approvals/${id}/reassign`, { body: payload });
  },

  /**
   * 撤回喺 Supplier route 上面，唔喺 queue route：佢係建檔人嘅動作，要
   * supplier.mgmt，而且唔要求再確認密碼（設計 §6.4）。
   */
  withdraw(supplierId, payload) {
    return httpClient.post(`/api/v1/suppliers/${supplierId}/approval/withdraw`, { body: payload });
  }
};
