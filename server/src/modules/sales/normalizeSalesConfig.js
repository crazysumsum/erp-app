import defaults from "../../../config/sales.js";
import { IMPORT_MAX_BYTES, IMPORT_MAX_ROWS, IMPORT_MAX_ORDERS, EXPORT_MAX_ROWS } from "./salesConstants.js";

export function normalizeSalesConfig(source, { requestTimeoutMs } = {}) {
  if (!source || typeof source !== "object" || Array.isArray(source)) throw new TypeError("Sales config must be an object");
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs <= 0) throw new TypeError("Sales config requires the actual HTTP timeout");
  if (Object.keys(source).some((key) => !Object.hasOwn(defaults, key))) throw new Error("Unknown Sales deployment setting");
  const config = { ...defaults, ...source };
  if (!Array.isArray(config.importChannelCodes) || config.importChannelCodes.length > 100 ||
      new Set(config.importChannelCodes).size !== config.importChannelCodes.length || [...config.importChannelCodes].some(code =>
        typeof code !== "string" || code.length > 50 || !/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/u.test(code))) throw new Error("Sales import channel catalogue is invalid");
  config.importChannelCodes = Object.freeze([...config.importChannelCodes]);
  for (const [key, value] of Object.entries(config)) {
    if (key === "importChannelCodes") continue;
    if (!Number.isSafeInteger(value) || value < (key === "archiveHourHkt" ? 0 : 1)) throw new Error(`Sales config ${key} must be a valid integer`);
    if (key.endsWith("Ms") && value > 2147483647) throw new Error(`Sales config ${key} exceeds the Node timer limit`);
  }
  if (config.importMaxBytes !== IMPORT_MAX_BYTES || config.importMaxRows > IMPORT_MAX_ROWS ||
      config.importMaxOrders > IMPORT_MAX_ORDERS || config.exportMaxRows > EXPORT_MAX_ROWS ||
      config.importWorkerBatchSize > config.importMaxOrders || config.archiveDayOfMonth > 31 || config.archiveHourHkt > 23) {
    throw new Error("Sales deployment capacity exceeds the supported domain limits");
  }
  if (config.importFileRetentionDays < 90 || config.intakePayloadRetentionDays < 90 || config.exportFileRetentionDays < 7) {
    throw new Error("Sales file retention must preserve the approved minimum periods");
  }
  if (config.manualConfirmationWaitMs >= requestTimeoutMs || config.confirmationLeaseMs <= config.transactionTimeoutMs ||
      config.confirmationLeaseMs <= config.manualConfirmationWaitMs) throw new Error("Sales timeout relationships are invalid");
  return Object.freeze(config);
}
