import { httpClient } from "@/framework/http/HttpClient.js";

export const service = { name: "returns" };
const base = (kind) => `/api/v1/${kind}-returns`;
const write = (path, body) => httpClient.post(path, { idempotent: true, idempotencyKey: body.eventId, body });

export default {
  list(kind, { page, rowsPerPage, status, signal }) {
    return httpClient.get(base(kind), { params: { page, pageSize: rowsPerPage, ...(status ? { status } : {}) }, signal })
      .then(({ items, total }) => ({ rows: items, rowsNumber: total }));
  },
  detail(kind, id, signal) { return httpClient.get(`${base(kind)}/${id}`, { signal }); },
  source(kind, reference, signal) { return httpClient.get(`${base(kind)}/sources/${encodeURIComponent(reference)}`, { signal }); },
  create(kind, body) { return write(base(kind), body); },
  cancel(kind, id, body) { return write(`${base(kind)}/${id}/cancel`, body); },
  post(kind, id, body) { return write(`${base(kind)}/${id}/post`, body); }
};
