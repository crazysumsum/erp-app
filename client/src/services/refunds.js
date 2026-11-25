import { httpClient } from "@/framework/http/HttpClient.js";

export const service = { name: "refunds" };
// These rejections occur after the command checks for a committed event.
export const REFUND_REJECTIONS = ["REFUND_EXCEEDS_CREDIT", "REFUND_CREDIT_STATE_CONFLICT", "REFUND_STATE_CONFLICT"];

const endpoint = { ar: "/api/v1/ar-refunds", ap: "/api/v1/ap-supplier-refunds" };
const write = (path, body) => httpClient.post(path, { idempotent: true, idempotencyKey: body.eventId, body });

export default {
  list(area, { page, rowsPerPage, signal }) {
    return httpClient.get(endpoint[area], { params: { page, pageSize: rowsPerPage }, signal })
      .then(({ items, total }) => ({ rows: items, rowsNumber: total }));
  },
  detail(area, id, signal) {
    return httpClient.get(`${endpoint[area]}/${id}`, { signal });
  },
  credits(area, page, signal) {
    return httpClient.get(`/api/v1/${area}-credit-notes`, { params: { status: "CONFIRMED", page, pageSize: 20 }, signal });
  },
  credit(area, id, signal) {
    return httpClient.get(`/api/v1/${area}-credit-notes/${id}`, { signal });
  },
  create(area, body) {
    return write(endpoint[area], body);
  },
  change(area, id, action, body) {
    return write(`${endpoint[area]}/${id}/${action}`, body);
  }
};
