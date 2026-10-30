import {it,expect} from "vitest";
import {isDefinitiveCreateRejection} from "@/components/fulfillment/fulfillmentCreateRejection.js";
it("accepts only authoritative postclaim409 codes for either initial or uncertain Create",()=>{
 for(const wasUncertain of [false,true])for(const code of ["VERSION_CONFLICT","FULFILLABLE_QUANTITY_CHANGED","RESERVATION_CLAIM_CONFLICT"])expect(isDefinitiveCreateRejection({status:409,code},wasUncertain)).toBe(true);
});
it("preserves auth, visibility, concurrency, preclaim and unknown errors until outcome is proven",()=>{
 for(const wasUncertain of [false,true])for(const error of [{status:403,code:"VERSION_CONFLICT"},{status:404},{status:503},{status:409,code:"CONCURRENT_OPERATION"},{status:409,code:"IDEMPOTENCY_CONFLICT"},{status:400,code:"VERSION_CONFLICT"},{code:"NETWORK_ERROR"}])expect(isDefinitiveCreateRejection(error,wasUncertain)).toBe(false);
 for(const code of ["FULFILLMENT_INPUT_INVALID","FULFILLMENT_QUANTITY_INVALID"]){expect(isDefinitiveCreateRejection({status:400,code},false)).toBe(true);expect(isDefinitiveCreateRejection({status:400,code},true)).toBe(false);}
});
