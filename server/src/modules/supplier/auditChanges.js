import { createHash } from "node:crypto";

// 同 SupplierAuditLogService 嘅 detail 上限一致。
const MAX_DETAIL_BYTES = 8192;

/**
 * HD-112 A：update 嘅 audit 只記錄有改到嘅欄位，前後值各一份；長自由文字（notes）唔存內容，記 { changed, length, sha256 }。
 * 冇欄位改到就回 null。如果咁樣仍然超過 detail 上限（例如每個欄位都係 4-byte 字元填到最長），所有改咗嘅文字欄位都改記
 * digest：合法嘅更新唔可以因為 audit 太大而失敗（REV-099 F-1）。代碼、ID 同用途清單照記原值。
 */
export function changedFieldsDetail(before, after) {
  const changed = Object.keys(after).filter((key) => JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null));
  if (changed.length === 0) return null;
  const build = (shown) => ({
    before: Object.fromEntries(changed.map((key) => [key, shown(key, before[key])])),
    after: Object.fromEntries(changed.map((key) => [key, shown(key, after[key])]))
  });
  const detail = build((key, value) => (key === "notes" ? textDigest(value) : value ?? null));
  if (Buffer.byteLength(JSON.stringify(detail), "utf8") <= MAX_DETAIL_BYTES) return detail;
  return build((key, value) => (key === "notes" || typeof value === "string" ? textDigest(value) : value ?? null));
}

export function textDigest(value) {
  const text = String(value ?? "");
  return { changed: true, length: Array.from(text).length, sha256: createHash("sha256").update(text, "utf8").digest("hex") };
}

/** 用途比較要同一個次序同形狀：DB 行同 request 都轉做按 code 排嘅 `{ purposeCode, isPrimary }`。 */
export function purposeList(rows) {
  return sortedPurposes(rows.map((row) => ({ purposeCode: row.purpose_code, isPrimary: Boolean(Number(row.is_primary)) })));
}

export function sortedPurposes(purposes) {
  return [...purposes].map((purpose) => ({ purposeCode: purpose.purposeCode, isPrimary: Boolean(purpose.isPrimary) }))
    .sort((a, b) => a.purposeCode.localeCompare(b.purposeCode));
}
