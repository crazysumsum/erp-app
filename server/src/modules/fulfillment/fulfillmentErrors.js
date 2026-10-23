import { ApplicationError } from "../../framework/errors/ApplicationError.js";

export const FULFILLMENT_ERROR_STATUS = Object.freeze({
  "FULFILLMENT_INPUT_INVALID": 400,
  "FULFILLMENT_QUANTITY_INVALID": 400,
  "FULFILLMENT_PERMISSION_DENIED": 403,
  "FEFO_OVERRIDE_DENIED": 403,
  "PERMISSION_STALE": 403,
  "FULFILLMENT_NOT_FOUND": 404,
  "SHIPMENT_NOT_FOUND": 404,
  "FULFILLMENT_STATE_CONFLICT": 409,
  "SHIPMENT_STATE_CONFLICT": 409,
  "VERSION_CONFLICT": 409,
  "FULFILLABLE_QUANTITY_CHANGED": 409,
  "RESERVATION_CLAIM_CONFLICT": 409,
  "ALLOCATION_CANDIDATE_CHANGED": 409,
  "ALLOCATION_INSUFFICIENT": 409,
  "PICK_SEQUENCE_REASON_REQUIRED": 409,
  "FEFO_OVERRIDE_REQUIRED": 409,
  "SHORT_PICK_REASON_REQUIRED": 409,
  "PICK_RESULT_INVALID": 409,
  "SHIPPING_ADDRESS_CHANGED": 409,
  "SHIPPING_ADDRESS_UNAVAILABLE": 409,
  "SHIPMENT_ALREADY_EXISTS": 409,
  "SHIPMENT_ALREADY_REVERSED": 409,
  "IDEMPOTENCY_CONFLICT": 409,
  "FULFILLMENT_SOURCE_CONFLICT": 409,
  "CONCURRENT_OPERATION": 409,
  "DOWNSTREAM_MATTER_BLOCKS_REVERSAL": 409,
  "ORIGINAL_BUCKET_UNAVAILABLE": 409,
  "SERIAL_TRACKING_UNSUPPORTED": 409,
  "FULFILLMENT_DEPENDENCY_UNAVAILABLE": 503,
  "DATABASE_TRANSACTION_INDETERMINATE": 503,
  "EXPORT_RESULT_EXPIRED": 410
});

const MESSAGES = Object.freeze({
  "FULFILLMENT_INPUT_INVALID": "履約輸入資料不正確，請檢查後再試",
  "FULFILLMENT_QUANTITY_INVALID": "履約輸入資料不正確，請檢查後再試",
  "FULFILLMENT_PERMISSION_DENIED": "履約權限不足或已變更，請重新登入或聯絡管理員",
  "FEFO_OVERRIDE_DENIED": "履約權限不足或已變更，請重新登入或聯絡管理員",
  "PERMISSION_STALE": "履約權限不足或已變更，請重新登入或聯絡管理員",
  "FULFILLMENT_NOT_FOUND": "找不到指定的履約資料，請重新查詢",
  "SHIPMENT_NOT_FOUND": "找不到指定的履約資料，請重新查詢",
  "FULFILLMENT_STATE_CONFLICT": "履約資料或狀態已變更，請重新載入後再試",
  "SHIPMENT_STATE_CONFLICT": "履約資料或狀態已變更，請重新載入後再試",
  "VERSION_CONFLICT": "履約資料或狀態已變更，請重新載入後再試",
  "FULFILLABLE_QUANTITY_CHANGED": "履約資料或狀態已變更，請重新載入後再試",
  "RESERVATION_CLAIM_CONFLICT": "履約資料或狀態已變更，請重新載入後再試",
  "ALLOCATION_CANDIDATE_CHANGED": "履約資料或狀態已變更，請重新載入後再試",
  "ALLOCATION_INSUFFICIENT": "履約資料或狀態已變更，請重新載入後再試",
  "PICK_SEQUENCE_REASON_REQUIRED": "履約資料或狀態已變更，請重新載入後再試",
  "FEFO_OVERRIDE_REQUIRED": "履約資料或狀態已變更，請重新載入後再試",
  "SHORT_PICK_REASON_REQUIRED": "短揀必須提供原因，請填寫後再試",
  "PICK_RESULT_INVALID": "揀貨數量不符合計劃，請核對每行實際數量",
  "SHIPPING_ADDRESS_CHANGED": "送貨地址已變更，請重新選取地址",
  "SHIPPING_ADDRESS_UNAVAILABLE": "送貨地址目前不可使用，請選取有效地址",
  "SHIPMENT_ALREADY_EXISTS": "履約資料或狀態已變更，請重新載入後再試",
  "SHIPMENT_ALREADY_REVERSED": "這張出貨單已沖銷，請重新載入現有結果",
  "IDEMPOTENCY_CONFLICT": "履約資料或狀態已變更，請重新載入後再試",
  "FULFILLMENT_SOURCE_CONFLICT": "履約資料或狀態已變更，請重新載入後再試",
  "CONCURRENT_OPERATION": "履約資料或狀態已變更，請重新載入後再試",
  "DOWNSTREAM_MATTER_BLOCKS_REVERSAL": "已有下游事項，請先處理相關事項再沖銷",
  "ORIGINAL_BUCKET_UNAVAILABLE": "原庫位目前不能回補，請先處理庫位狀態",
  "SERIAL_TRACKING_UNSUPPORTED": "履約資料或狀態已變更，請重新載入後再試",
  "FULFILLMENT_DEPENDENCY_UNAVAILABLE": "履約服務暫時未能確認結果，請沿用原操作識別碼查詢進度",
  "DATABASE_TRANSACTION_INDETERMINATE": "履約服務暫時未能確認結果，請沿用原操作識別碼查詢進度",
  "EXPORT_RESULT_EXPIRED": "匯出結果已過期，請重新建立匯出工作"
});

export function fulfillmentError(code, details = {}) {
  if (!Object.hasOwn(FULFILLMENT_ERROR_STATUS, code)) throw new TypeError("Unknown Fulfillment error code");
  if (!details || typeof details !== "object" || Array.isArray(details)) throw new TypeError("Invalid Fulfillment error details");
  const publicDetails = {};
  for (const [name, value] of Object.entries(details)) {
    const valid = name === "field" ? typeof value === "string" && /^[a-zA-Z][a-zA-Z0-9.[\]]{0,99}$/.test(value)
      : name === "currentVersion" ? Number.isSafeInteger(value) && value > 0
      : name === "correlationId" ? typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
      : name === "statusUrl" ? typeof value === "string" && /^\/api\/v1\/fulfillment-operations\/by-event\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
      : false;
    if (!valid) throw new TypeError("Invalid Fulfillment error detail");
    publicDetails[name] = value;
  }
  return new ApplicationError(code, { code, statusCode: FULFILLMENT_ERROR_STATUS[code],
    publicMessage: MESSAGES[code], publicDetails: Object.keys(publicDetails).length ? Object.freeze(publicDetails) : undefined });
}
