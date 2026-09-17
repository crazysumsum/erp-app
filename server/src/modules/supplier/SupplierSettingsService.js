import { assertActorFresh } from "../authorization/directoryLookups.js";
import { SupplierAuditLogService } from "./SupplierAuditLogService.js";
import { invalidSupplierInput, supplierConflict } from "./supplierErrors.js";

/**
 * Supplier Settings 係 singleton aggregate：只鎖 `id = 1`，唔會掃 Supplier。
 * 設計說明見 docs/supplier_management/03_design_spec.md §5.10 同 §6.7。
 */

// 本期只有一個業務參數。設計 §5.10：日後新參數以 typed column＋schema＋UI＋audit
// ＋migration 增加，唔用任意 key/value 去執行業務規則。
const SETTING_FIELDS = Object.freeze({
  requireActivationApproval: Object.freeze({
    column: "require_activation_approval",
    toRow: (value) => (value ? 1 : 0),
    fromRow: (value) => Number(value) === 1
  })
});

const SETTINGS_ROW_ID = 1;

function requireReason(value) {
  const reason = String(value ?? "").trim();
  if (reason.length < 5 || reason.length > 500) {
    throw invalidSupplierInput("SUPPLIER_REASON_REQUIRED", "這項修改必須填寫原因", { field: "reason" });
  }
  return reason;
}

function readSettings(input) {
  const values = {};
  for (const [name, field] of Object.entries(SETTING_FIELDS)) {
    if (!Object.hasOwn(input, name)) continue;
    if (typeof input[name] !== "boolean") {
      throw invalidSupplierInput("SUPPLIER_SETTING_INVALID", "設定值型別不正確", { field: name });
    }
    values[name] = field.toRow(input[name]);
  }
  return values;
}

// Handler schema 已經 additionalProperties: false，但 service 唔靠 caller 去守呢件事：
// 一個未定義嘅參數唔可以有業務效果（FR-SET-006）。
function assertNoUnknownSettings(input) {
  const reserved = new Set(["actorId", "claimedRoles", "claimedPermissions", "reason", "version", "requestId", "ip"]);
  const unknown = Object.keys(input).filter((key) => !reserved.has(key) && !Object.hasOwn(SETTING_FIELDS, key));
  if (unknown.length > 0) {
    throw invalidSupplierInput("SUPPLIER_SETTING_UNKNOWN", "不支援這項設定", { fields: unknown });
  }
}

function project(row) {
  const projected = {};
  for (const [name, field] of Object.entries(SETTING_FIELDS)) {
    projected[name] = field.fromRow(row[field.column]);
  }
  return projected;
}

/**
 * 供 create／approval／import 喺自己嘅交易入面共用。
 *
 * 用 `FOR SHARE` 而唔係 `FOR UPDATE`：呢度要嘅係「同一個交易入面答案唔會變」，
 * 唔係排斥其他啟用操作。`FOR UPDATE` 會令所有 Supplier 建立同啟用喺同一行排隊。
 * `FOR SHARE` 容許並發讀，但會令設定寫入等待進行中嘅啟用完成 —— 亦即 AC-013
 * 想要嘅方向：設定改動唔會追溯影響進行中嘅操作。
 *
 * 讀唔到設定列就拋錯，唔會當佢係 false：喺政策未知嘅情況下預設放行等於靜靜哋
 * 繞過審批要求，方向錯（SEC-007）。
 */
export async function getActivationPolicy(connection) {
  const [[row]] = await connection.query(
    `SELECT ${SETTING_FIELDS.requireActivationApproval.column} AS require_activation_approval
       FROM supplier_settings WHERE id = ${SETTINGS_ROW_ID} FOR SHARE`
  );
  if (!row) {
    // Runs inside every create and activate, so it has to fail as a domain error
    // rather than an opaque 500 the way a raw Error would on those routes.
    throw supplierConflict("SUPPLIER_SETTINGS_MISSING", "供應商設定尚未初始化");
  }
  return SETTING_FIELDS.requireActivationApproval.fromRow(row.require_activation_approval);
}

export class SupplierSettingsService {
  constructor({ database, logger, time, authorize = assertActorFresh, audit } = {}) {
    if (!database || !logger || !time) {
      throw new TypeError("SupplierSettingsService requires database, logger and time");
    }
    this.database = database;
    this.logger = logger;
    this.time = time;
    this.authorize = authorize;
    this.audit = audit ?? new SupplierAuditLogService({ database, logger, time });
  }

  async getSettings({ actorId, claimedRoles, claimedPermissions }) {
    await this.authorize(this.database, { actorId, claimedRoles, claimedPermissions });
    const [[row]] = await this.database.query(
      `SELECT * FROM supplier_settings WHERE id = ${SETTINGS_ROW_ID}`
    );
    if (!row) throw supplierConflict("SUPPLIER_SETTINGS_MISSING", "供應商設定尚未初始化");
    return { ...project(row), version: Number(row.version), updatedAt: Number(row.updated_at), updatedBy: row.updated_by === null ? null : Number(row.updated_by) };
  }

  async updateSettings(input) {
    assertNoUnknownSettings(input);
    const reason = requireReason(input.reason);
    const values = readSettings(input);
    if (Object.keys(values).length === 0) {
      throw invalidSupplierInput("SUPPLIER_SETTING_EMPTY", "沒有要修改的設定", { field: "requireActivationApproval" });
    }

    let projected = null;
    await this.database.withTransaction(async (connection) => {
      const actor = await this.authorize(connection, {
        actorId: input.actorId,
        claimedRoles: input.claimedRoles,
        claimedPermissions: input.claimedPermissions
      });
      const [[current]] = await connection.query(
        `SELECT * FROM supplier_settings WHERE id = ${SETTINGS_ROW_ID} FOR UPDATE`
      );
      if (!current) throw supplierConflict("SUPPLIER_SETTINGS_MISSING", "供應商設定尚未初始化");
      if (Number(current.version) !== Number(input.version)) {
        throw supplierConflict("VERSION_CONFLICT", "供應商設定已被其他人修改，請重新載入");
      }

      const before = project(current);
      const nowMs = this.time.nowMs();
      const columns = Object.keys(values).map((name) => SETTING_FIELDS[name].column);
      const [result] = await connection.execute(
        `UPDATE supplier_settings
            SET ${columns.map((column) => `${column} = ?`).join(", ")}, version = version + 1, updated_at = ?, updated_by = ?
          WHERE id = ${SETTINGS_ROW_ID} AND version = ?`,
        [...Object.values(values), nowMs, input.actorId, input.version]
      );
      if (result.affectedRows === 0) {
        throw supplierConflict("VERSION_CONFLICT", "供應商設定已被其他人修改，請重新載入");
      }

      const after = { ...before, ...Object.fromEntries(Object.entries(values).map(([name, value]) => [name, SETTING_FIELDS[name].fromRow(value)])) };
      await this.audit.record(connection, {
        actorUserId: input.actorId,
        actorUsername: actor.username,
        action: "setting.update",
        targetType: "setting",
        targetId: SETTINGS_ROW_ID,
        supplierId: null,
        targetLabel: "supplier_settings",
        reason,
        detail: { before, after },
        requestId: input.requestId,
        ip: input.ip
      });
      projected = { ...after, version: Number(input.version) + 1, updatedAt: nowMs, updatedBy: input.actorId };
    });
    return projected;
  }
}
