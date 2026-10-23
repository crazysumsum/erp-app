import { loadInventoryCandidates } from "./InventoryPickSequenceService.js";
import { inventoryError } from "./inventoryErrors.js";

// All inputs are owner-validated under current Warehouse/Reservation anchors.
// The budget exists only for this read: physical quantities and CAS never change.
export async function readFulfillmentBatchCandidates(tx,{warehouseId,demands,profiles,reservations,time}) {
  const used=new Map(),pages=new Map(),result=[];
  for(const demand of demands) {
    const reservation=reservations.get(demand.inventoryReservationId),profile=profiles.get(demand.skuId),minimumRemainingDays=Number(reservation.minimum_remaining_days);
    let remaining=Number(demand.requestedQuantity),offset=0,rank=0,exhausted=false;
    const visible=[],seen=new Set();
    while(!exhausted&&(remaining>0||rank<=demand.page*100)) {
      const key=`${demand.skuId}:${minimumRemainingDays}:${offset}`;
      let rows=pages.get(key);
      if(!rows){rows=await loadInventoryCandidates(tx,{warehouseId:Number(warehouseId),skuId:Number(demand.skuId),currentDate:time.fileDate(),minimumRemainingDays,trackingPolicy:profile.trackingPolicy,limit:100,offset});pages.set(key,rows);}
      for(const candidate of rows) {
        const id=String(candidate.id);
        if(seen.has(id))throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");seen.add(id);
        const available=candidate.freeQuantity-(used.get(id)??0);
        if(!Number.isSafeInteger(available)||available<0)throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");
        if(available===0)continue;
        rank++;
        const recommended=Math.min(remaining,available);remaining-=recommended;
        used.set(id,(used.get(id)??0)+recommended);
        if(rank>(demand.page-1)*100&&rank<=demand.page*100)visible.push({inventoryBalanceId:id,binId:String(candidate.binId),binCode:candidate.binCode,lotId:candidate.lotId===null?null:String(candidate.lotId),expiryDate:candidate.expiryDate,firstReceiptDate:candidate.firstReceiptDate,fifoAnchorDate:candidate.fifoAnchorDate,freeQuantity:String(candidate.freeQuantity),batchAvailableQuantity:String(available),expectedBalanceVersion:candidate.version,selectionStrategy:candidate.expiryDate?"FEFO":"FIFO",rank,eligible:true,recommendedQuantity:String(recommended)});
      }
      exhausted=rows.length<100;offset+=rows.length;
      if(!Number.isSafeInteger(offset))throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");
    }
    result.push({fulfillmentLineId:demand.fulfillmentLineId,claimId:demand.claimId,inventoryReservationId:demand.inventoryReservationId,skuId:demand.skuId,expectedReservationVersion:Number(reservation.version),requestedQuantity:demand.requestedQuantity,minimumRemainingDays,baseUom:profile.baseUom,page:demand.page,hasMore:rank>demand.page*100,candidates:visible,summary:{requestedBaseQuantity:demand.requestedQuantity,recommendedBaseQuantity:String(Number(demand.requestedQuantity)-remaining),quantityComplete:remaining===0,insufficientStock:remaining>0}});
  }
  return {warehouseId,asOf:time.nowMs(),demands:result};
}
