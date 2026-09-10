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
import { promptPassword, promptReason } from "@/framework/ui/confirm.js";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";
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

// --- 批量狀態操作（Phase 3） -------------------------------------------------
//
// 勾選 1–100 筆進入批量狀態操作（design_spec §7.3）。targetType 跟住 view
// 走：Item 同 SKU 各自嘅批量請求唔會混埋。切 view 或者重新整理列表都要清空
// 選取，避免帶住上一個 view 揀落嘅 row 送去後端。

const selectedRows = ref([]);
watch(view, () => {
  selectedRows.value = [];
});

const BULK_ACTION_LABEL = { activate: "啟用", deactivate: "停用", discontinue: "停產", archive: "封存", restore: "恢復" };
// 同伺服器端 `ItemAdminService.#applyBulkStatusTarget()` 用緊嗰組
// fromStatuses 對應（見 bulkChangeStatus() 的說明）——呢度純粹用嚟預先
// 喺客戶端過濾「呢個 action 係咪對成個已選集合都合法」，唔係最終判斷；
// 真正嘅驗證同以前一樣喺伺服器做，呢度得個「唔使白行一round」嘅作用。
const BULK_FROM_STATUSES = {
  item: {
    activate: ["draft", "inactive", "active"],
    deactivate: ["active"],
    discontinue: ["active", "inactive"],
    archive: ["draft", "inactive", "discontinued"],
    restore: ["archived"]
  },
  sku: {
    activate: ["draft", "inactive"],
    deactivate: ["active"],
    discontinue: ["active", "inactive"],
    archive: ["draft", "inactive", "discontinued"],
    restore: ["archived"]
  }
};

const availableBulkActions = computed(() => {
  if (selectedRows.value.length === 0) {
    return [];
  }
  const fromStatuses = BULK_FROM_STATUSES[view.value];
  return Object.keys(BULK_ACTION_LABEL).filter((action) =>
    selectedRows.value.every((row) => fromStatuses[action].includes(row.status))
  );
});

const showBulkDialog = ref(false);
const bulkAction = ref(null);
const bulkSubmitting = ref(false);

function openBulkDialog() {
  bulkAction.value = availableBulkActions.value[0] ?? null;
  showBulkDialog.value = true;
}

async function submitBulkAction() {
  if (!bulkAction.value) {
    return;
  }

  const outcome = await promptPassword({
    title: "批量狀態操作",
    message: `對 ${selectedRows.value.length} 筆${view.value === "item" ? "商品" : "SKU"}執行「${
      BULK_ACTION_LABEL[bulkAction.value]
    }」？全部成功先會套用，任何一筆失敗都唔會有任何改動。`,
    okLabel: "確認執行",
    requireReason: true
  });
  if (outcome === null) {
    return;
  }

  bulkSubmitting.value = true;
  try {
    await itemService.bulkChangeStatus({
      targetType: view.value,
      action: bulkAction.value,
      targets: selectedRows.value.map((row) => ({ id: row.id, version: row.version })),
      ...outcome
    });
    notifySuccess(`已完成批量${BULK_ACTION_LABEL[bulkAction.value]}（${selectedRows.value.length} 筆）`);
    showBulkDialog.value = false;
    selectedRows.value = [];
    dataTableRef.value?.reload();
  } catch (error) {
    const issues = error.details?.issues;
    if (Array.isArray(issues) && issues.length > 0) {
      notifyError(`${issues.length} 筆未能通過驗證，沒有任何資料被更改：${issues.map((issue) => issue.message).join("；")}`);
    } else {
      notifyError(error.message || "批量操作失敗");
    }
  } finally {
    bulkSubmitting.value = false;
  }
}

const itemColumns = [
  { name: "name", label: "商品名稱", field: "name", align: "left", sortable: true },
  { name: "categoryName", label: "分類", field: "categoryName", align: "left" },
  { name: "brandName", label: "品牌", field: "brandName", align: "left" },
  { name: "productType", label: "類型", field: "productType", align: "left" },
  { name: "skuCount", label: "SKU 數", field: "skuCount", align: "right" },
  { name: "status", label: "狀態", field: "status", align: "left" },
  { name: "updatedAt", label: "更新時間", field: "updatedAt", align: "left", sortable: true },
  { name: "actions", label: "", field: "id", align: "right" }
];

const skuColumns = [
  { name: "skuCode", label: "SKU Code", field: "skuCode", align: "left", sortable: true },
  { name: "skuName", label: "SKU 名稱", field: "skuName", align: "left" },
  { name: "itemName", label: "商品", field: "itemName", align: "left" },
  { name: "primaryBarcode", label: "主要條碼", field: "primaryBarcode", align: "left" },
  { name: "baseUomCode", label: "Base 單位", field: "baseUomCode", align: "left" },
  { name: "suggestedRetailPrice", label: "RRP", field: "suggestedRetailPrice", align: "right" },
  { name: "status", label: "狀態", field: "status", align: "left" },
  { name: "updatedAt", label: "更新時間", field: "updatedAt", align: "left", sortable: true },
  { name: "actions", label: "", field: "id", align: "right" }
];

// --- SKU row 嘅生命週期動作 -------------------------------------------------
//
// 呢個列表淨係得 SKU_SUMMARY_SCHEMA 嘅欄位，冇父 Item 而家嘅狀態，所以「啟用」
// （後端要求父 Item 已經 Active）呢度唔提供——冇資料判斷邊個 SKU 而家真係
// 啟用得到，貿然顯示個「啟用」掣只會俾一堆冇意義嘅後端拒絕。要啟用請去
// SkuDetailPage（已經載入齊父 Item 狀態）。停用／停產／封存／恢復呢四個淨係
// 睇 SKU 自己嘅狀態，喺呢個列表已經有齊資料，可以照做。

async function skuRowAction(row, action, successVerb) {
  try {
    const updated = await action();
    notifySuccess(`SKU「${updated.skuCode}」${successVerb}`);
    dataTableRef.value?.reload();
  } catch (error) {
    notifyError(error.message || "操作失敗");
  }
}

async function deactivateSkuRow(row) {
  const reason = await promptReason({ title: "停用 SKU", message: `停用「${row.skuCode}」？`, okLabel: "停用" });
  if (reason === null) {
    return;
  }
  await skuRowAction(row, () => itemService.deactivateSku(row.id, { reason, version: row.version }), "已停用");
}

async function discontinueSkuRow(row) {
  const outcome = await promptPassword({
    title: "停產 SKU",
    message: `停產「${row.skuCode}」？強制停止採購，這個操作不可以復原。`,
    okLabel: "停產",
    requireReason: true
  });
  if (outcome === null) {
    return;
  }
  await skuRowAction(row, () => itemService.discontinueSku(row.id, { ...outcome, version: row.version }), "已停產");
}

async function archiveSkuRow(row) {
  const outcome = await promptPassword({
    title: "封存 SKU",
    message: `封存「${row.skuCode}」？這個操作不可以復原。`,
    okLabel: "封存",
    requireReason: true
  });
  if (outcome === null) {
    return;
  }
  await skuRowAction(row, () => itemService.archiveSku(row.id, { ...outcome, version: row.version }), "已封存");
}

async function restoreSkuRow(row) {
  const outcome = await promptPassword({
    title: "恢復 SKU",
    message: `從封存恢復「${row.skuCode}」？`,
    okLabel: "恢復",
    requireReason: true
  });
  if (outcome === null) {
    return;
  }
  await skuRowAction(row, () => itemService.restoreSku(row.id, { ...outcome, version: row.version }), "已從封存恢復");
}

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

    <div v-if="canManage && selectedRows.length > 0" class="q-px-md q-pb-md row items-center q-gutter-sm">
      <div>已選取 {{ selectedRows.length }} 筆</div>
      <q-btn flat label="批量狀態操作" @click="openBulkDialog" />
      <q-btn flat label="清除選取" @click="selectedRows = []" />
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
        :selection="canManage ? 'multiple' : 'none'"
        :selected="selectedRows"
        @update:selected="(value) => (selectedRows = value)"
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
        <template #body-cell-actions="{ row }">
          <q-td class="text-right">
            <q-btn flat dense icon="visibility" :aria-label="`「${row.name}」的詳情`" :to="`/items/${row.id}`" />
          </q-td>
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
        :selection="canManage ? 'multiple' : 'none'"
        :selected="selectedRows"
        @update:selected="(value) => (selectedRows = value)"
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
        <template #body-cell-actions="{ row }">
          <q-td class="text-right">
            <q-btn
              flat
              dense
              icon="visibility"
              :aria-label="`「${row.skuCode}」的詳情`"
              :to="`/items/${row.itemId}/skus/${row.id}`"
            />
            <q-btn
              v-if="canManage"
              flat
              dense
              icon="more_vert"
              :aria-label="`「${row.skuCode}」的操作`"
            >
              <q-menu>
                <q-list>
                  <q-item v-if="row.status === 'active'" v-close-popup clickable @click="deactivateSkuRow(row)">
                    <q-item-section>停用</q-item-section>
                  </q-item>
                  <q-item
                    v-if="row.status === 'active' || row.status === 'inactive'"
                    v-close-popup
                    clickable
                    @click="discontinueSkuRow(row)"
                  >
                    <q-item-section>停產</q-item-section>
                  </q-item>
                  <q-item
                    v-if="['draft', 'inactive', 'discontinued'].includes(row.status)"
                    v-close-popup
                    clickable
                    @click="archiveSkuRow(row)"
                  >
                    <q-item-section>封存</q-item-section>
                  </q-item>
                  <q-item v-if="row.status === 'archived'" v-close-popup clickable @click="restoreSkuRow(row)">
                    <q-item-section>從封存恢復</q-item-section>
                  </q-item>
                </q-list>
              </q-menu>
            </q-btn>
          </q-td>
        </template>
      </DataTable>
    </div>

    <!-- 批量狀態操作 -->
    <q-dialog v-model="showBulkDialog" persistent>
      <q-card style="min-width: 420px">
        <q-card-section>
          <h2 class="text-h6 q-ma-none">批量狀態操作</h2>
        </q-card-section>
        <q-card-section class="q-pt-none q-gutter-md">
          <div>已選取 {{ selectedRows.length }} 筆{{ view === "item" ? "商品" : "SKU" }}。</div>

          <q-banner v-if="availableBulkActions.length === 0" class="bg-warning text-dark">
            所選項目目前狀態不一致，沒有任何操作可以一次套用到全部——全有全無：任何一筆失敗都不會有任何改動。請縮窄選取範圍。
          </q-banner>

          <q-select
            v-else
            v-model="bulkAction"
            outlined
            emit-value
            map-options
            label="操作"
            :options="availableBulkActions.map((action) => ({ label: BULK_ACTION_LABEL[action], value: action }))"
          />

          <div class="row justify-end q-gutter-sm">
            <q-btn flat label="取消" :disable="bulkSubmitting" @click="showBulkDialog = false" />
            <q-btn
              v-if="availableBulkActions.length > 0"
              color="primary"
              unelevated
              label="確認執行"
              :loading="bulkSubmitting"
              @click="submitBulkAction"
            />
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>
  </div>
</template>
