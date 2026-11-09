import { ref } from "vue";

const UNCERTAIN = ["TIMEOUT", "NETWORK_ERROR", "TRANSACTION_OUTCOME_UNKNOWN", "IDEMPOTENCY_IN_PROGRESS"];

/**
 * 一個 command 嘅 eventId 生命週期（§2.3）：結果未確定就保留原 payload 同 eventId，重試送返一模一樣嘅嘢；
 * 有明確結果先清走，下次先係新意圖。eventId 查詢要等 TASK-033，所以暫時靠 server replay 攞結果。
 * ponytail: intent 只放 memory，重新整理就冇；form 有 beforeunload 擋住，TASK-033 有查詢先值得放 sessionStorage。
 */
export function useCommandEvent() {
  const uncertain = ref(false);
  let intent = null;
  async function run(payload, send) {
    intent ??= { ...payload, eventId: crypto.randomUUID() };
    try {
      const result = await send(structuredClone(intent));
      intent = null;
      uncertain.value = false;
      return result;
    } catch (error) {
      // 結果未確定之後重試，密碼重新驗證被拒（403 PASSWORD_INVALID）只係今次認證失敗，證明唔到原交易冇成功：
      // 保留原 intent（eventId 同 payload）同未確定狀態，等用家用正確密碼重試同一操作。
      if (uncertain.value && error.code === "PASSWORD_INVALID") throw error;
      uncertain.value = UNCERTAIN.includes(error.code) || error.status >= 500;
      if (!uncertain.value) intent = null;
      throw error;
    }
  }
  function reset() { intent = null; uncertain.value = false; }
  return { uncertain, run, reset };
}
