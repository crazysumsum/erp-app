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

  /** 帶 idempotency key：網絡重送唔會變成第二次取消（409）。 */
  cancelJob(id, version) {
    return httpClient.post(`/api/v1/supplier-imports/${id}/cancel`, { body: { version }, idempotent: true });
  }
};
