import { getActiveTransactionIsolation } from "../../services/mysqldatabase/MySqlDatabaseService.js";

export function requireReturnSourceTransaction(tx, isolation) {
  if (tx?.context?.get()?.databaseTransaction !== tx || getActiveTransactionIsolation(tx) !== isolation) {
    throw new TypeError(`Returns source lookup requires an active ${isolation} transaction`);
  }
}

export function returnSourceId(value) {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,15}$/u.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new TypeError("Returns source ID must be a positive decimal string within the safe integer range");
  }
  return value;
}

export function returnSourceIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 5000 || new Set(ids).size !== ids.length) {
    throw new TypeError("Returns source lookup requires a bounded list of distinct IDs");
  }
  return ids.map(returnSourceId);
}
