import { httpClient } from "@/framework/http/HttpClient.js";

export const service = { name: "inventory" };

const write = (path, { idempotencyKey, ...body } = {}, options = {}) =>
  httpClient.post(path, { idempotent: true, idempotencyKey, body, ...options });

function list(path, { page, rowsPerPage, filter, status, lockStatus, sortBy, descending, signal, ...filters } = {}) {
  const params = Object.fromEntries(Object.entries({
    page, pageSize: rowsPerPage, q: filter || undefined, status: status || undefined,
    ...(lockStatus ? { lockStatus } : {}), sortBy: sortBy || undefined, descending, ...filters
  }).filter(([, value]) => value !== undefined && value !== null && value !== ""));
  return httpClient.get(path, {
    params,
    signal
  }).then(({ items, total }) => ({ rows: items, rowsNumber: total }));
}

export default {
  listWarehouses(options) { return list("/api/v1/inventory/warehouses", options); },
  getWarehouse(id, { signal } = {}) { return httpClient.get(`/api/v1/inventory/warehouses/${id}`, { signal }); },
  createWarehouse(payload) { return write("/api/v1/inventory/warehouses/create", payload); },
  updateWarehouse(id, payload) { return write(`/api/v1/inventory/warehouses/${id}/update`, payload); },
  deactivateWarehouse(id, payload) { return write(`/api/v1/inventory/warehouses/${id}/deactivate`, payload); },
  reactivateWarehouse(id, payload) { return write(`/api/v1/inventory/warehouses/${id}/reactivate`, payload); },
  deleteWarehouse(id, payload) { return write(`/api/v1/inventory/warehouses/${id}/delete`, payload, { signed: true }); },
  listBins(warehouseId, options) { return list(`/api/v1/inventory/warehouses/${warehouseId}/bins`, options); },
  getBin(warehouseId, binId, { signal } = {}) { return httpClient.get(`/api/v1/inventory/warehouses/${warehouseId}/bins/${binId}`, { signal }); },
  createBin(warehouseId, payload) { return write(`/api/v1/inventory/warehouses/${warehouseId}/bins/create`, payload); },
  updateBin(warehouseId, binId, payload) { return write(`/api/v1/inventory/warehouses/${warehouseId}/bins/${binId}/update`, payload); },
  deactivateBin(warehouseId, binId, payload) { return write(`/api/v1/inventory/warehouses/${warehouseId}/bins/${binId}/deactivate`, payload); },
  reactivateBin(warehouseId, binId, payload) { return write(`/api/v1/inventory/warehouses/${warehouseId}/bins/${binId}/reactivate`, payload); },
  deleteBin(warehouseId, binId, payload) { return write(`/api/v1/inventory/warehouses/${warehouseId}/bins/${binId}/delete`, payload, { signed: true }); },
  listStockAggregates(options) { return list("/api/v1/inventory/stocks/aggregates", options); },
  listStocks(options) { return list("/api/v1/inventory/stocks", options); },
  getStock(balanceId, { signal } = {}) { return httpClient.get(`/api/v1/inventory/stocks/${balanceId}`, { signal }); },
  getStockSummary(params, { signal } = {}) { return httpClient.get("/api/v1/inventory/stocks/summary", { params, signal }); },
  listLots(options) { return list("/api/v1/inventory/lots", options); },
  listExpiry(options) { return list("/api/v1/inventory/expiry", options); },
  listMovements(options) { return list("/api/v1/inventory/movements", options); },
  getMovement(id, { signal } = {}) { return httpClient.get(`/api/v1/inventory/movements/${id}`, { signal }); },
  createReservation(payload) { return write("/api/v1/inventory/reservations/create", payload); }
};
