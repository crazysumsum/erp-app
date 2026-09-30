import { salesError } from "./salesErrors.js";

const jobs = { UPLOADED: ["VALIDATING"], VALIDATING: ["READY", "FAILED"], READY: ["QUEUED", "CANCELLED"],
  QUEUED: ["PROCESSING", "CANCELLED"], PROCESSING: ["COMPLETED", "PARTIAL_SUCCESS", "FAILED"] };
const intake = { RECEIVED: ["VALIDATING"], VALIDATING: ["VALID", "INVALID", "DUPLICATE"], VALID: ["QUEUED"],
  QUEUED: ["PROCESSING"], PROCESSING: ["SUCCEEDED", "FAILED"] };

function transition(table, from, to) {
  if (!Object.hasOwn(table, from) || !table[from].includes(to)) throw salesError("SALES_STATE_CONFLICT");
  return to;
}
export function transitionImportJob(from, to) { return transition(jobs, from, to); }
export function transitionIntakeOrder(from, to) { return transition(intake, from, to); }
