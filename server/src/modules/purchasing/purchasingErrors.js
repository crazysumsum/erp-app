import { ApplicationError } from "../../framework/errors/ApplicationError.js";

/** 設計 §5.7 嘅穩定公開錯誤碼；之後嘅 Task 用到先加，唔預先填晒成張表。 */
export const PURCHASING_ERROR_STATUS = Object.freeze({
  PURCHASING_INPUT_INVALID: 400,
  PURCHASING_QUANTITY_INVALID: 400,
  UOM_CONVERSION_INVALID: 400,
  UNIT_PRICE_INVALID: 400
});

export function purchasingError(code, { field } = {}) {
  if (!Object.hasOwn(PURCHASING_ERROR_STATUS, code)) throw new TypeError(`Unknown Purchasing error code: ${code}`);
  return new ApplicationError(code, {
    code,
    statusCode: PURCHASING_ERROR_STATUS[code],
    publicMessage: "採購資料不正確，請檢查輸入",
    publicDetails: field ? { field } : undefined
  });
}
