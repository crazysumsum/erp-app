import { onUnmounted } from "vue";

/**
 * 頁面／元件卸載時自動 abort 未完成請求，避免 race 同已卸載元件更新狀態。
 * 用法：httpClient.get(path, { signal: useRequestAbort() })
 */
export function useRequestAbort() {
  const controller = new AbortController();
  onUnmounted(() => controller.abort());
  return controller.signal;
}
