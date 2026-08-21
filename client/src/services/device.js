import { httpClient } from "@/framework/http/HttpClient.js";

export const service = { name: "device" };

/**
 * 設備綁定嘅 API。頁面唔直接叫 httpClient，路徑同回應形狀集中喺呢度——
 * 後端改路徑或欄位名嗰陣，要跟住改嘅係一個檔案而唔係散落喺幾個 .vue 入面。
 */
export default {
  /** 待審批嘅申請。需要 device.mgmt 權限。 */
  async listPending() {
    const { items } = await httpClient.get("/api/v1/device/bindings/pending");
    return items;
  },

  /** 目前使用者自己嘅設備。 */
  async listMine() {
    const { items } = await httpClient.get("/api/v1/device/bindings");
    return items;
  },

  // 呢三個動作後端要求 authType "jwt-password"：核准會俾一台設備長期存取權，
  // 撤銷會即刻踢晒一個使用者所有 session，都值得要求操作者當場再打一次
  // 現時嘅密碼，唔淨係靠仲有效嘅 session。

  approve(id, password, note = "") {
    return httpClient.post(`/api/v1/device/bindings/${id}/approve`, { body: { password, note } });
  },

  reject(id, password, note = "") {
    return httpClient.post(`/api/v1/device/bindings/${id}/reject`, { body: { password, note } });
  },

  revoke(id, password, note = "") {
    return httpClient.post(`/api/v1/device/bindings/${id}/revoke`, { body: { password, note } });
  }
};
