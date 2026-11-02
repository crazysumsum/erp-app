import {BaseService} from "../../framework/services/BaseService.js";
import {FulfillmentArchiveParticipant} from "../../modules/fulfillment/FulfillmentArchiveParticipant.js";
export class FulfillmentArchiveService extends BaseService{
 static service=Object.freeze({name:"fulfillmentArchive",lifecycle:"singleton",dependencies:["mysqldatabase","time"],eager:false});
 #participant;
 constructor(options){super(options);this.#participant=new FulfillmentArchiveParticipant({database:this.services.require("mysqldatabase"),time:this.services.require("time"),authorizeArchive:async(tx,scope)=>{const jobs=await this.services.resolve("salesJobs");return typeof jobs.authorizeArchiveInTransaction==="function"&&await jobs.authorizeArchiveInTransaction(tx,scope)===true;}});}
 prepareOrderInTransaction(tx,command){return this.#participant.prepareOrderInTransaction(tx,command);}
 archiveOrderInTransaction(tx,command){return this.#participant.archiveOrderInTransaction(tx,command);}
}
