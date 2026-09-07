<script setup>
import { computed, onMounted, ref } from "vue";
import appConfig from "@config/app.js";

/**
 * 封裝 QTable，兩種用法共用同一套分頁／欄寬／空狀態設定，等成個 app 淨係得
 * 一個地方要調（例如「每頁筆數」揀項、有冇「全部」呢個選擇）——之前
 * RolesPage 自己攞一份 raw `<q-table>`，冇跟呢度嘅 `rows-per-page-options`，
 * 結果用戶揀「全部」嗰陣，用戶管理唔會出事但角色管理會（見果次修 bug 嘅
 * 討論）。以後新表格一律經呢個組件，先唔會再有第二個地方漏咗同一個設定。
 *
 *   1. **伺服器分頁**（Users／AuditLogs／DeviceApprovals／Profile 裝置清單）：
 *      傳 `fetch`，形狀跟 QTable 原生 `@request` 事件一致
 *      （page/rowsPerPage/sortBy/descending/filter），回傳 `{ rows, rowsNumber }`。
 *      DataTable 統一處理分頁／排序／篩選參數嘅收集，同載入／錯誤狀態。
 *   2. **客戶端分頁**（例如角色管理：清單本身唔大，一次過攞晒落嚟，分頁／
 *      排序純粹喺瀏覽器度做）：唔傳 `fetch`，改傳 `rows`（已經攞好嘅完整
 *      陣列）。無 `@request` 監聽——QTable 見到冇人接呢個 event，就會自己
 *      喺瀏覽器度做晒分頁／排序／篩選，DataTable 唔使自己執手尾。
 *
 * 兩者揀一個：`fetch` 有值就用伺服器模式，冇就用客戶端模式，`rows` 由呼叫
 * 端自己保證有傳。
 */
const props = defineProps({
  fetch: { type: Function, default: null },
  rows: { type: Array, default: () => [] },
  columns: { type: Array, required: true },
  rowKey: { type: String, default: "id" },
  filter: { type: String, default: "" },
  // 客戶端模式先用得著——伺服器模式嘅 loading 由 DataTable 自己喺 onRequest
  // 期間管理，呼叫端唔使亦唔應該傳呢個。
  loading: { type: Boolean, default: false },
  // 窄螢幕（或欄位多）令表格要橫向捲動嗰陣，最後一欄（通常係操作按鈕）會
  // 跟住捲走，用戶未必知道仲有嘢喺右邊——見 theme.css 嘅
  // .q-table--sticky-actions：釘住最後一欄唔畀佢捲走。
  stickyActions: { type: Boolean, default: false },
  // 淨係伺服器模式先有意義：等頁面可以由 URL query 還原返「用戶之前揭緊
  // 第幾頁、點樣排序」，唔使個 QTable 顯示嘅頁碼同實際攞緊嘅資料唔一致
  // （見 ItemsPage.vue）。冇傳嘅話行為同之前一模一樣——只係將預設值嘅來源
  // 由呢個組件內部改做呼叫端可以覆寫，唔改動任何現有呼叫端嘅行為。
  initialPagination: { type: Object, default: null }
});

const isServerMode = computed(() => props.fetch !== null);
const requestListeners = computed(() => (isServerMode.value ? { request: onRequest } : {}));
const displayRows = computed(() => (isServerMode.value ? fetchedRows.value : props.rows));
const displayLoading = computed(() => (isServerMode.value ? fetchLoading.value : props.loading));

const fetchedRows = ref([]);
const fetchLoading = ref(false);
const error = ref(null);
const pagination = ref(
  props.initialPagination ?? {
    page: 1,
    rowsPerPage: appConfig.defaultPageSize,
    rowsNumber: 0,
    sortBy: null,
    descending: false
  }
);

async function onRequest({ pagination: requestedPagination, filter: requestedFilter }) {
  fetchLoading.value = true;
  error.value = null;

  try {
    const result = await props.fetch({
      page: requestedPagination.page,
      rowsPerPage: requestedPagination.rowsPerPage,
      sortBy: requestedPagination.sortBy,
      descending: requestedPagination.descending,
      filter: requestedFilter
    });

    fetchedRows.value = result.rows;
    pagination.value = { ...requestedPagination, rowsNumber: result.rowsNumber };
  } catch (fetchError) {
    error.value = fetchError;
    fetchedRows.value = [];
  } finally {
    fetchLoading.value = false;
  }
}

// 俾頁面喺新增／編輯／刪除之後手動叫一次，攞返最新一頁資料——唔重設返
// 第一頁，刪除最後一頁最後一行呢類情境先唔會無端端跳走用戶正睇緊嗰頁。
// 淨係伺服器模式先有嘢做:客戶端模式嘅資料本身就係呼叫端傳落嚟嘅 `rows`
// prop，改咗個來源陣列，Vue 嘅 reactivity 已經自動反映，唔使呼叫 reload()。
function reload() {
  return isServerMode.value ? onRequest({ pagination: pagination.value, filter: props.filter }) : undefined;
}

defineExpose({ reload });

onMounted(() => {
  if (isServerMode.value) {
    onRequest({ pagination: pagination.value, filter: props.filter });
  }
});
</script>

<template>
  <!-- aria-busy：揭頁/排序/篩選嗰陣 QTable 自己會顯示 loading bar，但冇
       講低螢幕閱讀器「呢個區域而家喺度更新緊」——加喺呢個包住成個表格嘅
       div，唔加喺 QTable 本身，係因為唔想賭 Quasar 會唔會將呢個 attr
       原樣傳落去佢自己嘅 root 元素。 -->
  <div :aria-busy="displayLoading">
    <q-banner v-if="error" class="bg-negative text-white q-mb-md">
      {{ error.message }}
      <template #action>
        <q-btn flat label="重試" aria-label="重試" @click="reload" />
      </template>
    </q-banner>

    <q-table
      v-model:pagination="pagination"
      :rows="displayRows"
      :columns="columns"
      :row-key="rowKey"
      :loading="displayLoading"
      :filter="filter"
      :rows-per-page-options="appConfig.pageSizeOptions"
      :class="{ 'q-table--sticky-actions': stickyActions }"
      v-on="requestListeners"
    >
      <!--
        將 DataTable 收到嘅所有 slot（例如 body-cell-actions、
        body-cell-<欄位名>）原樣轉發俾內部嘅 QTable——頁面要自訂儲存格
        render（操作按鈕、格式化數值）就靠呢啲 slot，DataTable 唔可以
        淨係得返自己嗰個 #no-data 就算。
      -->
      <template v-for="(_, slotName) in $slots" #[slotName]="slotProps" :key="slotName">
        <slot :name="slotName" v-bind="slotProps" />
      </template>

      <template v-if="!$slots['no-data']" #no-data>
        <div class="full-width text-center text-grey-7 q-pa-lg">冇資料</div>
      </template>
    </q-table>
  </div>
</template>
