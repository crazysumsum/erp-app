import assert from "node:assert/strict";
import test from "node:test";
import {inspectSalesBackorderOrderIndex} from "../../../database/migrations/0108_add_sales_backorder_order_index.js";

const rows=()=>["sales_order_id","id"].map((column_name,i)=>({column_name,seq_in_index:i+1,non_unique:1,sub_part:null,expression:null,index_type:"BTREE",is_visible:"YES",collation:"A"}));
const inspect=value=>inspectSalesBackorderOrderIndex({query:async(sql,parameters)=>{assert.match(sql,/information_schema\.statistics/u);assert.deepEqual(parameters,["idx_sales_backorder_order"]);return [value];}});
test("DEF037 order index absence is distinguished from a compatible existing definition",async()=>{
 assert.equal(await inspect([]),false);assert.equal(await inspect(rows()),true);
});
test("DEF037 order index rejects missing, reversed and surplus key parts",async()=>{
 for(const value of [rows().slice(0,1),rows().reverse(),[...rows(),{...rows()[1],seq_in_index:3}]])await assert.rejects(()=>inspect(value),/Incompatible Sales Backorder order index/u);
});
test("DEF037 order index rejects unique, prefix, hidden, functional, descending and non-BTree alternatives",async()=>{
 for(const change of [{non_unique:0},{sub_part:4},{is_visible:"NO"},{expression:"id + 1"},{collation:"D"},{index_type:"HASH"},{seq_in_index:2}]){
  const value=rows();value[0]={...value[0],...change};await assert.rejects(()=>inspect(value),/Incompatible Sales Backorder order index/u);
 }
});

test("DEF037 native information-schema casing is normalized by explicit aliases",async()=>{
 const fields=["non_unique","column_name","seq_in_index","sub_part","index_type","is_visible","collation","expression"];
 const connection={query:async sql=>{const aliased=fields.every(field=>new RegExp(field+"\\s+AS\\s+"+field,"u").test(sql));return [rows().map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[aliased?key:key.toUpperCase(),value])))];}};
 assert.equal(await inspectSalesBackorderOrderIndex(connection),true);
});
