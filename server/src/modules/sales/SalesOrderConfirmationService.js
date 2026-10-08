import { createHash, randomUUID } from "node:crypto";
import { CustomerLookupService } from "../customer/CustomerLookupService.js";
import { ItemLookupService } from "../item/ItemLookupService.js";
import { BusinessMasterProvider } from "../businessMaster/BusinessMasterProvider.js";
import { BusinessMasterRepository } from "../businessMaster/BusinessMasterRepository.js";
import { InventoryReservationService } from "../inventory/InventoryReservationService.js";
import { inventoryOperationHash } from "../inventory/InventoryOperationService.js";
import defaults from "../../../config/sales.js";
import { SalesOperationService } from "./SalesOperationService.js";
import { SalesAuditService } from "./SalesAuditService.js";
import { requireSalesRecoveryActor, requireSalesWriteActor } from "./salesAuthorization.js";
import { salesPayloadHash } from "./salesCanonicalHash.js";
import { readSalesOrderDetail } from "./SalesOrderService.js";
import { prepareSalesDocument } from "./prepareSalesDocument.js";
import { documentTotal } from "./salesMoneyMath.js";
import { assertQuantityConservation } from "./salesQuantityMath.js";
import { salesEventId } from "./salesValidation.js";
import { salesError, SALES_ERROR_STATUS } from "./salesErrors.js";

export function validateConfirmationInventoryResult(result, payload, backorder = false) {
  const mismatch = () => { throw salesError("INVENTORY_CONTRACT_MISMATCH"); };
  if (!result || !Number.isSafeInteger(result.operationId) || result.operationId < 1 ||
      result.lineCount !== payload.lines.length || !Array.isArray(result.lines) || result.lines.length !== payload.lines.length) mismatch();
  const rootHash = inventoryOperationHash({ commandType: backorder ? "SALES_BACKORDER_BATCH_RESERVE" : "SALES_BATCH_RESERVE", payload });
  const digest = createHash("sha256"), seen = new Set();
  for (const line of result.lines) {
    const expected = payload.lines.find(row => row.sourceLineId === line?.sourceLineId);
    if (!expected || seen.has(line.sourceLineId) || line.rootOperationId !== result.operationId || line.rootRequestHash !== rootHash ||
        line.skuId !== expected.skuId || line.orderedBaseQuantity !== expected.orderedBaseQuantity || line.minimumRemainingDays !== expected.minimumRemainingDays ||
        ![line.reservedBaseQuantity,line.uncoveredBaseQuantity].every(value => Number.isSafeInteger(value) && value >= 0) ||
        BigInt(line.reservedBaseQuantity) + BigInt(line.uncoveredBaseQuantity) !== BigInt(expected.orderedBaseQuantity) ||
        (line.reservedBaseQuantity ? !Number.isSafeInteger(line.reservationId) || line.reservationId < 1 || line.version !== 1 : line.reservationId !== null || line.version !== null)) mismatch();
    seen.add(line.sourceLineId);
  }
  for (const expected of payload.lines)
    digest.update(`${expected.sourceLineId}:${inventoryOperationHash({ commandType: backorder ? "SALES_BACKORDER_LINE_RESERVE" : "SALES_LINE_RESERVE", payload: { rootOperationId: result.operationId,rootRequestHash: rootHash,...expected } })}\n`);
  if (result.membershipDigest !== digest.digest("hex")) mismatch();
}

function masterProjection(order) {
  return { customerCode: order.customerCode,customerName: order.customerName,paymentTermId: order.paymentTermId,
    paymentTermCode: order.paymentTermCode,paymentTermName: order.paymentTermName,warehouseCode: order.warehouseCode,warehouseName: order.warehouseName,
    lines: order.lines.map(line => ({ id: line.id,itemName: line.itemName,skuCode: line.skuCode,skuName: line.skuName,uomCode: line.uomCode,uomName: line.uomName,
      toBaseFactor: line.toBaseFactor,orderedBaseQuantity: line.orderedBaseQuantity,trackingPolicy: line.trackingPolicy,minimumSaleLifeDays: line.minimumSaleLifeDays,priceSource: line.priceSource })) };
}

export class SalesOrderConfirmationService {
  constructor({ database, time, logger, config = defaults, audit, customerProvider, itemProvider, businessMaster, inventory } = {}) {
    this.database = database; this.time = time; this.config = config;
    this.operations = new SalesOperationService(); this.audit = audit ?? new SalesAuditService();
    this.logger = logger;
    this.customers = customerProvider; this.items = itemProvider; this.businessMaster = businessMaster;
    // Phase A needs no master or Inventory service; resolve them when executing Phase B.
    this.inventory = inventory;
  }

  async confirm(request) {
    const intent = await this.startConfirmation(request);
    const pending = () => ({ statusCode: 202,retryAfterSeconds: 2,data: { outcome: "CONFIRMING",operationId: intent.operationId,eventId: intent.eventId,
      statusUrl: `/api/v1/sales-operations/by-event/${intent.eventId}`,retryAfterSeconds: 2 } });
    if (intent.outcomeUnknown) return pending();
    // A 202 response ends the HTTP signal; the bounded durable execution owns its own signal.
    const completion = this.completeConfirmation({ eventId: intent.eventId,claims: request.claims,leaseOwner: intent.leaseOwner,signal: new AbortController().signal })
      .then(result => ({ result }), error => ({ error }));
    let timer;
    const outcome = await Promise.race([completion,new Promise(resolve => { timer = setTimeout(() => resolve(null), this.config.manualConfirmationWaitMs); })]);
    clearTimeout(timer);
    if (!outcome || outcome.error && (outcome.error.statusCode >= 500 || outcome.error.code === "CONCURRENT_OPERATION")) return pending();
    if (outcome.error) throw outcome.error;
    return { statusCode: 200,data: { outcome: "CONFIRMED",salesOrder: outcome.result.salesOrder,warnings: outcome.result.warnings.map(warning => warning.code) } };
  }

  async lookup({ claims,eventId }) {
    salesEventId(eventId);
    return this.database.withTransaction(async tx => {
      const actor = await requireSalesWriteActor(tx, claims);
      // Committed status reads must remain available while Phase B owns the operation row lock.
      const [[row]] = await tx.query("SELECT id FROM sales_operation_requests WHERE event_id=? AND actor_user_id=? AND target_type IN ('SALES_ORDER','QUOTATION')", [eventId,actor.id]);
      if (!row) throw salesError("SALES_ORDER_NOT_FOUND");
      const operation = await this.operations.getForActor(tx, { eventId,actor });
      return { eventId,operationId: Number(row.id),status: operation.status,result: operation.result,errorCode: operation.errorCode ?? null };
    });
  }

  async recover({ signal } = {}) {
    signal?.throwIfAborted();
    const [rows] = await this.database.query(`SELECT event_id,
      GREATEST(0,CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS DECIMAL(20,0))-CAST(created_at AS DECIMAL(20,0))) AS oldest_age_ms
      FROM sales_operation_requests WHERE status='IN_PROGRESS' AND command_type='CONFIRM_ORDER' AND target_type='SALES_ORDER'
      AND lease_until<=CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED) ORDER BY lease_until,id LIMIT ?`,
    [this.config.confirmationRecoveryBatchSize], { signal });
    const result = { processed: 0,recovered: 0,failed: 0,deferred: 0,oldestAgeMs: 0 };
    for (const row of rows) {
      signal?.throwIfAborted();
      result.processed++; result.oldestAgeMs = Math.max(result.oldestAgeMs, Number(row.oldest_age_ms));
      try { await this.completeConfirmation({ eventId: row.event_id,recovery: true,signal }); result.recovered++; }
      catch (error) {
        signal?.throwIfAborted();
        // Inspect committed facts after any failure/unknown COMMIT; never create another intent.
        const outcome = await this.database.withTransaction(async tx => {
          const [[operation]] = await tx.query(`SELECT status,lease_until,updated_at FROM sales_operation_requests
            WHERE event_id=? AND command_type='CONFIRM_ORDER' AND target_type='SALES_ORDER' FOR UPDATE`, [row.event_id]);
          if (operation?.status === "SUCCEEDED") return "recovered";
          if (operation?.status === "FAILED") return "failed";
          if (!operation || operation.status !== "IN_PROGRESS") throw salesError("SALES_EVENT_CONFLICT");
          const [[clock]] = await tx.query("SELECT CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED) AS now_ms");
          const now = Number(clock.now_ms);
          if (Number(operation.lease_until) <= now) {
            const delay = Math.min(300000, Math.max(30000, 2 * (Number(operation.lease_until) - Number(operation.updated_at))));
            // A new owner fences the expired executor; the persisted window doubles up to five minutes.
            await tx.execute("UPDATE sales_operation_requests SET lease_owner=?,lease_until=?,updated_at=? WHERE event_id=? AND status='IN_PROGRESS'",
              [randomUUID(),now + delay,now,row.event_id]);
          }
          return "deferred";
        }, { signal,timeoutMs: this.config.transactionTimeoutMs });
        result[outcome]++;
        if (outcome === "deferred") await this.logger?.warn("sales.confirmation_recovery_deferred", "Confirmation remains unresolved", {
          eventId: row.event_id,errorCode: Object.hasOwn(SALES_ERROR_STATUS, error.code) ? error.code : "SALES_DEPENDENCY_UNAVAILABLE" });
      }
    }
    return result;
  }

  async completeConfirmation({ eventId, claims, leaseOwner, recovery = false, signal }) {
    salesEventId(eventId);
    if (!recovery && leaseOwner != null) salesEventId(leaseOwner);
    const outcome = await this.operations.run(this.database, async tx => {
      const [[operation]] = await tx.query(`SELECT id,target_id,command_type,target_type,status,request_hash,recovery_payload,actor_user_id,actor_label,
        lease_owner,lease_until
        FROM sales_operation_requests WHERE event_id=? FOR UPDATE`, [eventId]);
      if (!operation || operation.command_type !== "CONFIRM_ORDER" || operation.target_type !== "SALES_ORDER") throw salesError("SALES_EVENT_CONFLICT");
      const actor = recovery ? await requireSalesRecoveryActor(tx, Number(operation.actor_user_id)) : await requireSalesWriteActor(tx, claims);
      if (actor.id !== Number(operation.actor_user_id)) throw salesError("SALES_EVENT_CONFLICT");
      if (operation.status !== "IN_PROGRESS") {
        const result = await this.operations.getForActor(tx, { eventId,actor });
        if (result.status === "FAILED") return { errorCode: result.errorCode };
        if (result.status !== "SUCCEEDED") throw salesError("CONCURRENT_OPERATION");
        return { salesOrder: await readSalesOrderDetail(tx, Number(operation.target_id), { lock: true }),operation: result.result,warnings: [] };
      }
      const [[clock]] = await tx.query("SELECT CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED) AS now_ms");
      const leaseActive = Number(operation.lease_until) > Number(clock.now_ms);
      if (recovery) {
        if (leaseActive) throw salesError("CONCURRENT_OPERATION");
        leaseOwner = randomUUID();
        await tx.execute(`UPDATE sales_operation_requests SET lease_owner=?,lease_until=CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED)+?
          WHERE id=? AND status='IN_PROGRESS'`, [leaseOwner,this.config.confirmationLeaseMs,Number(operation.id)]);
      } else if (!leaseActive || operation.lease_owner !== leaseOwner) throw salesError("CONCURRENT_OPERATION");
      const payload = typeof operation.recovery_payload === "string" ? JSON.parse(operation.recovery_payload) : operation.recovery_payload;
      if (!payload || Object.keys(payload).join(",") !== "version" || !Number.isSafeInteger(payload.version) || payload.version < 1 ||
          salesPayloadHash(payload) !== operation.request_hash) throw salesError("SALES_EVENT_CONFLICT");
      const [[locked]] = await tx.query("SELECT status,version,confirmation_event_id FROM sales_orders WHERE id=? FOR UPDATE", [Number(operation.target_id)]);
      if (!locked || locked.status !== "CONFIRMING" || locked.confirmation_event_id !== eventId || Number(locked.version) !== payload.version + 1) throw salesError("SALES_EVENT_CONFLICT");
      await tx.query("SELECT id FROM sales_order_lines WHERE sales_order_id=? ORDER BY id FOR UPDATE", [Number(operation.target_id)]);
      const order = await readSalesOrderDetail(tx, Number(operation.target_id)), nowMs = this.time.nowMs();
      await tx.query("SAVEPOINT sales_confirmation_business");
      try {
        const result = await this.confirmDraftInTransaction(tx, { order,actor,eventId,nowMs });
        await this.operations.succeed(tx, { operationId: Number(operation.id),result: result.operation,nowMs });
        return result;
      } catch (error) {
        if (!["CUSTOMER_NOT_SALEABLE","CUSTOMER_CREDIT_ON_HOLD","SKU_NOT_SALEABLE","SKU_UOM_INVALID","SALES_UOM_CONVERSION_INVALID",
          "SALES_QUANTITY_INVALID","SALES_PRICE_INVALID","SALES_INPUT_INVALID","WAREHOUSE_INVALID","SKU_NOT_INVENTORY_TRACKED","SERIAL_TRACKING_UNSUPPORTED"].includes(error.code)) throw error;
        await tx.query("ROLLBACK TO SAVEPOINT sales_confirmation_business");
        const errorCode = ["SKU_NOT_INVENTORY_TRACKED","SERIAL_TRACKING_UNSUPPORTED"].includes(error.code) ? "SKU_NOT_SALEABLE" : error.code;
        await tx.execute(`UPDATE sales_orders SET status='DRAFT',confirmation_event_id=NULL,version=version+1,updated_at=?,last_business_updated_at=?,updated_by=? WHERE id=?`, [nowMs,nowMs,actor.id,order.id]);
        await tx.execute(`UPDATE sales_operation_requests SET status='FAILED',error_code=?,lease_owner=NULL,lease_until=NULL,updated_at=?,completed_at=? WHERE id=? AND status='IN_PROGRESS'`, [errorCode,nowMs,nowMs,Number(operation.id)]);
        await this.#transition(tx, { order,actor,eventId,nowMs,status: "DRAFT",action: "confirm_failed" });
        return { errorCode };
      }
    }, { signal,timeoutMs: this.config.transactionTimeoutMs });
    if (outcome.errorCode) throw salesError(outcome.errorCode);
    return outcome;
  }

  async confirmDraftInTransaction(tx, { order,actor,eventId,nowMs }) {
    this.customers ??= new CustomerLookupService({ database: this.database });
    this.items ??= new ItemLookupService({ database: this.database,time: this.time,logger: this.logger });
    this.businessMaster ??= new BusinessMasterProvider({ database: this.database,repository: new BusinessMasterRepository() });
    const document = { ...order,lines: order.lines.map(line => ({ ...line,lineNote: line.lineNote ?? "" })) };
    const prepared = await prepareSalesDocument(tx, document, nowMs, this);
    if (!prepared.customer.credit || !["not_configured","normal","on_hold"].includes(prepared.customer.credit.status)) throw salesError("SALES_DEPENDENCY_UNAVAILABLE");
    if (prepared.customer.credit.status === "on_hold") throw salesError("CUSTOMER_CREDIT_ON_HOLD");
    for (const snapshot of prepared.snapshots)
      if (!snapshot.inventoryTracked || snapshot.trackingPolicy === "serial") throw salesError("SKU_NOT_SALEABLE");
    const payload = { warehouseId: order.fulfillmentWarehouseId,expectedOrderVersion: order.version,
      lines: prepared.lines.map((line,index) => ({ sourceLineId: order.lines[index].id,skuId: line.sku_id,
        orderedBaseQuantity: line.base_quantity,minimumRemainingDays: prepared.snapshots.find(s => s.skuId === line.sku_id && s.salesUom.skuUomId === line.sku_uom_id).minimumSaleLifeDays ?? 0 }))
        .sort((a,b) => a.skuId - b.skuId || a.sourceLineId - b.sourceLineId) };
    this.inventory ??= new InventoryReservationService({ database: this.database,time: this.time,logger: this.logger,itemLookup: this.items });
    const reserved = await this.inventory.reserveAvailableForSalesBatchInTransaction(tx, { actor: { userId: actor.id,serviceName: "",claimedRoles: actor.roles,claimedPermissions: actor.permissions },
      source: { documentId: String(order.id),eventId },correlationId: eventId,payload });
    try { validateConfirmationInventoryResult(reserved, payload); }
    catch (error) {
      await this.logger?.error("sales.inventory_contract_mismatch", "Critical Sales confirmation Inventory contract mismatch", { salesOrderId: order.id,eventId,severity: "critical" });
      throw error;
    }
    const [[warehouse]] = await tx.query("SELECT warehouse_code,warehouse_name,status FROM inventory_warehouses WHERE id=? LOCK IN SHARE MODE", [order.fulfillmentWarehouseId]);
    if (!warehouse || warehouse.status !== "ACTIVE") throw salesError("WAREHOUSE_INVALID");
    let backorderCount = 0;
    for (const [index,source] of prepared.lines.entries()) {
      const line = order.lines[index], result = reserved.lines.find(row => row.sourceLineId === line.id);
      const { quantity,base_quantity,...snapshot } = source;
      const profile = prepared.snapshots.find(s => s.skuId === line.skuId && s.salesUom.skuUomId === line.skuUomId);
      assertQuantityConservation({ orderedBaseQuantity: base_quantity,reservedOutstandingBaseQuantity: result.reservedBaseQuantity,
        backorderedBaseQuantity: result.uncoveredBaseQuantity,fulfilledBaseQuantity: 0,cancelledBaseQuantity: 0 });
      const values = { ...snapshot,ordered_quantity: quantity,ordered_base_quantity: base_quantity,tracking_policy_snapshot: profile.trackingPolicy,
        minimum_sale_life_days_snapshot: profile.minimumSaleLifeDays ?? 0,reserved_outstanding_base_quantity: result.reservedBaseQuantity,
        backordered_base_quantity: result.uncoveredBaseQuantity,updated_at: nowMs };
      await tx.execute(`UPDATE sales_order_lines SET ${Object.keys(values).map(field => `${field}=?`).join(",")},version=version+1 WHERE id=? AND sales_order_id=?`, [...Object.values(values),line.id,order.id]);
      if (result.reservedBaseQuantity) await tx.execute(`INSERT INTO sales_order_line_reservations
        (sales_order_line_id,inventory_reservation_id,inventory_operation_id,source_event_id,original_base_quantity,outstanding_base_quantity,status,inventory_version,created_at,updated_at)
        VALUES (?,?,?,?,?,?,'ACTIVE',?,?,?)`, [line.id,result.reservationId,reserved.operationId,eventId,result.reservedBaseQuantity,result.reservedBaseQuantity,result.version,nowMs,nowMs]);
      if (result.uncoveredBaseQuantity) {
        backorderCount++;
        await tx.execute(`INSERT INTO sales_backorder_entries (sales_order_id,sales_order_line_id,line_no,warehouse_id,sku_id,outstanding_base_quantity,status,priority_at,next_attempt_at,created_at,updated_at)
          VALUES (?,?,?,?,?,?,'OPEN',?,?,?,?)`, [order.id,line.id,line.lineNo,order.fulfillmentWarehouseId,line.skuId,result.uncoveredBaseQuantity,nowMs,nowMs,nowMs,nowMs]);
      }
    }
    const credit = prepared.customer.credit;
    const header = { customer_code_snapshot: prepared.customer.customerCode,customer_name_snapshot: prepared.customer.legalName,
      payment_term_id: prepared.term?.id ?? null,payment_term_code_snapshot: prepared.term?.code ?? "",payment_term_name_snapshot: prepared.term?.name ?? "",
      credit_status_snapshot: credit.status.toUpperCase(),credit_limit_snapshot: credit.creditLimit,credit_currency_snapshot: credit.currencyCode,credit_policy_version_snapshot: credit.policyVersion,
      warehouse_code_snapshot: warehouse.warehouse_code,warehouse_name_snapshot: warehouse.warehouse_name,total_amount: documentTotal(prepared.lines.map(line => line.line_amount)),
      has_backorder: backorderCount > 0 ? 1 : 0,backorder_line_count: backorderCount,confirmed_at: nowMs,confirmed_by: actor.id,updated_at: nowMs,last_business_updated_at: nowMs,updated_by: actor.id };
    await tx.execute(`UPDATE sales_orders SET ${Object.keys(header).map(field => `${field}=?`).join(",")},status='CONFIRMED',version=version+1 WHERE id=?`, [...Object.values(header),order.id]);
    const salesOrder = await readSalesOrderDetail(tx, order.id), before = masterProjection(order), after = masterProjection(salesOrder);
    const changed = salesPayloadHash(before) !== salesPayloadHash(after);
    const reason = changed ? `MASTER_DIFFERENCE ${salesPayloadHash({ before,after })}` : "";
    await this.#transition(tx, { order,actor,eventId,nowMs,status: "CONFIRMED",action: "confirmed",reason });
    return { salesOrder,operation: { id: order.id,number: order.number,status: "CONFIRMED",version: order.version + 1 },
      warnings: [...(backorderCount ? [{ code: "PARTIAL_BACKORDER" }] : []),...(credit.creditLimit === null ? [] : [{ code: "CREDIT_LIMIT_ADVISORY" }]),...(changed ? [{ code: "MASTER_DATA_CHANGED" }] : [])] };
  }

  async #transition(tx, { order,actor,eventId,nowMs,status,action,reason = "" }) {
    await tx.execute(`INSERT INTO sales_order_status_history (sales_order_id,sequence_no,from_status,to_status,action,order_version_after,event_id,actor_user_id,actor_label,occurred_at,reason)
      SELECT ?,COALESCE(MAX(sequence_no),0)+1,?,?,?,?,?,?,?,?,? FROM sales_order_status_history WHERE sales_order_id=?`,
    [order.id,order.status,status,action,order.version + 1,eventId,actor.id,actor.username,nowMs,reason,order.id]);
    await this.audit.record(tx, { actor,action: `sales_order.${action}`,targetId: order.id,targetNumber: order.number,eventId,nowMs,reason,
      details: { fromStatus: order.status,toStatus: status,version: order.version + 1 } });
  }

  async startConfirmation({ claims, id, input, trace = {} }) {
    if (!Number.isSafeInteger(id) || id < 1 || !input || Array.isArray(input) ||
        Object.keys(input).sort().join(",") !== "eventId,version" || !Number.isSafeInteger(input.version) || input.version < 1)
      throw salesError("SALES_INPUT_INVALID");
    salesEventId(input.eventId);
    let stagedIntent;
    try { return await this.operations.run(this.database, async tx => {
      const actor = await requireSalesWriteActor(tx, claims), nowMs = this.time.nowMs();
      const intent = await this.operations.claimConfirmation(tx, { ...trace, eventId: input.eventId, targetId: id, payload: { version: input.version },
        actor, nowMs, leaseOwner: randomUUID(), leaseMs: this.config.confirmationLeaseMs });
      stagedIntent = intent;
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
    }); } catch (error) {
      // The ID was observed from INSERT/replay; commit uncertainty is not a durable success claim.
      if (error.code === "TRANSACTION_OUTCOME_UNKNOWN" && stagedIntent) return { ...stagedIntent,outcomeUnknown: true };
      throw error;
    }
  }
}
