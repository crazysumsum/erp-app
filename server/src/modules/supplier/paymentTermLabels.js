/**
 * 將付款條件 ID 變成使用者睇得明嘅 `{ id, code, name, status }`（DEF-038、DEF-040）。經 Business Master provider 讀，
 * 唔直接讀佢嘅表：先讀一次 Active 清單，唔喺入面嘅（已停用，或者唔喺頭 100 個）先逐個讀 history。
 * ponytail: 一頁通常得幾個唔同嘅條款；如果好多已停用條款同時出現，每個多一次主鍵讀取，要批量就要 Business Master 加 by-ids 讀取。
 */
export async function paymentTermsById(businessMaster, ids) {
  const wanted = [...new Set(ids.filter((id) => id !== null && id !== undefined).map(Number))];
  const terms = new Map();
  if (wanted.length === 0) return terms;
  for (const term of await businessMaster.listPaymentTerms({ page: 1, pageSize: 100 })) {
    if (wanted.includes(Number(term.id))) terms.set(Number(term.id), term);
  }
  for (const id of wanted.filter((value) => !terms.has(value))) {
    const term = await businessMaster.getPaymentTermHistory(id);
    if (term) terms.set(id, term);
  }
  return new Map([...terms].map(([id, term]) => [id, { id, code: term.code, name: term.name, status: term.status }]));
}
