import { ApplicationError } from "../../framework/errors/ApplicationError.js";
import { permissionStaleError } from "../authorization/adminGuard.js";
import { assertActorFresh } from "../authorization/directoryLookups.js";
import { purchasingError } from "./purchasingErrors.js";
import { eventId, onlyFields, positiveId, reason as validReason } from "./purchasingValidation.js";

const AUDIT_ACTION = "purchasing.setting.updated", LABEL = "purchasing_settings";
// ponytail: 只回最近 50 次，設定好少改；要睇晒先加分頁。
const HISTORY_LIMIT = 50;

const typed = (row) => ({ requirePoApproval: Boolean(row.require_po_approval), version: Number(row.version), updatedAt: Number(row.updated_at), updatedByLabel: row.updated_by_label });

/**
 * 全公司一筆嘅 Purchasing 設定（設計 §3.3、§4.4、§5.4；TASK-022）。Route 嘅高強度認證同 handler 由 TASK-023 交付。
 * 改設定只影響之後開始嘅 submit（FR-SET-006）：呢度唔掃描亦唔改任何 PO，submit 喺 transaction 入面鎖呢行攞當刻政策。
 */
export class PurchasingSettingsService {
  constructor({ database, logger, time, operations, audit }) {
    if (!database || !logger || !time || !operations || !audit) throw new TypeError("PurchasingSettingsService requires all of its dependencies");
    Object.assign(this, { database, logger, time, operations, audit });
  }

  /** Read path 都要 token 同 DB 權限一致（同 Inquiry 一樣）。 */
  get({ claims }) {
    return this.operations.run(this.database, async (tx) => {
      await this.#actor(tx, claims);
      const [[row]] = await tx.query("SELECT require_po_approval, version, updated_at, updated_by_label FROM purchasing_settings WHERE id = 1");
      if (!row) throw purchasingError("PURCHASING_DEPENDENCY_UNAVAILABLE");
      // FR-SET-007：變更歷史就係 Audit，唔另外存一份。
      const [history] = await tx.query(`SELECT occurred_at, actor_label, reason, detail FROM purchasing_audit_logs WHERE action = ? AND outcome = 'SUCCEEDED'
        ORDER BY occurred_at DESC, id DESC LIMIT ?`, [AUDIT_ACTION, HISTORY_LIMIT]);
      return { ...typed(row), history: history.map((entry) => ({ requirePoApproval: entry.detail.requirePoApproval, version: entry.detail.version, reason: entry.reason,
        actorLabel: entry.actor_label, occurredAt: Number(entry.occurred_at) })) };
    });
  }

  async update({ claims, input, context = {} }) {
    try {
      const { eventId: event, version, requirePoApproval, reason } = onlyFields(input, ["eventId", "version", "requirePoApproval", "reason"], "body");
      if (typeof requirePoApproval !== "boolean") throw purchasingError("PURCHASING_INPUT_INVALID", { field: "requirePoApproval" });
      const request = { eventId: eventId(event), version: positiveId(version, "version"), requirePoApproval, reason: validReason(reason) };
      return await this.operations.run(this.database, (tx) => this.#update(tx, claims, request, context));
    } catch (error) {
      if (error instanceof ApplicationError && error.statusCode >= 400 && error.statusCode < 500) await this.#rejected(claims, error, context);
      throw error;
    }
  }

  async #actor(tx, claims) {
    const fresh = await assertActorFresh(tx, { actorId: Number(claims?.sub), claimedRoles: claims?.roles, claimedPermissions: claims?.permissions });
    if (!fresh.permissions.includes("purchasing.settings")) throw permissionStaleError();
    return { id: fresh.id, username: fresh.username };
  }

  async #update(tx, claims, request, context) {
    const nowMs = this.time.nowMs(), actor = await this.#actor(tx, claims);
    const trace = { requestId: context.requestId, correlationId: context.correlationId };
    const { operationId, replay } = await this.operations.claim(tx, { commandType: "UPDATE_PURCHASING_SETTINGS", eventId: request.eventId, payload: request, actor, nowMs, ...trace });
    if (replay) return { ...replay, replayed: true };

    const [[row]] = await tx.query("SELECT version FROM purchasing_settings WHERE id = 1 FOR UPDATE");
    if (!row) throw purchasingError("PURCHASING_DEPENDENCY_UNAVAILABLE");
    if (Number(row.version) !== request.version) throw purchasingError("VERSION_CONFLICT", { currentVersion: Number(row.version) });
    const version = request.version + 1;
    await tx.query("UPDATE purchasing_settings SET require_po_approval = ?, version = ?, updated_at = ?, updated_by = ?, updated_by_label = ? WHERE id = 1",
      [request.requirePoApproval ? 1 : 0, version, nowMs, actor.id, actor.username]);

    const summary = { requirePoApproval: request.requirePoApproval, version };
    await this.audit.record(tx, { actor, action: AUDIT_ACTION, targetId: 1, targetLabel: LABEL, reason: request.reason, detail: summary, nowMs, ip: context.ip, ...trace });
    await this.operations.complete(tx, { operationId, result: summary, nowMs });
    return { ...summary, replayed: false };
  }

  async #rejected(claims, error, context) {
    const action = error.code === "PURCHASING_EVENT_CONFLICT" ? "purchasing.operation_conflict" : AUDIT_ACTION;
    try {
      await this.database.withTransaction((tx) => this.audit.recordRejected(tx, { actorId: Number(claims?.sub), action, targetId: 1, code: error.code, nowMs: this.time.nowMs(),
        requestId: context.requestId, correlationId: context.correlationId, ip: context.ip }));
    } catch (auditError) {
      // 唔可以話已經持久化 Audit；原本嘅拒絕照拋（§4.15）。
      await this.logger.error("purchasing.audit.rejected_not_persisted", "Rejected Purchasing command could not be audited", {
        action, code: error.code, auditErrorCode: auditError?.code ?? auditError?.name ?? null,
        requestId: context.requestId ?? null, correlationId: context.correlationId ?? null
      });
    }
  }
}
