import {inspectSalesArchiveSchemas} from "../../../database/migrations/0089_create_sales_archive_tables.js";
import {SALES_ARCHIVE_COLUMNS} from "./salesArchiveHash.js";
const body="SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='SALES_ARCHIVE_IMMUTABLE'";
export const SALES_ARCHIVE_GUARDS=Object.freeze(Object.keys(SALES_ARCHIVE_COLUMNS).flatMap(base=>["UPDATE","DELETE"].map(event=>Object.freeze({table:base+"_archive",name:`trg_${base}_archive_${event.toLowerCase()}`,event,body}))));
const byName=new Map(SALES_ARCHIVE_GUARDS.map(guard=>[guard.name,guard])),tables=new Set(SALES_ARCHIVE_GUARDS.map(guard=>guard.table));
function normalized(sql){
 return sql.replace(/\\'/gu,"'").split(/('(?:[^']|'')*')/u).map((part,index,parts)=>{
  if(index%2)return part;
  if(index<parts.length-1)part=part.replace(/_[a-z0-9]+$/u,"");
  return part.replace(/[`\s]/gu,"").toLowerCase();
 }).join("");
}
function verify(row,table){
 const expected=byName.get(row.name);
 if(!expected||expected.table!==table||row.event!==expected.event||row.timing!=="BEFORE"||row.orientation!=="ROW"||normalized(row.statement)!==normalized(expected.body))throw new Error("Incompatible Sales Archive immutable trigger");
}
async function knownGuards(connection){
 const [rows]=await connection.query(`SELECT trigger_name AS name,event_object_table AS table_name,event_manipulation AS event,action_timing AS timing,action_orientation AS orientation,action_statement AS statement FROM information_schema.triggers WHERE trigger_schema=DATABASE() AND trigger_name IN (${SALES_ARCHIVE_GUARDS.map(()=>"?").join(",")})`,SALES_ARCHIVE_GUARDS.map(guard=>guard.name));
 for(const row of rows)verify(row,row.table_name);
 return new Set(rows.map(row=>row.name));
}
export async function inspectSalesArchiveProtection(connection,{allowMissingTriggers=false}={}){
 await knownGuards(connection);let complete=true;
 // Preserve the installed legacy schema contract byte-for-byte. Only exact, independently validated
 // forward guards are removed from its trigger metadata; foreign/altered rows remain rejected.
 const observer={async query(sql,args=[]){
  const result=await connection.query(sql,args);
  if(typeof sql!=="string"||!sql.includes("FROM information_schema.triggers")||!tables.has(args[0]))return result;
  const [rows,fields]=result,seen=new Set();
  for(const row of rows)if(byName.has(row.name)){verify(row,args[0]);seen.add(row.name);}
  if(seen.size!==2)complete=false;
  return [rows.filter(row=>!byName.has(row.name)),fields];
 }};
 const valid=await inspectSalesArchiveSchemas(observer);
 return valid&&(allowMissingTriggers||complete);
}
export async function installSalesArchiveProtection(connection){
 if(!await inspectSalesArchiveProtection(connection,{allowMissingTriggers:true}))throw new Error("Missing Sales Archive mirror prerequisite");
 const existing=await knownGuards(connection);
 for(const guard of SALES_ARCHIVE_GUARDS)if(!existing.has(guard.name))await connection.query(`CREATE TRIGGER ${guard.name} BEFORE ${guard.event} ON ${guard.table} FOR EACH ROW ${guard.body}`);
 if(!await inspectSalesArchiveProtection(connection))throw new Error("Incomplete Sales Archive immutable protection");
}
