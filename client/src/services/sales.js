import { httpClient } from "@/framework/http/HttpClient.js";

export const service = { name: "sales" };
const write = (path, { idempotencyKey, ...body } = {}) => httpClient.post(path, { idempotent: true, idempotencyKey: idempotencyKey ?? body.eventId, body });
const lookup = (kind, { signal, ...params } = {}) => httpClient.get(`/api/v1/sales-lookups/${kind}`, { params, signal });

export default {
  lookupCustomers(query) { return lookup("customers", query); },
  lookupSkus(query) { return lookup("skus", query); },
  lookupWarehouses(query) { return lookup("warehouses", query); },
  lookupChannels(query) { return lookup("channels", query); },
  listQuotations({ rowsPerPage, filter, signal, ...query } = {}) {
    const params = Object.fromEntries(Object.entries({ ...query, pageSize: rowsPerPage ?? query.pageSize, q: filter ?? query.q })
      .filter(([, value]) => value !== undefined && value !== null && value !== ""));
    return httpClient.get("/api/v1/sales-quotations", { params, signal }).then(({ items, total }) => ({ rows: items, rowsNumber: total }));
  },
  getQuotation(id, { signal } = {}) { return httpClient.get(`/api/v1/sales-quotations/${id}`, { signal }); },
  createQuotation(payload) { return write("/api/v1/sales-quotations/create", payload); },
  updateQuotation(id, payload) { return write(`/api/v1/sales-quotations/${id}/update`, payload); },
  issueQuotation(id, payload) { return write(`/api/v1/sales-quotations/${id}/issue`, payload); },
  cancelQuotation(id, payload) { return write(`/api/v1/sales-quotations/${id}/cancel`, payload); },
  convertQuotation(id, payload) { return write(`/api/v1/sales-quotations/${id}/convert`, payload); },
  getOrder(id, { signal } = {}) { return httpClient.get(`/api/v1/sales-orders/${id}`, { signal }); },
  listOrders({ rowsPerPage, filter, signal, ...query } = {}) {
    const params=Object.fromEntries(Object.entries({...query,pageSize:rowsPerPage??query.pageSize,q:filter??query.q}).filter(([,value])=>value!==undefined&&value!==null&&value!==""));
    return httpClient.get("/api/v1/sales-orders",{params,signal}).then(({items,total})=>({rows:items,rowsNumber:total}));
  },
  createOrder(payload) { return write("/api/v1/sales-orders/create", payload); },
  updateOrder(id, payload) { return write(`/api/v1/sales-orders/${id}/update`, payload); }
};
