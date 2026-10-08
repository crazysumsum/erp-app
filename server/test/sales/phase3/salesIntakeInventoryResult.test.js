import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {inventoryOperationHash} from "../../../src/modules/inventory/InventoryOperationService.js";
import {validateConfirmationInventoryResult,SalesOrderConfirmationService} from "../../../src/modules/sales/SalesOrderConfirmationService.js";
test("TC-038 Intake shared confirmation checks its distinct Inventory root/child hashes and rejects mixed worker membership",()=>{
 const payload={warehouseId:1,expectedOrderVersion:1,lines:[{sourceLineId:2,skuId:3,orderedBaseQuantity:5,minimumRemainingDays:0}]},rootRequestHash=inventoryOperationHash({commandType:"SALES_INTAKE_BATCH_RESERVE",payload}),line={rootOperationId:4,rootRequestHash,...payload.lines[0],reservedBaseQuantity:3,uncoveredBaseQuantity:2,reservationId:5,version:1},childHash=inventoryOperationHash({commandType:"SALES_INTAKE_LINE_RESERVE",payload:{rootOperationId:4,rootRequestHash,...payload.lines[0]}}),result={operationId:4,lineCount:1,lines:[line],membershipDigest:createHash("sha256").update(`2:${childHash}\n`).digest("hex")};
 assert.doesNotThrow(()=>validateConfirmationInventoryResult(result,payload,"intake"));assert.throws(()=>validateConfirmationInventoryResult(result,payload),{code:"INVENTORY_CONTRACT_MISMATCH"});assert.throws(()=>validateConfirmationInventoryResult({...result,membershipDigest:"0".repeat(64)},payload,"intake"),{code:"INVENTORY_CONTRACT_MISMATCH"});assert.equal(typeof SalesOrderConfirmationService.prototype.confirmIntakeDraftInTransaction,"function");
});
