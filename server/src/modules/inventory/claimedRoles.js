import { inventoryStringHasInvalidCharacters } from "./inventorySafeJson.js";

export function isValidClaimedRoleList(values) {
  if (!Array.isArray(values) || new Set(values).size !== values.length) return false;
  for (const name of values) {
    if (typeof name !== "string" || name.length === 0 || Buffer.byteLength(name, "utf8") > 760 ||
        [...name].length > 190 || inventoryStringHasInvalidCharacters(name)) return false;
  }
  return true;
}
