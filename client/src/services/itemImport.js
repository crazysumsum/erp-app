import { httpClient } from "@/framework/http/HttpClient.js";

export const service = { name: "itemImport" };

/**
 * 商品匯入的 template／upload／list／get／confirm／cancel／result API。路徑及
 * 回應形狀見 docs/items_management/design_spec.md §6.8。
 */
export default {
  /** 回 `{ blob, contentType }`——同 itemMedia 的 downloadMedia() 一樣，認證
   * 用 Authorization header，唔可以直接指向端點 URL。 */
  downloadTemplate({ signal } = {}) {
    return httpClient.getBlob("/api/v1/item-imports/template", { signal });
  },

  /** `idempotent: true` 等 HttpClient 自動加一個隨機 `Idempotency-Key`——
   * 同一個上傳意外重送（例如網路逾時後重試）唔會建多一個 job（route 本身
   * 有 `idempotency: { enabled: true }`，見 uploadItemImportHandler.js）。 */
  uploadJob({ file, mode, signal }) {
    const data = new FormData();
    data.append("mode", mode);
    data.append("file", file);
    return httpClient.post("/api/v1/item-imports/upload", { body: data, idempotent: true, signal });
  },

  listJobs({ page, pageSize, status, signal } = {}) {
    return httpClient.get("/api/v1/item-imports", { params: { page, pageSize, status }, signal });
  },

  getJob(id, { page, pageSize, rowStatus, signal } = {}) {
    return httpClient.get(`/api/v1/item-imports/${id}`, { params: { page, pageSize, rowStatus }, signal });
  },

  confirmJob(id, { reason, version, password }) {
    return httpClient.post(`/api/v1/item-imports/${id}/confirm`, { body: { reason, version, password } });
  },

  cancelJob(id) {
    return httpClient.post(`/api/v1/item-imports/${id}/cancel`, { body: {} });
  },

  downloadResult(id, { signal } = {}) {
    return httpClient.getBlob(`/api/v1/item-imports/${id}/result`, { signal });
  }
};
