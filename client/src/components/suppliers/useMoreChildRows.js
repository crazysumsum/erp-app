import { computed, ref, watch } from "vue";
import { notifyError } from "@/framework/ui/notify.js";

// 同 server SupplierAdminService 嘅 CHILD_DETAIL_LIMIT 一致：詳情最多帶 100 筆，排序同分頁 API 一樣。
export const DETAIL_CHILD_LIMIT = 100;

/**
 * 詳情讀滿 100 筆地址／聯絡人即係可能仲有；用分頁 API 由第 2 頁（每頁 100）逐頁接落去（HD-107 G5）。
 * 詳情重新載入（新增／編輯之後）就由頭再嚟；重嚟之前已經發出嘅請求返嚟就丟咗佢（REV-095 L-3）。
 * 兩頁之間有人改資料可能令同一筆再出現，所以按 id 去重。
 */
export function useMoreChildRows(initialRows, fetchPage) {
  const extra = ref([]);
  const total = ref(null);
  const loading = ref(false);
  let nextPage = 2;
  let generation = 0;

  watch(initialRows, () => {
    generation += 1;
    extra.value = [];
    total.value = null;
    nextPage = 2;
    loading.value = false;
  });

  const rows = computed(() => [...initialRows(), ...extra.value]);
  const hasMore = computed(() => (total.value === null
    ? initialRows().length === DETAIL_CHILD_LIMIT
    : nextPage <= Math.ceil(total.value / DETAIL_CHILD_LIMIT)));

  async function loadMore() {
    if (loading.value) return;
    loading.value = true;
    const started = generation;
    try {
      const page = await fetchPage({ page: nextPage, pageSize: DETAIL_CHILD_LIMIT });
      if (started !== generation) return;
      const seen = new Set(rows.value.map((row) => row.id));
      extra.value = [...extra.value, ...page.items.filter((row) => !seen.has(row.id))];
      total.value = page.total;
      nextPage += 1;
    } catch (error) {
      if (started === generation) notifyError(error.message || "載入更多失敗");
    } finally {
      if (started === generation) loading.value = false;
    }
  }

  return { rows, total, hasMore, loading, loadMore };
}
