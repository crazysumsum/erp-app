import { ApplicationError } from "../../framework/errors/ApplicationError.js";

export const SALES_ERROR_STATUS = Object.freeze({
  SALES_INPUT_INVALID: 400,
  SALES_QUANTITY_INVALID: 400,
  SALES_UOM_CONVERSION_INVALID: 400,
  SALES_PRICE_INVALID: 400,
  SALES_DATE_INVALID: 400,
  SALES_ORDER_NOT_FOUND: 404,
  SALES_QUOTATION_NOT_FOUND: 404,
  SALES_IMPORT_NOT_FOUND: 404,
  SALES_EXPORT_NOT_FOUND: 404,
  SALES_STATE_CONFLICT: 409,
  QUOTATION_STATE_CONFLICT: 409,
  VERSION_CONFLICT: 409,
  SALES_EVENT_CONFLICT: 409,
  SALES_SEQUENCE_EXHAUSTED: 409,
  IDEMPOTENCY_CONFLICT: 409,
  SALES_CONFIRMATION_IN_PROGRESS: 409,
  QUOTATION_ALREADY_CONVERTED: 409,
  CUSTOMER_NOT_SALEABLE: 409,
  CUSTOMER_CREDIT_ON_HOLD: 409,
  SKU_NOT_SALEABLE: 409,
  SKU_UOM_INVALID: 409,
  WAREHOUSE_INVALID: 409,
  ORDER_ALREADY_FULFILLED: 409,
  RESERVATION_RELEASE_FAILED: 409,
  OPEN_FULFILLMENT_EXISTS: 409,
  EXTERNAL_ORDER_DUPLICATE: 409,
  SALES_SOURCE_HASH_COLLISION: 409,
  CONCURRENT_OPERATION: 409,
  SALES_IMPORT_ORDER_INVALID: 422,
  SALES_IMPORT_FILE_INVALID: 400,
  SALES_IMPORT_VERSION_UNSUPPORTED: 400,
  SALES_IMPORT_RESULT_EXPIRED: 410,
  SALES_EXPORT_EXPIRED: 410,
  ARCHIVE_NOT_ELIGIBLE: 409,
  ARCHIVE_DATA_CONFLICT: 409,
  SALES_DEPENDENCY_UNAVAILABLE: 503,
  INVENTORY_CONTRACT_MISMATCH: 503,
  TRANSACTION_OUTCOME_UNKNOWN: 500,
  SALES_LINE_MERGE_CONFLICT: 409,
});

export function salesError(code, { field, currentVersion } = {}) {
  if (!Object.hasOwn(SALES_ERROR_STATUS, code)) throw new TypeError("Unknown Sales error code");
  if (field !== undefined && (typeof field !== "string" || !/^[a-zA-Z][a-zA-Z0-9.[\]]{0,99}$/.test(field))) throw new TypeError("Invalid Sales error field");
  if (currentVersion !== undefined && (code !== "VERSION_CONFLICT" || !Number.isSafeInteger(currentVersion) || currentVersion < 1)) throw new TypeError("Invalid Sales conflict version");
  return new ApplicationError(code, { code, statusCode: SALES_ERROR_STATUS[code],
    publicMessage: "銷售操作未能完成，請檢查輸入或重新讀取資料", publicDetails: currentVersion !== undefined ? { currentVersion } : field ? { field } : undefined });
}
