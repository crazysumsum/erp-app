// Test-data planning only. These numbers are not observed database counts or performance results.
export const PHASE4_CAPACITY_BASELINE=Object.freeze({activeHeaders:7300000,externalKeys:25000000,archiveCandidates:300000,archiveBatchSize:500,interactiveUsers:50});
const distribution=[[1,245],[5,695],[20,59],[100,1]];
function ordinal(value){if(!Number.isSafeInteger(value)||value<1)throw new TypeError("Positive safe dataset count required");}
export function lineCountForOrdinal(value){ordinal(value);const offset=(value-1)%1000;return offset<245?1:offset<940?5:offset<999?20:100;}
export function activeDatasetShape(headers){
 ordinal(headers);if(headers>PHASE4_CAPACITY_BASELINE.activeHeaders)throw new TypeError("Dataset planning exceeds the approved Active baseline");
 const blocks=Math.floor(headers/1000),tail=headers%1000,byLineCount={};let start=0,lines=0,cumulative=0,p95Lines;
 const rank=Math.floor((headers*95+99)/100);
 for(const [size,width]of distribution){const count=blocks*width+Math.max(0,Math.min(tail,start+width)-start);byLineCount[size]=count;lines+=size*count;cumulative+=count;if(p95Lines===undefined&&cumulative>=rank)p95Lines=size;start+=width;}
 return {headers,lines,byLineCount,averageLines:lines/headers,p95Lines};
}
