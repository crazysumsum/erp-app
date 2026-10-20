import { randomUUID } from "node:crypto";
import { createTestCurrency } from "../phase1/fixtures.js";

// Only called on a fixture-owned database; its enclosing fixture drops that entire private namespace.
export async function seedFulfillmentSalesOrder(db) {
  const label="fa_"+randomUUID().slice(0,12),now=1700000000000;
  const insert=async(table,row)=>Number((await db.query(`INSERT INTO ${table} SET ?`,row))[0].insertId);
  const currency=await createTestCurrency(db,[],now);
  const customerId=await insert("customers",{customer_code:label,customer_code_key:label,legal_name:label,legal_name_key:label,default_currency_code:currency,status:"active",created_at:now,updated_at:now});
  const warehouseId=await insert("inventory_warehouses",{warehouse_code:label,normalized_code:label,warehouse_name:label,status:"ACTIVE",created_at:now,updated_at:now});
  const uomId=await insert("item_uoms",{code:label,name:"Each",status:"active",created_at:now,updated_at:now});
  const itemId=await insert("items",{name:label,status:"active",created_at:now,updated_at:now});
  const skuId=await insert("item_skus",{item_id:itemId,sku_code:label,sku_name:label,status:"active",created_at:now,updated_at:now});
  const skuUomId=await insert("item_sku_uoms",{sku_id:skuId,uom_id:uomId,to_base_factor:1,is_base:1,is_default_sale:1,created_at:now,updated_at:now});
  const addressId=await insert("customer_addresses",{customer_id:customerId,label:"Synthetic",address_line1:"Synthetic only",created_at:now,updated_at:now});
  const orderId=await insert("sales_orders",{sales_order_number:label,status:"CANCELLED",source_type:"MANUAL",customer_id:customerId,customer_code_snapshot:label,customer_name_snapshot:label,currency_code:currency,fulfillment_warehouse_id:warehouseId,warehouse_code_snapshot:label,warehouse_name_snapshot:label,order_date:"2023-11-14",line_count:1,total_amount:"1.0000",created_at:now,updated_at:now,last_business_updated_at:now});
  const lineId=await insert("sales_order_lines",{sales_order_id:orderId,line_no:1,sku_id:skuId,sku_uom_id:skuUomId,item_name_snapshot:label,sku_code_snapshot:label,sku_name_snapshot:label,uom_code_snapshot:"EA",uom_name_snapshot:"Each",to_base_factor_snapshot:1,tracking_policy_snapshot:"none",ordered_quantity:"1.000000",ordered_base_quantity:1,unit_selling_price:"1.0000",price_source:"MANUAL",line_amount:"1.0000",cancelled_base_quantity:1,created_at:now,updated_at:now});
  return {orderId,lineId,customerId,warehouseId,uomId,skuId,skuUomId,addressId,now,insert};
}
