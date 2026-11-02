const MAX_GAP=330000,MIN_SAMPLE_GAP=270000,SPAN=600000,DAY=86400000;
const time=value=>Number.isSafeInteger(value)&&value>=0;
const hash=value=>typeof value==="string"&&/^[a-f0-9]{64}$/u.test(value);
export const SALES_OBSERVATION_PROTOCOL="1";
export function advanceSalesOperationalSignal(previous,{atMs,status,identityHash}){
 if(!time(atMs)||!["POSITIVE","CLEAR","UNKNOWN"].includes(status)||!hash(identityHash))throw new TypeError("Invalid Sales operational observation");
 const fresh=()=>({status,identityHash,firstSeenAt:status==="POSITIVE"?atMs:null,lastSeenAt:atMs,lastSampleAt:status==="POSITIVE"?atMs:null,samples:status==="POSITIVE"?1:0,active:false,sampledSpanMs:0});
 if(!previous||status!=="POSITIVE"||previous.status!=="POSITIVE"||previous.identityHash!==identityHash||atMs<previous.lastSeenAt||atMs-previous.lastSeenAt>MAX_GAP)return fresh();
 if(![previous.firstSeenAt,previous.lastSeenAt,previous.lastSampleAt].every(time)||!Number.isSafeInteger(previous.samples)||previous.samples<1||previous.firstSeenAt>previous.lastSampleAt||previous.lastSampleAt>previous.lastSeenAt)throw new TypeError("Invalid persisted Sales operational observation");
 const qualified=atMs-previous.lastSampleAt>=MIN_SAMPLE_GAP,lastSampleAt=qualified?atMs:previous.lastSampleAt,samples=qualified?Math.min(previous.samples+1,1000000000):previous.samples,sampledSpanMs=lastSampleAt-previous.firstSeenAt;
 return {...previous,lastSeenAt:atMs,lastSampleAt,samples,sampledSpanMs,active:samples>=3&&sampledSpanMs>=SPAN};
}
export function salesBackorderHistory({nowMs,activation,protocolVersion,baselineHash,pending,lastSuccessAt}){
 if(!time(nowMs))throw new TypeError("Invalid Sales history observation clock");
 const lastSuccessAgeMs=time(lastSuccessAt)&&lastSuccessAt<=nowMs?nowMs-lastSuccessAt:null;
 const trustworthy=activation&&activation.version===protocolVersion&&hash(baselineHash)&&activation.baselineHash===baselineHash&&typeof activation.epoch==="string"&&activation.epoch.length>0&&time(activation.atMs)&&activation.atMs<=nowMs&&Number.isSafeInteger(pending)&&pending===0&&(lastSuccessAt===null||lastSuccessAgeMs!==null);
 const historyComplete=Boolean(trustworthy&&nowMs-activation.atMs>=DAY),noSuccessOver24h=Boolean(historyComplete&&(lastSuccessAt===null?nowMs-activation.atMs>DAY:lastSuccessAgeMs>DAY));
 return {coverage:historyComplete?"COMPLETE_ACTIVATED_WINDOW":"UNKNOWN",historyComplete,noSuccessOver24h,lastSuccessAgeMs,windowMs:DAY};
}
export function salesOperationalAlerts(observation){
 const alerts=[],add=(event,context)=>alerts.push({event:"sales.alert."+event,level:"warn",context});
 if(observation.fifo.active>0)add("backorder_stock_present_sampled",{count:observation.fifo.active,sampleSpanMs:SPAN,requiredSamples:3});
 if(observation.providerUnknown.active)add("archive_provider_unknown_sampled",{sampleSpanMs:SPAN,requiredSamples:3});
 if(observation.fifo.coverage!=="COMPLETE")add("backorder_stock_observation_incomplete",{observedScopes:observation.fifo.observedScopes});
 return alerts;
}
const availabilityFields="availableToPromiseBaseQuantity,effectiveMinimumSaleLifeDays,eligibleOnHandBaseQuantity,observedAtMs,reasonCodes,reservedBaseQuantity,skuId,sourceLineId,status,warehouseId";
const availabilityReasons=new Set(["WAREHOUSE_UNAVAILABLE","ITEM_PROFILE_UNAVAILABLE","STOCK_CONTROL_UNAVAILABLE","DEPENDENCY_UNAVAILABLE","SKU_UNSUPPORTED","NO_ELIGIBLE_ATP"]);
export function validSalesAvailabilityObservation(value,head,atMs){
 if(!value||Object.keys(value).sort().join(",")!==availabilityFields||value.warehouseId!==Number(head.warehouse_id)||value.skuId!==Number(head.sku_id)||value.sourceLineId!==Number(head.sales_order_line_id)||value.observedAtMs!==atMs||!["AVAILABLE","NO_STOCK","UNKNOWN"].includes(value.status)||!Number.isSafeInteger(value.effectiveMinimumSaleLifeDays)||value.effectiveMinimumSaleLifeDays<Number(head.minimum_sale_life_days_snapshot)||value.effectiveMinimumSaleLifeDays>36500||!Array.isArray(value.reasonCodes)||value.reasonCodes.length>4||new Set(value.reasonCodes).size!==value.reasonCodes.length||value.reasonCodes.some(code=>!availabilityReasons.has(code)))return false;
 const quantities=[value.eligibleOnHandBaseQuantity,value.reservedBaseQuantity,value.availableToPromiseBaseQuantity];
 if(value.status==="UNKNOWN")return quantities.every(n=>n===null)&&value.reasonCodes.length>0;
 if(!quantities.every(n=>typeof n==="string"&&/^(0|[1-9][0-9]*)$/u.test(n)&&BigInt(n)<=9007199254740991n))return false;
 const [eligible,reserved,atp]=quantities.map(BigInt);return atp===(eligible>reserved?eligible-reserved:0n)&&(value.status==="AVAILABLE"?atp>0n&&value.reasonCodes.length===0:atp===0n);
}
