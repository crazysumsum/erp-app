import { reactive } from "vue";

const UNCERTAIN = ["TIMEOUT", "NETWORK_ERROR", "TRANSACTION_OUTCOME_UNKNOWN", "IDEMPOTENCY_IN_PROGRESS"];

/**
 * Command 嘅 eventId 生命週期（§2.3），按 target key 分開保存。Key 由 consumer 綁定 actor、PO 同 action，所以換 actor／PO
 * 唔會用錯原 intent，亦唔會抹走佢；返嚟同一個 target 仍然可以用原 eventId 確認結果。
 * - 從未未確定：成功或者明確拒絕都清走 intent，下次係新意圖。
 * - 一旦未確定：只有同一原操作成功（server 會 replay 原結果）先解除。之後任何錯誤，包括密碼、權限、裝置、並發、
 *   版本或者陌生 4xx，都證明唔到原交易冇成功，所以保留原 eventId、payload 同未確定狀態。
 * 冇 reset：同一 context 嘅刷新、卸載重建都唔可以默默清走未確定嘅操作。
 * ponytail: intent 只喺 owner component 嘅 memory；owner 卸載（離開頁面、整頁重新整理）就冇。要跨刷新恢復要等 TASK-033 嘅 eventId 查詢。
 */
export function useCommandEvent() {
  const intents = new Map(), uncertainKeys = reactive(new Set());
  async function run(payload, send, key = "") {
    const pending = uncertainKeys.has(key);
    if (!intents.has(key)) intents.set(key, { ...payload, eventId: crypto.randomUUID() });
    try {
      const result = await send(structuredClone(intents.get(key)));
      intents.delete(key);
      uncertainKeys.delete(key);
      return result;
    } catch (error) {
      if (!pending) {
        if (UNCERTAIN.includes(error.code) || error.status >= 500) uncertainKeys.add(key);
        else intents.delete(key);
      }
      throw error;
    }
  }
  const isUncertain = (key = "") => uncertainKeys.has(key);
  /** 未確定時重試會送嘅原 payload（唔含 eventId），畀 consumer 重建後顯示返用家原本輸入。 */
  function pendingPayload(key = "") {
    if (!uncertainKeys.has(key)) return null;
    const { eventId: _eventId, ...payload } = structuredClone(intents.get(key));
    return payload;
  }
  return { run, isUncertain, pendingPayload };
}
