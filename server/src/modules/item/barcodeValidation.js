/**
 * 條碼正規化與 GTIN check digit 驗證。設計說明見
 * docs/items_management/design_spec.md §4.5。
 *
 * 純函式，不碰資料庫——唯一性由 item_sku_barcodes.normalized_barcode 的
 * unique key 保證（見 0017_create_item_sku_barcodes.js），這裡只負責「這個
 * 字串本身合不合法、正規化之後長什麼樣」。
 */
import { gtinInvalid } from "./itemErrors.js";
import { GTIN_LENGTHS, INTERNAL_BARCODE_MAX_LENGTH } from "./itemConstants.js";

const GTIN_TYPES = new Set(Object.keys(GTIN_LENGTHS));

/**
 * GS1 標準 check digit 演算法，對 8／12／13／14 位長度一致適用：從最後一位
 * （check digit 本身）左邊那一位開始，由右至左交替乘 3、1，總和對 10 取模，
 * 10 減去餘數（餘數是 0 時直接用 0）就是應該有的 check digit。
 *
 * 只接受純數字字串，呼叫端負責先確認長度與字元組成。
 */
function computeCheckDigit(digitsWithoutCheckDigit) {
  let sum = 0;
  let multiplier = 3;

  for (let i = digitsWithoutCheckDigit.length - 1; i >= 0; i -= 1) {
    sum += Number(digitsWithoutCheckDigit[i]) * multiplier;
    multiplier = multiplier === 3 ? 1 : 3;
  }

  return (10 - (sum % 10)) % 10;
}

/** 控制字元（C0／C1，含 DEL）——internal barcode 拒絕接受這些。 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER_PATTERN = /[\x00-\x1F\x7F]/;

/**
 * 正規化並驗證一個條碼，回傳正規化後用來比對唯一性的字串
 * （`item_sku_barcodes.normalized_barcode`）。不合法時拋出 `GTIN_INVALID`
 * （§6.11）。
 *
 * @param {string} rawBarcode 使用者輸入的原始顯示值。
 * @param {string} barcodeType `gtin8`／`upca`／`ean13`／`gtin14`／`internal`
 *   其中之一——呼叫端已經用 BARCODE_TYPES 驗證過這是已知種類。
 * @returns {string} 正規化值。
 */
export function normalizeBarcode(rawBarcode, barcodeType) {
  if (GTIN_TYPES.has(barcodeType)) {
    // 只移除空格與連字號，其餘字元原樣檢查——藏在中間的任何非數字都要拒絕，
    // 不能被使用者誤以為「反正會被清掉」。
    const digitsOnly = String(rawBarcode ?? "").replace(/[ -]/g, "");

    if (!/^\d+$/.test(digitsOnly)) {
      throw gtinInvalid(rawBarcode);
    }

    const expectedLength = GTIN_LENGTHS[barcodeType];
    if (digitsOnly.length !== expectedLength) {
      throw gtinInvalid(rawBarcode);
    }

    const body = digitsOnly.slice(0, -1);
    const checkDigit = Number(digitsOnly.slice(-1));
    if (computeCheckDigit(body) !== checkDigit) {
      throw gtinInvalid(rawBarcode);
    }

    return digitsOnly;
  }

  // internal：只 trim 首尾空白、拒絕控制字元、限長度，不要求數字。
  const trimmed = String(rawBarcode ?? "").trim();
  if (trimmed.length === 0 || trimmed.length > INTERNAL_BARCODE_MAX_LENGTH) {
    throw gtinInvalid(rawBarcode);
  }
  if (CONTROL_CHARACTER_PATTERN.test(trimmed)) {
    throw gtinInvalid(rawBarcode);
  }

  return trimmed;
}
