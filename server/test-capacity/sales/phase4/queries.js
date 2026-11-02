import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {quantiles} from "./http.js";

export async function datasetShape(c){
 const [[shape]]=await c.db.query("SELECT COUNT(*) AS headers,SUM(line_count) AS line_total,SUM(status='CANCELLED' AND last_business_updated_at<?) AS eligible FROM sales_orders",[Date.parse("2024-10-01T00:00:00+08:00")]);
 assert.equal(Number(shape.headers),1000000);assert.equal(Number(shape.line_total),5000000);assert.equal(Number(shape.eligible),300000);
 const [[lines]]=await c.db.query("SELECT COUNT(*) AS n FROM sales_order_lines"),[histogram]=await c.db.query("SELECT line_count,COUNT(*) AS n FROM sales_orders GROUP BY line_count ORDER BY line_count");
 assert.equal(Number(lines.n),5000000);assert.deepEqual(histogram.map(r=>[Number(r.line_count),Number(r.n)]),[[1,245000],[5,695000],[20,59000],[100,1000]]);
 const [sources]=await c.db.query("SELECT source_type,status,has_backorder,COUNT(*) AS n FROM sales_orders GROUP BY source_type,status,has_backorder ORDER BY source_type,status,has_backorder");
 assert.equal(new Set(sources.map(r=>r.source_type)).size,4);assert.ok(sources.some(r=>Number(r.has_backorder)===1&&Number(r.n)>0));
 await c.reserve();await c.assertLogged();await c.save("full-source-shape.json",{shape,lines,histogram,sources,initializationReceipt:"source-capacity-r1/complete-1000000.json",smallBusinessRouting:"independent native cases remain required",indexScale:"separate25m schema is not this application's routing graph"});
}
const sortColumns={number:"sales_order_number",customerCode:"customer_code_snapshot",customerName:"customer_name_snapshot",orderDate:"order_date",updatedAt:"updated_at",status:"status",sourceType:"source_type",totalAmount:"total_amount"};
export async function activeMatrix(c){
 const [numbers]=await c.db.query("(SELECT id,sales_order_number FROM sales_orders ORDER BY id LIMIT 1) UNION ALL (SELECT id,sales_order_number FROM sales_orders WHERE id>=500000 ORDER BY id LIMIT 1) UNION ALL (SELECT id,sales_order_number FROM sales_orders ORDER BY id DESC LIMIT 1)");
 assert.equal(numbers.length,3);const [[external]]=await c.db.query("SELECT external_order_id,channel_code FROM sales_external_order_keys WHERE status='SUCCEEDED' AND is_order_archived=0 ORDER BY id LIMIT 1");assert.ok(external);
 const customer=c.binding.customers[7],warehouse=c.binding.warehouses[4].id,actor=c.actors[4];
 return [
  {name:"number-exact",input:{number:numbers[1].sales_order_number},predicate:"sales_order_number=?",values:[numbers[1].sales_order_number],sortBy:"number"},
  {name:"customer",input:{customerId:customer},predicate:"customer_id=?",values:[customer],sortBy:"customerCode"},
  {name:"warehouse",input:{warehouseId:warehouse},predicate:"fulfillment_warehouse_id=?",values:[warehouse],sortBy:"customerName"},
  {name:"date",input:{orderDateFrom:c.binding.currentDate,orderDateTo:c.binding.currentDate},predicate:"order_date BETWEEN ? AND ?",values:[c.binding.currentDate,c.binding.currentDate],sortBy:"orderDate"},
  {name:"status",input:{status:"CONFIRMED"},predicate:"status='CONFIRMED'",values:[],sortBy:"status"},
  {name:"source",input:{sourceType:"CSV"},predicate:"source_type='CSV'",values:[],sortBy:"sourceType"},
  {name:"backorder",input:{hasBackorder:true},predicate:"has_backorder=1",values:[],sortBy:"totalAmount"},
  {name:"mine",input:{view:"mine"},predicate:"created_by=?",values:[actor.id],sortBy:"updatedAt",actor},
  {name:"outstanding",route:"/api/v1/outstanding-sales-orders",input:{},predicate:"status IN ('CONFIRMED','PARTIALLY_FULFILLED') AND EXISTS(SELECT 1 FROM sales_order_lines l WHERE l.sales_order_id=sales_orders.id AND l.ordered_base_quantity>l.fulfilled_base_quantity+l.cancelled_base_quantity)",values:[],sortBy:"number"},
  {name:"customer-search",input:{q:"Capacity Customer 7"},predicate:"(sales_order_number=? OR customer_code_snapshot LIKE ? OR customer_name_snapshot LIKE ? OR customer_po_reference=?)",values:["Capacity Customer 7","Capacity Customer 7%","%Capacity Customer 7%","Capacity Customer 7"],sortBy:"customerName"},
  {name:"external-exact",input:{externalOrderId:external.external_order_id,channelCode:external.channel_code},predicate:"external_order_key_id IN(SELECT id FROM sales_external_order_keys WHERE external_order_id_hash=? AND BINARY external_order_id=BINARY ? AND channel_code=? AND is_order_archived=0)",values:[createHash("sha256").update(external.external_order_id).digest(),external.external_order_id,external.channel_code],sortBy:"number"},
  {name:"all",input:{},predicate:"1=1",values:[],sortBy:"orderDate"},
  {name:"finalized",input:{view:"finalized"},predicate:"status IN ('COMPLETED','CLOSED','CANCELLED')",values:[],sortBy:"orderDate"}
 ];
}
async function measureMatrix(c,matrix,{archive=false}={}){
 const samples=[],plans=[],responses=[];let actorOffset=0;
 // Initial means the first measured phase following real setup, not cold OS/buffer-pool cache.
 for(const phase of ["initial-cache-uncontrolled","steady-state"]){
  for(let repetition=0;repetition<100;repetition++)for(const item of matrix){
   const query={...item.input,sortBy:item.sortBy,descending:repetition%2===0,page:1,pageSize:20};
   const actor=item.actor??c.actors[actorOffset++%50],route=(item.route??(archive?"/api/v1/archived-sales-orders":"/api/v1/sales-orders"))+"?"+new URLSearchParams(Object.entries(query).map(([k,v])=>[k,String(v)]));
   const result=await c.http(actor,route),data=c.successful(result);assert.ok(data.total>0,item.name+" must exercise real rows");assert.ok(data.items.length>0);assert.ok(data.items.length<=20);
   const sample={class:item.name,phase,repetition,descending:query.descending,ms:result.sample.ms,status:result.response.status,total:data.total,ids:data.items.map(row=>row.id)};samples.push(sample);
   responses.push({item,query,data});
  }
  await c.reserve();
 }
 // Independent literal predicates and SQL oracle run AFTER both measured phases, never as hidden warmups.
 const oracle=new Map(),table=archive?"sales_orders_archive":"sales_orders";
 for(const {item,query,data}of responses){
  const key=item.name+":"+query.descending;
  if(!oracle.has(key)){
   const direction=query.descending?"DESC":"ASC",[[total]]=await c.db.query(`SELECT COUNT(*) AS n FROM ${table} WHERE ${item.predicate}`,item.values);
   const select=`SELECT id,sales_order_number,line_count,total_amount,status,source_type,customer_id,fulfillment_warehouse_id,has_backorder FROM ${table} WHERE ${item.predicate} ORDER BY ${sortColumns[item.sortBy]} ${direction},id ${direction} LIMIT 20`;
   const [rows]=await c.db.query(select,item.values),[plan]=await c.db.query("EXPLAIN FORMAT=TRADITIONAL "+select,item.values);assert.ok(plan.length>0);
   plans.push({class:item.name,descending:query.descending,plan});oracle.set(key,{total:Number(total.n),rows});
  }
  const expected=oracle.get(key);assert.equal(data.total,expected.total);assert.deepEqual(data.items.map(row=>row.id),expected.rows.map(row=>Number(row.id)));
  for(let index=0;index<data.items.length;index++){
   const actual=data.items[index],row=expected.rows[index];assert.equal(actual.number,row.sales_order_number);assert.equal(actual.lineCount,Number(row.line_count));assert.equal(actual.totalAmount,String(row.total_amount));assert.equal(actual.status,row.status);assert.equal(actual.sourceType,row.source_type);assert.equal(actual.customerId,Number(row.customer_id));assert.equal(actual.fulfillmentWarehouseId,Number(row.fulfillment_warehouse_id));assert.equal(actual.hasBackorder,Boolean(row.has_backorder));
  }
 }
 const report=[];
 for(const item of matrix)for(const phase of ["initial-cache-uncontrolled","steady-state"]){const metrics=quantiles(samples.filter(s=>s.class===item.name&&s.phase===phase)),limit=archive?(item.exact?3000:5000):2000;report.push({class:item.name,phase,limitMs:limit,...metrics});}
 await c.save(archive?"archive-query-samples.json":"active-query-samples.json",{samples,report,plans,cache:"Both phases uncontrolled InnoDB/OS cache; no discarded warmups; SQL oracle/plans after timing",oracleRows:oracle.size});
 for(const row of report){assert.equal(row.count,100);assert.ok(row.p95<=row.limitMs,`${row.class}/${row.phase} P95 ${row.p95} > ${row.limitMs}`);}
 return report;
}
export async function activeQueries(c){return measureMatrix(c,await activeMatrix(c));}
export async function activeMergeQueries(c){
 const matrix=(await activeMatrix(c)).filter(item=>item.name!=="outstanding");assert.equal(matrix.length,12);
 return measureMatrix(c,matrix);
}

export async function archiveQueries(c){
 const [[row]]=await c.db.query("SELECT sales_order_number,customer_id FROM sales_orders_archive WHERE customer_id=? ORDER BY id LIMIT 1",[c.binding.customers[7]]);assert.ok(row);
 const completed="EXISTS(SELECT 1 FROM sales_archive_order_manifests m WHERE m.sales_order_id=sales_orders_archive.id AND m.archive_batch_id=sales_orders_archive.archive_batch_id)";
 const matrix=[
  {name:"archive-number",exact:true,input:{number:row.sales_order_number},predicate:"sales_order_number=? AND "+completed,values:[row.sales_order_number],sortBy:"number"},
  {name:"archive-customer",input:{customerId:Number(row.customer_id)},predicate:"customer_id=? AND "+completed,values:[row.customer_id],sortBy:"orderDate"},
  {name:"archive-range366",input:{orderDateFrom:"2023-01-01",orderDateTo:"2024-01-01"},predicate:"order_date BETWEEN ? AND ? AND "+completed,values:["2023-01-01","2024-01-01"],sortBy:"orderDate"}
 ];
 const report=await measureMatrix(c,matrix,{archive:true});
 for(const query of ["","?orderDateFrom=2023-01-01","?orderDateFrom=2023-01-01&orderDateTo=2025-01-01"]){const result=await c.http(c.actors[0],"/api/v1/archived-sales-orders"+query);assert.equal(result.response.status,400);}
 return report;
}
