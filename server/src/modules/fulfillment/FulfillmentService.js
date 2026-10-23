import { randomUUID } from "node:crypto";
import { FulfillmentTransactionService } from "./FulfillmentTransactionService.js";
import { FulfillmentInquiryService } from "./FulfillmentInquiryService.js";
import { FulfillmentSequenceService } from "./FulfillmentSequenceService.js";
import { FulfillmentOperationService } from "./FulfillmentOperationService.js";
import { FulfillmentLockService } from "./FulfillmentLockService.js";
import { SalesFulfillmentService } from "../sales/SalesFulfillmentService.js";
import { InventoryFulfillmentService } from "../inventory/InventoryFulfillmentService.js";
import { InventoryLookupService } from "../inventory/InventoryLookupService.js";
import { ItemLookupService } from "../item/ItemLookupService.js";
import { requireFulfillmentActor } from "./fulfillmentAuthorization.js";
import { normalizeFulfillmentCreate } from "./fulfillmentCreateCommand.js";
import { fulfillmentError } from "./fulfillmentErrors.js";

async function insert(tx, table, row) {
  const columns = Object.keys(row), [result] = await tx.execute(`INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(()=>"?").join(",")})`, Object.values(row));
  return String(result.insertId);
}
export class FulfillmentService {
  constructor({ database, time, logger }) {
    Object.assign(this, { database, time, logger });
    this.transactions = new FulfillmentTransactionService({ database });
    this.sequence = new FulfillmentSequenceService({ database, time });
    this.inquiry = new FulfillmentInquiryService({ database });
    this.operations = new FulfillmentOperationService({ database, time });
    this.sales = new SalesFulfillmentService({ database, time, logger });
    const inventory = new InventoryFulfillmentService({ database, time, logger });
    this.locks = new FulfillmentLockService({ database, time, sales: this.sales, itemLookup: new ItemLookupService({ database, time, logger }), inventoryLookup: new InventoryLookupService({ fulfillment: inventory, time }) });
  }
  async create(input) {
    const command = normalizeFulfillmentCreate(input);
    const number = await this.sequence.reserveNumber({ documentType: "FULFILLMENT" });
    const request = { eventId: command.eventId, operationType: "CREATE", target: { type: "FULFILLMENT", id: null }, payload: command, leaseOwner: randomUUID(), correlationId: randomUUID() };
    const outcome = await this.transactions.withTransaction(async tx => {
      const operation = await this.operations.claimInTransaction(tx, request);
      if (operation.replay) {
        if (operation.status === "FAILED") throw fulfillmentError(operation.publicErrorCode, operation.publicErrorDetails);
        return operation.result;
      }
      if (!operation.created) throw fulfillmentError("CONCURRENT_OPERATION");
      const actor = await requireFulfillmentActor(this.database, tx, "fulfillment.operation"), at = this.time.nowMs();
      const preflight = await this.sales.getOrderForFulfillment(String(command.salesOrderId), { atMs: at });
      if (preflight.version !== command.salesOrderVersion) throw fulfillmentError("VERSION_CONFLICT");
      const lines = command.lines.map(selected => {
        const line = preflight.lines.find(row => row.lineId === String(selected.salesOrderLineId));
        if (!line) throw fulfillmentError("FULFILLABLE_QUANTITY_CHANGED");
        let remaining = BigInt(selected.plannedBaseQuantity);
        const reservations = [];
        // This is only a bounded Sales lock probe. Largest capacities minimize tentative members;
        // the complete fresh proof below still allocates actual Claims by mapping ID.
        for (const mapping of [...line.reservationMappings].sort((a,b)=>BigInt(a.outstandingBaseQuantity)===BigInt(b.outstandingBaseQuantity)?(BigInt(a.salesReservationMappingId)<BigInt(b.salesReservationMappingId)?-1:1):(BigInt(a.outstandingBaseQuantity)>BigInt(b.outstandingBaseQuantity)?-1:1))) {
          const free = BigInt(mapping.outstandingBaseQuantity), quantity = remaining < free ? remaining : free;
          if (quantity > 0n) reservations.push({ claimId: null, inventoryReservationId: mapping.inventoryReservationId, expectedVersion: mapping.inventoryVersion, baseQuantity: quantity.toString() });
          remaining -= quantity; if (!remaining) break;
        }
        if (remaining || reservations.length > 50) throw fulfillmentError("RESERVATION_CLAIM_CONFLICT");
        return { salesOrderLineId: line.lineId, expectedVersion: line.version, baseQuantity: selected.plannedBaseQuantity, reservations: reservations.sort((a,b)=>BigInt(a.inventoryReservationId)<BigInt(b.inventoryReservationId)?-1:1) };
      });
      const salesIntent = { actor: { userId: String(actor.id), serviceName: "", claimedRoles: actor.roles, claimedPermissions: actor.permissions }, purpose: "CLAIM", claimMode: "PENDING_CREATE", salesOrderId: String(command.salesOrderId), expectedOrderVersion: command.salesOrderVersion, lines };
      const proof = await this.locks.lockPendingClaimCapacityInTransaction(tx, { salesIntent });
      const order = proof.sales;
      // Names are read through the existing owner batch while all corresponding Item/UOM locks remain held.
      const snapshots = await new ItemLookupService({ database: tx, time: this.time, logger: this.logger }).findManyForSale([...new Set(order.lines.map(line=>Number(line.skuId)))], { atMs: at });
      const id = await insert(tx, "fulfillments", { fulfillment_number: number, sales_order_id: order.orderId, sales_order_number_snapshot: order.orderNumber, customer_id: order.customer.id, customer_code_snapshot: order.customer.code, customer_name_snapshot: order.customer.name, warehouse_id: order.warehouse.id, warehouse_code_snapshot: order.warehouse.code, warehouse_name_snapshot: order.warehouse.name, status: "DRAFT", line_count: proof.lines.length, notes: command.notes, last_business_updated_at: at, created_at: at, updated_at: at, created_by: actor.id, updated_by: actor.id });
      const claimRows = [];
      let lineNo = 0;
      for (const source of [...order.lines].sort((a,b)=>a.lineNo-b.lineNo)) {
        const selected = proof.lines.find(line=>line.salesOrderLineId===source.lineId), profile = proof.profiles.find(row=>row.skuId===source.skuId);
        const base = snapshots.get(Number(source.skuId))?.uoms.find(uom=>uom.isBase && String(uom.uomId)===source.baseUomId);
        if (!selected || !base || typeof base.uomName !== "string" || !base.uomName) throw fulfillmentError("FULFILLMENT_DEPENDENCY_UNAVAILABLE");
        const lineId = await insert(tx, "fulfillment_lines", { fulfillment_id: id, sales_order_id: order.orderId, sales_order_line_id: source.lineId, line_no: ++lineNo, sales_order_line_no: source.lineNo, sku_id: source.skuId, sku_code_snapshot: source.skuCode, sku_name_snapshot: source.skuName, base_uom_id: source.baseUomId, base_uom_code_snapshot: base.uomCode, base_uom_name_snapshot: base.uomName, tracking_policy_snapshot: profile.trackingPolicy, minimum_sale_life_days_snapshot: profile.minimumSaleLifeDays, planned_base_quantity: selected.baseQuantity, created_at: at, updated_at: at });
        for (const claim of selected.claims) claimRows.push([id,lineId,claim.salesReservationMappingId,claim.inventoryReservationId,claim.baseQuantity,claim.baseQuantity,"ACTIVE",claim.inventoryVersion,at,at]);
      }
      for (let start=0; start<claimRows.length; start+=100) {
        const batch=claimRows.slice(start,start+100);
        await tx.execute(`INSERT INTO fulfillment_line_reservation_claims (fulfillment_id,fulfillment_line_id,sales_order_line_reservation_id,inventory_reservation_id,original_claimed_quantity,active_claimed_quantity,status,inventory_version,created_at,updated_at) VALUES ${batch.map(()=>"(?,?,?,?,?,?,?,?,?,?)").join(",")}`,batch.flat());
      }
      await insert(tx,"fulfillment_status_history",{fulfillment_id:id,sequence_no:1,from_status:null,to_status:"DRAFT",action:"CREATE",event_id:command.eventId,version_after:1,actor_user_id:actor.id,actor_label:actor.username,occurred_at:at});
      await insert(tx,"fulfillment_audit_logs",{target_type:"FULFILLMENT",target_id:id,action:"CREATE",event_id:command.eventId,correlation_id:request.correlationId,actor_user_id:actor.id,actor_label:actor.username,after_summary:JSON.stringify({fulfillmentId:id,salesOrderId:order.orderId,warehouseId:order.warehouse.id,status:"DRAFT",version:1,lineCount:proof.lines.length}),occurred_at:at});
      const result = {id,number,status:"DRAFT",version:1};
      await this.operations.succeedInTransaction(tx,{request,result});
      return result;
    });
    // Current projections use one fresh coherent snapshot, independently of the original durable outcome.
    try { return { outcome, ...await this.inquiry.detail(outcome.id) }; }
    catch (error) {
      if (["FULFILLMENT_PERMISSION_DENIED", "PERMISSION_STALE"].includes(error.code)) throw error;
      await this.logger.error("fulfillment.create.projection_unavailable", "Create succeeded but its current projection is unavailable", { code: "FULFILLMENT_DEPENDENCY_UNAVAILABLE", correlationId: request.correlationId });
      throw fulfillmentError("FULFILLMENT_DEPENDENCY_UNAVAILABLE", { correlationId: request.correlationId });
    }
  }
}
