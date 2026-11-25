import { ApplicationError } from "../../framework/errors/ApplicationError.js";

const errors = {
  REFUND_INPUT_INVALID: [400, "退款資料不正確"],
  REFUND_NOT_FOUND: [404, "找不到退款記錄"],
  REFUND_CREDIT_NOT_FOUND: [404, "找不到來源貸項單"],
  REFUND_CREDIT_STATE_CONFLICT: [409, "來源貸項單必須已確認"],
  REFUND_STATE_CONFLICT: [409, "退款目前的狀態不允許此操作"],
  REFUND_EXCEEDS_CREDIT: [409, "退款金額超過貸項可用額"],
  REFUND_BALANCE_CONFLICT: [409, "退款與貸項的餘額或來源不相符"],
  VERSION_CONFLICT: [409, "退款已被更新，請重新載入"],
  CONCURRENT_OPERATION: [409, "退款資料正被更新，請重試"]
};

export function refundError(code, details) {
  const [statusCode, message] = errors[code];
  return new ApplicationError(message, { code, statusCode, publicDetails: details });
}
