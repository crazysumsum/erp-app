import { createHash } from "node:crypto";
import { InventoryReservationService } from "../inventory/InventoryReservationService.js";
import { inventoryOperationHash } from "../inventory/InventoryOperationService.js";
import { SalesOrderService, readSalesOrderDetail } from "./SalesOrderService.js";
import { SalesFulfillmentGuardService } from "./SalesFulfillmentGuardService.js";
import { requireSalesWriteActor } from "./salesAuthorization.js";
import { transitionSalesOrder } from "./salesOrderStateMachine.js";
import { assertQuantityConservation } from "./salesQuantityMath.js";
import { salesEventId, salesReason } from "./salesValidation.js";
import { CustomerLookupService } from "../customer/CustomerLookupService.js";
import { ItemLookupService } from "../item/ItemLookupService.js";
import { salesError } from "./salesErrors.js";
import defaults from "../../../config/sales.js";

export function validateSalesLifecycleInput(input) {
  if (!input || Array.isArray(input) || Object.keys(input).sort().join(",") !== "eventId,reason,version" || !Number.isSafeInteger(input.version) || input.version < 1) throw salesError("SALES_INPUT_INVALID");
  salesEventId(input.eventId); return { ...input,reason: salesReason(input.reason) };
}
export function validateLifecycleRelease(result, payload, mappings) {
  const mismatch = () => { throw salesError("INVENTORY_CONTRACT_MISMATCH"); };
  const active = mappings.filter(row => Number(row.outstanding_base_quantity) > 0).sort((a,b) => Number(a.inventory_reservation_id) - Number(b.inventory_reservation_id));
  if (!result || !Number.isSafeInteger(result.operationId) || result.operationId < 1 || result.lineCount !== active.length || !Array.isArray(result.members) || result.members.length !== active.length) mismatch();
  const rootRequestHash = inventoryOperationHash({ commandType: "SALES_BATCH_RELEASE",payload }), digest = createHash("sha256"), seen = new Set();
  for (const row of active) {
    const id = Number(row.inventory_reservation_id), member = result.members.find(m => m?.reservationId === id);
    const original = Number(row.original_base_quantity), consumed = Number(row.consumed_base_quantity), released = Number(row.released_base_quantity), outstanding = Number(row.outstanding_base_quantity);
    if (![original,consumed,released,outstanding,Number(row.inventory_version)].every(value => Number.isSafeInteger(value) && value >= 0) || BigInt(original) !== BigInt(consumed)+BigInt(released)+BigInt(outstanding) ||
        !member || seen.has(id) || member.rootOperationId !== result.operationId || member.rootRequestHash !== rootRequestHash || member.sourceLineId !== Number(row.sales_order_line_id) || member.skuId !== Number(row.sku_id) ||
        member.expectedVersion !== Number(row.inventory_version) || member.releaseQuantity !== outstanding || member.version !== Number(row.inventory_version)+1 || member.releasedQuantity !== released+outstanding || member.outstandingQuantity !== 0 || member.status !== "RELEASED") mismatch();
    seen.add(id);
    const childPayload = { rootOperationId: result.operationId,rootRequestHash,reservationId: id,sourceLineId: member.sourceLineId,skuId: member.skuId,expectedVersion: member.expectedVersion,releaseQuantity: member.releaseQuantity };
    digest.update(`reservation:${id}:${inventoryOperationHash({ commandType: "SALES_LINE_RELEASE",payload: childPayload })}\n`);
  }
  if (result.membershipDigest !== digest.digest("hex")) mismatch();
  return result.members;
}
const actions = { WITHDRAW: "withdrawn",CANCEL: "cancelled",CLOSE_REMAINING: "remaining_closed" };
export class SalesOrderLifecycleService {
  constructor(options = {}) {
    this.order = new SalesOrderService(options);this.database = options.database;this.time = options.time;this.config = options.config ?? defaults;
    this.customerProvider = options.customerProvider;this.itemProvider = options.itemProvider;this.logger = options.logger;
    this.guard = options.fulfillmentGuard ?? new SalesFulfillmentGuardService({ services: options.services });
    this.inventory = options.inventory ?? new InventoryReservationService(options);
  }
  withdrawConfirmation(request) { return this.#execute(request,"WITHDRAW"); }
  cancel(request) { return this.#execute(request,"CANCEL"); }
  closeRemaining(request) { return this.#execute(request,"CLOSE_REMAINING"); }
  async #execute({ claims,id,input,trace = {},signal }, action) {
    if (!Number.isSafeInteger(id) || id < 1) throw salesError("SALES_INPUT_INVALID",{ field: "id" });
    input = validateSalesLifecycleInput(input);
    return this.order.operations.run(this.database,async tx => {
      const actor = await requireSalesWriteActor(tx,claims), nowMs = this.time.nowMs(), { eventId,...payload } = input;
      const claim = await this.order.operations.claim(tx,{ eventId,commandType: `${action}_ORDER`,targetId: id,payload,actor,nowMs,...trace });
      if (claim.replay) return { salesOrder: await readSalesOrderDetail(tx,id,{ lock: true }),operation: claim.replay };
      const [[header]] = await tx.query("SELECT status,version FROM sales_orders WHERE id=? FOR UPDATE",[id]);
      if (!header) throw salesError("SALES_ORDER_NOT_FOUND");
      if (Number(header.version) !== input.version) throw salesError("VERSION_CONFLICT",{ currentVersion: Number(header.version) });
      await tx.query("SELECT id FROM sales_order_lines WHERE sales_order_id=? ORDER BY id FOR UPDATE",[id]);
      const order = await readSalesOrderDetail(tx,id), fulfilled = order.lines.reduce((sum,l) => sum+BigInt(l.fulfilledBaseQuantity),0n), ordered = order.lines.reduce((sum,l) => sum+BigInt(l.orderedBaseQuantity),0n);
      // State machine uses per-line safe integers; totals need only distinguish zero/partial/all.
      const status = transitionSalesOrder(order.status,action,{ reason: input.reason,fulfilledBaseQuantity: fulfilled === 0n ? 0 : fulfilled === ordered ? 2 : 1,orderedBaseQuantity: 2 });
      const [queue] = await tx.query("SELECT * FROM sales_backorder_entries WHERE sales_order_id=? ORDER BY id FOR UPDATE",[id]);
      const [mappings] = await tx.query(`SELECT r.*,l.sku_id FROM sales_order_line_reservations r JOIN sales_order_lines l ON l.id=r.sales_order_line_id WHERE l.sales_order_id=? ORDER BY r.id FOR UPDATE`,[id]);
      // Withdrawal re-fetches Draft display only; saleability is revalidated at the next confirmation.
      let draftCustomer,draftSkus;
      if (action === "WITHDRAW") {
        draftCustomer = await (this.customerProvider ?? new CustomerLookupService({ database: tx })).findById(order.customerId,{ purpose: "history",atMs: nowMs });
        draftSkus = await (this.itemProvider ?? new ItemLookupService({ database: tx,time: this.time,logger: this.logger })).findManyByIds(order.lines.map(line=>line.skuId),{ includeInactive: true,atMs: nowMs });
        if (!draftCustomer || !(draftSkus instanceof Map) || order.lines.some(line=>!draftSkus.has(line.skuId))) throw salesError("SALES_DEPENDENCY_UNAVAILABLE");
      }
      let release = [];
      if (order.status !== "DRAFT") {
        for (const line of order.lines) {
          assertQuantityConservation({ orderedBaseQuantity: Number(line.orderedBaseQuantity),reservedOutstandingBaseQuantity: Number(line.reservedBaseQuantity),backorderedBaseQuantity: Number(line.backorderedBaseQuantity),fulfilledBaseQuantity: Number(line.fulfilledBaseQuantity),cancelledBaseQuantity: Number(line.cancelledBaseQuantity) });
          if (mappings.filter(m => Number(m.sales_order_line_id) === line.id).reduce((sum,m) => sum+BigInt(m.outstanding_base_quantity),0n) !== BigInt(line.reservedBaseQuantity) ||
              queue.filter(q => Number(q.sales_order_line_id) === line.id && q.status === "OPEN").reduce((sum,q) => sum+BigInt(q.outstanding_base_quantity),0n) !== BigInt(line.backorderedBaseQuantity)) throw salesError("RESERVATION_RELEASE_FAILED");
        }
        await this.guard.assertAllowed(tx,{ orderId: id,action,eventId,expectedVersion: order.version });
        const releasePayload = { warehouseId: order.fulfillmentWarehouseId,expectedOrderVersion: order.version,intent: "ALL_OUTSTANDING" };
        const result = await this.inventory.releaseSalesBatchInTransaction(tx,{ actor: { userId: actor.id,serviceName: "",claimedRoles: actor.roles,claimedPermissions: actor.permissions },source: { documentId: String(id),eventId },correlationId: eventId,payload: releasePayload });
        const members = []; for await (const page of result.results) members.push(...page);
        release = validateLifecycleRelease({ ...result,members },releasePayload,mappings);
      }
      const version = order.version+1;
      // Preserve a fingerprint of the pre-release Sales commitment projection before deleting any mapping/queue.
      await this.order.audit.record(tx,{ actor,action: `sales_order.${actions[action]}`,targetId: id,targetNumber: order.number,eventId,nowMs,reason: input.reason,...trace,
        details: { fromStatus: order.status,toStatus: status,version,commitmentHash: createHash("sha256").update(JSON.stringify({ lines: order.lines,mappings,queue })).digest("hex") } });
      const [[sequence]] = await tx.query("SELECT COALESCE(MAX(sequence_no),0)+1 AS next FROM sales_order_status_history WHERE sales_order_id=?",[id]);
      await tx.execute(`INSERT INTO sales_order_status_history (sales_order_id,sequence_no,from_status,to_status,action,reason,order_version_after,event_id,actor_user_id,actor_label,occurred_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,[id,Number(sequence.next),order.status,status,actions[action],input.reason,version,eventId,actor.id,actor.username,nowMs]);
      for (const member of release) await tx.execute(`UPDATE sales_order_line_reservations SET released_base_quantity=?,outstanding_base_quantity=0,status='RELEASED',inventory_version=?,updated_at=? WHERE inventory_reservation_id=?`,[member.releasedQuantity,member.version,nowMs,member.reservationId]);
      if (action === "WITHDRAW") {
        await tx.execute("DELETE FROM sales_backorder_entries WHERE sales_order_id=?",[id]);
        await tx.execute("DELETE FROM sales_order_line_reservations WHERE sales_order_line_id IN (SELECT id FROM sales_order_lines WHERE sales_order_id=?)",[id]);
        for (const line of order.lines) {
          const sku = draftSkus.get(line.skuId);
          await tx.execute(`UPDATE sales_order_lines SET item_name_snapshot=?,sku_code_snapshot=?,sku_name_snapshot=?,reserved_outstanding_base_quantity=0,backordered_base_quantity=0,fulfilled_base_quantity=0,cancelled_base_quantity=0,version=version+1,updated_at=? WHERE id=?`,[sku.itemName,sku.skuCode,sku.skuName,nowMs,line.id]);
        }
        await tx.execute(`UPDATE sales_orders SET customer_code_snapshot=?,customer_name_snapshot=?,confirmation_event_id=NULL,confirmed_at=NULL,confirmed_by=NULL,credit_status_snapshot='NOT_CONFIGURED',credit_limit_snapshot=NULL,credit_currency_snapshot=NULL,credit_policy_version_snapshot=NULL,warehouse_code_snapshot='',warehouse_name_snapshot='' WHERE id=?`,[draftCustomer.customerCode,draftCustomer.legalName,id]);
      } else {
        for (const line of order.lines) {
          const cancelled = action === "CANCEL" && order.status === "DRAFT" ? line.orderedBaseQuantity : (BigInt(line.cancelledBaseQuantity)+BigInt(line.reservedBaseQuantity)+BigInt(line.backorderedBaseQuantity)).toString();
          await tx.execute(`UPDATE sales_order_lines SET cancelled_base_quantity=?,reserved_outstanding_base_quantity=0,backordered_base_quantity=0,version=version+1,updated_at=? WHERE id=?`,[cancelled,nowMs,line.id]);
        }
        await tx.execute("UPDATE sales_backorder_entries SET outstanding_base_quantity=0,status='CANCELLED',updated_at=? WHERE sales_order_id=? AND status='OPEN'",[nowMs,id]);
        const milestone = action === "CANCEL" ? "cancelled" : "closed";
        await tx.execute(`UPDATE sales_orders SET ${milestone}_at=?,${milestone}_by=?,${action === "CANCEL" ? "cancel" : "close"}_reason=? WHERE id=?`,[nowMs,actor.id,input.reason,id]);
      }
      const [updated] = await tx.execute("UPDATE sales_orders SET status=?,has_backorder=0,backorder_line_count=0,version=?,updated_at=?,last_business_updated_at=?,updated_by=? WHERE id=? AND version=?",[status,version,nowMs,nowMs,actor.id,id,input.version]);
      if (Number(updated.affectedRows) !== 1) throw salesError("CONCURRENT_OPERATION");
      const result = { id,number: order.number,status,version };await this.order.operations.succeed(tx,{ operationId: claim.operationId,result,nowMs });
      return { salesOrder: await readSalesOrderDetail(tx,id),operation: result };
    },{ signal,timeoutMs: this.config.transactionTimeoutMs });
  }
}
