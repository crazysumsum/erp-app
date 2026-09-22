import { httpClient } from "@/framework/http/HttpClient.js";

export const service = { name: "customerSettings" };

export default {
  get({ signal } = {}) { return httpClient.get("/api/v1/customer-settings", { signal }); },
  update(payload) { return httpClient.post("/api/v1/customer-settings/update", { body: payload, signed: true }); }
};
