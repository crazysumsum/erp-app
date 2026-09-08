/**
 * Variant SKU 嘅規格組合 signature。設計說明見
 * docs/items_management/design_spec.md §4.4。
 *
 * 純函式，不碰資料庫——「attributeId／optionId 是否真係存在」、「呢個屬性
 * 是咪 is_variant」、「呢個 option 是咪屬於呢個屬性」呢類要查表先知嘅嘢，
 * 由 `ItemAdminService.createItem()` 負責，唔喺呢度做。
 *
 * Canonical form／分隔符號／Unicode normalization 呢幾個設計文件冇明文寫死
 * 嘅細節（§4.4 淨係話「規則固定」），已經同用戶確認：
 * - 條目之間用 `&` 連接（同 URL query string 嗰種 key=value 序列化方式一致）。
 * - 文字類型值用 NFC 正規化（Unicode 官方建議嘅一般文字比較／儲存預設形式，
 *   同呢個專案 Node 環境 `String.prototype.normalize()` 冇填參數時嘅預設一
 *   致）。
 * 呢兩個一旦用過就唔可以隨便改：改咗會令現存 SKU 嘅 signature 同重新計算嘅
 * 結果對唔上，等於一次性令「同 Item 內唔可以有重複組合」呢條防線失效。
 */
import { createHash } from "node:crypto";

/**
 * 將一個屬性值轉做 signature 用嘅正規化字串。呼叫端已經用屬性嘅 `data_type`
 * 判斷用邊個分支，呢度唔重新驗證 `dataType` 是否已知之外嘅任何業務規則
 * （例如 single_option 係咪真係得返一個 optionId、decimal 是否喺允許範圍
 * 內——嗰啲驗證發生喺呼叫端）。
 *
 * @param {string} dataType `text`／`long_text`／`decimal`／`boolean`／`date`／`single_option`。
 * @param {*} value single_option 用 optionId（number）；text／long_text 用
 *   字串；decimal 用字串或 number；boolean 用 boolean；date 用 epoch 毫秒
 *   （number）。
 * @returns {string}
 */
export function typedValueToCanonicalString(dataType, value) {
  switch (dataType) {
    case "single_option":
      return String(value);
    case "text":
    case "long_text":
      return String(value).trim();
    case "decimal":
      // DECIMAL(20,6)：固定 6 位小數，避免同一個數值因為輸入形式唔同
      // （"1"、"1.0"、"1.000000"）算出唔同嘅 signature。
      return Number(value).toFixed(6);
    case "boolean":
      return value ? "true" : "false";
    case "date":
      return String(value);
    default:
      throw new TypeError(`Unknown attribute data type: "${dataType}"`);
  }
}

/**
 * 計算一個 SKU 嘅 variant signature：按 `attributeId` 排序、正規化做
 * `attributeId=typedValue`、用 `&` 連接、NFC normalize 之後 SHA-256。
 *
 * 呢個 hash 淨係用嚟做唯一性判斷；可讀嘅規格描述永遠要由 `entries` 本身
 * （或者資料庫嘅 attribute value rows）組出嚟，唔可以逆向由 hash 還原
 * （design_spec §4.4：「這個 hash 只用於唯一性，不代替實際 attribute
 * rows」）。
 *
 * @param {Array<{attributeId: number, typedValue: string}>} entries 已經用
 *   `typedValueToCanonicalString()` 轉好嘅值；呼叫端已經確認晒對應嘅
 *   attributeId／optionId 存在。
 * @returns {string} 64 字元嘅 hex signature。
 */
export function computeVariantSignature(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new TypeError("computeVariantSignature requires at least one entry");
  }

  const seenAttributeIds = new Set();
  for (const entry of entries) {
    if (seenAttributeIds.has(entry.attributeId)) {
      throw new TypeError(`Duplicate attributeId ${entry.attributeId} in variant values`);
    }
    seenAttributeIds.add(entry.attributeId);
  }

  const canonical = [...entries]
    .sort((a, b) => a.attributeId - b.attributeId)
    .map((entry) => `${entry.attributeId}=${entry.typedValue}`)
    .join("&")
    .normalize("NFC");

  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
