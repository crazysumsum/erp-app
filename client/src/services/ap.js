import { httpClient } from "@/framework/http/HttpClient.js";

export const service = { name: "ap" };
// 命令：Idempotency-Key 一定要同 body.eventId 逐字相同（契約共同規則）。
const write = (path, body) => httpClient.post(path, { idempotent: true, idempotencyKey: body.eventId, body });
// Server schema 唔收 sortBy／descending（固定新到舊），亦唔收空字串，所以只送有值嘅 filter。
const listParams = ({ page, rowsPerPage, filter, q, ...query }) => Object.fromEntries(Object.entries({ page, pageSize: rowsPerPage, q: filter ?? q, ...query })
  .filter(([key, value]) => !["sortBy", "descending"].includes(key) && value !== undefined && value !== null && value !== ""));

export default {
  listInvoices({ signal, ...query } = {}) {
    return httpClient.get("/api/v1/ap-invoices", { params: listParams(query), signal }).then(({ items, total }) => ({ rows: items, rowsNumber: total }));
  },
  getInvoice(id, { signal } = {}) { return httpClient.get(`/api/v1/ap-invoices/${id}`, { signal }); },
  createInvoice(payload) { return write("/api/v1/ap-invoices", payload); },
  updateInvoice(id, payload) { return write(`/api/v1/ap-invoices/${id}/update`, payload); },
  // 所問收貨之中已在有效發票上嘅；server 最多收 100 個 ID。
  listInvoicedReceipts(goodsReceiptIds, { signal } = {}) {
    if (!goodsReceiptIds.length) return Promise.resolve([]);
    return httpClient.get("/api/v1/ap-invoiced-receipts", { params: { goodsReceiptIds: goodsReceiptIds.join(",") }, signal }).then(({ items }) => items);
  },
  listPayments({ signal, ...query } = {}) {
    return httpClient.get("/api/v1/ap-payments", { params: listParams(query), signal }).then(({ items, total }) => ({ rows: items, rowsNumber: total }));
  },
  getPayment(id, { signal } = {}) { return httpClient.get(`/api/v1/ap-payments/${id}`, { signal }); },
  createPayment(payload) { return write("/api/v1/ap-payments", payload); },
  confirmPayment(id, payload) { return write(`/api/v1/ap-payments/${id}/confirm`, payload); },
  cancelPayment(id, payload) { return write(`/api/v1/ap-payments/${id}/cancel`, payload); },
  voidPayment(id, payload) { return write(`/api/v1/ap-payments/${id}/void`, payload); },
  allocatePayment(id, payload) { return write(`/api/v1/ap-payments/${id}/allocations`, payload); },
  unapplyAllocation(id, allocationId, payload) { return write(`/api/v1/ap-payments/${id}/allocations/${allocationId}/unapply`, payload); },
  // 只做今日現況，唔分頁；唔同幣別唔可以相加。
  getAging({ signal, ...query } = {}) { return httpClient.get("/api/v1/ap-aging", { params: listParams(query), signal }); },
  confirmInvoice(id, payload) { return write(`/api/v1/ap-invoices/${id}/confirm`, payload); },
  cancelInvoice(id, payload) { return write(`/api/v1/ap-invoices/${id}/cancel`, payload); },
  voidInvoice(id, payload) { return write(`/api/v1/ap-invoices/${id}/void`, payload); }
};
