import { httpClient } from "@/framework/http/HttpClient.js";

export const service = { name: "customerImport" };

export default {
  downloadTemplate({ signal } = {}) { return httpClient.getBlob("/api/v1/customer-imports/template", { signal }); },
  uploadJob({ file, mode, signal }) {
    const body = new FormData(); body.append("mode", mode); body.append("file", file);
    return httpClient.post("/api/v1/customer-imports/upload", { body, idempotent: true, signal });
  },
  listJobs({ page, pageSize, status, signal } = {}) {
    return httpClient.get("/api/v1/customer-imports", { params: { page, pageSize, status }, signal });
  },
  getJob(id, { page, pageSize, rowStatus, signal } = {}) {
    return httpClient.get(`/api/v1/customer-imports/${id}`, { params: { page, pageSize, rowStatus }, signal });
  },
  confirmJob(id, { version, activationMode, approverUserId, password }) {
    return httpClient.post(`/api/v1/customer-imports/${id}/confirm`, {
      body: { version, activationMode, approverUserId: approverUserId || undefined, password }, idempotent: true
    });
  },
  cancelJob(id, version) { return httpClient.post(`/api/v1/customer-imports/${id}/cancel`, { body: { version } }); },
  downloadResult(id, { signal } = {}) { return httpClient.getBlob(`/api/v1/customer-imports/${id}/result`, { signal }); },
  createExport({ filters, password }) {
    return httpClient.post("/api/v1/customer-exports/create", { body: { filters, password }, idempotent: true });
  },
  getExport(id, { signal } = {}) { return httpClient.get(`/api/v1/customer-exports/${id}`, { signal }); },
  downloadExport(id, { signal } = {}) { return httpClient.getBlob(`/api/v1/customer-exports/${id}/result`, { signal }); }
};
