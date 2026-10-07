import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { SalesOrderService } from "../../modules/sales/SalesOrderService.js";
import { validateSalesBackorderScope } from "../../modules/sales/SalesBackorderService.js";
import { EMPTY,SALES_ORDER_WRITE_POLICY,salesActorClaims } from "../sales/salesSchemas.js";

export class RunSalesBackorderAllocationHandler extends BaseRequestHandler {
 static handlerName="runSalesBackorderAllocation";
 static api={method:"POST",path:"/api/v1/sales-backorders/allocations/run",description:"Wake the registered FIFO Sales Backorder job",authorizationPolicies:[SALES_ORDER_WRITE_POLICY],idempotency:{enabled:true},
  requestSchema:{params:EMPTY,query:EMPTY,body:{}},responseSchema:{202:{type:"object",additionalProperties:false,required:["accepted"],properties:{accepted:{const:true}}}}};
 constructor(services={}){super(services);this.order=new SalesOrderService({database:services.require("mysqldatabase"),time:services.require("time"),logger:this.logger});}
 authorizeRequest(req){return this.order.authorizeWrite(salesActorClaims(req));}
 async execute(req){const result=await this.services.require("salesJobs").wakeBackorders({claims:salesActorClaims(req),input:validateSalesBackorderScope(req.input.body),signal:req.requestTimeout?.signal});return this.response(result,{statusCode:202});}
}
