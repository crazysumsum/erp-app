/**
 * 呢個測試環境嘅 jsdom 冇提供可用嘅 `localStorage`（vitest 嘅 populateGlobal
 * 冇複製呢個 key，見 HttpClient.test.js 嘅「HttpClient 預設值」describe block
 * 已經用緊同一個做法）。要測真正嘅讀寫（tokenStorage、session store）就要自己
 * 裝一個落 globalThis。
 */
export function installFakeLocalStorage() {
  const store = new Map();

  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear()
  };

  return globalThis.localStorage;
}
