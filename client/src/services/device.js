import { httpClient } from "@/framework/http/HttpClient.js";

export const service = { name: "device" };

/**
 * 設備綁定嘅 API。頁面唔直接叫 httpClient，路徑同回應形狀集中喺呢度——
 * 後端改路徑或欄位名嗰陣，要跟住改嘅係一個檔案而唔係散落喺幾個 .vue 入面。
 */
export default {
  /** 待審批嘅申請。需要 device.approve 權限。 */
  async listPending() {
    const { items } = await httpClient.get("/api/v1/device/bindings/pending");
    return items;
  },

  /** 目前使用者自己嘅設備。 */
  async listMine() {
    const { items } = await httpClient.get("/api/v1/device/bindings");
    return items;
  },

  approve(id, note = "") {
    return httpClient.post(`/api/v1/device/bindings/${id}/approve`, { body: { note } });
  },

  reject(id, note = "") {
    return httpClient.post(`/api/v1/device/bindings/${id}/reject`, { body: { note } });
  },

  revoke(id, note = "") {
    return httpClient.post(`/api/v1/device/bindings/${id}/revoke`, { body: { note } });
  }
};
