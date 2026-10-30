import assert from "node:assert/strict";
import test from "node:test";
import {postingCandidatePages} from "../../src/modules/inventory/inventoryFulfillmentCandidatePages.js";
import {assessFulfillmentAllocationSelection} from "../../src/modules/inventory/inventoryFulfillmentAllocation.js";

const query={warehouseId:1,skuId:1,currentDate:"2026-10-29",minimumRemainingDays:0,trackingPolicy:"none",offset:0,limit:100};
function fixture(size,capacity=1){
 const balances=new Map(Array.from({length:size},(_,i)=>[String(i+1),{id:i+1,on_hand_quantity:capacity,allocated_quantity:0,version:1}]));let calls=0;
 const load=async(tx,args)=>{calls++;return [...balances.values()].filter(b=>b.on_hand_quantity>b.allocated_quantity).map(b=>({id:b.id,binId:b.id,lotId:null,freeQuantity:b.on_hand_quantity-b.allocated_quantity,version:b.version,expiryDate:null})).slice(args.offset,args.offset+args.limit);};
 return {tx:{},balances,load,get calls(){return calls;},consume(id,q=1){const b=balances.get(String(id));b.allocated_quantity+=q;b.version++;}};
}
test("posting candidate prefix follows real depletion and fresh OFFSET across pages",async()=>{
 const f=fixture(251),read=postingCandidatePages(f.balances,f.load,()=>true);
 for(let i=1;i<=251;i++){const rows=await read(f.tx,query);assert.equal(rows[0].id,i);assert.equal(rows[0].version,1);f.consume(i);}
 assert.deepEqual(await read(f.tx,query),[]);assert.equal(f.calls,3);
});
test("posting candidate policies share actual quantity/version, never double deduct fresh pages",async()=>{
 const f=fixture(205,3),read=postingCandidatePages(f.balances,f.load,()=>true);
 await read(f.tx,query);f.consume(1);let rows=await read(f.tx,{...query,minimumRemainingDays:1});assert.equal(rows[0].freeQuantity,2);assert.equal(rows[0].version,2);
 f.consume(1,2);rows=await read(f.tx,query);assert.equal(rows[0].id,2);assert.equal(rows.length,100);
 rows=await read(f.tx,{...query,offset:100});assert.equal(rows[0].id,102);assert.equal(rows.at(-1).id,201);assert.equal(rows[0].freeQuantity,3);
});
test("posting candidate reader preserves rank/manual choices under mutations like fresh SQL",async()=>{
 const f=fixture(221,3),read=postingCandidatePages(f.balances,f.load,()=>true),service={time:{fileDate:()=>query.currentDate}},profile={trackingPolicy:"none"};
 for(const [id,q,policy]of [[201,2,0],[1,3,0],[102,1,1],[201,1,1],[3,1,0],[221,1,0]]){
  const member={input:{baseQuantity:String(q)},reservation:{warehouse_id:1,sku_id:1,minimum_remaining_days:policy},legs:[{kind:"ALLOCATE",input:{inventoryBalanceId:String(id),baseQuantity:String(q)}}]};
  assert.deepEqual(await assessFulfillmentAllocationSelection({},service,member,profile,read),await assessFulfillmentAllocationSelection({},service,member,profile,f.load));f.consume(id,q);
 }
});
test("posting candidate bounded cache fallback preserves all rows for oversized prefixes",async()=>{
 const f=fixture(5101),read=postingCandidatePages(f.balances,f.load,()=>true);
 for(const offset of [0,4900,5000,5100,0])assert.deepEqual(await read(f.tx,{...query,offset}),await f.load({},{...query,offset}));
});
test("posting candidate query identity separates date, policy, warehouse and SKU",async()=>{
 const f=fixture(2),read=postingCandidatePages(f.balances,f.load,()=>true);
 for(const q of [query,{...query,currentDate:"2026-10-30"},{...query,trackingPolicy:"batch"},{...query,warehouseId:2},{...query,skuId:2},{...query,minimumRemainingDays:1}]){await read(f.tx,q);await read(f.tx,q);}assert.equal(f.calls,6);
});
test("posting candidate unknown rows retain original facts; SQL errors propagate unchanged",async()=>{
 const f=fixture(2),read=postingCandidatePages(new Map(),f.load,()=>true);assert.deepEqual(await read(f.tx,query),await f.load({},query));
 const error=new Error("original schema failure");await assert.rejects(postingCandidatePages(new Map(),async()=>{throw error;})({},query),e=>e===error);
});
test("posting candidate pages match fresh reads across deterministic mixed policies and offsets",async()=>{
 const f=fixture(413,7),read=postingCandidatePages(f.balances,f.load,()=>true);let seed=19;
 for(let step=0;step<180;step++){
  seed=(seed*48271)%2147483647;const id=seed%413+1,b=f.balances.get(String(id));if(b.allocated_quantity<7)f.consume(id);
  const args={...query,minimumRemainingDays:step%3,offset:step%5*100};assert.deepEqual(await read(f.tx,args),await f.load({},args));
 }
});
test("posting cache is local to one posting and loads the post-release physical baseline",async()=>{
 const f=fixture(2,4);f.consume(1,4);const read=postingCandidatePages(f.balances,f.load,()=>true);assert.equal((await read(f.tx,query))[0].id,2);
 const b=f.balances.get("1");b.allocated_quantity=0;b.version++;
 const next=postingCandidatePages(f.balances,f.load,()=>true);assert.equal((await next(f.tx,query))[0].freeQuantity,4);assert.equal((await next(f.tx,query))[0].version,3);
});
test("posting keeps fresh reads when absent-Stocktake proof is unavailable",async()=>{
 const f=fixture(205),read=postingCandidatePages(f.balances,f.load,()=>false);
 for(const offset of [0,100,0])assert.deepEqual(await read(f.tx,{...query,offset}),await f.load({},{...query,offset}));
});
test("posting batch/expiry ties preserve original ordering and current ranks across page boundaries",async()=>{
 const {rankInventoryCandidates}=await import("../../src/modules/inventory/InventoryPickSequenceService.js");
 for(const trackingPolicy of ["batch","batch_expiry"]){
  const f=fixture(205,2);const load=async(tx,args)=>{
   const all=[...f.balances.values()].filter(b=>b.on_hand_quantity>b.allocated_quantity).map(b=>({id:b.id,binId:b.id,lotId:b.id,version:b.version,freeQuantity:2-b.allocated_quantity,expiryDate:trackingPolicy==="batch_expiry"?"2027-01-01":null,firstReceiptDate:"2026-01-01",lotKey:`L${String(b.id%9).padStart(2,"0")}`,binCode:`B${b.id}`,fifoAnchorDate:null}));
   return rankInventoryCandidates(all).slice(args.offset,args.offset+args.limit);
  },read=postingCandidatePages(f.balances,load,()=>true),args={...query,trackingPolicy};
  for(let step=0;step<110;step++){const expected=await load({},args);assert.deepEqual(await read(f.tx,args),expected);assert.deepEqual(await read(f.tx,{...args,offset:100}),await load({},{...args,offset:100}));f.consume(expected[0].id,2);}
 }
});
test("posting cannot seed prefix from a fresh nonzero-offset proof",async()=>{
 const f=fixture(205);let proven=false;
 const load=async(tx,args)=>{const rows=await f.load(tx,args);proven=true;return rows;},read=postingCandidatePages(f.balances,load,()=>proven);
 assert.deepEqual(await read(f.tx,{...query,offset:100}),await f.load({},{...query,offset:100}));assert.equal((await read(f.tx,query))[0].id,1);
});
test("posting proof loss never serves a cached page or swallows the original reader error",async()=>{
 const f=fixture(205);let proven=true,reads=0,fail=false;const error=new Error("closed executor"),load=async(tx,args)=>{reads++;if(fail)throw error;return f.load(tx,args);},read=postingCandidatePages(f.balances,load,()=>proven);
 await read(f.tx,query);proven=false;const before=reads;
 for(const offset of [0,100])await read(f.tx,{...query,offset});assert.equal(reads,before+2);
 proven=true;await read(f.tx,query);proven=false;fail=true;await assert.rejects(read(f.tx,query),e=>e===error);
});
test("posting never reuses a prefix on a different executor",async()=>{
 const f=fixture(2),read=postingCandidatePages(f.balances,f.load,()=>true);await read(f.tx,query);await read({},query);assert.equal(f.calls,2);
});
