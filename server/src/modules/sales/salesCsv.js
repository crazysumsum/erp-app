import {createHash} from "node:crypto";
import {mkdtemp,chmod,readFile,writeFile,opendir,rm} from "node:fs/promises";
import path from "node:path";
import {Readable} from "node:stream";
import {pipeline} from "node:stream/promises";
import {CsvError,parse} from "csv-parse";
import {stringify} from "csv-stringify/sync";
import {sanitizeCsvCell} from "../item/csvSafety.js";
import {IMPORT_MAX_BYTES,IMPORT_MAX_ROWS,IMPORT_MAX_ORDERS,MAX_DOCUMENT_LINES} from "./salesConstants.js";
import {normalizeMoney,formatSalesDecimal} from "./salesMoneyMath.js";
import {normalizeQuantity,quantityUnits} from "./salesQuantityMath.js";
import {salesDate} from "./salesValidation.js";
import {salesError} from "./salesErrors.js";

export const SALES_CSV_COLUMNS=Object.freeze([
  ["templateVersion","模板版本固定1.0","1.0"],["sourceOrderKey","相同來源訂單使用完全相同的key","EXAMPLE-1"],
  ["channelCode","部署設定允許的渠道代碼","SYNTHETIC"],["externalOrderId","渠道內精確外部訂單識別碼","EXAMPLE-1"],
  ["customerId","現有可銷售客戶ID","1"],["warehouseCode","現有可用倉庫代碼","SYNTHETIC"],
  ["orderDate","訂單日期YYYY-MM-DD","2026-10-07"],["requestedDeliveryDate","可選交付日期YYYY-MM-DD",""],
  ["currencyCode","三位大寫幣別代碼","HKD"],["paymentTermCode","可選付款條款代碼",""],
  ["customerPoReference","可選客戶採購單參考",""],["orderNotes","可選訂單備註",""],
  ["skuCode","現有可銷售SKU代碼","SYNTHETIC"],["salesUomCode","現有銷售單位代碼","EA"],
  ["quantity","正數，最多6位小數，不接受指數或千位符","1.000000"],["unitSellingPrice","非負單價，最多4位小數","1.0000"],
  ["lineNote","可選行備註",""]
].map(([name,description,example])=>Object.freeze({name,description,example})));
const names=SALES_CSV_COLUMNS.map(column=>column.name),headerFields=names.slice(0,12);
export function buildSalesImportTemplate(){return "\uFEFF"+stringify([names,SALES_CSV_COLUMNS.map(column=>column.example)],{record_delimiter:"\r\n"});}

async function* utf8(source,signal) {
  const decoder=new TextDecoder("utf-8",{fatal:true});let bytes=0;
  for await(const chunk of Buffer.isBuffer(source)||source instanceof Uint8Array?[source]:source) {
    signal?.throwIfAborted();const buffer=Buffer.from(chunk);bytes+=buffer.length;
    if(bytes>IMPORT_MAX_BYTES)throw salesError("SALES_IMPORT_FILE_INVALID",{field:"file"});
    let text;
    try {text=decoder.decode(buffer,{stream:true});}catch {throw salesError("SALES_IMPORT_FILE_INVALID",{field:"encoding"});}
    if(text.includes("\0"))throw salesError("SALES_IMPORT_FILE_INVALID",{field:"file"});
    yield text;
  }
  try {yield decoder.decode();}catch {throw salesError("SALES_IMPORT_FILE_INVALID",{field:"encoding"});}
}

const freeText=value=>/^\s*[=+\-@]/u.test(value)?"'"+value:sanitizeCsvCell(value);
function normalizeRow(row,rowNo) {
  const errors=[];
  const checked=(field,fn)=>{try{return fn(row[field]);}catch(error){errors.push({rowNo,field,code:error.code??"SALES_IMPORT_ORDER_INVALID"});return "";}};
  const text=(field,max,required=false,neutralize=false)=>checked(field,value=>{
    if(typeof value!=="string"||required&&!value.trim()||[...value].length>max||/[\p{Cc}\p{Cf}]/u.test(value.replace(/[\t\n\r]/gu,"")))throw salesError("SALES_IMPORT_ORDER_INVALID",{field});
    const safe=neutralize?freeText(value):value;
    if([...safe].length>max)throw salesError("SALES_IMPORT_ORDER_INVALID",{field});
    return safe;
  });
  const customerId=checked("customerId",value=>{const id=Number(value);if(!/^\d+$/u.test(value)||!Number.isSafeInteger(id)||id<1)throw salesError("SALES_IMPORT_ORDER_INVALID",{field:"customerId"});return id;});
  const channelCode=checked("channelCode",value=>{if(!/^[A-Z][A-Z0-9_]{0,49}$/u.test(value))throw salesError("SALES_IMPORT_ORDER_INVALID",{field:"channelCode"});return value;});
  const currencyCode=checked("currencyCode",value=>{if(!/^[A-Z]{3}$/u.test(value))throw salesError("SALES_IMPORT_ORDER_INVALID",{field:"currencyCode"});return value;});
  const orderDate=checked("orderDate",value=>salesDate(value,"orderDate"));
  const requestedDeliveryDate=checked("requestedDeliveryDate",value=>{if(!value)return null;if(salesDate(value,"requestedDeliveryDate")<orderDate)throw salesError("SALES_DATE_INVALID",{field:"requestedDeliveryDate"});return value;});
  const payload={customerId,channelCode,currencyCode,orderDate,requestedDeliveryDate,warehouseCode:text("warehouseCode",50,true),paymentTermCode:text("paymentTermCode",50),
    customerPoReference:text("customerPoReference",190,false,true),notes:text("orderNotes",2000,false,true)};
  const lineNote=text("lineNote",500,false,true);
  const line={skuCode:text("skuCode",190,true),salesUomCode:text("salesUomCode",100,true),quantity:checked("quantity",normalizeQuantity),unitSellingPrice:checked("unitSellingPrice",normalizeMoney),lineNote,formulaPrefixed:lineNote!==row.lineNote,rowNumbers:[rowNo]};
  return {payload,line,errors,externalOrderId:text("externalOrderId",190,true)};
}

function appendErrors(group,errors,rowNo) {
  const overflow=group.errors.length+errors.length>200;
  group.errors.push(...errors.slice(0,200-group.errors.length));
  if(overflow&&group.errors.at(-1)?.code!=="TOO_MANY_ERRORS")group.errors[199]={rowNo,field:"row",code:"TOO_MANY_ERRORS"};
}
const safePayload=group=>({...group.payload,lines:group.payload.lines.map(({formulaPrefixed: _formulaPrefixed,...line})=>line)});

// A group file holds at most100 rows/128KiB; there is no file-wide in-memory order map.
export async function parseSalesCsv(source,{spoolRoot,abortSignal,onOrder,onFileValidated}={}) {
  if(!path.isAbsolute(spoolRoot)||typeof onOrder!=="function")throw new TypeError("Sales CSV requires a managed spool root and bounded order consumer");
  abortSignal?.throwIfAborted();const directory=await mkdtemp(path.join(spoolRoot,"sales-csv-"));
  let rowCount=0,orderCount=0;
  try {
    await chmod(directory,0o700);
    const parser=parse({bom:true,record_delimiter:["\r\n","\n"],skip_empty_lines:true,relax_column_count:false,max_record_size:65536});
    const completed=pipeline(Readable.from(utf8(source,abortSignal)),parser,{signal:abortSignal});void completed.catch(()=>{});
    let headers;
    try {
      for await(const values of parser) {
        abortSignal?.throwIfAborted();
        if(!headers) {
          if(values.length!==names.length||new Set(values).size!==names.length||names.some(name=>!values.includes(name)))throw salesError("SALES_IMPORT_FILE_INVALID",{field:"header"});
          headers=values;continue;
        }
        if(values.every((value,index)=>value===headers[index]))throw salesError("SALES_IMPORT_FILE_INVALID",{field:"header"});
        if(++rowCount>IMPORT_MAX_ROWS)throw salesError("SALES_IMPORT_FILE_INVALID",{field:"rows"});
        const row=Object.fromEntries(headers.map((name,index)=>[name,values[index]])),rowNo=rowCount+1;
        if(row.templateVersion!=="1.0")throw salesError("SALES_IMPORT_VERSION_UNSUPPORTED");
        if(!row.sourceOrderKey.trim()||[...row.sourceOrderKey].length>190||/[\p{Cc}\p{Cf}]/u.test(row.sourceOrderKey))throw salesError("SALES_IMPORT_FILE_INVALID",{field:"sourceOrderKey"});
        const hash=createHash("sha256").update(row.sourceOrderKey,"utf8").digest("hex"),file=path.join(directory,hash);
        let group;
        try {group=JSON.parse(await readFile(file,"utf8"));}catch(error){if(error.code!=="ENOENT")throw error;}
        const normalized=normalizeRow(row,rowNo);
        if(!group) {
          if(++orderCount>IMPORT_MAX_ORDERS)throw salesError("SALES_IMPORT_FILE_INVALID",{field:"orders"});
          group={sourceOrderKey:row.sourceOrderKey,externalOrderId:normalized.externalOrderId,channelCode:normalized.payload.channelCode,header:headerFields.map(name=>[...row[name]].length>(name==="orderNotes"?2000:190)?null:row[name]),payload:{...normalized.payload,lines:[]},errors:[],firstRowNo:rowNo,lastRowNo:rowNo,rowCount:0,limited:false};
        }
        if(group.sourceOrderKey!==row.sourceOrderKey)throw salesError("SALES_SOURCE_HASH_COLLISION");
        if(group.header.some((value,index)=>value!==row[headerFields[index]]))normalized.errors.push({rowNo,field:"header",code:"SALES_IMPORT_ORDER_INVALID"});
        group.rowCount++;group.lastRowNo=rowNo;
        if(group.rowCount>MAX_DOCUMENT_LINES&&!group.limited){group.limited=true;group.payload.lines=[];normalized.errors.push({rowNo,field:"lines",code:"SALES_IMPORT_ORDER_INVALID"});}
        if(!group.limited&&!normalized.errors.length) {
          const previous=group.payload.lines.find(line=>line.skuCode===normalized.line.skuCode&&line.salesUomCode===normalized.line.salesUomCode);
          if(previous) {
            if(previous.unitSellingPrice!==normalized.line.unitSellingPrice||previous.lineNote!==normalized.line.lineNote||previous.formulaPrefixed!==normalized.line.formulaPrefixed)normalized.errors.push({rowNo,field:"lines",code:"SALES_LINE_MERGE_CONFLICT"});
            else try {previous.quantity=normalizeQuantity(formatSalesDecimal(quantityUnits(previous.quantity)+quantityUnits(normalized.line.quantity),6));previous.rowNumbers.push(rowNo);}catch(error){normalized.errors.push({rowNo,field:"quantity",code:error.code});}
          } else group.payload.lines.push(normalized.line);
        }
        appendErrors(group,normalized.errors,rowNo);
        if(Buffer.byteLength(JSON.stringify(safePayload(group)))>131072){group.limited=true;group.payload.lines=[];appendErrors(group,[{rowNo,field:"payload",code:"SALES_IMPORT_ORDER_INVALID"}],rowNo);}
        await writeFile(file,JSON.stringify(group),{mode:0o600});
      }
      await completed;
      if(!headers||!rowCount)throw salesError("SALES_IMPORT_FILE_INVALID",{field:"file"});
    } catch(error) {
      parser.destroy();
      if(abortSignal?.aborted){source.destroy?.();throw abortSignal.reason;}
      await completed.catch(()=>{});
      if(error instanceof CsvError)throw salesError("SALES_IMPORT_FILE_INVALID",{field:"file"});
      throw error;
    }
    await onFileValidated?.({rowCount,orderCount});
    for await(const entry of await opendir(directory)) {
      abortSignal?.throwIfAborted();const group=JSON.parse(await readFile(path.join(directory,entry.name),"utf8"));
      delete group.header;delete group.limited;
      group.payload=safePayload(group);
      await onOrder(group);
      abortSignal?.throwIfAborted();
    }
    return {rowCount,orderCount};
  } finally {await rm(directory,{recursive:true,force:true});}
}
