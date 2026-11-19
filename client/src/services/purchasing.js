import { httpClient } from "@/framework/http/HttpClient.js";

export const service = { name: "purchasing" };
const write = (path, body, options = {}) => httpClient.post(path, { idempotent: true, idempotencyKey: body.eventId, body, ...options });
const lookup = (kind, { signal, ...params } = {}) => httpClient.get(`/api/v1/purchasing-lookups/${kind}`, { params, signal }).then(({ items }) => items);

export default {
  lookupSuppliers(query) { return lookup("suppliers", query); },
  getSupplierDefaults(id, { signal } = {}) { return httpClient.get(`/api/v1/purchasing-lookups/suppliers/${id}/defaults`, { signal }); },
  lookupSkus(query) { return lookup("skus", query); },
  lookupCurrencies(query) { return lookup("currencies", query); },
  lookupPaymentTerms(query) { return lookup("payment-terms", query); },
  lookupWarehouses(query) { return lookup("warehouses", query); },
  lookupBuyers(query) { return lookup("buyers", query); },
  listPurchaseOrders({ rowsPerPage, filter, signal, ...query } = {}) {
    const params = Object.fromEntries(Object.entries({ ...query, pageSize: rowsPerPage ?? query.pageSize, q: filter ?? query.q })
      .filter(([, value]) => value !== undefined && value !== null && value !== ""));
    return httpClient.get("/api/v1/purchase-orders", { params, signal }).then(({ items, total }) => ({ rows: items, rowsNumber: total }));
  },
  getPurchaseOrder(id, { signal } = {}) { return httpClient.get(`/api/v1/purchase-orders/${id}`, { signal }); },
  createPurchaseOrder(payload) { return write("/api/v1/purchase-orders/create", payload); },
  updatePurchaseOrder(id, payload) { return write(`/api/v1/purchase-orders/${id}/update`, payload); },
  submitPurchaseOrder(id, payload) { return write(`/api/v1/purchase-orders/${id}/submit`, payload); },
  copyPurchaseOrder(id, payload) { return write(`/api/v1/purchase-orders/${id}/copy`, payload); },
  // 回 { requireApproval, items }：提交對話框要知審批開唔開（HD-022 a）。
  lookupApprovers({ signal, ...params } = {}) { return httpClient.get("/api/v1/purchasing-lookups/approvers", { params, signal }); },
  listMyApprovals({ rowsPerPage, filter, signal, page, supplierId } = {}) {
    const params = Object.fromEntries(Object.entries({ page, pageSize: rowsPerPage, q: filter, supplierId }).filter(([, value]) => value !== undefined && value !== null && value !== ""));
    return httpClient.get("/api/v1/purchase-order-approvals/mine", { params, signal }).then(({ items, total }) => ({ rows: items, rowsNumber: total }));
  },
  approvePurchaseOrder(id, payload) { return write(`/api/v1/purchase-orders/${id}/approval/approve`, payload); },
  rejectPurchaseOrder(id, payload) { return write(`/api/v1/purchase-orders/${id}/approval/reject`, payload); },
  withdrawPurchaseOrderApproval(id, payload) { return write(`/api/v1/purchase-orders/${id}/approval/withdraw`, payload); },
  getSettings({ signal } = {}) { return httpClient.get("/api/v1/purchasing-settings", { signal }); },
  // jwt-device-password：要裝置簽章（§6.2）。
  updateSettings(payload) { return write("/api/v1/purchasing-settings/update", payload, { signed: true }); }
};
