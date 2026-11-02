import assert from "node:assert/strict";
import test from "node:test";
import {advanceSalesOperationalSignal,salesBackorderHistory} from "../../../src/modules/sales/salesOperationalObservations.js";
const identity="a".repeat(64),observation=(atMs,status="POSITIVE",identityHash=identity)=>({atMs,status,identityHash});
test("OBS-F02 three qualified five-minute samples spanning10minutes activate a sampled-continuity warning",()=>{
 let state=advanceSalesOperationalSignal(null,observation(1000000));assert.equal(state.active,false);assert.equal(state.samples,1);
 state=advanceSalesOperationalSignal(state,observation(1300000));assert.equal(state.active,false);state=advanceSalesOperationalSignal(state,observation(1600000));assert.equal(state.active,true);assert.equal(state.samples,3);assert.equal(state.sampledSpanMs,600000);
});
test("OBS-F02 repeated collection/retry inside one cadence cannot manufacture three samples",()=>{
 let state=null;for(let time=1000000;time<=1600000;time+=10000)state=advanceSalesOperationalSignal(state,observation(time));assert.ok(state.samples<=3);assert.equal(state.active,false,"Early extra samples do not prove three5minute-separated qualified observations spanning10m");
});
test("OBS-F02 changed oldest demand, no stock, unknown, backwards clock and sampling gap reset persistence",()=>{
 let active=null;for(const at of [1000000,1300000,1600000])active=advanceSalesOperationalSignal(active,observation(at));
 for(const next of [observation(1900000,"POSITIVE","b".repeat(64)),observation(1900000,"CLEAR"),observation(1900000,"UNKNOWN"),observation(1599999),observation(1930001)]){const result=advanceSalesOperationalSignal(active,next);assert.equal(result.active,false);assert.ok(result.samples<=1);}
});
test("OBS-P01 elapsed time alone and invalid metadata never manufacture provider persistence",()=>{
 const first=advanceSalesOperationalSignal(null,observation(1000000));assert.equal(advanceSalesOperationalSignal(first,observation(1600000)).active,false);
 for(const value of [{...observation(-1)},{...observation(1),status:"CLOSED"},{...observation(1),identityHash:"private-order"}])assert.throws(()=>advanceSalesOperationalSignal(null,value),TypeError);
});
const history=(changes={})=>({nowMs:200000000,activation:{epoch:"epoch",version:"1",atMs:100000000,baselineHash:"a".repeat(64)},protocolVersion:"1",baselineHash:"a".repeat(64),pending:0,lastSuccessAt:null,...changes});
test("OBS-H02 inactive, incomplete, mismatched and pending histories remain UNKNOWN",()=>{
 for(const input of [history({activation:null}),history({activation:{epoch:"epoch",version:"old",atMs:1}}),history({activation:{epoch:"epoch",version:"1",atMs:199000000}}),history({pending:1}),history({activation:{epoch:"epoch",version:"1",atMs:200000001}})])assert.equal(salesBackorderHistory(input).historyComplete,false);
});
test("OBS-H02 only complete activated24h window can establish no observed successful worker",()=>{
 const old=salesBackorderHistory(history());assert.equal(old.historyComplete,true);assert.equal(old.noSuccessOver24h,true);
 const exact=salesBackorderHistory(history({activation:{epoch:"epoch",version:"1",baselineHash:"a".repeat(64),atMs:200000000-86400000}}));assert.equal(exact.historyComplete,true);assert.equal(exact.noSuccessOver24h,false,"Original strictly-more-than24h boundary retained");
 const recent=salesBackorderHistory(history({lastSuccessAt:199000000}));assert.equal(recent.noSuccessOver24h,false);assert.equal(recent.lastSuccessAgeMs,1000000);
});
test("OBS-F01 malformed or contradictory owner ATP metadata cannot become a positive FIFO observation",async()=>{
 const {validSalesAvailabilityObservation}=await import("../../../src/modules/sales/salesOperationalObservations.js"),head={warehouse_id:1,sku_id:2,sales_order_line_id:3,minimum_sale_life_days_snapshot:0},good={warehouseId:1,skuId:2,sourceLineId:3,status:"AVAILABLE",observedAtMs:1000,effectiveMinimumSaleLifeDays:0,eligibleOnHandBaseQuantity:"5",reservedBaseQuantity:"2",availableToPromiseBaseQuantity:"3",reasonCodes:[]};
 assert.equal(validSalesAvailabilityObservation(good,head,1000),true);
 for(const change of [{availableToPromiseBaseQuantity:"0"},{availableToPromiseBaseQuantity:"4"},{reservedBaseQuantity:"-1"},{observedAtMs:999},{sourceLineId:4},{effectiveMinimumSaleLifeDays:-1},{status:"UNKNOWN"},{reasonCodes:["private payload"]},{extra:1}])assert.equal(validSalesAvailabilityObservation({...good,...change},head,1000),false);
});

test("OBS-H02 same protocol but a different actual artifact cannot reuse an activated history epoch",()=>{
 const input=history({baselineHash:"b".repeat(64)}),result=salesBackorderHistory(input);assert.equal(result.historyComplete,false);assert.equal(result.noSuccessOver24h,false);
});
