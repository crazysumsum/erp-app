import { describe,it,expect } from "vitest";
import { fulfillmentFailure } from "@/services/fulfillment.js";
describe("TASK020 safe Fulfillment errors",()=>{
 it("keeps conflicts editable and supplies correction or explicit reload",()=>{
  for(const code of ["VERSION_CONFLICT","ALLOCATION_CANDIDATE_CHANGED","RESERVATION_CLAIM_CONFLICT","FULFILLABLE_QUANTITY_CHANGED"]){const result=fulfillmentFailure({status:409,code,message:"SELECT secret"});expect(result.action).toBe("reload");expect(result.preserveInput).toBe(true);expect(result.message).not.toContain("secret");}
  for(const code of ["SHORT_PICK_REASON_REQUIRED","PICK_SEQUENCE_REASON_REQUIRED","FEFO_OVERRIDE_REQUIRED","PICK_RESULT_INVALID"]){expect(fulfillmentFailure({status:409,code}).action).toBe("correct");}
 });
 it("uses fixed safe403/404 and unknown messages without reflecting SQL/address/stack",()=>{
  for(const status of [403,404]){const a=fulfillmentFailure({status,code:"untrusted",message:"SELECT address stack"}),b=fulfillmentFailure({status,code:status===403?"FEFO_OVERRIDE_DENIED":"FULFILLMENT_NOT_FOUND"});expect(a.message).toBe(b.message);expect(a.action).toBe("none");}
  expect(fulfillmentFailure({message:"SELECT address stack"}).message).not.toContain("SELECT");
  for(const code of ["toString","constructor","__proto__"])expect(typeof fulfillmentFailure({code}).message).toBe("string");
 });
 it("keeps unknown commit/network/timeout recovery on original event and input",()=>{
  for(const code of ["DATABASE_TRANSACTION_INDETERMINATE","FULFILLMENT_DEPENDENCY_UNAVAILABLE","TIMEOUT","NETWORK_ERROR","CONCURRENT_OPERATION"]){const result=fulfillmentFailure({code,status:503});expect(result.action).toBe("recover");expect(result.preserveInput).toBe(true);expect(result.message).toContain("原操作");}
 });
});
