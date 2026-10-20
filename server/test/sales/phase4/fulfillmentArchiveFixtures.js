import { randomUUID, createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { execFile } from "node:child_process";
import mysql from "mysql2/promise";

const databaseDirectory = fileURLToPath(new URL("../../../database/", import.meta.url));
const migrateScript = fileURLToPath(new URL("../../../scripts/migrate.js", import.meta.url));
const framework = ["framework/idempotency.sql", "framework/jwt.sql", "framework/scheduler.sql"];
const legacyExport = "migrations/0087_create_sales_export_jobs.js";
const currentExport = "migrations/0090_create_sales_export_jobs.js";
export async function createFulfillmentArchiveDatabase(t, { legacyExportIdentity = false, baseOnly = true } = {}) {
  if (process.env.DB_INTEGRATION_TESTS !== "1") throw new Error("Explicit isolated integration environment required");
  const base = process.env.DB_NAME;
  if (typeof base !== "string" || !/^[A-Za-z0-9_]{1,30}$/u.test(base)) throw new Error("Invalid isolated fixture database namespace");
  const name = `${base}_fa_${randomUUID().replaceAll("-", "").slice(0,12)}`;
  const connectionOptions = { host:process.env.DB_HOST, port:Number(process.env.DB_PORT || 3306), socketPath:process.env.DB_SOCKET_PATH,
    user:process.env.DB_ADMIN_USER ?? process.env.DB_USER, password:process.env.DB_ADMIN_PASSWORD ?? process.env.DB_PASSWORD,
    multipleStatements:true };
  const admin = await mysql.createConnection(connectionOptions); let db = null, created = false;
  t.after(async()=>{ try { if(db)await db.end();if(created)await admin.query(`DROP DATABASE \`${name}\``); } finally { await admin.end(); } });
  // CREATE without IF NOT EXISTS exclusively acquires this synthetic namespace; no caller supplies its name.
  await admin.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);created = true;
  db = await mysql.createConnection({...connectionOptions,database:name});
  await db.query("CREATE TABLE fr_schema_migrations (name VARCHAR(190) NOT NULL PRIMARY KEY,applied_at BIGINT UNSIGNED NOT NULL)");
  let entries = (await readdir(path.join(databaseDirectory,"migrations"))).filter(file=>/^[0-9]{4}_.*\.(?:js|sql)$/u.test(file));
  if(baseOnly || legacyExportIdentity)entries=entries.filter(file=>Number(file.slice(0,4))<=90);
  if(legacyExportIdentity)entries=entries.filter(file=>file!=="0087_fix_supplier_sku_refs_sku_foreign_key.js");
  const names = [...framework,...entries.sort().map(file=>"migrations/"+file)];
  const inventory = names.map(source=>({source,logical:legacyExportIdentity && source===currentExport?legacyExport:source}));
  if(legacyExportIdentity){
    const bytes=await readFile(path.join(databaseDirectory,currentExport));
    if(createHash("sha256").update(bytes).digest("hex")!=="8923fbd075baef9bd0c2e0e4ad02376c98036b34c0d9130a20ba91455f6bbe55")throw new Error("Legacy0087 body identity changed");
    inventory.splice(3,inventory.length-3,...inventory.slice(3).sort((a,b)=>a.logical.localeCompare(b.logical,"en")));
  }
  const firstAppliedAt=Date.now();
  for(const [index,{source,logical}] of inventory.entries()){
    if(source.endsWith(".js"))await (await import(pathToFileURL(path.join(databaseDirectory,source)).href)).up(db);
    else await db.query(await readFile(path.join(databaseDirectory,source),"utf8"));
    await db.execute("INSERT INTO fr_schema_migrations(name,applied_at) VALUES (?,?)",[logical,firstAppliedAt+index]);
  }
  return {db,name,connectionOptions,legacyExport,inventory,async migrate(){
    const env={...process.env,DB_NAME:name,DB_USER:connectionOptions.user,DB_PASSWORD:connectionOptions.password};
    return new Promise(resolve=>{
      execFile(process.execPath,[migrateScript],{env,timeout:180000,maxBuffer:1024*1024},
        (error,stdout,stderr)=>resolve({code:error?.code ?? (error ? -1 : 0),stdout,stderr}));
    });
  }};
}
