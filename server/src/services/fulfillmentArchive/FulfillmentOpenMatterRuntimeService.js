import { BaseService } from "../../framework/services/BaseService.js";
import { FulfillmentOpenMatterService } from "../../modules/fulfillment/FulfillmentOpenMatterService.js";
export class FulfillmentOpenMatterRuntimeService extends BaseService {
  static service=Object.freeze({name:"fulfillmentOpenMatter",lifecycle:"singleton",dependencies:["mysqldatabase","context","time"],eager:true});
  constructor(options={}){super(options);this.provider=new FulfillmentOpenMatterService({database:this.services.require("mysqldatabase"),context:this.services.require("context"),time:this.services.require("time")});}
  getOrderArchiveStatus(...args){return this.provider.getOrderArchiveStatus(...args);}
  getOrderArchiveStatusInTransaction(...args){return this.provider.getOrderArchiveStatusInTransaction(...args);}
  assertSalesLifecycleAllowedInTransaction(...args){return this.provider.assertSalesLifecycleAllowedInTransaction(...args);}
}
