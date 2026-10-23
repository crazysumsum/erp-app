// Shared only by the new Fulfillment migrations: composite ownership and stored generated columns.
function normalize(sql){return String(sql??"").replace(/\\'/gu,"'").split(/('(?:[^']|'')*')/u).map((part,i,parts)=>i%2?part:part.replace(i<parts.length-1?/_[a-z0-9]+$/u:/$^/u,"").replace(/[`\s]/gu,"").toLowerCase()).join("");}
const fail=(table,part)=>{throw new Error(`Incompatible Fulfillment schema: ${table} ${part}`);};
function names(value){if(!/^[a-z][a-z0-9_]*(,[a-z][a-z0-9_]*)*$/u.test(value))throw new TypeError("Invalid migration identifier");return value;}
export async function inspectFulfillmentTable(tx,c,{allowMissingTriggers=false}={}){
  const [columns]=await tx.query(`SELECT column_name AS name,column_type AS type,is_nullable AS nullable,column_default AS def,collation_name AS collation,extra AS extra,generation_expression AS generation
    FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? ORDER BY ordinal_position`,[c.table]);
  if(!columns.length)return false;if(columns.length!==Object.keys(c.columns).length)fail(c.table,"columns");
  for(const r of columns){const expected=c.columns[r.name];if(!expected)fail(c.table,"column");const [type,nullable=false,def=null,collation,extra="",generation=""]=expected;
    if(r.type!==type||r.nullable!==(nullable?"YES":"NO")||(r.def??null)!==def||r.collation!==(collation??(/^(var)?char\(/u.test(type)?"utf8mb4_unicode_ci":null))||r.extra!==(generation?"STORED GENERATED":extra)||normalize(r.generation)!==normalize(generation))fail(c.table,`column ${r.name}`);
  }
  const [[meta]]=await tx.query("SELECT engine AS engine,table_collation AS collation FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=?",[c.table]);
  if(meta.engine!=="InnoDB"||meta.collation!=="utf8mb4_unicode_ci")fail(c.table,"engine/collation");
  const [indexes]=await tx.query("SELECT index_name AS name,non_unique AS non_unique,column_name AS field,sub_part AS prefix FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name=? ORDER BY index_name,seq_in_index",[c.table]);
  const found=new Map();for(const r of indexes){if(!found.has(r.name))found.set(r.name,[Number(r.non_unique),[]]);found.get(r.name)[1].push(r.field);if(r.prefix!==null||!c.indexes[r.name]&&Number(r.non_unique)===0)fail(c.table,"index");}
  for(const [name,[nonUnique,fields]]of Object.entries(c.indexes)){const r=found.get(name);if(!r||r[0]!==nonUnique||r[1].join(",")!==fields)fail(c.table,`index ${name}`);}
  const [fks]=await tx.query(`SELECT k.constraint_name AS name,k.column_name AS field,k.referenced_table_name AS target,k.referenced_column_name AS target_field,r.delete_rule AS delete_rule,r.update_rule AS update_rule,
    k.referenced_table_schema=DATABASE() AS local_scope FROM information_schema.key_column_usage k JOIN information_schema.referential_constraints r ON r.constraint_schema=k.constraint_schema AND r.table_name=k.table_name AND r.constraint_name=k.constraint_name
    WHERE k.table_schema=DATABASE() AND k.table_name=? ORDER BY k.constraint_name,k.ordinal_position`,[c.table]);
  const groups=new Map();for(const r of fks){if(!groups.has(r.name))groups.set(r.name,[]);groups.get(r.name).push(r);}
  const allowed={...c.foreignKeys,...c.deferredForeignKeys};
  for(const [name,rows]of groups){const e=allowed[name];if(!e||rows.map(r=>r.field).join(",")!==e[0]||rows.some(r=>r.target!==e[1]||r.delete_rule!==e[3]||!r.local_scope||!["RESTRICT","NO ACTION"].includes(r.update_rule))||rows.map(r=>r.target_field).join(",")!==e[2])fail(c.table,`foreign key ${name}`);}
  if(Object.keys(c.foreignKeys).some(name=>!groups.has(name)))fail(c.table,"missing foreign key");
  const [checks]=await tx.query(`SELECT tc.constraint_name AS name,tc.enforced AS enforced,cc.check_clause AS clause FROM information_schema.table_constraints tc JOIN information_schema.check_constraints cc ON cc.constraint_schema=tc.constraint_schema AND cc.constraint_name=tc.constraint_name WHERE tc.constraint_schema=DATABASE() AND tc.table_name=? AND tc.constraint_type='CHECK'`,[c.table]);
  if(checks.length!==Object.keys(c.checks).length||checks.some(r=>!c.checks[r.name]||r.enforced!=="YES"||normalize(r.clause)!==normalize(c.checks[r.name])))fail(c.table,"checks");
  const [triggers]=await tx.query("SELECT trigger_name AS name,event_manipulation AS event,action_timing AS timing,action_statement AS statement FROM information_schema.triggers WHERE trigger_schema=DATABASE() AND event_object_table=?",[c.table]);
  for(const r of triggers){const e=c.triggers?.[r.name];if(!e||r.event!==e[0]||r.timing!=="BEFORE"||normalize(r.statement)!==normalize(e[1]))fail(c.table,`trigger ${r.name}`);}
  if(!allowMissingTriggers&&Object.keys(c.triggers??{}).some(name=>!triggers.some(r=>r.name===name)))fail(c.table,"missing trigger");
  return true;
}
export async function createFulfillmentTable(tx,c){
  const exists=await inspectFulfillmentTable(tx,c,{allowMissingTriggers:true});
  if(!exists){
    const definitions=Object.entries(c.columns).map(([name,[type,nullable=false,def=null,collation,extra="",generation=""]])=>`${names(name)} ${type}${collation?` CHARACTER SET ${collation.split("_")[0]} COLLATE ${collation}`:""}${generation?` GENERATED ALWAYS AS (${generation}) STORED`:` ${nullable?"NULL":"NOT NULL"}${def===null?"":` DEFAULT '${def}'`}${extra?` ${extra}`:""}`}`);
    for(const [name,[nonUnique,fields]]of Object.entries(c.indexes))definitions.push(name==="PRIMARY"?`PRIMARY KEY (${names(fields)})`:`${nonUnique?"KEY":"UNIQUE KEY"} ${names(name)} (${names(fields)})`);
    for(const [name,[fields,target,refs,rule]]of Object.entries(c.foreignKeys))definitions.push(`CONSTRAINT ${names(name)} FOREIGN KEY (${names(fields)}) REFERENCES ${names(target)} (${names(refs)}) ON DELETE ${rule}`);
    for(const [name,clause]of Object.entries(c.checks)){definitions.push(`CONSTRAINT ${names(name)} CHECK (${clause})`);}
    await tx.query(`CREATE TABLE ${names(c.table)} (${definitions.join(",\n")}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  }
  for(const [name,[event,body]]of Object.entries(c.triggers??{})){const [rows]=await tx.query("SELECT trigger_name FROM information_schema.triggers WHERE trigger_schema=DATABASE() AND trigger_name=?",[name]);if(!rows.length)await tx.query(`CREATE TRIGGER ${names(name)} BEFORE ${event} ON ${names(c.table)} FOR EACH ROW ${body}`);}
  await inspectFulfillmentTable(tx,c);
}
export async function addFulfillmentForeignKey(tx,table,name,definition){
  const [rows]=await tx.query("SELECT constraint_name FROM information_schema.referential_constraints WHERE constraint_schema=DATABASE() AND table_name=? AND constraint_name=?",[table,name]);
  if(!rows.length){const [fields,target,refs,rule]=definition;await tx.query(`ALTER TABLE ${names(table)} ADD CONSTRAINT ${names(name)} FOREIGN KEY (${names(fields)}) REFERENCES ${names(target)} (${names(refs)}) ON DELETE ${rule}`);}
}
export function appendOnlyTriggers(prefix){return Object.fromEntries(["UPDATE","DELETE"].map(event=>[`trg_${prefix}_${event.toLowerCase()}`,[event,"SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Fulfillment fact is append-only'"]]));}
