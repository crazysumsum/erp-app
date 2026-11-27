import { httpClient } from "@/framework/http/HttpClient.js";

export const service = { name: "referenceLookups" };

async function search(path, q, signal) {
  const { items } = await httpClient.get(path, { params: { page: 1, pageSize: 50, q }, signal });
  return items;
}

export function searchCustomerReferences(query, signal) {
  return search("/api/v1/customer-lookups/references", query, signal);
}

export function searchWarehouseReferences(query, signal) {
  return search("/api/v1/inventory-lookups/warehouses", query, signal);
}

export default { searchCustomerReferences, searchWarehouseReferences };
