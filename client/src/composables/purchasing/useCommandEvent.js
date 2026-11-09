import { computed, ref } from "vue";

const UNCERTAIN = ["TIMEOUT", "NETWORK_ERROR", "TRANSACTION_OUTCOME_UNKNOWN", "IDEMPOTENCY_IN_PROGRESS"];

/**
 * Command 嘅 eventId 生命週期（§2.3），一個 key 一個 record。要放喺穩定嘅 owner（頁面），唔好放喺會被 v-if 卸載嘅 child。
 * Key 由 owner 綁 actor、PO 同目標（審批要連 approval ID）；`meta.action` 係呢個 record 嘅動作，同一 key 唔准換動作。
 * - 一個 key 同一時間只得一個 in-flight，亦唔准換動作：違反就 COMMAND_PENDING，唔發 HTTP。
 * - 從未未確定：成功或者明確拒絕都結算走 record，下次係新意圖。
 * - 一旦未確定：只有同一 record 成功（server replay 原結果）先解除；之後任何錯誤都證明唔到原交易失敗，保留原 eventId、payload 同 meta。
 * - 只結算自己 call 開始時嘅同一個 record，睇結算當下嘅未確定狀態。
 * 冇自動重試，冇 reset。ponytail: record 只喺 owner 嘅 memory；owner 卸載或者整頁重新整理就冇，要等 TASK-033 嘅 eventId 查詢。
 */
export function useCommandEvent() {
  // Plain Map：record 要 structuredClone，reactive proxy clone 唔到；讀取者先讀 `changes` 建立依賴，record 一變就跟住更新。
  // meta 用 JSON 複製，因為 owner 可能傳 reactive 嘅畫面快照。
  const records = new Map(), changes = ref(0);
  const touch = () => { changes.value += 1; };
  async function run(payload, send, key = "", meta = {}) {
    let record = records.get(key);
    if (record && (record.inflight || record.meta.action !== meta.action)) {
      throw Object.assign(new Error("同一操作仍在處理或結果尚未確認，請先確認原操作。"), { code: "COMMAND_PENDING" });
    }
    if (!record) {
      record = { body: { ...payload, eventId: crypto.randomUUID() }, meta: JSON.parse(JSON.stringify(meta)), uncertain: false, inflight: false };
      records.set(key, record);
    }
    record.inflight = true;
    touch();
    try {
      const result = await send(structuredClone(record.body));
      if (records.get(key) === record) records.delete(key);
      return result;
    } catch (error) {
      if (records.get(key) === record && !record.uncertain) {
        if (UNCERTAIN.includes(error.code) || error.status >= 500) record.uncertain = true;
        else records.delete(key);
      }
      throw error;
    } finally {
      record.inflight = false;
      touch();
    }
  }
  const isUncertain = (key = "") => changes.value >= 0 && Boolean(records.get(key)?.uncertain);
  const isBusy = (key = "") => changes.value >= 0 && Boolean(records.get(key)?.inflight);
  /** 現存 record（in-flight 或者未確定）嘅原 payload（唔含 eventId）同 meta，畀 owner 綁住可見 state 同用原內容重試。 */
  function current(key = "") {
    if (changes.value < 0) return null;
    const record = records.get(key);
    if (!record) return null;
    const { eventId: _eventId, ...payload } = structuredClone(record.body);
    return { key, payload, meta: structuredClone(record.meta), uncertain: record.uncertain, inflight: record.inflight };
  }
  const pending = (key = "") => { const record = current(key); return record?.uncertain ? record : null; };
  // 一定要先讀 changes：Map 初始係空，唔讀就冇依賴，computed 會永遠 cache 住空 array。
  const uncertainRecords = computed(() => {
    void changes.value;
    return [...records.keys()].map((key) => pending(key)).filter(Boolean);
  });
  return { run, isUncertain, isBusy, current, pending, uncertainRecords };
}
