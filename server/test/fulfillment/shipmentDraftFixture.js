import { randomUUID } from "node:crypto";
import { cancellationFixture } from "./p1CancellationFixture.js";
import { ShipmentService } from "../../src/modules/fulfillment/ShipmentService.js";
export async function shipmentDraftFixture(t){
 const f=await cancellationFixture(t),service=new ShipmentService(f.options);
 await f.s.insert("customer_address_purposes",{address_id:f.s.addressId,customer_id:f.s.customerId,purpose_code:"shipping",is_default:1,created_at:f.s.now,updated_at:f.s.now});
 const body=()=>({eventId:randomUUID(),shippingAddressId:f.s.addressId,shippingAddressVersion:1,totalWeight:"1.250000",weightUom:"KG"});
 return {...f,service,body,create:input=>f.execute(()=>service.createDraft(String(f.created.outcome.id),input)),update:(id,input)=>f.execute(()=>service.updateDraft(id,input)),cancelDraft:(id,input)=>f.execute(()=>service.cancelDraft(id,input))};
}
export async function shipmentDraftFacts(f){const output={};for(const table of ["shipments","shipment_lines","shipment_status_history","fulfillment_operation_requests","fulfillment_audit_logs","fulfillments"])output[table]=(await f.db.query(`SELECT * FROM ${table} ORDER BY id`))[0];return output;}
