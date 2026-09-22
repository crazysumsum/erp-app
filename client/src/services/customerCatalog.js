import { httpClient } from "@/framework/http/HttpClient.js";

export const service = { name: "customerCatalog" };

export default {
  list(catalog, { includeInactive = false, signal } = {}) {
    return httpClient.get(`/api/v1/customer-catalog/${catalog}`, { params: { includeInactive }, signal });
  },
  create(catalog, payload) { return httpClient.post(`/api/v1/customer-catalog/${catalog}/create`, { body: payload, signed: true }); },
  update(catalog, id, payload) { return httpClient.post(`/api/v1/customer-catalog/${catalog}/${id}/update`, { body: payload, signed: true }); },
  deactivate(catalog, id, payload) { return httpClient.post(`/api/v1/customer-catalog/${catalog}/${id}/deactivate`, { body: payload, signed: true }); }
};
