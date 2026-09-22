import { assertActorFresh } from "../authorization/directoryLookups.js";
import { CustomerAuditLogService } from "./CustomerAuditLogService.js";
import {
  customerSettingInvalid,
  customerSettingsMissing,
  versionConflict
} from "./customerErrors.js";

const SETTINGS_ROW_ID = 1;
const SETTING_FIELDS = Object.freeze({
  requireActivationApproval: Object.freeze({
    column: "require_activation_approval",
    toRow: (value) => value ? 1 : 0,
    fromRow: (value) => Number(value) === 1
  })
});

function project(row) {
  return Object.fromEntries(Object.entries(SETTING_FIELDS).map(([name, field]) => [name, field.fromRow(row[field.column])]));
}

function requireReason(value) {
  const reason = String(value ?? "").trim();
  if (reason.length < 5 || reason.length > 500) {
    throw customerSettingInvalid("CUSTOMER_REASON_REQUIRED", "這項修改必須填寫原因", { field: "reason" });
  }
  return reason;
}

function readSettings(input) {
  const values = {};
  for (const [name, field] of Object.entries(SETTING_FIELDS)) {
    if (!Object.hasOwn(input, name)) continue;
    if (typeof input[name] !== "boolean") {
      throw customerSettingInvalid("CUSTOMER_SETTING_INVALID", "設定值型別不正確", { field: name });
    }
    values[name] = field.toRow(input[name]);
  }
  return values;
}

function assertNoUnknownSettings(input) {
  const reserved = new Set(["actorId", "claimedRoles", "claimedPermissions", "reason", "version", "requestId", "ip"]);
  const unknown = Object.keys(input).filter((key) => !reserved.has(key) && !Object.hasOwn(SETTING_FIELDS, key));
  if (unknown.length > 0) {
    throw customerSettingInvalid("CUSTOMER_SETTING_UNKNOWN", "不支援這項設定", { fields: unknown });
  }
}

async function activationPolicy(runner) {
  const [[row]] = await runner.query(
    `SELECT require_activation_approval FROM customer_settings WHERE id = ${SETTINGS_ROW_ID} FOR SHARE`
  );
  if (!row) throw customerSettingsMissing();
  return SETTING_FIELDS.requireActivationApproval.fromRow(row.require_activation_approval);
}

export function getCustomerActivationPolicy(connection) {
  return activationPolicy(connection);
}

export class CustomerSettingsService {
  constructor({ database, time, authorize = assertActorFresh, audit = new CustomerAuditLogService() } = {}) {
    if (!database || !time) throw new TypeError("CustomerSettingsService requires database and time");
    this.database = database;
    this.time = time;
    this.authorize = authorize;
    this.audit = audit;
  }

  async getSettings({ actorId, claimedRoles, claimedPermissions }) {
    await this.authorize(this.database, { actorId, claimedRoles, claimedPermissions });
    const [[row]] = await this.database.query(`SELECT * FROM customer_settings WHERE id = ${SETTINGS_ROW_ID}`);
    if (!row) throw customerSettingsMissing();
    return {
      ...project(row),
      version: Number(row.version),
      updatedAt: Number(row.updated_at),
      updatedBy: row.updated_by === null ? null : Number(row.updated_by)
    };
  }

  async updateSettings(input) {
    assertNoUnknownSettings(input);
    const reason = requireReason(input.reason);
    const values = readSettings(input);
    if (Object.keys(values).length === 0) {
      throw customerSettingInvalid("CUSTOMER_SETTING_EMPTY", "沒有要修改的設定", { field: "requireActivationApproval" });
    }

    return this.database.withTransaction(async (connection) => {
      const actor = await this.authorize(connection, {
        actorId: input.actorId,
        claimedRoles: input.claimedRoles,
        claimedPermissions: input.claimedPermissions
      });
      const [[current]] = await connection.query(`SELECT * FROM customer_settings WHERE id = ${SETTINGS_ROW_ID} FOR UPDATE`);
      if (!current) throw customerSettingsMissing();
      if (Number(current.version) !== Number(input.version)) throw versionConflict(current.version);

      const before = project(current);
      const nowMs = this.time.nowMs();
      const columns = Object.keys(values).map((name) => SETTING_FIELDS[name].column);
      const [result] = await connection.execute(
        `UPDATE customer_settings
            SET ${columns.map((column) => `${column} = ?`).join(", ")}, version = version + 1, updated_at = ?, updated_by = ?
          WHERE id = ${SETTINGS_ROW_ID} AND version = ?`,
        [...Object.values(values), nowMs, input.actorId, input.version]
      );
      if (result.affectedRows !== 1) throw versionConflict(current.version);

      const after = {
        ...before,
        ...Object.fromEntries(Object.entries(values).map(([name, value]) => [name, SETTING_FIELDS[name].fromRow(value)]))
      };
      await this.audit.record(connection, {
        occurredAt: nowMs,
        actorUserId: input.actorId,
        actorUsername: actor.username,
        action: "setting.update",
        targetType: "setting",
        targetId: SETTINGS_ROW_ID,
        customerId: null,
        targetLabel: "customer_settings",
        reason,
        detail: { before, after },
        requestId: input.requestId,
        ip: input.ip
      });
      return { ...after, version: Number(input.version) + 1, updatedAt: nowMs, updatedBy: input.actorId };
    });
  }
}
