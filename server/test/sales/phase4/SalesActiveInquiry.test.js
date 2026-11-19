import assert from "node:assert/strict";
import test from "node:test";
import { validateSalesOrderQuery } from "../../../src/modules/sales/SalesInquiryService.js";
test("TC-044 common order views have an explicit allowlist",()=>{
 for(const view of ["all","mine","outstanding","backorder","finalized"])assert.equal(validateSalesOrderQuery({view}).view,view);
 assert.throws(()=>validateSalesOrderQuery({view:"created_by=7"}),{code:"SALES_INPUT_INVALID"});
});
