import {BaseService} from "../../framework/services/BaseService.js";
import {FulfillmentOpenMatterService as OpenMatter} from "../../modules/fulfillment/FulfillmentOpenMatterService.js";
const activation=process.env.FULFILLMENT_LIFECYCLE_ENABLED;
if(activation!==undefined&&!["true","false"].includes(activation))throw new TypeError("FULFILLMENT_LIFECYCLE_ENABLED must be true or false");
// Enable only through the approved quiesce/install/register/all-node-probe/resume cutover.
export class FulfillmentOpenMatterService extends BaseService {
  static service=Object.freeze({name:"fulfillmentOpenMatter",lifecycle:"singleton",dependencies:["mysqldatabase"],eager:false,enabled:activation==="true"});
  constructor(options){super(options);this.provider=new OpenMatter({database:this.services.require("mysqldatabase"),authorizeArchiveRead:async(tx,scope)=>{const jobs=await this.services.resolve("salesJobs");return typeof jobs.authorizeArchiveReadInTransaction==="function"&&await jobs.authorizeArchiveReadInTransaction(tx,scope)===true;}});}
  getOrderArchiveStatus(orderId,options){return this.provider.getOrderArchiveStatus(orderId,options);}
  getOrderArchiveStatusInTransaction(tx,command){return this.provider.getOrderArchiveStatusInTransaction(tx,command);}
  assertSalesLifecycleAllowedInTransaction(tx,command){return this.provider.assertSalesLifecycleAllowedInTransaction(tx,command);}
}
