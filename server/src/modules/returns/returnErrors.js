import { ApplicationError } from "../../framework/errors/ApplicationError.js";

const errors = {
  RETURN_INPUT_INVALID: [400, "退貨資料不正確"],
  RETURN_NOT_FOUND: [404, "找不到退貨單"],
  RETURN_SOURCE_NOT_FOUND: [404, "找不到原出貨或收貨單"],
  RETURN_SOURCE_CONFLICT: [409, "原出貨或收貨狀態不允許退貨"],
  RETURN_QUANTITY_EXCEEDED: [409, "退貨量超過原單剩餘可退數量"],
  RETURN_BIN_NOT_AVAILABLE: [409, "退貨庫位必須使用有效庫位"],
  CUSTOMER_RETURN_WAREHOUSE_MISMATCH: [409, "客戶退貨只可收回原出貨倉"],
  SUPPLIER_RETURN_WAREHOUSE_MISMATCH: [409, "退回供應商只可由原收貨倉出庫"],
  RETURN_STATE_CONFLICT: [409, "退貨單目前狀態不允許此操作"],
  VERSION_CONFLICT: [409, "退貨單已更新，請重新載入"],
  RETURN_EVENT_CONFLICT: [409, "同一事件識別碼已用於不同操作"],
  CONCURRENT_OPERATION: [409, "有其他操作正在更新退貨來源，請重試"],
  RETURN_INVENTORY_UNAVAILABLE: [503, "目前無法確認庫存過帳結果，請用同一事件重試"],
  TRANSACTION_OUTCOME_UNKNOWN: [503, "未能確定退貨操作結果，請用同一事件重試"]
};

export function returnError(code, details) {
  const [statusCode, message] = errors[code];
  return new ApplicationError(message, { code, statusCode, publicDetails: details });
}
