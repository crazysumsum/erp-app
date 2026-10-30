import { salesFulfillmentFixture } from "../sales/phase4/salesFulfillmentFixtures.js";
import { up as operationUp } from "../../database/migrations/0092_create_fulfillment_operations_and_sequences.js";
import { up as documentsUp } from "../../database/migrations/0093_create_fulfillment_documents.js";
import { up as allocationsUp } from "../../database/migrations/0095_create_fulfillment_allocations.js";
async function fixture(t,baseQuantity=1){const f=await salesFulfillmentFixture(t,baseQuantity);await operationUp(f.db);await documentsUp(f.db);await allocationsUp(f.db);return f;}
async function document(f,number="FUL-202610-000001"){
  const id=await f.s.insert("fulfillments",{fulfillment_number:number,sales_order_id:f.s.orderId,sales_order_number_snapshot:"SO-SYNTHETIC",customer_id:f.s.customerId,customer_code_snapshot:"SYN",customer_name_snapshot:"Synthetic",warehouse_id:f.s.warehouseId,warehouse_code_snapshot:"SYN",warehouse_name_snapshot:"Synthetic",status:"DRAFT",line_count:1,last_business_updated_at:f.s.now,created_at:f.s.now,updated_at:f.s.now});
  const line=await f.s.insert("fulfillment_lines",{fulfillment_id:id,sales_order_id:f.s.orderId,sales_order_line_id:f.s.lineId,line_no:1,sales_order_line_no:1,sku_id:f.s.skuId,sku_code_snapshot:"SYN",sku_name_snapshot:"Synthetic",base_uom_id:f.s.uomId,base_uom_code_snapshot:"EA",base_uom_name_snapshot:"Each",tracking_policy_snapshot:"none",planned_base_quantity:1,created_at:f.s.now,updated_at:f.s.now});
  return {id,line};
}

export {fixture,document};
