// These409s follow the same-event domain claim; completed outcomes bypass their checks.
export function isDefinitiveCreateRejection(error,wasUncertain){
 return error?.status===409&&["VERSION_CONFLICT","FULFILLABLE_QUANTITY_CHANGED","RESERVATION_CLAIM_CONFLICT"].includes(error.code)||!wasUncertain&&error?.status===400&&["FULFILLMENT_INPUT_INVALID","FULFILLMENT_QUANTITY_INVALID"].includes(error.code);
}
