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
  listReceipts({ signal, ...query } = {}) {
    return httpClient.get("/api/v1/ar-receipts", { params: listParams(query), signal }).then(({ items, total }) => ({ rows: items, rowsNumber: total }));
  },
  getReceipt(id, { signal } = {}) { return httpClient.get(`/api/v1/ar-receipts/${id}`, { signal }); },
  listCreditNotes({ signal, ...query } = {}) {
    return httpClient.get("/api/v1/ar-credit-notes", { params: listParams(query), signal }).then(({ items, total }) => ({ rows: items, rowsNumber: total }));
  },
  getCreditNote(id, { signal } = {}) { return httpClient.get(`/api/v1/ar-credit-notes/${id}`, { signal }); },
  listCreditReturnSources(invoiceId, { signal } = {}) {
    return httpClient.get(`/api/v1/ar-credit-notes/sources/${invoiceId}/returns`, { signal }).then(({ items }) => items);
  },
  createCreditNote(payload) { return write("/api/v1/ar-credit-notes", payload); },
  editCreditNote(id, payload) { return write(`/api/v1/ar-credit-notes/${id}/edit`, payload); },
  confirmCreditNote(id, payload) { return write(`/api/v1/ar-credit-notes/${id}/confirm`, payload); },
  cancelCreditNote(id, payload) { return write(`/api/v1/ar-credit-notes/${id}/cancel`, payload); },
  voidCreditNote(id, payload) { return write(`/api/v1/ar-credit-notes/${id}/void`, payload); },
  applyCreditNote(id, payload) { return write(`/api/v1/ar-credit-notes/${id}/applications`, payload); },
  unapplyCreditNote(id, applicationId, payload) { return write(`/api/v1/ar-credit-notes/${id}/applications/${applicationId}/unapply`, payload); },
  createReceipt(payload) { return write("/api/v1/ar-receipts", payload); },
  confirmReceipt(id, payload) { return write(`/api/v1/ar-receipts/${id}/confirm`, payload); },
  cancelReceipt(id, payload) { return write(`/api/v1/ar-receipts/${id}/cancel`, payload); },
  voidReceipt(id, payload) { return write(`/api/v1/ar-receipts/${id}/void`, payload); },
  allocateReceipt(id, payload) { return write(`/api/v1/ar-receipts/${id}/allocations`, payload); },
  unapplyAllocation(id, allocationId, payload) { return write(`/api/v1/ar-receipts/${id}/allocations/${allocationId}/unapply`, payload); },
  // 只做今日現況，唔分頁；唔同幣別唔可以相加。
  getAging({ signal, ...query } = {}) { return httpClient.get("/api/v1/ar-aging", { params: listParams(query), signal }); },
  confirmInvoice(id, payload) { return write(`/api/v1/ar-invoices/${id}/confirm`, payload); },
  cancelInvoice(id, payload) { return write(`/api/v1/ar-invoices/${id}/cancel`, payload); },
  voidInvoice(id, payload) { return write(`/api/v1/ar-invoices/${id}/void`, payload); }
};
