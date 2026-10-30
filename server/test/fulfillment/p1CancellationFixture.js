import { ShipmentService } from "../../src/modules/fulfillment/ShipmentService.js";
import { randomUUID } from "node:crypto";
import { p1Fixture,addSourceLine } from "./p1Fixture.js";
import { FulfillmentAllocationService } from "../../src/modules/fulfillment/FulfillmentAllocationService.js";
import { FulfillmentPickingService } from "../../src/modules/fulfillment/FulfillmentPickingService.js";
import { FulfillmentCancellationService } from "../../src/modules/fulfillment/FulfillmentCancellationService.js";
export async function cancellationFixture(t,{picked="3"}={}){
 const f=await p1Fixture(t,5),created=await f.create(f.body("5")),bin=await f.s.insert("inventory_bins",{warehouse_id:f.s.warehouseId,bin_code:"CANCEL-HISTORY",normalized_code:"cancel-history",status:"ACTIVE",created_at:f.s.now,updated_at:f.s.now}),balance=await f.s.insert("inventory_stock_balances",{warehouse_id:f.s.warehouseId,bin_id:bin,sku_id:f.s.skuId,stock_status:"AVAILABLE",on_hand_quantity:5,allocated_quantity:0,fifo_anchor_date:"2023-11-13",created_at:f.s.now,updated_at:f.s.now}),logs=[],options={database:f.database,time:{...f.time,fileDate:()=>"2023-11-14"},logger:{error(...args){logs.push(args);}}},allocator=new FulfillmentAllocationService(options),picking=new FulfillmentPickingService(options),cancellation=new FulfillmentCancellationService(options);
 const allocated=await f.execute(()=>allocator.allocate(created.outcome.id,{eventId:randomUUID(),version:1,lines:[{fulfillmentLineId:Number(created.fulfillment.lines[0].id),overrideReason:"",allocations:[{inventoryReservationId:Number(f.reservationId),inventoryBalanceId:Number(balance),balanceVersion:1,baseQuantity:"5"}]}]}));
 let current=allocated;if(picked!==null)current=await f.execute(()=>picking.confirmPick(created.outcome.id,{eventId:randomUUID(),version:2,lines:[{fulfillmentLineId:Number(allocated.fulfillment.lines[0].id),shortPickReason:picked==="5"?"":"Two units missing from original bin",allocations:[{fulfillmentAllocationId:Number(allocated.fulfillment.allocations.items[0].id),inventoryAllocationVersion:1,pickedBaseQuantity:picked}]}]}));
 const body=()=>({eventId:randomUUID(),version:current.outcome.version,reason:"Wrong task for this order",goodsReturnedToOriginalBins:picked!==null});return {...f,created,allocated,current,bin,balance,options,logs,allocator,picking,cancellation,body,cancel:input=>f.execute(()=>cancellation.cancel(created.outcome.id,input))};
}
export async function cancellationFacts(f){const result={};for(const table of ["fulfillments","fulfillment_lines","fulfillment_line_reservation_claims","fulfillment_allocations","fulfillment_status_history","fulfillment_audit_logs","fulfillment_operation_requests","inventory_stock_balances","inventory_stock_controls","inventory_reservations","inventory_allocations","inventory_operation_requests","inventory_audit_logs","sales_orders","sales_order_lines","sales_order_line_reservations","shipments"])result[table]=(await f.db.query(`SELECT * FROM ${table} ORDER BY id`))[0];return result;}

export async function shipmentDraftFixture(t){
 const f=await cancellationFixture(t),service=new ShipmentService(f.options);
 await f.s.insert("customer_address_purposes",{address_id:f.s.addressId,customer_id:f.s.customerId,purpose_code:"shipping",is_default:1,created_at:f.s.now,updated_at:f.s.now});
 const body=()=>({eventId:randomUUID(),shippingAddressId:f.s.addressId,shippingAddressVersion:1,totalWeight:"1.250000",weightUom:"KG"});
 return {...f,service,body,create:input=>f.execute(()=>service.createDraft(String(f.created.outcome.id),input)),update:(id,input)=>f.execute(()=>service.updateDraft(id,input)),cancelDraft:(id,input)=>f.execute(()=>service.cancelDraft(id,input))};
}
export async function shipmentDraftFacts(f){const output={};for(const table of ["shipments","shipment_lines","shipment_status_history","fulfillment_operation_requests","fulfillment_audit_logs","fulfillments"])output[table]=(await f.db.query(`SELECT * FROM ${table} ORDER BY id`))[0];return output;}

export async function shipmentTwoLineFixture(t,{addressLabel="Synthetic shipping"}={}){
 const f=await p1Fixture(t,5),second=await addSourceLine(f,2),options={database:f.database,time:{...f.time,fileDate:()=>"2023-11-14"},logger:{error(){}}};
 const {up}=await import("../../database/migrations/0097_create_shipment_issues_and_reversals.js");await up(f.db);
 await f.db.execute("UPDATE customer_addresses SET label=?,version=version+1,updated_at=? WHERE id=?",[addressLabel,f.s.now,f.s.addressId]);
 await f.s.insert("customer_address_purposes",{address_id:f.s.addressId,customer_id:f.s.customerId,purpose_code:"shipping",is_default:1,created_at:f.s.now,updated_at:f.s.now});
 const sources=[{salesOrderLineId:f.s.lineId,skuId:f.s.skuId,reservationId:f.reservationId,quantity:"5",picked:"3"},{salesOrderLineId:second.lineId,skuId:second.skuId,reservationId:second.reservationId,quantity:"2",picked:"2"}];
 const work=await f.execute(()=>f.fulfillments.create({eventId:randomUUID(),salesOrderId:f.s.orderId,salesOrderVersion:2,lines:sources.map(row=>({salesOrderLineId:row.salesOrderLineId,plannedBaseQuantity:row.quantity}))}));
 for(const [i,source]of sources.entries()){
  const bin=await f.s.insert("inventory_bins",{warehouse_id:f.s.warehouseId,bin_code:"SHIP-"+i,normalized_code:"ship-"+i,status:"ACTIVE",created_at:f.s.now,updated_at:f.s.now});
  source.balanceId=await f.s.insert("inventory_stock_balances",{warehouse_id:f.s.warehouseId,bin_id:bin,sku_id:source.skuId,stock_status:"AVAILABLE",on_hand_quantity:Number(source.quantity),allocated_quantity:0,fifo_anchor_date:"2023-11-13",created_at:f.s.now,updated_at:f.s.now});
 }
 const allocator=new FulfillmentAllocationService(options),picking=new FulfillmentPickingService(options);
 const allocated=await f.execute(()=>allocator.allocate(work.outcome.id,{eventId:randomUUID(),version:1,lines:sources.map(source=>({fulfillmentLineId:Number(work.fulfillment.lines.find(line=>line.salesOrderLineId===String(source.salesOrderLineId)).id),overrideReason:"",allocations:[{inventoryReservationId:Number(source.reservationId),inventoryBalanceId:Number(source.balanceId),balanceVersion:1,baseQuantity:source.quantity}]}))}));
 await f.execute(()=>picking.confirmPick(work.outcome.id,{eventId:randomUUID(),version:2,lines:sources.map(source=>{const line=allocated.fulfillment.lines.find(row=>row.salesOrderLineId===String(source.salesOrderLineId)),allocation=allocated.fulfillment.allocations.items.find(row=>row.fulfillmentLineId===line.id);return {fulfillmentLineId:Number(line.id),shortPickReason:source.picked===source.quantity?"":"Two units missing from the original bin",allocations:[{fulfillmentAllocationId:Number(allocation.id),inventoryAllocationVersion:allocation.inventoryVersion,pickedBaseQuantity:source.picked}]};})}));
 const shipments=new ShipmentService(options),body={eventId:randomUUID(),shippingAddressId:f.s.addressId,shippingAddressVersion:2,carrierName:"Synthetic Carrier",trackingNumber:"TRACK-SYNTHETIC",totalWeight:"1.25",weightUom:"KG"},draft=await f.execute(()=>shipments.createDraft(work.outcome.id,body));
 const confirm=async()=>{const {ShipmentConfirmationService}=await import("../../src/modules/fulfillment/ShipmentConfirmationService.js"),service=new ShipmentConfirmationService(options);return f.execute(async()=>{const started=await service.startConfirmation(draft.outcome.id,{eventId:randomUUID(),version:1});return service.completeConfirmation(started);});};
 return {...f,options,sources,work,shipments,draft,confirm};
}
