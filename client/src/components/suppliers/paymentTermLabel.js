/**
 * 付款條件嘅顯示文字（DEF-038、DEF-040）：「code — name」，已停用加「（已停用）」；冇設定講「未設定」；
 * 有 ID 但伺服器冇回名稱就「—」，唔顯示內部 ID。
 */
export function paymentTermLabel(term, id) {
  if (term) return `${term.code} — ${term.name}${term.status === "INACTIVE" ? "（已停用）" : ""}`;
  return id === null || id === undefined ? "未設定" : "—";
}
