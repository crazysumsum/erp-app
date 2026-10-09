import {BaseRequestHandler} from "../../framework/api/BaseRequestHandler.js";
import {ApplicationError} from "../../framework/errors/ApplicationError.js";
import {requireSalesActor} from "../../modules/sales/salesAuthorization.js";
import {buildSalesImportTemplate} from "../../modules/sales/salesCsv.js";
import {EMPTY,salesActorClaims} from "../sales/salesSchemas.js";

export class GetCurrentSalesImportTemplateHandler extends BaseRequestHandler {
  static handlerName="getCurrentSalesImportTemplate";
  static api={method:"GET",path:"/api/v1/sales-import-templates/current",description:"下載Sales CSV1.0模板；範例需換成有效客戶、倉庫、SKU及受控渠道。",
    authorizationPolicies:[{name:"hasPermission",options:{permissions:["sales.view","sales.import"]}}],download:{enabled:true},
    requestSchema:{params:EMPTY,query:EMPTY,body:EMPTY},responseSchema:{200:{type:"object",additionalProperties:true}}};
  async execute(req,res) {
    await this.mysqlDatabase.withTransaction(async tx=>{
      const actor=await requireSalesActor(tx,salesActorClaims(req),"sales.import");
      if(!actor.permissions.includes("sales.view"))throw new ApplicationError("Sales view permission is required",{code:"FORBIDDEN",statusCode:403});
    });
    res.setHeader("X-Sales-Import-Template-Version","1.0");res.setHeader("Cache-Control","no-store");
    return this.file({buffer:Buffer.from(buildSalesImportTemplate(),"utf8"),fileName:"sales-import-template-1.0.csv",contentType:"text/csv; charset=utf-8"});
  }
}
