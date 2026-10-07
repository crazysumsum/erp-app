import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { validateConfirmationInventoryResult } from "../../../src/modules/sales/SalesOrderConfirmationService.js";
import { inventoryOperationHash } from "../../../src/modules/inventory/InventoryOperationService.js";
function fixture() {
  const payload = { warehouseId: 1, expectedOrderVersion: 2, lines: [{ sourceLineId: 3,skuId: 4,orderedBaseQuantity: 10,minimumRemainingDays: 0 }] };
  const hash = inventoryOperationHash({ commandType: "SALES_BATCH_RESERVE", payload });
  const line = { rootOperationId: 5,rootRequestHash: hash,...payload.lines[0],reservedBaseQuantity: 4,uncoveredBaseQuantity: 6,reservationId: 6,version: 1 };
  const digest = createHash("sha256").update(`3:${inventoryOperationHash({ commandType: "SALES_LINE_RESERVE",payload: { rootOperationId: 5,rootRequestHash: hash,...payload.lines[0] } })}\n`).digest("hex");
  return { payload,result: { operationId: 5,lineCount: 1,membershipDigest: digest,lines: [line] } };
}
test("TC-021 exact Inventory result preserves partial and zero reservation conservation", () => {
  const f = fixture(); assert.doesNotThrow(() => validateConfirmationInventoryResult(f.result,f.payload));
  Object.assign(f.result.lines[0], { reservedBaseQuantity: 0,uncoveredBaseQuantity: 10,reservationId: null,version: null });
  assert.doesNotThrow(() => validateConfirmationInventoryResult(f.result,f.payload));
});
test("TC-021 missing, extra, duplicate, wrong identity, unsafe quantity and invalid root membership fail closed", () => {
  const mutations = [r => r.lines.pop(),r => r.lines.push(r.lines[0]),r => r.lineCount=2,r => r.operationId=0,r => r.membershipDigest="0".repeat(64),
    ...["sourceLineId","skuId","orderedBaseQuantity","rootOperationId","minimumRemainingDays","version","reservationId"].map(k => r => r.lines[0][k]=-1),
    r => r.lines[0].rootRequestHash="0".repeat(64),r => r.lines[0].reservedBaseQuantity=11,r => r.lines[0].uncoveredBaseQuantity=NaN,
    r => r.lines[0].reservedBaseQuantity="4",r => r.lines[0].reservedBaseQuantity=Number.MAX_SAFE_INTEGER+1];
  for (const mutate of mutations) { const f=fixture(); mutate(f.result); assert.throws(() => validateConfirmationInventoryResult(f.result,f.payload), { code: "INVENTORY_CONTRACT_MISMATCH" }); }
});
