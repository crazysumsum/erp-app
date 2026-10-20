import { randomUUID } from "node:crypto";
import { createTestCurrency } from "../phase1/fixtures.js";

// Only called on a fixture-owned database; its enclosing fixture drops that entire private namespace.
export async function seedFulfillmentSalesOrder(db) {
  const label="fa_"+randomUUID().slice(0,12),now=1700000000000;
  const insert=async(table,row)=>Number((await db.query(`INSERT INTO ${table} SET ?`,row))[0].insertId);
  const currency=await createTestCurrency(db,[],now);
  const customerId=await insert("customers",{customer_code:label,customer_code_key:label,legal_name:label,legal_name_key:label,default_currency_code:currency,status:"active",created_at:now,updated_at:now});
  const warehouseId=await insert("inventory_warehouses",{warehouse_code:label,normalized_code:label,warehouse_name:label,status:"ACTIVE",created_at:now,updated_at:now});
  const uomId=await insert("item_uoms",{code:label,name:"Each",status:"active",created_at:now,updated_at:now});
  const itemId=await insert("items",{name:label,status:"active",created_at:now,updated_at:now});
  const skuId=await insert("item_skus",{item_id:itemId,sku_code:label,sku_name:label,status:"active",created_at:now,updated_at:now});
  const skuUomId=await insert("item_sku_uoms",{sku_id:skuId,uom_id:uomId,to_base_factor:1,is_base:1,is_default_sale:1,created_at:now,updated_at:now});
  const addressId=await insert("customer_addresses",{customer_id:customerId,label:"Synthetic",address_line1:"Synthetic only",created_at:now,updated_at:now});
  const orderId=await insert("sales_orders",{sales_order_number:label,status:"CANCELLED",source_type:"MANUAL",customer_id:customerId,customer_code_snapshot:label,customer_name_snapshot:label,currency_code:currency,fulfillment_warehouse_id:warehouseId,warehouse_code_snapshot:label,warehouse_name_snapshot:label,order_date:"2023-11-14",line_count:1,total_amount:"1.0000",created_at:now,updated_at:now,last_business_updated_at:now});
  const lineId=await insert("sales_order_lines",{sales_order_id:orderId,line_no:1,sku_id:skuId,sku_uom_id:skuUomId,item_name_snapshot:label,sku_code_snapshot:label,sku_name_snapshot:label,uom_code_snapshot:"EA",uom_name_snapshot:"Each",to_base_factor_snapshot:1,tracking_policy_snapshot:"none",ordered_quantity:"1.000000",ordered_base_quantity:1,unit_selling_price:"1.0000",price_source:"MANUAL",line_amount:"1.0000",cancelled_base_quantity:1,created_at:now,updated_at:now});
  return {orderId,lineId,customerId,warehouseId,uomId,skuId,skuUomId,addressId,now,insert};
}

export async function seedCancelledFulfillment(db) {
  const f=await seedFulfillmentSalesOrder(db),label="FUL-"+randomUUID().slice(0,12);
  const fulfillmentId=await f.insert("fulfillments",{fulfillment_number:label,sales_order_id:f.orderId,sales_order_number_snapshot:String(f.orderId),customer_id:f.customerId,customer_code_snapshot:"Synthetic",customer_name_snapshot:"Synthetic",warehouse_id:f.warehouseId,warehouse_code_snapshot:"Synthetic",warehouse_name_snapshot:"Synthetic",status:"CANCELLED",line_count:1,last_business_updated_at:f.now,created_at:f.now,updated_at:f.now});
  const fulfillmentLineId=await f.insert("fulfillment_lines",{fulfillment_id:fulfillmentId,sales_order_id:f.orderId,sales_order_line_id:f.lineId,line_no:1,sales_order_line_no:1,sku_id:f.skuId,sku_code_snapshot:"Synthetic",sku_name_snapshot:"Synthetic",base_uom_id:f.uomId,base_uom_code_snapshot:"EA",base_uom_name_snapshot:"Each",tracking_policy_snapshot:"none",planned_base_quantity:1,created_at:f.now,updated_at:f.now});
  return {...f,fulfillmentId,fulfillmentLineId};
}

export async function seedFulfillmentClaim(db) {
  const f=await seedCancelledFulfillment(db),eventId=randomUUID();
  const operation={source_module:"SALES",source_document_type:"SALES_ORDER",source_document_id:String(f.orderId),source_event_id:eventId,request_hash:"a".repeat(64),actor_label:"Synthetic",created_at:f.now};
  const rootOperationId=await f.insert("inventory_operation_requests",{...operation,command_type:"SALES_BATCH_RESERVE"});
  const childOperationId=await f.insert("inventory_operation_requests",{...operation,command_type:"SALES_LINE_RESERVE",source_line_id:String(f.lineId)});
  const reservationId=await f.insert("inventory_reservations",{create_operation_id:childOperationId,warehouse_id:f.warehouseId,sku_id:f.skuId,original_quantity:1,outstanding_quantity:1,purpose:"SALE",status:"ACTIVE",created_at:f.now,updated_at:f.now});
  const mappingId=await f.insert("sales_order_line_reservations",{sales_order_line_id:f.lineId,inventory_reservation_id:reservationId,inventory_operation_id:rootOperationId,source_event_id:eventId,original_base_quantity:1,outstanding_base_quantity:1,status:"ACTIVE",inventory_version:1,created_at:f.now,updated_at:f.now});
  const claimId=await f.insert("fulfillment_line_reservation_claims",{fulfillment_id:f.fulfillmentId,fulfillment_line_id:f.fulfillmentLineId,sales_order_line_reservation_id:mappingId,inventory_reservation_id:reservationId,original_claimed_quantity:1,active_claimed_quantity:1,status:"ACTIVE",inventory_version:1,created_at:f.now,updated_at:f.now});
  await db.query("UPDATE fulfillments SET status='DRAFT' WHERE id=?",[f.fulfillmentId]);
  return {...f,reservationId,mappingId,claimId,rootOperationId,childOperationId};
}
export async function seedFulfillmentAllocation(db) {
  const f=await seedFulfillmentClaim(db),label=randomUUID();
  const binId=await f.insert("inventory_bins",{warehouse_id:f.warehouseId,bin_code:label,normalized_code:label,created_at:f.now,updated_at:f.now});
  const balanceId=await f.insert("inventory_stock_balances",{warehouse_id:f.warehouseId,bin_id:binId,sku_id:f.skuId,stock_status:"AVAILABLE",on_hand_quantity:1,allocated_quantity:1,created_at:f.now,updated_at:f.now});
  const operationId=await f.insert("inventory_operation_requests",{command_type:"ALLOCATE",source_module:"FULFILLMENT",source_document_type:"FULFILLMENT",source_document_id:String(f.fulfillmentId),source_event_id:randomUUID(),request_hash:"a".repeat(64),actor_label:"Synthetic",created_at:f.now});
  const inventoryAllocationId=await f.insert("inventory_allocations",{create_operation_id:operationId,reservation_id:f.reservationId,stock_balance_id:balanceId,allocated_quantity:1,outstanding_quantity:1,selection_strategy:"FIFO",status:"ACTIVE",created_at:f.now,updated_at:f.now});
  const allocationId=await f.insert("fulfillment_allocations",{fulfillment_id:f.fulfillmentId,fulfillment_line_id:f.fulfillmentLineId,claim_id:f.claimId,inventory_reservation_id:f.reservationId,inventory_allocation_id:inventoryAllocationId,inventory_balance_id:balanceId,warehouse_id:f.warehouseId,bin_id:binId,stock_status_snapshot:"AVAILABLE",selection_strategy:"FIFO",recommended_rank_snapshot:1,allocated_base_quantity:1,status:"ACTIVE",inventory_version:1,balance_version:1,created_at:f.now,updated_at:f.now});
  await db.query("UPDATE fulfillment_lines SET allocated_base_quantity=1 WHERE id=?",[f.fulfillmentLineId]);await db.query("UPDATE fulfillments SET status='PICKING' WHERE id=?",[f.fulfillmentId]);
  return {...f,binId,balanceId,operationId,inventoryAllocationId,allocationId};
}
