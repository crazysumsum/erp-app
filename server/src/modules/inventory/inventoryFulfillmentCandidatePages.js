import {loadInventoryCandidates,hasPreStocktakeCandidateProof} from "./InventoryPickSequenceService.js";
import {inventoryError} from "./inventoryErrors.js";

// Only call after the complete posting locks and all releases; later writes only consume these balances.
export function postingCandidatePages(balances,load=loadInventoryCandidates,canReuse=hasPreStocktakeCandidateProof) {
  const cache=new Map();let cachedRows=0,executor=null;
  const current=row=>{
    const balance=balances.get(String(row.id));
    if(!balance)return row;
    const freeQuantity=Number(balance.on_hand_quantity)-Number(balance.allocated_quantity),version=Number(balance.version);
    if(!Number.isSafeInteger(freeQuantity)||freeQuantity<0||!Number.isSafeInteger(version)||version<1)throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");
    return {...row,freeQuantity,version};
  };
  return async(tx,query)=>{
    if(executor===null)executor=tx;
    if(tx!==executor)return load(tx,query);
    const key=JSON.stringify([query.warehouseId,query.skuId,query.currentDate,query.minimumRemainingDays,query.trackingPolicy]);
    if(!canReuse(tx)){
      cache.clear();cachedRows=0;
      const rows=await load(tx,query);
      if(canReuse(tx)&&query.offset===0&&query.limit===100&&rows.length){
        const ids=new Set(rows.map(row=>String(row.id)));
        if(ids.size!==rows.length)throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");
        cache.set(key,{rows,ids,complete:rows.length<100});cachedRows=rows.length;
      }
      return rows;
    }
    const entry=cache.get(key)??{rows:[],ids:new Set(),complete:false};
    while(true){
      const active=entry.rows.map(current).filter(row=>row.freeQuantity>0);
      if(entry.complete||active.length>=query.offset+query.limit)return active.slice(query.offset,query.offset+query.limit);
      const rows=await load(tx,{...query,limit:100,offset:active.length});
      // Stocktake writers are not yet implemented: keep every fresh read when its tables exist.
      if(!canReuse(tx))return active.length===query.offset&&query.limit===100?rows:load(tx,query);
      if(cachedRows+rows.length>5000){cache.clear();cachedRows=0;return load(tx,query);}
      for(const row of rows){
        const id=String(row.id);
        if(entry.ids.has(id))throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");
        entry.ids.add(id);entry.rows.push(row);
      }
      cachedRows+=rows.length;entry.complete=rows.length<100;
      if(entry.rows.length)cache.set(key,entry);
    }
  };
}
