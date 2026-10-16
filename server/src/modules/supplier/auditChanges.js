import { createHash } from "node:crypto";

/**
 * HD-112 A：update 嘅 audit 只記錄有改到嘅欄位，前後值各一份；長自由文字（notes）唔存內容，只存長度同 SHA-256，
 * 所以合法嘅更新唔會因為 detail 超過 8192 bytes 而失敗，又睇得出改咗。冇欄位改到就回 null。
 */
export function changedFieldsDetail(before, after, { digest = ["notes"] } = {}) {
  const changed = Object.keys(after).filter((key) => JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null));
  if (changed.length === 0) return null;
  const shown = (key, value) => (digest.includes(key) ? textDigest(value) : value ?? null);
  return {
    before: Object.fromEntries(changed.map((key) => [key, shown(key, before[key])])),
    after: Object.fromEntries(changed.map((key) => [key, shown(key, after[key])]))
  };
}

export function textDigest(value) {
  const text = String(value ?? "");
  return { length: Array.from(text).length, sha256: createHash("sha256").update(text, "utf8").digest("hex") };
}

/** 用途比較要同一個次序同形狀：DB 行同 request 都轉做按 code 排嘅 `{ purposeCode, isPrimary }`。 */
export function purposeList(rows) {
  return sortedPurposes(rows.map((row) => ({ purposeCode: row.purpose_code, isPrimary: Boolean(Number(row.is_primary)) })));
}

export function sortedPurposes(purposes) {
  return [...purposes].map((purpose) => ({ purposeCode: purpose.purposeCode, isPrimary: Boolean(purpose.isPrimary) }))
    .sort((a, b) => a.purposeCode.localeCompare(b.purposeCode));
}
