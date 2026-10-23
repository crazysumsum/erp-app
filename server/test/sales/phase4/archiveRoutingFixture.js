import {randomUUID} from "node:crypto";
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
