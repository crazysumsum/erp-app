<script>
export const page = {
  name: "items",
  path: "/items",
  title: "商品與 SKU",
  requires: { permissions: ["item.view"] },
  menu: { group: "items", icon: "inventory_2", order: 10 }
};
</script>

<script setup>
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import appConfig from "@config/app.js";
import PageHeader from "@/framework/layout/PageHeader.vue";
import DataTable from "@/framework/ui/DataTable.vue";
import EllipsisCell from "@/framework/ui/EllipsisCell.vue";
import { can } from "@/framework/authorization/can.js";
import itemService from "@/services/item.js";
import { useSessionStore } from "@/stores/session.js";

const session = useSessionStore();
const canManage = computed(() => can(session, { permissions: ["item.mgmt"] }));

const route = useRoute();
const router = useRouter();

const STATUS_LABEL = {
  draft: "草稿",
  active: "啟用",
  inactive: "已停用",
  discontinued: "已停產",
  archived: "已封存"
};
const STATUS_COLOUR = {
  draft: "grey",
  active: "positive",
  inactive: "grey-7",
  discontinued: "warning",
  archived: "warning"
};
const STATUS_FILTER_OPTIONS = [
  { label: "全部", value: null },
  { label: "草稿", value: "draft" },
  { label: "啟用", value: "active" },
  { label: "已停用", value: "inactive" },
  { label: "已停產", value: "discontinued" },
  { label: "已封存", value: "archived" }
];

const VALID_VIEWS = new Set(["item", "sku"]);

/**
 * 全部 URL 狀態淨係喺 mount 嗰陣讀一次，做返初始值——之後 view／filters 嘅
 * 改動由使用者互動驅動，唔會再逆向由 URL 推返嚟（例如撳「重新整理」先會
 * 再讀一次 URL，跟一般 SPA 慣例一致，唔係整條連結變成雙向同步嘅狀態）。
 */
const initialQuery = route.query;
const view = ref(VALID_VIEWS.has(initialQuery.view) ? initialQuery.view : "sku");
const searchText = ref(typeof initialQuery.q === "string" ? initialQuery.q : "");
const statusFilter = ref(typeof initialQuery.status === "string" ? initialQuery.status : null);

function parsedInitialPagination() {
  const page = Number(initialQuery.page);
  return {
    page: Number.isInteger(page) && page > 0 ? page : 1,
    rowsPerPage: appConfig.defaultPageSize,
    rowsNumber: 0,
    sortBy: typeof initialQuery.sortBy === "string" ? initialQuery.sortBy : null,
    descending: initialQuery.descending === "true"
  };
}
const initialPagination = parsedInitialPagination();

const dataTableRef = ref(null);

// 淨係喺呢個 ref 反映「畫面而家實際顯示緊嘅參數」，等 URL 保持同步俾使用者
// 重新整理／分享連結——真正嘅資料由 DataTable 嘅 fetch 負責攞，呢度唔重複
// 一份 loading／rows 狀態。
const currentRequest = ref({
  page: initialPagination.page,
  sortBy: initialPagination.sortBy,
  descending: initialPagination.descending
});

function syncUrl() {
  router.replace({
    query: {
      view: view.value,
      page: currentRequest.value.page,
      sortBy: currentRequest.value.sortBy || undefined,
      descending: String(currentRequest.value.descending),
      q: searchText.value || undefined,
      status: statusFilter.value || undefined
    }
  });
}

function fetchItems({ page, rowsPerPage, sortBy, descending, filter }) {
  currentRequest.value = { page, sortBy, descending };
  syncUrl();
  return itemService.listItems({ page, rowsPerPage, sortBy, descending, filter, status: statusFilter.value });
}

function fetchSkus({ page, rowsPerPage, sortBy, descending, filter }) {
  currentRequest.value = { page, sortBy, descending };
  syncUrl();
  return itemService.listSkus({ page, rowsPerPage, sortBy, descending, filter, status: statusFilter.value });
}

// 撳 view toggle／改 statusFilter 都要令 DataTable 由第一頁重新攞——用
// :key="view" 逼佢喺切換 view 嗰陣整個重新掛載（見下面 template），
// statusFilter 就直接叫 reload()。搜尋本身由 q-input 嘅 debounce prop 處理，
// 唔使呢度另外 debounce。
watch(statusFilter, () => {
  dataTableRef.value?.reload();
});

const itemColumns = [
  { name: "name", label: "商品名稱", field: "name", align: "left", sortable: true },
  { name: "categoryName", label: "分類", field: "categoryName", align: "left" },
  { name: "brandName", label: "品牌", field: "brandName", align: "left" },
  { name: "productType", label: "類型", field: "productType", align: "left" },
  { name: "skuCount", label: "SKU 數", field: "skuCount", align: "right" },
  { name: "status", label: "狀態", field: "status", align: "left" },
  { name: "updatedAt", label: "更新時間", field: "updatedAt", align: "left", sortable: true }
];

const skuColumns = [
  { name: "skuCode", label: "SKU Code", field: "skuCode", align: "left", sortable: true },
  { name: "skuName", label: "SKU 名稱", field: "skuName", align: "left" },
  { name: "itemName", label: "商品", field: "itemName", align: "left" },
  { name: "primaryBarcode", label: "主要條碼", field: "primaryBarcode", align: "left" },
  { name: "baseUomCode", label: "Base 單位", field: "baseUomCode", align: "left" },
  { name: "suggestedRetailPrice", label: "RRP", field: "suggestedRetailPrice", align: "right" },
  { name: "status", label: "狀態", field: "status", align: "left" },
  { name: "updatedAt", label: "更新時間", field: "updatedAt", align: "left", sortable: true }
];

const PRODUCT_TYPE_LABEL = { standard: "一般", variant: "多規格" };

function formatUpdatedAt(epochMs) {
  return new Date(epochMs).toLocaleString("zh-HK", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

const moneyFormatter = new Intl.NumberFormat("en-HK", { minimumFractionDigits: 2, maximumFractionDigits: 4 });

function formatPrice(price) {
  return price ? `HK$${moneyFormatter.format(Number(price.amount))}` : "—";
}
</script>

<template>
  <div>
    <PageHeader>
      <template #actions>
        <q-btn-toggle
          v-model="view"
          toggle-color="primary"
          :options="[
            { label: '商品', value: 'item' },
            { label: 'SKU', value: 'sku' }
          ]"
        />
        <q-btn v-if="canManage" color="primary" unelevated label="新增商品" icon="add" to="/items/new" />
      </template>
    </PageHeader>

    <div class="q-px-md q-pb-md row q-gutter-sm items-center">
      <q-input
        v-model="searchText"
        dense
        outlined
        debounce="300"
        :placeholder="view === 'item' ? '搜尋商品名稱或其 SKU' : '搜尋 SKU Code、條碼或名稱'"
        style="width: 280px"
        @update:model-value="dataTableRef?.reload()"
      >
        <template #prepend><q-icon name="search" /></template>
      </q-input>
      <q-select
        v-model="statusFilter"
        dense
        outlined
        emit-value
        map-options
        :options="STATUS_FILTER_OPTIONS"
        style="width: 160px"
        label="狀態"
      />
    </div>

    <div class="q-px-md q-pb-md">
      <DataTable
        v-if="view === 'item'"
        :key="'item'"
        ref="dataTableRef"
        :fetch="fetchItems"
        :columns="itemColumns"
        :filter="searchText"
        :initial-pagination="initialPagination"
        row-key="id"
      >
        <template #body-cell-categoryName="{ value }">
          <EllipsisCell :text="value ?? '—'" max-width="160px" />
        </template>
        <template #body-cell-productType="{ value }">
          <q-td class="text-left">{{ PRODUCT_TYPE_LABEL[value] ?? value }}</q-td>
        </template>
        <template #body-cell-status="{ value }">
          <q-td class="text-left">
            <q-badge :color="STATUS_COLOUR[value]" :label="STATUS_LABEL[value] ?? value" />
          </q-td>
        </template>
        <template #body-cell-updatedAt="{ value }">
          <q-td class="text-left">{{ formatUpdatedAt(value) }}</q-td>
        </template>
      </DataTable>

      <DataTable
        v-else
        :key="'sku'"
        ref="dataTableRef"
        :fetch="fetchSkus"
        :columns="skuColumns"
        :filter="searchText"
        :initial-pagination="initialPagination"
        row-key="id"
      >
        <template #body-cell-itemName="{ value }">
          <EllipsisCell :text="value" max-width="160px" />
        </template>
        <template #body-cell-primaryBarcode="{ value }">
          <q-td class="text-left">{{ value ?? "—" }}</q-td>
        </template>
        <template #body-cell-suggestedRetailPrice="{ value }">
          <q-td class="text-right">{{ formatPrice(value) }}</q-td>
        </template>
        <template #body-cell-status="{ value }">
          <q-td class="text-left">
            <q-badge :color="STATUS_COLOUR[value]" :label="STATUS_LABEL[value] ?? value" />
          </q-td>
        </template>
        <template #body-cell-updatedAt="{ value }">
          <q-td class="text-left">{{ formatUpdatedAt(value) }}</q-td>
        </template>
      </DataTable>
    </div>
  </div>
</template>
