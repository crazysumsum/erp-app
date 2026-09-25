import { ApplicationError } from "../../framework/errors/ApplicationError.js";

const definitions = [
  ["INVENTORY_INPUT_INVALID", 400, "庫存輸入資料不正確"],
  ["INVENTORY_QUANTITY_INVALID", 400, "庫存數量不正確"],
  ["WAREHOUSE_INVALID", 400, "倉庫目前不可使用"],
  ["BIN_INVALID", 400, "庫位目前不可使用"],
  ["BIN_WAREHOUSE_MISMATCH", 400, "庫位不屬於指定倉庫"],
  ["SKU_NOT_INVENTORY_TRACKED", 400, "這個 SKU 沒有啟用庫存追蹤"],
  ["SERIAL_TRACKING_UNSUPPORTED", 400, "目前不支援序號追蹤 SKU"],
  ["LOT_REQUIRED", 400, "這個 SKU 必須提供批次資料"],
  ["EXPIRY_REQUIRED", 400, "這個 SKU 必須提供有效日期"],
  ["LOT_DATA_CONFLICT", 409, "批次資料與現有記錄不一致"],
  ["WAREHOUSE_CODE_TAKEN", 409, "倉庫代碼已被使用"],
  ["BIN_CODE_TAKEN", 409, "庫位代碼已被使用"],
  ["WAREHOUSE_IN_USE", 409, "倉庫仍在使用中"],
  ["BIN_IN_USE", 409, "庫位仍在使用中"],
  ["INSUFFICIENT_STOCK", 409, "庫存數量不足"],
  ["INSUFFICIENT_ATP", 409, "可承諾庫存不足"],
  ["ALLOCATION_INSUFFICIENT", 409, "已分配庫存不足"],
  ["RESERVATION_STATE_CONFLICT", 409, "預留狀態已改變"],
  ["ALLOCATION_STATE_CONFLICT", 409, "分配狀態已改變"],
  ["VERSION_CONFLICT", 409, "資料已被修改，請重新載入後再試"],
  ["CONCURRENT_OPERATION", 409, "同一庫存正在處理其他操作，請重試"],
  ["INVENTORY_SOURCE_CONFLICT", 409, "相同來源已用於不同庫存操作"],
  ["IDEMPOTENCY_CONFLICT", 409, "相同請求識別碼已用於不同內容"],
  ["PICK_SEQUENCE_REASON_REQUIRED", 409, "偏離建議揀貨次序時必須提供原因"],
  ["FEFO_OVERRIDE_REQUIRED", 409, "偏離先到期先出需要專門權限及原因"],
  ["FEFO_OVERRIDE_DENIED", 403, "沒有偏離先到期先出的權限"],
  ["PERMISSION_STALE", 403, "權限已變更，請重新登入後再試"],
  ["LOT_EXPIRED", 409, "批次已過期"],
  ["LOT_MINIMUM_LIFE_FAILED", 409, "批次剩餘有效期不足"],
  ["STOCK_STATUS_INELIGIBLE", 409, "庫存狀態不符合這個操作"],
  ["BIN_LOCKED_BY_STOCKTAKE", 409, "庫位正在盤點，暫時不能異動"],
  ["TRANSFER_STATE_CONFLICT", 409, "調撥狀態已改變"],
  ["TRANSFER_PARTIAL_NOT_SUPPORTED", 409, "調撥不支援部分收發"],
  ["STOCKTAKE_STATE_CONFLICT", 409, "盤點狀態已改變"],
  ["STOCKTAKE_INCOMPLETE", 409, "盤點尚未完成"],
  ["STOCKTAKE_SNAPSHOT_MISMATCH", 409, "盤點快照與目前庫存不一致"],
  ["MOVEMENT_ALREADY_REVERSED", 409, "庫存異動已經沖銷"],
  ["MOVEMENT_TYPE_NOT_REVERSIBLE", 409, "這類庫存異動不可直接沖銷"],
  ["REVERSAL_NOT_ALLOWED", 409, "目前庫存狀態不允許沖銷"],
  ["OPENING_PRECHECK_STALE", 409, "期初庫存預檢已過期，請重新預檢"],
  ["OPENING_STATE_CONFLICT", 409, "期初庫存工作狀態已改變"],
  ["OPENING_CLOSED", 403, "系統上線後不可再匯入期初庫存"],
  ["INVENTORY_RESOURCE_NOT_FOUND", 404, "找不到指定的庫存資料"],
  ["OPENING_RESULT_EXPIRED", 410, "期初庫存結果檔案已清理"],
  ["INVENTORY_DEPENDENCY_UNAVAILABLE", 503, "庫存服務所需資料暫時無法使用"]
];

export const INVENTORY_ERROR_DEFINITIONS = Object.freeze(Object.fromEntries(
  definitions.map(([code, statusCode, publicMessage]) => [code, Object.freeze({ statusCode, publicMessage })])
));

export function inventoryError(code, details) {
  const definition = INVENTORY_ERROR_DEFINITIONS[code];
  if (!definition) throw new TypeError(`Unknown Inventory error code: ${code}`);
  return new ApplicationError(definition.publicMessage, {
    code,
    statusCode: definition.statusCode,
    publicCode: code,
    publicMessage: definition.publicMessage,
    details,
    publicDetails: details
  });
}
