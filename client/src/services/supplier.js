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

  update(id, payload) {
    return httpClient.post(`/api/v1/suppliers/${id}/update`, { body: payload });
  },

  changeCode(id, payload) {
    return httpClient.post(`/api/v1/suppliers/${id}/code/change`, { body: payload, signed: true });
  },

  createAddress(supplierId, payload) {
    return httpClient.post(`/api/v1/suppliers/${supplierId}/addresses/create`, { body: payload });
  },

  updateAddress(supplierId, addressId, payload) {
    return httpClient.post(`/api/v1/suppliers/${supplierId}/addresses/${addressId}/update`, { body: payload });
  },

  deactivateAddress(supplierId, addressId, payload) {
    return httpClient.post(`/api/v1/suppliers/${supplierId}/addresses/${addressId}/deactivate`, { body: payload });
  },

  createContact(supplierId, payload) {
    return httpClient.post(`/api/v1/suppliers/${supplierId}/contacts/create`, { body: payload });
  },

  updateContact(supplierId, contactId, payload) {
    return httpClient.post(`/api/v1/suppliers/${supplierId}/contacts/${contactId}/update`, { body: payload });
  },

  deactivateContact(supplierId, contactId, payload) {
    return httpClient.post(`/api/v1/suppliers/${supplierId}/contacts/${contactId}/deactivate`, { body: payload });
  },

  createIdentifier(supplierId, payload) {
    return httpClient.post(`/api/v1/suppliers/${supplierId}/identifiers/create`, { body: payload });
  },

  updateIdentifier(supplierId, identifierId, payload) {
    return httpClient.post(`/api/v1/suppliers/${supplierId}/identifiers/${identifierId}/update`, { body: payload });
  },

  deleteIdentifier(supplierId, identifierId, payload) {
    return httpClient.post(`/api/v1/suppliers/${supplierId}/identifiers/${identifierId}/delete`, { body: payload });
  }
};
