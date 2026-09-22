import { httpClient } from "@/framework/http/HttpClient.js";

export const service = { name: "customerApproval" };

const write = (path, { idempotencyKey, ...body } = {}) => httpClient.post(path, { idempotent: true, idempotencyKey, body });

export default {
  eligibleApprovers({ q, excludeUserId, signal } = {}) {
    return httpClient.get("/api/v1/customer-approvers", { params: { q: q || undefined, excludeUserId }, signal });
  },
  queue({ scope, status, requesterId, requestedFrom, requestedTo, page, rowsPerPage, signal } = {}) {
    return httpClient.get("/api/v1/customer-approvals", { params: { scope, status, requesterId, requestedFrom, requestedTo, page, pageSize: rowsPerPage }, signal })
      .then(({ items, total }) => ({ rows: items, rowsNumber: total }));
  },
  get(id, { signal } = {}) { return httpClient.get(`/api/v1/customer-approvals/${id}`, { signal }); },
  approve(id, payload) { return write(`/api/v1/customer-approvals/${id}/approve`, payload); },
  reject(id, payload) { return write(`/api/v1/customer-approvals/${id}/reject`, payload); },
  reassign(id, payload) { return write(`/api/v1/customer-approvals/${id}/reassign`, payload); }
};
