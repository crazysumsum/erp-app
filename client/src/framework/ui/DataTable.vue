<script setup>
import { onMounted, ref } from "vue";
import appConfig from "@config/app.js";

/**
 * 封裝 QTable 嘅 server-side 模式：接一個 `fetch` function，統一處理分頁／
 * 排序／篩選參數嘅收集，同載入／空／錯誤狀態，令業務頁面唔使逐個自己接
 * 呢啲線。
 *
 * `fetch` 嘅參數形狀跟 QTable 原生 `@request` 事件一致
 * （page/rowsPerPage/sortBy/descending/filter），回傳 `{ rows, rowsNumber }`。
 * 呢個形狀點樣對應去後端實際嘅 query schema（後端而家未有分頁慣例），係
 * service 層（例如 `services/order.js`）嘅工作——DataTable 完全唔理會
 * HTTP 細節，`fetch` 掉出嚟嘅錯誤淨係讀 `.message`。
 */
const props = defineProps({
  fetch: { type: Function, required: true },
  columns: { type: Array, required: true },
  rowKey: { type: String, default: "id" },
  filter: { type: String, default: "" }
});

const rows = ref([]);
const loading = ref(false);
const error = ref(null);
const pagination = ref({
  page: 1,
  rowsPerPage: appConfig.defaultPageSize,
  rowsNumber: 0,
  sortBy: null,
  descending: false
});

async function onRequest({ pagination: requestedPagination, filter: requestedFilter }) {
  loading.value = true;
  error.value = null;

  try {
    const result = await props.fetch({
      page: requestedPagination.page,
      rowsPerPage: requestedPagination.rowsPerPage,
      sortBy: requestedPagination.sortBy,
      descending: requestedPagination.descending,
      filter: requestedFilter
    });

    rows.value = result.rows;
    pagination.value = { ...requestedPagination, rowsNumber: result.rowsNumber };
  } catch (fetchError) {
    error.value = fetchError;
    rows.value = [];
  } finally {
    loading.value = false;
  }
}

// 俾頁面喺新增／編輯／刪除之後手動叫一次，攞返最新一頁資料——唔重設返
// 第一頁，刪除最後一頁最後一行呢類情境先唔會無端端跳走用戶正睇緊嗰頁。
function reload() {
  return onRequest({ pagination: pagination.value, filter: props.filter });
}

defineExpose({ reload });

onMounted(() => onRequest({ pagination: pagination.value, filter: props.filter }));
</script>

<template>
  <div>
    <q-banner v-if="error" class="bg-negative text-white q-mb-md">
      {{ error.message }}
      <template #action>
        <q-btn flat label="重試" aria-label="重試" @click="reload" />
      </template>
    </q-banner>

    <q-table
      v-model:pagination="pagination"
      :rows="rows"
      :columns="columns"
      :row-key="rowKey"
      :loading="loading"
      :filter="filter"
      @request="onRequest"
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
