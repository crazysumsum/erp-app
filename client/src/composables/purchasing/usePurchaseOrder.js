import { onBeforeUnmount, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useSessionStore } from "@/stores/session.js";
import purchasing from "@/services/purchasing.js";

/** 詳情、編輯、列印頁共用：跟 route 同權限讀 PO，舊回應唔蓋新 PO。`keep` 喺重新讀取時留住現有資料，表單唔使 unmount。 */
export function usePurchaseOrder({ onLoad } = {}) {
  const route = useRoute(), session = useSessionStore();
  const document = ref(null), loading = ref(false), error = ref("");
  let controller;
  async function load({ keep = false } = {}) {
    controller?.abort();
    controller = new AbortController();
    const { signal } = controller, id = String(route.params.id);
    error.value = "";
    if (!keep) { document.value = null; loading.value = true; }
    onLoad?.();
    // route param 會 decode：`..%2F` 砌入 API path 會打到第二條 route，所以唔係正整數就唔發。
    if (!/^[1-9]\d*$/u.test(id)) { error.value = "找不到此採購單。"; loading.value = false; return; }
    try {
      const value = await purchasing.getPurchaseOrder(id, { signal });
      if (!signal.aborted) document.value = value;
    } catch (failure) {
      if (!signal.aborted) error.value = failure.message || "載入採購單失敗";
    } finally {
      if (!signal.aborted) loading.value = false;
    }
  }
  watch([() => route.params.id, () => session.user?.id, () => session.permissions.join("|")], () => load(), { immediate: true });
  onBeforeUnmount(() => controller?.abort());
  return { document, loading, error, load };
}
