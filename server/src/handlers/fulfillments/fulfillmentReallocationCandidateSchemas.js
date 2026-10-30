import {FULFILLMENT_CANDIDATE_RESPONSE} from "./fulfillmentCandidateSchemas.js";
export const FULFILLMENT_REALLOCATION_CANDIDATE_RESPONSE=structuredClone(FULFILLMENT_CANDIDATE_RESPONSE);
const candidate=FULFILLMENT_REALLOCATION_CANDIDATE_RESPONSE.properties.demands.items.properties.candidates.items;
const positive=candidate.properties.freeQuantity,quantity=candidate.properties.recommendedQuantity;
delete candidate.properties.freeQuantity;
candidate.required=candidate.required.filter(key=>key!=="freeQuantity").concat(["physicalFreeQuantity","ownReleaseCredit","availableAfterOwnRelease"]);
Object.assign(candidate.properties,{physicalFreeQuantity:quantity,ownReleaseCredit:quantity,availableAfterOwnRelease:positive});
