import { httpClient } from "@/framework/http/HttpClient.js";

export const service = { name: "supplierImport" };

/** Supplier import job API（T44；設計 §6.9）。List／detail 映射成 DataTable 嘅 `{ rows, rowsNumber }`。 */
export default {
  listJobs({ page, rowsPerPage, status, signal } = {}) {
    return httpClient.get("/api/v1/supplier-imports", {
      params: { page, pageSize: rowsPerPage, status: status || undefined }, signal
    }).then(({ items, total }) => ({ rows: items, rowsNumber: total }));
  },

  getJob(id, { page, rowsPerPage, rowStatus, signal } = {}) {
    return httpClient.get(`/api/v1/supplier-imports/${id}`, {
      params: { page, pageSize: rowsPerPage, rowStatus: rowStatus || undefined }, signal
    }).then(({ job, rows, total }) => ({ job, rows, rowsNumber: total }));
  },

  /** 每次呼叫一條新 idempotency key；重按會收到 409（version 已經變），唔會取消兩次。 */
  cancelJob(id, version) {
    return httpClient.post(`/api/v1/supplier-imports/${id}/cancel`, { body: { version }, idempotent: true });
  }
};
