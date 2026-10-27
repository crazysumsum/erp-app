import assert from "node:assert/strict";
import test from "node:test";
import {readinessMetadata} from "../../../src/modules/fulfillment/fulfillmentArchiveReadiness.js";

const tables=["fulfillments","fulfillment_lines"];
const query="SELECT engine AS engine,table_collation AS collation FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=?";

test("readiness batches a known family once and preserves each table's rows",async()=>{
 const rows=tables.map((table,index)=>({__readiness_table:table,engine:"InnoDB",collation:"utf8mb4_unicode_ci",index}));let calls=0;
 const reader=readinessMetadata({async query(sql,args){calls++;assert.equal(sql,"SELECT table_name AS __readiness_table,engine AS engine,table_collation AS collation FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN (?)");assert.deepEqual(args,[tables]);return [rows];}},tables);
 for(const [index,table]of tables.entries())assert.deepEqual(await reader.query(query,[table]),[[{engine:"InnoDB",collation:"utf8mb4_unicode_ci",index}]]);
 assert.equal(calls,1);assert.equal(rows[0].__readiness_table,tables[0]);
});

test("readiness metadata is fresh on each new probe with the same executor",async()=>{
 let calls=0;const executor={async query(){calls++;return [[{__readiness_table:tables[0],engine:String(calls)}]];}};
 for(const value of ["1","2"])assert.deepEqual(await readinessMetadata(executor,tables).query(query,[tables[0]]),[[{engine:value}]]);
 assert.equal(calls,2);
});

test("unknown metadata SQL keeps its original LIMIT, aggregation and compound semantics",async()=>{
 const variants=[query+" LIMIT 1",query.replace("SELECT ","SELECT DISTINCT "),query.replace("engine AS engine,table_collation AS collation","COUNT(*) AS n"),query+" UNION ALL SELECT 'x','y'",query+" OR table_name='other'",query.replace("table_schema=DATABASE()","table_schema = DATABASE()"),"SELECT table_name FROM information_schema.tables WHERE table_name=? LIMIT 1"];
 for(const sql of variants){const args=[tables[0]],result=[[{original:sql}],{fields:true}];let calls=0;const reader=readinessMetadata({async query(actual,values){calls++;assert.equal(actual,sql);assert.equal(values,args);return result;}},tables);assert.equal(await reader.query(sql,args),result);assert.equal(calls,1);}
});

test("unknown table and argument shapes delegate without rewriting",async()=>{
 for(const args of [["unowned_table"],[],[tables[0],"extra"]]){const result=[[]];const reader=readinessMetadata({async query(sql,actual){assert.equal(sql,query);assert.equal(actual,args);return result;}},tables);assert.equal(await reader.query(query,args),result);}
});

test("readiness rejects malformed or unknown grouping identities",async()=>{
 for(const rows of [null,"rows",[null],[{}],[{__readiness_table:"unowned_table"}]]){const reader=readinessMetadata({async query(){return [rows];}},tables);await assert.rejects(reader.query(query,[tables[0]]),{name:"TypeError"});}
});

test("recognized trigger ordering projection retains ordinal and row order",async()=>{
 const sql="SELECT trigger_name AS name,event_manipulation AS event,action_timing AS timing,action_order AS ordinal,action_statement AS statement FROM information_schema.triggers WHERE trigger_schema=DATABASE() AND event_object_table=?";
 const reader=readinessMetadata({async query(actual,args){assert.match(actual,/action_order AS ordinal/u);assert.deepEqual(args,[tables]);return [[{__readiness_table:tables[0],name:"first",ordinal:1},{__readiness_table:tables[0],name:"second",ordinal:2}]];}},tables);
 assert.deepEqual(await reader.query(sql,[tables[0]]),[[{name:"first",ordinal:1},{name:"second",ordinal:2}]]);assert.deepEqual(await reader.query(sql,[tables[1]]),[[]]);
});

test("CHECK metadata uses the bounded join plan and preserves each table's checks",async()=>{
 const sql="SELECT tc.constraint_name AS name,tc.enforced AS enforced,cc.check_clause AS clause FROM information_schema.table_constraints tc JOIN information_schema.check_constraints cc ON cc.constraint_schema=tc.constraint_schema AND cc.constraint_name=tc.constraint_name WHERE tc.constraint_schema=DATABASE() AND tc.table_name=? AND tc.constraint_type='CHECK'";
 let calls=0;const reader=readinessMetadata({async query(actual,args){calls++;assert.match(actual,/STRAIGHT_JOIN information_schema\.check_constraints cc/u);assert.equal(actual.includes(" UNION ALL "),false);assert.equal((actual.match(/tc\.table_name IN \(\?\)/gu)??[]).length,1);assert.deepEqual(args,[tables]);return [[{__readiness_table:tables[0],name:"first",enforced:"YES",clause:"quantity >= 0"},{__readiness_table:tables[1],name:"second",enforced:"YES",clause:"version >= 1"}]];}},tables);
 assert.deepEqual(await reader.query(sql,[tables[0]]),[[{name:"first",enforced:"YES",clause:"quantity >= 0"}]]);assert.deepEqual(await reader.query(sql,[tables[1]]),[[{name:"second",enforced:"YES",clause:"version >= 1"}]]);assert.equal(calls,1);
});
