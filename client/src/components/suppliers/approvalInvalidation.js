// 設計 §7.4（DEF-044、HD-139 A）：待審批時改 approval-significant 資料之前要講明會令原申請失效，
// 改完伺服器回 approvalInvalidated: true 就要講明已經失效。詳情頁同識別資料面板共用同一套字眼。
export const PENDING_EDIT_WARNING = "此供應商正在審批中，修改 Code、名稱、顯示名稱、幣別、付款條件或識別資料會令原申請失效";
export const INVALIDATED_NOTICE = "原審批申請已失效，供應商回到草稿，需要重新提交審批";

export function withInvalidation(message, response) {
  return response?.approvalInvalidated ? `${message}。${INVALIDATED_NOTICE}` : message;
}
