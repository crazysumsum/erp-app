import {randomUUID} from "node:crypto";
import {salesSourceHash} from "../../../src/modules/sales/salesImportPrecheck.js";
import {salesPayloadHash} from "../../../src/modules/sales/salesCanonicalHash.js";

// Synthetic retained Quotation/conversion projection; Inventory/Fulfillment history remains the native fixture's actual history.
export async function seedConvertedQuotation(f){
 const [[order]]=await f.db.query("SELECT * FROM sales_orders WHERE id=?",[f.s.orderId]);
 const fields=["customer_id","customer_code_snapshot","customer_name_snapshot","currency_code","payment_term_id","payment_term_code_snapshot","payment_term_name_snapshot","notes","line_count","total_amount","created_at","updated_at","last_business_updated_at","created_by","updated_by"];
 const id=await f.s.insert("sales_quotations",{...Object.fromEntries(fields.map(k=>[k,order[k]])),quotation_number:"QT-202311-000001",status:"CONVERTED",quotation_date:"2023-11-14",valid_until:"2023-11-30",version:2});
 const [lines]=await f.db.query("SELECT * FROM sales_order_lines WHERE sales_order_id=? ORDER BY line_no",[f.s.orderId]);
 const lineFields=["line_no","sku_id","sku_uom_id","item_name_snapshot","sku_code_snapshot","sku_name_snapshot","uom_code_snapshot","uom_name_snapshot","to_base_factor_snapshot","unit_selling_price","price_source","line_amount","line_note","created_at","updated_at"];
 for(const line of lines)await f.s.insert("sales_quotation_lines",{...Object.fromEntries(lineFields.map(k=>[k,line[k]])),quotation_id:id,quantity:line.ordered_quantity,base_quantity:line.ordered_base_quantity});
 const difference={added:[],removed:[],quantityChanged:[],priceChanged:[]};
 await f.s.insert("sales_quotation_conversions",{quotation_id:id,sales_order_id:f.s.orderId,sales_order_number_snapshot:order.sales_order_number,difference_summary:JSON.stringify(difference),difference_hash:salesPayloadHash(difference),event_id:randomUUID(),converted_at:order.created_at,converted_by:f.userId});
 await f.db.execute("UPDATE sales_orders SET source_type='QUOTATION',source_quotation_id=? WHERE id=?",[id,f.s.orderId]);
 return {id,input:{eventId:randomUUID(),version:2,order:{customerId:Number(order.customer_id),currencyCode:order.currency_code,fulfillmentWarehouseId:Number(order.fulfillment_warehouse_id),orderDate:"2023-11-14",lines:lines.map(line=>({skuId:Number(line.sku_id),skuUomId:Number(line.sku_uom_id),quantity:String(line.ordered_quantity),unitSellingPrice:String(line.unit_selling_price)}))}}};
}

// Synthetic completed CSV/source projection for read routing; no upload/worker execution is claimed.
export async function seedRetainedCsvOrder(f){
 const [[original]]=await f.db.query("SELECT * FROM sales_orders WHERE id=?",[f.s.orderId]),header=Object.fromEntries(Object.entries(original).filter(([key])=>key!=="id"));
 const orderId=await f.s.insert("sales_orders",{...header,sales_order_number:"SO-202311-999998",source_type:"CSV",source_quotation_id:null,source_intake_order_id:null,external_order_key_id:null,channel_code_snapshot:"ARCHIVE_CSV",external_order_id_snapshot:"Synthetic-CSV-Archive",confirmation_event_id:null});
 const [lines]=await f.db.query("SELECT * FROM sales_order_lines WHERE sales_order_id=? ORDER BY line_no",[f.s.orderId]);
 for(const originalLine of lines){const line=Object.fromEntries(Object.entries(originalLine).filter(([key])=>key!=="id"));await f.s.insert("sales_order_lines",{...line,sales_order_id:orderId,reserved_outstanding_base_quantity:0,backordered_base_quantity:0,fulfilled_base_quantity:0,cancelled_base_quantity:line.ordered_base_quantity});}
 const now=Date.now(),jobId=await f.s.insert("sales_import_jobs",{batch_number:"SI-202311-999998",template_version:"1.0",original_file_name:"synthetic-retained.csv",file_sha256:Buffer.alloc(32,1),file_size_bytes:1,status:"COMPLETED",total_row_count:1,source_order_count:1,valid_count:1,success_count:1,created_by:f.userId,created_at:now,updated_at:now,completed_at:now,files_purged_at:now});
 const external="Synthetic-CSV-Archive",hash=salesSourceHash(external),payload="b".repeat(64),keyId=await f.s.insert("sales_external_order_keys",{channel_code:"ARCHIVE_CSV",external_order_id:external,external_order_id_hash:hash,source_type:"CSV",payload_hash:payload,status:"SUCCEEDED",sales_order_id:orderId,sales_order_number:"SO-202311-999998",claimed_at:now,updated_at:now});
 const intakeId=await f.s.insert("sales_intake_orders",{import_job_id:jobId,source_type:"CSV",source_order_key:external,source_order_key_hash:hash,channel_code:"ARCHIVE_CSV",external_order_id:external,external_order_id_hash:hash,schema_version:"1.0",payload_hash:payload,first_row_no:1,last_row_no:1,line_count:lines.length,status:"SUCCEEDED",processing_event_id:randomUUID(),external_order_key_id:keyId,sales_order_id:orderId,sales_order_number:"SO-202311-999998",created_at:now,updated_at:now,completed_at:now});
 await f.db.execute("UPDATE sales_orders SET source_intake_order_id=?,external_order_key_id=? WHERE id=?",[intakeId,keyId,orderId]);
 return {orderId,jobId,intakeId,number:"SO-202311-999998",external};
}
