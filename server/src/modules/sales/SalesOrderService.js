import { CustomerLookupService } from "../customer/CustomerLookupService.js";
import { ItemLookupService } from "../item/ItemLookupService.js";
import { BusinessMasterProvider } from "../businessMaster/BusinessMasterProvider.js";
import { BusinessMasterRepository } from "../businessMaster/BusinessMasterRepository.js";
import { SalesSequenceService } from "./SalesSequenceService.js";
import { SalesOperationService } from "./SalesOperationService.js";
import { SalesAuditService } from "./SalesAuditService.js";
import { requireSalesWriteActor } from "./salesAuthorization.js";
import { validateSalesDocument } from "./salesValidation.js";
import { documentTotal } from "./salesMoneyMath.js";
import { prepareSalesDocument } from "./prepareSalesDocument.js";
import { salesError } from "./salesErrors.js";

export function toSalesOrderDetail(row, lines) {
  return { id: Number(row.id), number: row.sales_order_number, status: row.status, sourceType: row.source_type,
    sourceQuotationId: row.source_quotation_id === null ? null : Number(row.source_quotation_id),
    channelCode: row.channel_code_snapshot, externalOrderId: row.external_order_id_snapshot,
    version: Number(row.version), customerId: Number(row.customer_id), customerCode: row.customer_code_snapshot, customerName: row.customer_name_snapshot,
    currencyCode: row.currency_code, paymentTermId: row.payment_term_id === null ? null : Number(row.payment_term_id), paymentTermCode: row.payment_term_code_snapshot, paymentTermName: row.payment_term_name_snapshot,
    fulfillmentWarehouseId: Number(row.fulfillment_warehouse_id), warehouseCode: row.warehouse_code_snapshot, warehouseName: row.warehouse_name_snapshot,
    orderDate: row.order_date, requestedDeliveryDate: row.requested_delivery_date, customerPoReference: row.customer_po_reference, notes: row.notes,
    lineCount: Number(row.line_count), totalAmount: String(row.total_amount), hasBackorder: Boolean(row.has_backorder), backorderLineCount: Number(row.backorder_line_count),
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at), lines: lines.map(line => ({ id: Number(line.id), lineNo: Number(line.line_no),
      skuId: Number(line.sku_id), skuUomId: Number(line.sku_uom_id), itemName: line.item_name_snapshot, skuCode: line.sku_code_snapshot, skuName: line.sku_name_snapshot,
      uomCode: line.uom_code_snapshot, uomName: line.uom_name_snapshot, toBaseFactor: Number(line.to_base_factor_snapshot), trackingPolicy: line.tracking_policy_snapshot.toUpperCase(),
      minimumSaleLifeDays: Number(line.minimum_sale_life_days_snapshot), quantity: String(line.ordered_quantity), orderedBaseQuantity: String(line.ordered_base_quantity),
      unitSellingPrice: String(line.unit_selling_price), priceSource: line.price_source, lineAmount: String(line.line_amount),
      reservedBaseQuantity: String(line.reserved_outstanding_base_quantity), backorderedBaseQuantity: String(line.backordered_base_quantity),
      fulfilledBaseQuantity: String(line.fulfilled_base_quantity), cancelledBaseQuantity: String(line.cancelled_base_quantity), lineNote: line.line_note, version: Number(line.version) })) };
}
export async function readSalesOrderDetail(tx, id, { lock = false } = {}) {
  const [[row]] = await tx.query(`SELECT id,sales_order_number,status,source_type,source_quotation_id,channel_code_snapshot,external_order_id_snapshot,
    version,customer_id,customer_code_snapshot,customer_name_snapshot,currency_code,payment_term_id,payment_term_code_snapshot,payment_term_name_snapshot,
    fulfillment_warehouse_id,warehouse_code_snapshot,warehouse_name_snapshot,DATE_FORMAT(order_date,'%Y-%m-%d') AS order_date,
    DATE_FORMAT(requested_delivery_date,'%Y-%m-%d') AS requested_delivery_date,customer_po_reference,notes,line_count,total_amount,has_backorder,backorder_line_count,
    created_at,updated_at FROM sales_orders WHERE id=?${lock ? " LOCK IN SHARE MODE" : ""}`, [id]);
  if (!row) throw salesError("SALES_ORDER_NOT_FOUND");
  const [lines] = await tx.query(`SELECT id,line_no,sku_id,sku_uom_id,item_name_snapshot,sku_code_snapshot,sku_name_snapshot,uom_code_snapshot,uom_name_snapshot,
    to_base_factor_snapshot,tracking_policy_snapshot,minimum_sale_life_days_snapshot,ordered_quantity,CAST(ordered_base_quantity AS CHAR) AS ordered_base_quantity,
    unit_selling_price,price_source,line_amount,CAST(reserved_outstanding_base_quantity AS CHAR) AS reserved_outstanding_base_quantity,
    CAST(backordered_base_quantity AS CHAR) AS backordered_base_quantity,CAST(fulfilled_base_quantity AS CHAR) AS fulfilled_base_quantity,
    CAST(cancelled_base_quantity AS CHAR) AS cancelled_base_quantity,line_note,version FROM sales_order_lines WHERE sales_order_id=? ORDER BY line_no LIMIT 100${lock ? " LOCK IN SHARE MODE" : ""}`, [id]);
  return toSalesOrderDetail(row, lines);
}

export class SalesOrderService {
  constructor({ database, time, logger, customerProvider, itemProvider, businessMaster, audit } = {}) {
    this.database=database;this.time=time;
    this.customers=customerProvider ?? new CustomerLookupService({ database });
    this.items=itemProvider ?? new ItemLookupService({ database,time,logger });
    this.businessMaster=businessMaster ?? new BusinessMasterProvider({ database,repository:new BusinessMasterRepository() });
    this.sequence=new SalesSequenceService({ time });this.operations=new SalesOperationService();this.audit=audit ?? new SalesAuditService();
  }
  authorizeWrite(claims) { return this.database.withTransaction(tx=>requireSalesWriteActor(tx,claims)).then(()=>true); }
  create(request) { return this.#save(request,false); }
  update(request) { return this.#save(request,true); }
  async #save({ claims, input, id, trace = {} }, update) {
    if(update && (!Number.isSafeInteger(id)||id<1))throw salesError("SALES_INPUT_INVALID",{field:"id"});
    return this.operations.run(this.database,async tx=>{
      const actor=await requireSalesWriteActor(tx,claims),{document,warnings}=validateSalesDocument(input,{update}),nowMs=this.time.nowMs();
      const {eventId,...payload}=document;
      const claim=await this.operations.claim(tx,{eventId,commandType:update?"UPDATE_ORDER":"CREATE_ORDER",targetId:update?id:null,payload,actor,nowMs,...trace});
      if(claim.replay)return {salesOrder:await readSalesOrderDetail(tx,claim.replay.id,{lock:true}),operation:claim.replay,warnings:[]};
      let number,version;
      if(update){
        const [[before]]=await tx.query("SELECT id,sales_order_number,status,version FROM sales_orders WHERE id=? FOR UPDATE",[id]);
        if(!before)throw salesError("SALES_ORDER_NOT_FOUND");if(before.status!=="DRAFT")throw salesError("SALES_STATE_CONFLICT");
        if(Number(before.version)!==document.version)throw salesError("VERSION_CONFLICT",{currentVersion:Number(before.version)});
        const [existing]=await tx.query("SELECT id,sku_id,sku_uom_id FROM sales_order_lines WHERE sales_order_id=? ORDER BY id FOR UPDATE",[id]);
        for(const line of input.lines)if(line.id!==undefined && !existing.some(row=>Number(row.id)===line.id && Number(row.sku_id)===line.skuId && Number(row.sku_uom_id)===line.skuUomId))throw salesError("SALES_INPUT_INVALID",{field:"lines"});
        number=before.sales_order_number;version=document.version+1;
      }else{number=await this.sequence.nextNumberInTransaction(tx,{documentType:"SALES_ORDER",nowMs});version=1;}
      const prepared=await prepareSalesDocument(tx,document,nowMs,this);
      const [[warehouse]]=await tx.query("SELECT id,warehouse_code,warehouse_name,status FROM inventory_warehouses WHERE id=? LOCK IN SHARE MODE",[document.fulfillmentWarehouseId]);
      if(!warehouse || warehouse.status!=="ACTIVE")throw salesError("WAREHOUSE_INVALID");
      const header={customer_id:document.customerId,customer_code_snapshot:prepared.customer.customerCode,customer_name_snapshot:prepared.customer.legalName,
        currency_code:document.currencyCode,payment_term_id:prepared.term?.id ?? null,payment_term_code_snapshot:prepared.term?.code ?? "",payment_term_name_snapshot:prepared.term?.name ?? "",
        fulfillment_warehouse_id:document.fulfillmentWarehouseId,warehouse_code_snapshot:warehouse.warehouse_code,warehouse_name_snapshot:warehouse.warehouse_name,
        order_date:document.orderDate,requested_delivery_date:document.requestedDeliveryDate ?? null,customer_po_reference:document.customerPoReference,notes:document.notes,
        line_count:prepared.lines.length,total_amount:documentTotal(prepared.lines.map(line=>line.line_amount)),version,updated_at:nowMs,last_business_updated_at:nowMs,updated_by:actor.id};
      if(update){
        const [written]=await tx.execute(`UPDATE sales_orders SET ${Object.keys(header).map(field=>`${field}=?`).join(",")} WHERE id=? AND version=? AND status='DRAFT'`,[...Object.values(header),id,document.version]);
        if(written.affectedRows!==1)throw salesError("VERSION_CONFLICT",{currentVersion:document.version});
        await tx.execute("DELETE FROM sales_order_lines WHERE sales_order_id=?",[id]);
      }else{
        const row={sales_order_number:number,status:"DRAFT",source_type:"MANUAL",...header,created_at:nowMs,created_by:actor.id};
        const [inserted]=await tx.execute(`INSERT INTO sales_orders (${Object.keys(row).join(",")}) VALUES (${Object.keys(row).map(()=>"?").join(",")})`,Object.values(row));id=Number(inserted.insertId);
      }
      for(const [index,source] of prepared.lines.entries()){
        const {quantity,base_quantity,...line}=source,snapshot=prepared.snapshots.find(row=>row.skuId===line.sku_id && row.salesUom.skuUomId===line.sku_uom_id);
        const row={sales_order_id:id,line_no:index+1,...line,ordered_quantity:quantity,ordered_base_quantity:base_quantity,
          tracking_policy_snapshot:snapshot.trackingPolicy,minimum_sale_life_days_snapshot:snapshot.minimumSaleLifeDays ?? 0,created_at:nowMs,updated_at:nowMs};
        await tx.execute(`INSERT INTO sales_order_lines (${Object.keys(row).join(",")}) VALUES (${Object.keys(row).map(()=>"?").join(",")})`,Object.values(row));
      }
      if(!update)await tx.execute(`INSERT INTO sales_order_status_history (sales_order_id,sequence_no,from_status,to_status,action,order_version_after,event_id,actor_user_id,actor_label,occurred_at)
        VALUES (?,1,NULL,'DRAFT','created',1,?,?,?,?)`,[id,eventId,actor.id,actor.username,nowMs]);
      await this.audit.record(tx,{actor,action:update?"sales_order.updated":"sales_order.created",targetId:id,targetNumber:number,eventId,nowMs,...trace,
        details:{version,lineCount:header.line_count,totalAmount:header.total_amount,currencyCode:document.currencyCode}});
      const result={id,number,status:"DRAFT",version};await this.operations.succeed(tx,{operationId:claim.operationId,result,nowMs});
      if(document.currencyCode!==prepared.customer.defaultCurrencyCode)warnings.push({code:"CUSTOMER_CURRENCY_DIFFERENT",field:"currencyCode"});
      return {salesOrder:await readSalesOrderDetail(tx,id,{lock:true}),operation:result,warnings};
    });
  }
}
