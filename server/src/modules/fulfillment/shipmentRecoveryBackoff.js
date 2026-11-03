export const SHIPMENT_RECOVERY_MAX_ATTEMPTS=10;
export const SHIPMENT_RECOVERY_MAX_DELAY_MS=300000;

// Technical attempts include the original Phase A intent. Never use this count to infer business failure.
export function shipmentRecoveryDelay(attemptCount){
 if(!Number.isSafeInteger(attemptCount)||attemptCount<1||attemptCount>4294967295)throw new TypeError("Actual Shipment technical attempt count required");
 const random=Math.random();if(!Number.isFinite(random)||random<0||random>=1)throw new TypeError("Bounded Shipment retry jitter required");
 const base=1000*2**Math.min(attemptCount-1,9);
 return Math.min(SHIPMENT_RECOVERY_MAX_DELAY_MS,base+Math.floor(base*0.25*random));
}
