import { createHash } from "node:crypto";
import { salesError } from "./salesErrors.js";

// Call with validated business payload only. Transport claims/request IDs are selected out by the caller.
// Decimal strings and exact Unicode code points are preserved; normalization belongs to domain validation.
export function canonicalSalesPayload(payload) {
  const seen = new Set();
  const canonical = (value) => {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isSafeInteger(value)) return value;
    if (!value || typeof value !== "object" || seen.has(value)) throw salesError("SALES_INPUT_INVALID");
    if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw salesError("SALES_INPUT_INVALID");
    seen.add(value);
    let result;
    if (Array.isArray(value)) {
      result = [];
      for (let index = 0; index < value.length; index++) {
        if (!Object.hasOwn(value, index)) throw salesError("SALES_INPUT_INVALID");
        result.push(canonical(value[index]));
      }
    } else result = Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
    seen.delete(value);
    return result;
  };
  return JSON.stringify(canonical(payload));
}

export function salesPayloadHash(payload) {
  return createHash("sha256").update(canonicalSalesPayload(payload), "utf8").digest("hex");
}
