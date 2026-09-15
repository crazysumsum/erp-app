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
  }
};
