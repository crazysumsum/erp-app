const MAX_DETAIL_BYTES = 8192;

const ACTIONS = new Set([
  "customer.create",
  "customer.update",
  "customer.status",
  "customer.address.create",
  "customer.address.update",
  "customer.address.deactivate",
  "customer.contact.create",
  "customer.contact.update",
  "customer.contact.deactivate"
]);

const ROOT_AUDIT_FIELDS = new Set([
  "id",
  "customerCode",
  "legalName",
  "tradingName",
  "defaultCurrencyCode",
  "defaultPaymentTermId",
  "accountManagerUserId",
  "categoryId",
  "industryId",
  "territoryId",
  "website",
  "generalPhone",
  "generalEmail",
  "status",
  "everActivatedAt",
  "version",
  "label",
  "recipientCompanyDepartment",
  "addressLine1",
  "addressLine2",
  "addressLine3",
  "city",
  "stateRegion",
  "postalCode",
  "countryCode",
  "name",
  "jobTitle",
  "department",
  "email",
  "phone",
  "mobile",
  "preferredLanguage",
  "sortOrder",
  "purposes"
]);

function allowlistedSnapshot(value) {
  if (value === null || value === undefined) return undefined;
  return Object.fromEntries(
    Object.entries(value).filter(([field, fieldValue]) => ROOT_AUDIT_FIELDS.has(field) && fieldValue !== undefined)
  );
}

function boundedDetail(detail) {
  if (detail === null || detail === undefined) return null;
  const value = {};
  const before = allowlistedSnapshot(detail.before);
  const after = allowlistedSnapshot(detail.after);
  if (before !== undefined) value.before = before;
  if (after !== undefined) value.after = after;
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > MAX_DETAIL_BYTES) {
    throw new Error("Customer audit detail exceeds 8192 bytes");
  }
  return serialized;
}

function numberOrNull(value) {
  return value === null || value === undefined ? null : Number(value);
}

export class CustomerAuditLogService {
  async record(connection, input) {
    if (!connection || typeof connection.execute !== "function") {
      throw new TypeError("A transaction connection is required");
    }
    if (!ACTIONS.has(input.action)) {
      throw new TypeError(`Unsupported Customer audit action: ${input.action}`);
    }
    await connection.execute(
      `INSERT INTO customer_audit_logs
         (occurred_at, actor_user_id, actor_username, action, target_type, target_id,
          customer_id, target_label, reason, detail, request_id, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        Number(input.occurredAt),
        numberOrNull(input.actorUserId),
        String(input.actorUsername ?? ""),
        input.action,
        String(input.targetType),
        numberOrNull(input.targetId),
        numberOrNull(input.customerId),
        String(input.targetLabel ?? ""),
        String(input.reason ?? ""),
        boundedDetail(input.detail),
        String(input.requestId ?? ""),
        String(input.ip ?? "")
      ]
    );
  }
}
