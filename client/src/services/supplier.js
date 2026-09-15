import { httpClient } from "@/framework/http/HttpClient.js";

export const service = { name: "supplier" };

export default {
  create(payload) {
    return httpClient.post("/api/v1/suppliers/create", {
      idempotent: true,
      body: payload
    });
  },

  checkDuplicates(payload) {
    return httpClient.post("/api/v1/suppliers/duplicates/check", {
      body: payload
    });
  },

  list({
    page, rowsPerPage, sortBy, descending, filter, status, currencyCode, paymentTermId,
    updatedFrom, updatedTo, includeArchived
  }) {
    return httpClient.get("/api/v1/suppliers", {
      params: {
        page,
        pageSize: rowsPerPage,
        q: filter || undefined,
        status: status || undefined,
        currencyCode: currencyCode || undefined,
        paymentTermId: paymentTermId || undefined,
        updatedFrom,
        updatedTo,
        includeArchived,
        sortBy: sortBy || undefined,
        descending
      }
    }).then(({ items, total }) => ({ rows: items, rowsNumber: total }));
  },

  getById(id) {
    return httpClient.get(`/api/v1/suppliers/${id}`);
  },

  completeness(id) {
    return httpClient.get(`/api/v1/suppliers/${id}/completeness`);
  },

  createAddress(supplierId, payload) {
    return httpClient.post(`/api/v1/suppliers/${supplierId}/addresses/create`, { body: payload });
  },

  updateAddress(supplierId, addressId, payload) {
    return httpClient.post(`/api/v1/suppliers/${supplierId}/addresses/${addressId}/update`, { body: payload });
  },

  deactivateAddress(supplierId, addressId, payload) {
    return httpClient.post(`/api/v1/suppliers/${supplierId}/addresses/${addressId}/deactivate`, { body: payload });
  }
};
