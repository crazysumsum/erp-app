/**
 * 設計 §2.8 嘅精度同上限。全部同 DB 欄位綁定，所以係 domain constants，唔由環境變數覆寫（§12.1）；
 * 可以由 config 收緊嘅只有 Base quantity 上限（`maxQuantity`），而且唔可以高過 MAX_SAFE_INTEGER。
 */
export const QUANTITY_SCALE = 6; // DECIMAL(20,6)
export const QUANTITY_INTEGER_DIGITS = 14;
export const UNIT_PRICE_SCALE = 4; // DECIMAL(19,4)：0～999999999999999.9999
export const UNIT_PRICE_INTEGER_DIGITS = 15;
export const AMOUNT_INTEGER_DIGITS = 21; // DECIMAL(25,4)
export const MAX_TO_BASE_FACTOR = 1_000_000;
export const MAX_CURRENCY_DECIMAL_PLACES = 4;
