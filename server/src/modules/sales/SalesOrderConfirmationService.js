import { randomUUID } from "node:crypto";
import defaults from "../../../config/sales.js";
import { SalesOperationService } from "./SalesOperationService.js";
import { SalesAuditService } from "./SalesAuditService.js";
import { requireSalesWriteActor } from "./salesAuthorization.js";
import { salesEventId } from "./salesValidation.js";
import { salesError } from "./salesErrors.js";

export class SalesOrderConfirmationService {
  constructor({ database, time, config = defaults, audit } = {}) {
    this.database = database; this.time = time; this.config = config;
    this.operations = new SalesOperationService(); this.audit = audit ?? new SalesAuditService();
  }

  async startConfirmation({ claims, id, input, trace = {} }) {
    if (!Number.isSafeInteger(id) || id < 1 || !input || Array.isArray(input) ||
        Object.keys(input).sort().join(",") !== "eventId,version" || !Number.isSafeInteger(input.version) || input.version < 1)
      throw salesError("SALES_INPUT_INVALID");
    salesEventId(input.eventId);
    return this.operations.run(this.database, async tx => {
      const actor = await requireSalesWriteActor(tx, claims), nowMs = this.time.nowMs();
      const intent = await this.operations.claimConfirmation(tx, { ...trace, eventId: input.eventId, targetId: id, payload: { version: input.version },
        actor, nowMs, leaseOwner: randomUUID(), leaseMs: this.config.confirmationLeaseMs });
      if (intent.replay) return intent;
      const [[order]] = await tx.query("SELECT id,sales_order_number,status,version,confirmation_event_id FROM sales_orders WHERE id=? FOR UPDATE", [id]);
      if (!order) throw salesError("SALES_ORDER_NOT_FOUND");
      if (order.status === "CONFIRMING") {
        if (order.confirmation_event_id !== input.eventId) throw salesError("SALES_CONFIRMATION_IN_PROGRESS");
        if (Number(order.version) !== input.version + 1) throw salesError("SALES_EVENT_CONFLICT");
        return intent;
      }
      if (order.status !== "DRAFT") throw salesError("SALES_STATE_CONFLICT");
      if (Number(order.version) !== input.version) throw salesError("VERSION_CONFLICT", { currentVersion: Number(order.version) });
      const version = input.version + 1;
      const [written] = await tx.execute(`UPDATE sales_orders SET status='CONFIRMING',confirmation_event_id=?,version=version+1,
        updated_at=?,last_business_updated_at=?,updated_by=? WHERE id=? AND version=? AND status='DRAFT'`,
      [input.eventId,nowMs,nowMs,actor.id,id,input.version]);
      if (Number(written.affectedRows) !== 1) throw salesError("CONCURRENT_OPERATION");
      await tx.execute(`INSERT INTO sales_order_status_history
        (sales_order_id,sequence_no,from_status,to_status,action,order_version_after,event_id,actor_user_id,actor_label,occurred_at)
        SELECT ?,COALESCE(MAX(sequence_no),0)+1,'DRAFT','CONFIRMING','confirm_started',?,?,?,?,?
        FROM sales_order_status_history WHERE sales_order_id=?`, [id,version,input.eventId,actor.id,actor.username,nowMs,id]);
      await this.audit.record(tx, { ...trace, actor, action: "sales_order.confirm_started", targetId: id, targetNumber: order.sales_order_number,
        eventId: input.eventId, nowMs, details: { fromStatus: "DRAFT", toStatus: "CONFIRMING", version } });
      return intent;
    });
  }
}
