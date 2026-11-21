import { httpClient } from "@/framework/http/HttpClient.js";

export const service = { name: "ar" };
// 命令：Idempotency-Key 一定要同 body.eventId 逐字相同（契約共同規則）。
const write = (path, body) => httpClient.post(path, { idempotent: true, idempotencyKey: body.eventId, body });
// Server schema 唔收 sortBy／descending（固定新到舊），亦唔收空字串，所以只送有值嘅 filter。
const listParams = ({ page, rowsPerPage, filter, q, ...query }) => Object.fromEntries(Object.entries({ page, pageSize: rowsPerPage, q: filter ?? q, ...query })
  .filter(([key, value]) => !["sortBy", "descending"].includes(key) && value !== undefined && value !== null && value !== ""));

export default {
  listInvoices({ signal, ...query } = {}) {
    return httpClient.get("/api/v1/ar-invoices", { params: listParams(query), signal }).then(({ items, total }) => ({ rows: items, rowsNumber: total }));
  },
  getInvoice(id, { signal } = {}) { return httpClient.get(`/api/v1/ar-invoices/${id}`, { signal }); },
  createInvoice(payload) { return write("/api/v1/ar-invoices", payload); },
  // 所問出貨之中已在有效發票上嘅；server 最多收 100 個 ID。
  listInvoicedShipments(shipmentIds, { signal } = {}) {
    if (!shipmentIds.length) return Promise.resolve([]);
    return httpClient.get("/api/v1/ar-invoiced-shipments", { params: { shipmentIds: shipmentIds.join(",") }, signal }).then(({ items }) => items);
  },
  confirmInvoice(id, payload) { return write(`/api/v1/ar-invoices/${id}/confirm`, payload); },
  cancelInvoice(id, payload) { return write(`/api/v1/ar-invoices/${id}/cancel`, payload); },
  voidInvoice(id, payload) { return write(`/api/v1/ar-invoices/${id}/void`, payload); }
};
