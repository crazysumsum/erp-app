import { httpClient } from "@/framework/http/HttpClient.js";

export const service = { name: "businessMaster" };

const BASE = "/api/v1/business-master";
const writeOptions = (body, idempotencyKey) => ({
  body,
  idempotent: true,
  ...(idempotencyKey ? { idempotencyKey } : {})
});

function list(path, { page, rowsPerPage, sortBy, descending, filter, status }) {
  return httpClient
    .get(`${BASE}/${path}`, {
      params: {
        page,
        pageSize: rowsPerPage,
        sort: sortBy || undefined,
        descending,
        q: filter || undefined,
        status: status || undefined
      }
    })
    .then(({ items, total }) => ({ rows: items, rowsNumber: total }));
}

export default {
  currencyList(options) {
    return list("currencies", options);
  },

  createCurrency({ code, name, decimalPlaces }) {
    return httpClient.post(`${BASE}/currencies`, writeOptions({ code, name, decimalPlaces }));
  },

  updateCurrency(code, { name, version }) {
    return httpClient.patch(`${BASE}/currencies/${code}`, writeOptions({ name, version }));
  },

  previewCurrencyImpact(code, { operation, version, proposedChange }) {
    return httpClient.post(
      `${BASE}/currencies/${code}/impact-preview`,
      writeOptions({ operation, version, proposedChange })
    );
  },

  activateCurrency(code, { version, reason }) {
    return httpClient.post(`${BASE}/currencies/${code}/activate`, writeOptions({ version, reason }));
  },

  deactivateCurrency(code, { version, reason, impactToken, idempotencyKey }) {
    return httpClient.post(
      `${BASE}/currencies/${code}/deactivate`,
      writeOptions({ version, reason, impactToken }, idempotencyKey)
    );
  },

  changeCurrencyPrecision(code, { decimalPlaces, version, reason, impactToken, idempotencyKey }) {
    return httpClient.post(
      `${BASE}/currencies/${code}/change-precision`,
      writeOptions({ decimalPlaces, version, reason, impactToken }, idempotencyKey)
    );
  },

  paymentTermList(options) {
    return list("payment-terms", options);
  },

  createPaymentTerm({ code, name, description, calculationType, dueDays }) {
    return httpClient.post(
      `${BASE}/payment-terms`,
      writeOptions({ code, name, description, calculationType, dueDays })
    );
  },

  updatePaymentTerm(id, { name, description, version }) {
    return httpClient.patch(
      `${BASE}/payment-terms/${id}`,
      writeOptions({ name, description, version })
    );
  },

  previewPaymentTermImpact(id, { operation, version, proposedChange }) {
    return httpClient.post(
      `${BASE}/payment-terms/${id}/impact-preview`,
      writeOptions({ operation, version, proposedChange })
    );
  },

  activatePaymentTerm(id, { version, reason }) {
    return httpClient.post(`${BASE}/payment-terms/${id}/activate`, writeOptions({ version, reason }));
  },

  deactivatePaymentTerm(id, { version, reason, impactToken, idempotencyKey }) {
    return httpClient.post(
      `${BASE}/payment-terms/${id}/deactivate`,
      writeOptions({ version, reason, impactToken }, idempotencyKey)
    );
  },

  changePaymentTermRule(id, { calculationType, dueDays, version, reason, impactToken, idempotencyKey }) {
    return httpClient.post(
      `${BASE}/payment-terms/${id}/change-rule`,
      writeOptions({ calculationType, dueDays, version, reason, impactToken }, idempotencyKey)
    );
  },

  calculatePaymentTerm(id, { baseDate, expectedVersion }) {
    return httpClient.post(
      `${BASE}/payment-terms/${id}/calculate`,
      writeOptions({ baseDate, expectedVersion })
    );
  },

  auditList({ entityType, entityKey, action, actorUserId, from, to, page, rowsPerPage }) {
    return httpClient.get(`${BASE}/audit`, {
      params: { entityType, entityKey, action, actorUserId, from, to, page, pageSize: rowsPerPage }
    });
  }
};
