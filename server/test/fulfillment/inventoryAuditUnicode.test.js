import assert from "node:assert/strict";
import test from "node:test";
import { InventoryAuditService } from "../../src/modules/inventory/InventoryAuditService.js";

test("Inventory audit preserves the approved500-character reason independently of UTF8 byte length",async()=>{
  const audit=new InventoryAuditService({database:{withTransaction(){}},time:{nowMs:()=>1},logger:{error(){}}});
  const input={actorUserId:1,actorLabel:"Synthetic",action:"allocation.create",targetType:"allocation",targetId:1,targetLabel:"1",operationRequestId:1};
  const reasons=[];const tx={async execute(sql,args){reasons.push(args[9]);}};
  for(const count of [5,500])await audit.recordSucceeded(tx,{...input,reasonText:"原".repeat(count)});
  assert.deepEqual(reasons,["原".repeat(5),"原".repeat(500)]);
  await assert.rejects(audit.recordSucceeded(tx,{...input,reasonText:"原".repeat(501)}));
  await assert.rejects(audit.recordSucceeded(tx,{...input,actorLabel:"原".repeat(190)}),"actor labels keep their existing byte limit");
});
