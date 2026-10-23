import assert from "node:assert/strict";
import test from "node:test";
import {SalesFulfillmentGuardService} from "../../src/modules/sales/SalesFulfillmentGuardService.js";
const reason="FULFILLMENT_HISTORY_BLOCKS_WITHDRAWAL";
const guard=(result,action="WITHDRAW")=>new SalesFulfillmentGuardService({services:{names:()=>["fulfillmentOpenMatter"],resolve:async()=>({assertSalesLifecycleAllowedInTransaction:async()=>result})}}).assertAllowed({}, {action});
test("HD014 bounded dependency reason rejects malformed, unknown and wrong-purpose replies",async()=>{
 for(const reasonCodes of [undefined,null,reason,[reason,"UNKNOWN"],["UNKNOWN"],Array(1)])await assert.rejects(guard({status:"CLOSED",reasonCodes}),{code:"SALES_DEPENDENCY_UNAVAILABLE"});
 for(const action of ["CANCEL","CLOSE_REMAINING"])await assert.rejects(guard({status:"CLOSED",reasonCodes:[reason]},action),{code:"SALES_DEPENDENCY_UNAVAILABLE"});
 await assert.rejects(guard({status:"UNKNOWN",reasonCodes:[reason]}),{code:"SALES_DEPENDENCY_UNAVAILABLE"});
 for(const status of ["OPEN","CLOSED"])await assert.rejects(guard({status,reasonCodes:[reason]}),{code:reason});
 assert.equal(await guard({status:"CLOSED",reasonCodes:[]}),"ALLOWED");assert.equal(await guard(undefined),"ALLOWED");
});
test("HD014 a thrown history code from a dependency cannot impersonate the guard's validated business decision",async()=>{
 for(const action of ["WITHDRAW","CANCEL","CLOSE_REMAINING"])await assert.rejects(new SalesFulfillmentGuardService({services:{names:()=>["fulfillmentOpenMatter"],resolve:async()=>({assertSalesLifecycleAllowedInTransaction(){throw Object.assign(new Error("synthetic incompatible dependency"),{code:reason});}})}}).assertAllowed({}, {action}),{code:"SALES_DEPENDENCY_UNAVAILABLE"});
});
