import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { CustomerAttachmentAccessToken, customerAttachmentUploadBinding } from "../../modules/customer/CustomerAttachmentAccessToken.js";
import { CustomerAttachmentService } from "../../modules/customer/CustomerAttachmentService.js";
import { customerAttachmentError } from "../../modules/customer/customerErrors.js";
import { CUSTOMER_ROUTE_POLICIES } from "../../modules/customer/customerPermissions.js";
import { ClamdScanner } from "../../services/customerFile/ClamdScanner.js";
import { CustomerAttachmentStorage } from "../../services/customerFile/CustomerAttachmentStorage.js";
import {
  CUSTOMER_ATTACHMENT_DELETE, CUSTOMER_ATTACHMENT_DELETE_RESPONSE, CUSTOMER_ATTACHMENT_DOWNLOAD_SESSION,
  CUSTOMER_ATTACHMENT_EMPTY, CUSTOMER_ATTACHMENT_LIST_RESPONSE, CUSTOMER_ATTACHMENT_PARAMS,
  CUSTOMER_ATTACHMENT_PARENT_PARAMS, CUSTOMER_ATTACHMENT_RESPONSE, CUSTOMER_ATTACHMENT_SESSION_RESPONSE,
  CUSTOMER_ATTACHMENT_UPDATE, CUSTOMER_ATTACHMENT_UPLOAD, CUSTOMER_ATTACHMENT_UPLOAD_SESSION,
  CUSTOMER_ATTACHMENT_VERSIONED
} from "./customerAttachmentSchemas.js";

const IDEMPOTENT = Object.freeze({ enabled: true });
const DOWNLOAD = Object.freeze({ enabled: true });
const FAILURE_ACTIONS = Object.freeze({
  listCustomerAttachments: "attachment.view", authorizeCustomerAttachmentUpload: "attachment.upload",
  uploadCustomerAttachment: "attachment.upload", updateCustomerAttachment: "attachment.update",
  deactivateCustomerAttachment: "attachment.deactivate", deleteCustomerAttachment: "attachment.delete",
  downloadCustomerAttachment: "attachment.download", previewCustomerAttachment: "attachment.view"
});
const UPLOAD = Object.freeze({
  enabled: true, memoryOnly: true, maxFileSizeBytes: 20 * 1024 * 1024, maxFiles: 1,
  maxTotalFileBytes: 20 * 1024 * 1024, maxRequestBytes: 21 * 1024 * 1024, maxFieldCount: 12,
  allowedMimeTypes: ["application/pdf", "image/png", "image/jpeg", "image/webp"]
});

function actor(req) {
  return {
    actorId: Number(req.auth.claims.sub), claimedRoles: req.auth.claims.roles,
    claimedPermissions: req.auth.claims.permissions, requestId: req.requestId ?? "",
    ip: req.ip || req.socket?.remoteAddress || ""
  };
}

class CustomerAttachmentHandler extends BaseRequestHandler {
  constructor(services = {}) {
    super(services);
    const config = services.config.customer;
    const attachment = config.attachment;
    if (!attachment) { this.attachments = null; return; }
    const time = services.require("time");
    const accessTokens = new CustomerAttachmentAccessToken({ encryption: config.bankEncryption, time });
    const storage = new CustomerAttachmentStorage({
      config: attachment, encryption: config.bankEncryption,
      scanner: new ClamdScanner(attachment.malwareScanner), fileTypes: services.require("filetypes")
    });
    this.attachments = new CustomerAttachmentService({ database: services.require("mysqldatabase"), time, storage, accessTokens });
  }

  requireAttachments() {
    if (!this.attachments) throw customerAttachmentError("CUSTOMER_ATTACHMENT_UNAVAILABLE", 503, "附件功能目前未啟用");
    return this.attachments;
  }

  async auditFailure(req, error) {
    const actorId = Number(req.auth?.claims?.sub);
    if (!this.attachments || !Number.isSafeInteger(actorId) || actorId < 1) return;
    const body = req.input?.body || req.body || {};
    const action = this.handlerName === "authorizeCustomerAttachmentDownload"
      ? (body.mode === "preview" ? "attachment.view" : "attachment.download")
      : FAILURE_ACTIONS[this.handlerName];
    if (!action) return;
    await this.attachments.auditFailure({
      actorId, action, customerId: Number(req.input?.params?.id ?? req.params?.id),
      attachmentId: Number(req.input?.params?.attachmentId ?? req.params?.attachmentId),
      sensitivity: body.sensitivity, errorCode: error.publicCode || error.code,
      requestId: req.requestId ?? "", ip: req.ip || req.socket?.remoteAddress || ""
    });
  }
}

export class ListCustomerAttachmentsHandler extends CustomerAttachmentHandler {
  static handlerName = "listCustomerAttachments";
  static api = { method: "GET", path: "/api/v1/customers/:id/attachments", description: "列出客戶附件。", authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.generalRead], requestSchema: { params: CUSTOMER_ATTACHMENT_PARENT_PARAMS, query: CUSTOMER_ATTACHMENT_EMPTY }, responseSchema: { 200: CUSTOMER_ATTACHMENT_LIST_RESPONSE } };
  async execute(req) { return this.response(await this.requireAttachments().list({ ...actor(req), customerId: Number(req.input.params.id) })); }
}

export class AuthorizeCustomerAttachmentUploadHandler extends CustomerAttachmentHandler {
  static handlerName = "authorizeCustomerAttachmentUpload";
  static api = { method: "POST", path: "/api/v1/customers/:id/attachments/upload-session", description: "重新驗證敏感附件上傳。", authType: "jwt-device-password", authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.bankManage], requestSchema: { params: CUSTOMER_ATTACHMENT_PARENT_PARAMS, query: CUSTOMER_ATTACHMENT_EMPTY, body: CUSTOMER_ATTACHMENT_UPLOAD_SESSION }, responseSchema: { 200: CUSTOMER_ATTACHMENT_SESSION_RESPONSE } };
  async execute(req) {
    const body = req.input.body;
    return this.response(await this.requireAttachments().issueUploadSession({ ...actor(req), customerId: Number(req.input.params.id), ...body, binding: customerAttachmentUploadBinding(body) }));
  }
}

export class UploadCustomerAttachmentHandler extends CustomerAttachmentHandler {
  static handlerName = "uploadCustomerAttachment";
  static api = { method: "POST", path: "/api/v1/customers/:id/attachments/upload", description: "上傳客戶附件。", authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.generalRead], idempotency: IDEMPOTENT, upload: UPLOAD, requestSchema: { params: CUSTOMER_ATTACHMENT_PARENT_PARAMS, query: CUSTOMER_ATTACHMENT_EMPTY, body: CUSTOMER_ATTACHMENT_UPLOAD }, responseSchema: { 201: CUSTOMER_ATTACHMENT_RESPONSE } };
  async execute(req) {
    const file = req.files?.[0];
    if (!file || req.files.length !== 1) throw customerAttachmentError("CUSTOMER_ATTACHMENT_REJECTED", 422, "請選擇一個有效附件");
    const bindingInput = { ...req.input.body, originalFilename: file.originalName, mimeType: file.mimeType, contentSha256: file.contentHash };
    try {
      return this.response(await this.requireAttachments().create({
        ...actor(req), customerId: Number(req.input.params.id), ...req.input.body,
        originalFilename: file.originalName, mimeType: file.mimeType, content: file.buffer,
        idempotencyKey: req.get("idempotency-key"), binding: customerAttachmentUploadBinding(bindingInput)
      }), { statusCode: 201 });
    } finally {
      file.buffer.fill(0); req.files = Object.freeze([]);
    }
  }
}

export class UpdateCustomerAttachmentHandler extends CustomerAttachmentHandler {
  static handlerName = "updateCustomerAttachment";
  static api = { method: "POST", path: "/api/v1/customers/:id/attachments/:attachmentId/update", description: "更新客戶附件顯示資料。", authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.generalRead], idempotency: IDEMPOTENT, requestSchema: { params: CUSTOMER_ATTACHMENT_PARAMS, query: CUSTOMER_ATTACHMENT_EMPTY, body: CUSTOMER_ATTACHMENT_UPDATE }, responseSchema: { 200: CUSTOMER_ATTACHMENT_RESPONSE } };
  async execute(req) { return this.response(await this.requireAttachments().update({ ...actor(req), customerId: Number(req.input.params.id), attachmentId: Number(req.input.params.attachmentId), ...req.input.body })); }
}

export class DeactivateCustomerAttachmentHandler extends CustomerAttachmentHandler {
  static handlerName = "deactivateCustomerAttachment";
  static api = { method: "POST", path: "/api/v1/customers/:id/attachments/:attachmentId/deactivate", description: "停用客戶附件。", authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.generalRead], idempotency: IDEMPOTENT, requestSchema: { params: CUSTOMER_ATTACHMENT_PARAMS, query: CUSTOMER_ATTACHMENT_EMPTY, body: CUSTOMER_ATTACHMENT_VERSIONED }, responseSchema: { 200: CUSTOMER_ATTACHMENT_RESPONSE } };
  async execute(req) { return this.response(await this.requireAttachments().deactivate({ ...actor(req), customerId: Number(req.input.params.id), attachmentId: Number(req.input.params.attachmentId), ...req.input.body })); }
}

export class DeleteCustomerAttachmentHandler extends CustomerAttachmentHandler {
  static handlerName = "deleteCustomerAttachment";
  static api = { method: "POST", path: "/api/v1/customers/:id/attachments/:attachmentId/delete", description: "永久刪除未引用的草稿客戶附件。", authType: "jwt-device-password", authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.generalRead], idempotency: IDEMPOTENT, requestSchema: { params: CUSTOMER_ATTACHMENT_PARAMS, query: CUSTOMER_ATTACHMENT_EMPTY, body: CUSTOMER_ATTACHMENT_DELETE }, responseSchema: { 200: CUSTOMER_ATTACHMENT_DELETE_RESPONSE } };
  async execute(req) { return this.response(await this.requireAttachments().delete({ ...actor(req), customerId: Number(req.input.params.id), attachmentId: Number(req.input.params.attachmentId), ...req.input.body })); }
}

export class AuthorizeCustomerAttachmentDownloadHandler extends CustomerAttachmentHandler {
  static handlerName = "authorizeCustomerAttachmentDownload";
  static api = { method: "POST", path: "/api/v1/customers/:id/attachments/:attachmentId/download-session", description: "重新驗證敏感附件下載或預覽。", authType: "jwt-password", authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.bankReveal], requestSchema: { params: CUSTOMER_ATTACHMENT_PARAMS, query: CUSTOMER_ATTACHMENT_EMPTY, body: CUSTOMER_ATTACHMENT_DOWNLOAD_SESSION }, responseSchema: { 200: CUSTOMER_ATTACHMENT_SESSION_RESPONSE } };
  async execute(req, res) {
    res.setHeader("Pragma", "no-cache");
    return this.response(await this.requireAttachments().issueDownloadSession({ ...actor(req), customerId: Number(req.input.params.id), attachmentId: Number(req.input.params.attachmentId), ...req.input.body }));
  }
}

class ReadCustomerAttachmentHandler extends CustomerAttachmentHandler {
  async read(req, res, mode) {
    const result = await this.requireAttachments().read({
      ...actor(req), customerId: Number(req.input.params.id), attachmentId: Number(req.input.params.attachmentId),
      mode, sessionToken: req.get("x-customer-attachment-session")
    });
    res.setHeader("Pragma", "no-cache"); res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'"); res.setHeader("Accept-Ranges", "bytes");
    let content = result.content; let statusCode = 200;
    const range = String(req.get("range") || "");
    if (range) {
      const match = /^bytes=(\d+)-(\d*)$/u.exec(range);
      const start = Number(match?.[1]); const end = match?.[2] ? Number(match[2]) : content.length - 1;
      if (!match || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || end >= content.length) {
        throw customerAttachmentError("CUSTOMER_ATTACHMENT_RANGE_INVALID", 416, "附件範圍無效");
      }
      res.setHeader("Content-Range", `bytes ${start}-${end}/${content.length}`);
      content = content.subarray(start, end + 1); statusCode = 206;
    }
    return this.file({ buffer: content, fileName: result.attachment.originalFilename, contentType: result.attachment.mimeType, statusCode });
  }
}

export class DownloadCustomerAttachmentHandler extends ReadCustomerAttachmentHandler {
  static handlerName = "downloadCustomerAttachment";
  static api = { method: "GET", path: "/api/v1/customers/:id/attachments/:attachmentId/download", description: "下載客戶附件。", authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.generalRead], download: DOWNLOAD, requestSchema: { params: CUSTOMER_ATTACHMENT_PARAMS, query: CUSTOMER_ATTACHMENT_EMPTY }, responseSchema: { 200: { type: "object", additionalProperties: true }, 206: { type: "object", additionalProperties: true } } };
  async execute(req, res) { return this.read(req, res, "download"); }
}

export class PreviewCustomerAttachmentHandler extends ReadCustomerAttachmentHandler {
  static handlerName = "previewCustomerAttachment";
  static api = { method: "GET", path: "/api/v1/customers/:id/attachments/:attachmentId/preview", description: "安全預覽客戶附件。", authorizationPolicies: [CUSTOMER_ROUTE_POLICIES.generalRead], download: DOWNLOAD, requestSchema: { params: CUSTOMER_ATTACHMENT_PARAMS, query: CUSTOMER_ATTACHMENT_EMPTY }, responseSchema: { 200: { type: "object", additionalProperties: true }, 206: { type: "object", additionalProperties: true } } };
  async execute(req, res) { return this.read(req, res, "preview"); }
}
