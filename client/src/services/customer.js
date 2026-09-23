import { httpClient } from "@/framework/http/HttpClient.js";

export const service = { name: "customer" };

const write = (path, { idempotencyKey, ...body } = {}, options = {}) => httpClient.post(path, { idempotent: true, idempotencyKey, body, ...options });

async function sha256Hex(file) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export default {
  list({ page, rowsPerPage, sortBy, sortDirection, descending, filter, status, currencyCode, paymentTermId, accountManagerUserId, categoryId, industryId, territoryId, creditStatus, missing, createdFrom, createdTo, updatedFrom, updatedTo, includeArchived, signal } = {}) {
    return httpClient.get("/api/v1/customers", {
      params: { page, pageSize: rowsPerPage, q: filter || undefined, status: status || undefined, currencyCode: currencyCode || undefined, paymentTermId, accountManagerUserId, categoryId, industryId, territoryId, creditStatus, missing, createdFrom, createdTo, updatedFrom, updatedTo, includeArchived, sortBy: sortBy || undefined, sortDirection: sortDirection ?? (descending === undefined ? undefined : descending ? "desc" : "asc") },
      signal
    }).then(({ items, total }) => ({ rows: items, rowsNumber: total }));
  },
  getById(id, { signal } = {}) { return httpClient.get(`/api/v1/customers/${id}`, { signal }); },
  completeness(id, { signal } = {}) { return httpClient.get(`/api/v1/customers/${id}/completeness`, { signal }); },
  getOperation(operationId, { signal } = {}) { return httpClient.get(`/api/v1/customer-operations/${operationId}`, { signal }); },
  addresses(id, { page, rowsPerPage, signal } = {}) { return httpClient.get(`/api/v1/customers/${id}/addresses`, { params: { page, pageSize: rowsPerPage }, signal }); },
  contacts(id, { page, rowsPerPage, signal } = {}) { return httpClient.get(`/api/v1/customers/${id}/contacts`, { params: { page, pageSize: rowsPerPage }, signal }); },
  identifiers(id, { page, rowsPerPage, signal } = {}) { return httpClient.get(`/api/v1/customers/${id}/identifiers`, { params: { page, pageSize: rowsPerPage }, signal }); },
  creditPolicy(id, { signal } = {}) { return httpClient.get(`/api/v1/customers/${id}/credit-policy`, { signal }); },
  bankAccounts(id, options) { return httpClient.get(`/api/v1/customers/${id}/bank-accounts`, options); },
  attachments(id, options) { return httpClient.get(`/api/v1/customers/${id}/attachments`, options); },
  checkDuplicates(payload) { return write("/api/v1/customers/duplicates/check", payload); },
  create(payload) { return write("/api/v1/customers/create", payload); },
  update(id, payload) { return write(`/api/v1/customers/${id}/update`, payload); },
  changeCode(id, payload) { return write(`/api/v1/customers/${id}/code/change`, payload, { signed: true }); },
  activate(id, payload) { return write(`/api/v1/customers/${id}/activate`, payload); },
  suspend(id, payload) { return write(`/api/v1/customers/${id}/suspend`, payload); },
  reactivate(id, payload) { return write(`/api/v1/customers/${id}/reactivate`, payload); },
  archive(id, payload) { return write(`/api/v1/customers/${id}/archive`, payload); },
  restore(id, payload) { return write(`/api/v1/customers/${id}/restore`, payload); },
  deleteCustomer(id, payload) { return write(`/api/v1/customers/${id}/delete`, payload, { signed: true }); },
  block(id, payload) { return write(`/api/v1/customers/${id}/block`, payload, { signed: true }); },
  unblock(id, payload) { return write(`/api/v1/customers/${id}/unblock`, payload, { signed: true }); },
  submitApproval(id, payload) { return write(`/api/v1/customers/${id}/approval/submit`, payload); },
  withdrawApproval(id, payload) { return write(`/api/v1/customers/${id}/approval/withdraw`, payload); },
  createAddress(id, payload) { return write(`/api/v1/customers/${id}/addresses/create`, payload); },
  updateAddress(id, addressId, payload) { return write(`/api/v1/customers/${id}/addresses/${addressId}/update`, payload); },
  deactivateAddress(id, addressId, payload) { return write(`/api/v1/customers/${id}/addresses/${addressId}/deactivate`, payload); },
  createContact(id, payload) { return write(`/api/v1/customers/${id}/contacts/create`, payload); },
  updateContact(id, contactId, payload) { return write(`/api/v1/customers/${id}/contacts/${contactId}/update`, payload); },
  deactivateContact(id, contactId, payload) { return write(`/api/v1/customers/${id}/contacts/${contactId}/deactivate`, payload); },
  createIdentifier(id, payload) { return write(`/api/v1/customers/${id}/identifiers/create`, payload); },
  updateIdentifier(id, identifierId, payload) { return write(`/api/v1/customers/${id}/identifiers/${identifierId}/update`, payload); },
  deactivateIdentifier(id, identifierId, payload) { return write(`/api/v1/customers/${id}/identifiers/${identifierId}/deactivate`, payload); },
  saveCreditPolicy(id, payload) { return write(`/api/v1/customers/${id}/credit-policy/save`, payload); },
  clearCreditPolicy(id, payload) { return write(`/api/v1/customers/${id}/credit-policy/clear`, payload); },
  createBankAccount(id, payload) { return write(`/api/v1/customers/${id}/bank-accounts/create`, payload, { signed: true }); },
  updateBankAccount(id, bankId, payload) { return write(`/api/v1/customers/${id}/bank-accounts/${bankId}/update`, payload, { signed: true }); },
  setDefaultBankAccount(id, bankId, payload) { return write(`/api/v1/customers/${id}/bank-accounts/${bankId}/default`, payload, { signed: true }); },
  deactivateBankAccount(id, bankId, payload) { return write(`/api/v1/customers/${id}/bank-accounts/${bankId}/deactivate`, payload, { signed: true }); },
  revealBankAccount(id, bankId, payload) { return write(`/api/v1/customers/${id}/bank-accounts/${bankId}/reveal`, payload); },
  async uploadAttachment(id, { file, password, ...metadata }) {
    const idempotencyKey = crypto.randomUUID();
    let sessionToken;
    if (metadata.sensitivity === "bank_sensitive") {
      const session = await httpClient.post(`/api/v1/customers/${id}/attachments/upload-session`, {
        signed: true,
        body: { ...metadata, originalFilename: file.name, mimeType: file.type, contentSha256: await sha256Hex(file), password }
      });
      sessionToken = session.token;
    }
    const form = new FormData();
    form.append("file", file, file.name);
    for (const [key, value] of Object.entries({ ...metadata, sessionToken })) {
      if (value !== undefined && value !== null) form.append(key, String(value));
    }
    return httpClient.post(`/api/v1/customers/${id}/attachments/upload`, { idempotent: true, idempotencyKey, body: form });
  },
  updateAttachment(id, attachmentId, payload) { return write(`/api/v1/customers/${id}/attachments/${attachmentId}/update`, payload); },
  deactivateAttachment(id, attachmentId, payload) { return write(`/api/v1/customers/${id}/attachments/${attachmentId}/deactivate`, payload); },
  deleteAttachment(id, attachmentId, payload) { return write(`/api/v1/customers/${id}/attachments/${attachmentId}/delete`, payload, { signed: true }); },
  authorizeAttachmentDownload(id, attachmentId, payload) { return httpClient.post(`/api/v1/customers/${id}/attachments/${attachmentId}/download-session`, { body: payload }); },
  attachmentContent(id, attachmentId, mode, options) { return httpClient.getBlob(`/api/v1/customers/${id}/attachments/${attachmentId}/${mode}`, options); }
};
