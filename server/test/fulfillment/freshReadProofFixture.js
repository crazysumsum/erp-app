export function freshReadProofFixture(lineCount=2,membersPerLine=3){
 const snapshot={header:{id:1,sales_order_id:2,warehouse_id:3,status:"PICKING",version:2,line_count:lineCount,allocated_at:1,active_shipment_id:null,picked_at:null,shipped_at:null,reversed_at:null},lines:[],claims:[],allocations:[],allocationTotals:[],hasShipment:false},facts={fulfillmentId:"1",allocations:[],reservationFacts:[]},command={eventId:"00000000-0000-4000-8000-000000000001",version:2,lines:[]};
 for(let i=0;i<lineCount;i++){
  const id=100+i,sales=200+i,sku=300+i,balance=50000+i;
  snapshot.lines.push({id,fulfillment_id:1,sales_order_line_id:sales,sku_id:sku,version:1,planned_base_quantity:membersPerLine,allocated_base_quantity:membersPerLine,picked_base_quantity:0,short_base_quantity:0,shipped_base_quantity:0,reversed_base_quantity:0});snapshot.allocationTotals.push({fulfillment_line_id:id,allocated:membersPerLine,released:0,picked:0});
  const selected={fulfillmentLineId:id,shortPickReason:"Missing physical stock in original bin",allocations:[]};
  for(let j=0;j<membersPerLine;j++){
   const n=i*membersPerLine+j,claim=10000+n,reservation=20000+n,allocation=30000+n,inventory=40000+n;
   snapshot.claims.push({id:claim,fulfillment_id:1,fulfillment_line_id:id,inventory_reservation_id:reservation,inventory_version:2,original_claimed_quantity:1,active_claimed_quantity:1,released_quantity:0,consumed_quantity:0,reversed_quantity:0,status:"ACTIVE"});snapshot.allocations.push({id:allocation,fulfillment_id:1,fulfillment_line_id:id,claim_id:claim,inventory_reservation_id:reservation,inventory_allocation_id:inventory,inventory_balance_id:balance,inventory_version:1,balance_version:1,allocated_base_quantity:1,released_base_quantity:0,picked_base_quantity:0,status:"ACTIVE"});
   facts.allocations.push({inventoryAllocationId:String(inventory),inventoryReservationId:String(reservation),claimId:String(claim),fulfillmentLineId:String(id),salesOrderLineId:String(sales),inventoryBalanceId:String(balance),warehouseId:"3",skuId:String(sku),version:1,balanceVersion:51,status:"ACTIVE",allocatedQuantity:"1",consumedQuantity:"0",releasedQuantity:"0",outstandingQuantity:"1"});facts.reservationFacts.push({inventoryReservationId:String(reservation),warehouseId:"3",skuId:String(sku),salesOrderId:"2",salesOrderLineId:String(sales),originalInventoryOperationId:String(60000+n),originalSourceEventId:command.eventId,originalQuantity:"1",consumedQuantity:"0",releasedQuantity:"0",outstandingQuantity:"1",version:2});selected.allocations.push({fulfillmentAllocationId:allocation,inventoryAllocationVersion:1,pickedBaseQuantity:i===lineCount-1&&j===membersPerLine-1?"1":"0"});
  }
  command.lines.push(selected);
 }
 const query={fulfillmentId:"1",inventoryAllocationIds:facts.allocations.map(row=>row.inventoryAllocationId)};return {snapshot,facts,command,query};
}
