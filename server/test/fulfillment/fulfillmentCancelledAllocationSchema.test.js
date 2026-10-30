import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { FULFILLMENT_ALLOCATION_TABLE as legacy } from "../../database/migrations/0095_create_fulfillment_allocations.js";
import { cancelledAllocationSchema,recognizeCancelledAllocationSchema } from "../../src/modules/fulfillment/fulfillmentCancelledAllocationSchema.js";
import { normalizeFulfillmentSchemaSql as normalize } from "../../src/modules/fulfillment/fulfillmentMigrationSchema.js";
test("HD019 pure revision preserves0095 spec and recognizes only the complete exact known forward schema",()=>{
 const before=structuredClone(legacy),next=cancelledAllocationSchema(legacy),checks=Object.entries(next.checks).map(([name,clause])=>({name,clause,enforced:"YES"})),triggers=Object.entries(next.triggers).map(([name,[event,statement,ordinal]])=>({name,event,statement,timing:"BEFORE",ordinal}));assert.deepEqual(legacy,before);assert.equal(recognizeCancelledAllocationSchema(legacy,checks,triggers.map(row=>({...row,ordinal:3})),normalize),null);assert.ok(recognizeCancelledAllocationSchema(legacy,checks,triggers,normalize));assert.equal(recognizeCancelledAllocationSchema(legacy,checks,triggers.slice(1),normalize),null);assert.equal(recognizeCancelledAllocationSchema(legacy,checks.map(row=>({...row,enforced:"NO"})),triggers,normalize),null);assert.equal(recognizeCancelledAllocationSchema(legacy,checks,triggers.map(row=>({...row,statement:row.statement.replace("NOWAIT","")})),normalize),null);
});
test("HD019 fresh process0095-first and helper-first imports cannot hide an ESM initialization cycle",()=>{
 const paths=["./database/migrations/0095_create_fulfillment_allocations.js","./src/modules/fulfillment/fulfillmentCancelledAllocationSchema.js"];for(const order of [paths,[...paths].reverse()]){const result=spawnSync(process.execPath,["--input-type=module","--eval",order.map(path=>`await import(${JSON.stringify(path)});`).join("\n")],{cwd:new URL("../../",import.meta.url),encoding:"utf8"});assert.equal(result.status,0,result.stderr);}
});
