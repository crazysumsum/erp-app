<script>
export const page = {
  name: "inventory-warehouses",
  path: "/inventory/warehouses",
  title: "倉庫與庫位",
  requires: { permissions: ["inventory.view"] },
  menu: { group: "inventory", icon: "warehouse", order: 10 }
};
</script>

<script setup>
import { computed, nextTick, ref, watch } from "vue";
import appConfig from "@config/app.js";
import { can } from "@/framework/authorization/can.js";
import PageHeader from "@/framework/layout/PageHeader.vue";
import DataTable from "@/framework/ui/DataTable.vue";
import FormPanel from "@/framework/ui/FormPanel.vue";
import { promptPassword } from "@/framework/ui/confirm.js";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";
import inventoryService from "@/services/inventory.js";
import { useSessionStore } from "@/stores/session.js";

const session = useSessionStore();
const canManage = computed(() => can(session, { permissions: ["inventory.mgmt"] }));
const warehouseTable = ref(null);
const binTable = ref(null);
const warehouseSearch = ref("");
const warehouseStatus = ref(null);
const binSearch = ref("");
const binStatus = ref(null);
const lockStatus = ref(null);
const selectedWarehouse = ref(null);
const selectedBin = ref(null);
const detailLoading = ref(false);
const detailError = ref("");

const statusOptions = [
  { label: "全部", value: null },
  { label: "啟用", value: "ACTIVE" },
  { label: "已停用", value: "INACTIVE" }
];
const lockOptions = [
  { label: "全部", value: null },
  { label: "已鎖定", value: "LOCKED" },
  { label: "未鎖定", value: "UNLOCKED" }
];
const initialPagination = { page: 1, rowsPerPage: appConfig.defaultPageSize, rowsNumber: 0, sortBy: "code", descending: false };
const warehouseColumns = [
  { name: "code", label: "代碼", field: "code", align: "left", sortable: true },
  { name: "name", label: "名稱", field: "name", align: "left", sortable: true },
  { name: "status", label: "狀態", field: "status", align: "left", sortable: true },
  { name: "actions", label: "操作", field: "id", align: "right" }
];
const binColumns = [
  { name: "code", label: "代碼", field: "code", align: "left", sortable: true },
  { name: "name", label: "名稱", field: "name", align: "left", sortable: true },
  { name: "locked", label: "鎖定", field: "locked", align: "left" },
  { name: "status", label: "狀態", field: "status", align: "left", sortable: true },
  { name: "actions", label: "操作", field: "id", align: "right" }
];

function fetchWarehouses(request) {
  return inventoryService.listWarehouses({ ...request, status: warehouseStatus.value });
}
function fetchBins(request) {
  return inventoryService.listBins(selectedWarehouse.value.id, { ...request, status: binStatus.value, lockStatus: lockStatus.value });
}
watch(warehouseStatus, () => warehouseTable.value?.reload());
watch([binStatus, lockStatus], () => binTable.value?.reload());

async function selectWarehouse(row) {
  const replacingSelection = selectedWarehouse.value !== null;
  selectedBin.value = null;
  detailLoading.value = true;
  detailError.value = "";
  try {
    selectedWarehouse.value = await inventoryService.getWarehouse(row.id);
    await nextTick();
    if (replacingSelection) await binTable.value?.reload();
  } catch (error) {
    detailError.value = error.message || "無法載入倉庫詳情";
  } finally {
    detailLoading.value = false;
  }
}
async function selectBin(row) {
  detailLoading.value = true;
  detailError.value = "";
  try {
    selectedBin.value = await inventoryService.getBin(selectedWarehouse.value.id, row.id);
  } catch (error) {
    detailError.value = error.message || "無法載入庫位詳情";
  } finally {
    detailLoading.value = false;
  }
}
function backToWarehouses() {
  selectedWarehouse.value = null;
  selectedBin.value = null;
}

const warehouseBlockerLabels = {
  currentOnHand: "現有庫存", activeReservations: "有效預留", activeAllocations: "有效分配",
  openTransfers: "未完成調撥", activeStocktakes: "進行中盤點", activeBinLocks: "已鎖定庫位"
};
const binBlockerLabels = {
  currentOnHand: "現有庫存", activeAllocations: "有效分配", openTransfers: "未完成調撥",
  activeStocktakeLocks: "盤點鎖定"
};
function blockerText(detail, labels) {
  if (!detail?.blockers) return "未能取得阻擋資料";
  return Object.entries(labels).map(([key, label]) => `${label}：${detail.blockers[key] ?? 0}`).join("；");
}

const showForm = ref(false);
const formEntity = ref("warehouse");
const formMode = ref("create");
const editing = ref(null);
const formError = ref("");
const warehouseForm = ref({ warehouseCode: "", warehouseName: "", address: "", description: "" });
const binForm = ref({ binCode: "", binName: "", description: "" });
const formTitle = computed(() => `${formMode.value === "create" ? "新增" : "編輯"}${formEntity.value === "warehouse" ? "倉庫" : "庫位"}`);

function openWarehouseForm(row = null) {
  formEntity.value = "warehouse";
  formMode.value = row ? "edit" : "create";
  editing.value = row;
  formError.value = "";
  warehouseForm.value = row
    ? { warehouseCode: row.code, warehouseName: row.name, address: row.address ?? "", description: row.description ?? "" }
    : { warehouseCode: "", warehouseName: "", address: "", description: "" };
  showForm.value = true;
}
function openBinForm(row = null) {
  formEntity.value = "bin";
  formMode.value = row ? "edit" : "create";
  editing.value = row;
  formError.value = "";
  binForm.value = row
    ? { binCode: row.code, binName: row.name ?? "", description: row.description ?? "" }
    : { binCode: "", binName: "", description: "" };
  showForm.value = true;
}
function normalizeFormError(error) {
  const field = error.code === "WAREHOUSE_CODE_TAKEN" ? "warehouseCode" : error.code === "BIN_CODE_TAKEN" ? "binCode" : null;
  if (field && !error.details) error.details = [{ location: "body", path: `/${field}`, message: error.message }];
}
async function submitForm() {
  formError.value = "";
  try {
    if (formEntity.value === "warehouse") {
      if (formMode.value === "create") return await inventoryService.createWarehouse(warehouseForm.value);
      return await inventoryService.updateWarehouse(editing.value.id, { ...warehouseForm.value, version: editing.value.version });
    }
    if (formMode.value === "create") return await inventoryService.createBin(selectedWarehouse.value.id, binForm.value);
    return await inventoryService.updateBin(selectedWarehouse.value.id, editing.value.id, { ...binForm.value, version: editing.value.version });
  } catch (error) {
    normalizeFormError(error);
    if (error.code === "VERSION_CONFLICT") {
      formError.value = "資料已被其他人修改；最新資料已重新載入，輸入內容仍保留，請核對後再提交。";
      if (formEntity.value === "warehouse") {
        await warehouseTable.value?.reload();
        if (selectedWarehouse.value?.id === editing.value.id) await selectWarehouse(editing.value);
      } else {
        await binTable.value?.reload();
        if (selectedBin.value?.id === editing.value.id) await selectBin(editing.value);
      }
    }
    throw error;
  }
}
async function afterSubmit(result) {
  showForm.value = false;
  notifySuccess(`${formTitle.value}成功`);
  if (formEntity.value === "warehouse") {
    await warehouseTable.value?.reload();
    if (selectedWarehouse.value?.id === result.id) await selectWarehouse(result);
  } else {
    await binTable.value?.reload();
    if (selectedBin.value?.id === result.id) await selectBin(result);
  }
}

async function warehouseLifecycle(row, action) {
  try {
    const fresh = await inventoryService.getWarehouse(row.id);
    const labels = { deactivate: "停用", reactivate: "重新啟用", delete: "永久刪除" };
    const credentials = await promptPassword({
      title: `${labels[action]}倉庫`,
      message: `${blockerText(fresh, warehouseBlockerLabels)}。提交時系統會再次檢查；確定要${labels[action]}「${fresh.code} — ${fresh.name}」？`,
      okLabel: labels[action], requireReason: true
    });
    if (!credentials) return;
    await inventoryService[`${action}Warehouse`](fresh.id, { ...credentials, version: fresh.version });
    notifySuccess(`倉庫「${fresh.code}」已${labels[action]}`);
    if (action === "delete") backToWarehouses();
    else if (selectedWarehouse.value?.id === fresh.id) await selectWarehouse(fresh);
    await warehouseTable.value?.reload();
  } catch (error) {
    notifyError(error.message || "操作失敗");
  }
}
async function binLifecycle(row, action) {
  try {
    const fresh = await inventoryService.getBin(selectedWarehouse.value.id, row.id);
    const labels = { deactivate: "停用", reactivate: "重新啟用", delete: "永久刪除" };
    const credentials = await promptPassword({
      title: `${labels[action]}庫位`,
      message: `${blockerText(fresh, binBlockerLabels)}。提交時系統會再次檢查；確定要${labels[action]}「${fresh.code}」？`,
      okLabel: labels[action], requireReason: true
    });
    if (!credentials) return;
    await inventoryService[`${action}Bin`](selectedWarehouse.value.id, fresh.id, { ...credentials, version: fresh.version });
    notifySuccess(`庫位「${fresh.code}」已${labels[action]}`);
    selectedBin.value = null;
    await selectWarehouse(selectedWarehouse.value);
  } catch (error) {
    notifyError(error.message || "操作失敗");
  }
}
</script>

<template>
  <div>
    <PageHeader subtitle="維護倉庫、庫位、使用狀態與目前阻擋摘要。">
      <template #actions><q-btn v-if="canManage" color="primary" unelevated icon="add" label="新增倉庫" @click="openWarehouseForm()" /></template>
    </PageHeader>

    <q-banner v-if="detailError" role="alert" class="bg-negative text-white q-mx-md q-mb-md">{{ detailError }}</q-banner>
    <div class="inventory-master-detail q-px-md q-pb-md" :aria-busy="detailLoading">
      <section class="warehouse-panel" :class="{ 'has-mobile-selection': selectedWarehouse }" aria-labelledby="warehouse-heading">
        <h2 id="warehouse-heading" class="text-h6 q-mt-none q-mb-md">倉庫</h2>
        <div class="filter-row q-mb-md">
          <q-input v-model="warehouseSearch" dense outlined debounce="300" label="搜尋倉庫" clearable><template #prepend><q-icon name="search" /></template></q-input>
          <q-select v-model="warehouseStatus" dense outlined emit-value map-options :options="statusOptions" label="狀態" />
        </div>
        <DataTable ref="warehouseTable" :fetch="fetchWarehouses" :columns="warehouseColumns" :filter="warehouseSearch" :initial-pagination="initialPagination" row-key="id" sticky-actions>
          <template #body-cell-status="{ value }"><q-td><q-badge :color="value === 'ACTIVE' ? 'positive' : 'grey-7'" :label="value === 'ACTIVE' ? '啟用' : '已停用'" /></q-td></template>
          <template #body-cell-actions="{ row }"><q-td class="text-right q-gutter-xs">
            <q-btn flat round dense icon="chevron_right" :aria-label="`查看倉庫 ${row.code} 的庫位`" @click="selectWarehouse(row)" />
            <q-btn v-if="canManage" flat round dense icon="edit" :aria-label="`編輯倉庫 ${row.code}`" @click="openWarehouseForm(row)" />
            <q-btn v-if="canManage && row.status === 'ACTIVE'" flat round dense icon="block" :aria-label="`停用倉庫 ${row.code}`" @click="warehouseLifecycle(row, 'deactivate')" />
            <q-btn v-if="canManage && row.status === 'INACTIVE'" flat round dense icon="play_arrow" :aria-label="`重新啟用倉庫 ${row.code}`" @click="warehouseLifecycle(row, 'reactivate')" />
            <q-btn v-if="canManage" flat round dense color="negative" icon="delete" :aria-label="`永久刪除倉庫 ${row.code}`" @click="warehouseLifecycle(row, 'delete')" />
          </q-td></template>
        </DataTable>
      </section>

      <section class="bin-panel" :class="{ 'has-mobile-selection': selectedWarehouse }" aria-labelledby="bin-heading">
        <template v-if="selectedWarehouse">
          <div class="row items-center q-gutter-sm q-mb-md">
            <q-btn class="mobile-back" flat icon="arrow_back" label="返回倉庫" @click="backToWarehouses" />
            <div>
              <h2 id="bin-heading" class="text-h6 q-ma-none">{{ selectedWarehouse.code }} — {{ selectedWarehouse.name }} 的庫位</h2>
              <div class="text-caption text-grey-8">{{ blockerText(selectedWarehouse, warehouseBlockerLabels) }}</div>
            </div>
            <q-space />
            <q-btn v-if="canManage && selectedWarehouse.status === 'ACTIVE'" color="primary" unelevated icon="add" label="新增庫位" @click="openBinForm()" />
          </div>
          <div class="filter-row q-mb-md">
            <q-input v-model="binSearch" dense outlined debounce="300" label="搜尋庫位" clearable><template #prepend><q-icon name="search" /></template></q-input>
            <q-select v-model="binStatus" dense outlined emit-value map-options :options="statusOptions" label="狀態" />
            <q-select v-model="lockStatus" dense outlined emit-value map-options :options="lockOptions" label="鎖定狀態" />
          </div>
          <DataTable ref="binTable" :fetch="fetchBins" :columns="binColumns" :filter="binSearch" :initial-pagination="initialPagination" row-key="id" sticky-actions>
            <template #body-cell-locked="{ value }"><q-td><q-badge :color="value ? 'warning' : 'grey-6'" :label="value ? '已鎖定' : '未鎖定'" /></q-td></template>
            <template #body-cell-status="{ value }"><q-td><q-badge :color="value === 'ACTIVE' ? 'positive' : 'grey-7'" :label="value === 'ACTIVE' ? '啟用' : '已停用'" /></q-td></template>
            <template #body-cell-actions="{ row }"><q-td class="text-right q-gutter-xs">
              <q-btn flat round dense icon="info" :aria-label="`查看庫位 ${row.code} 詳情`" @click="selectBin(row)" />
              <q-btn v-if="canManage" flat round dense icon="edit" :aria-label="`編輯庫位 ${row.code}`" @click="openBinForm(row)" />
              <q-btn v-if="canManage && row.status === 'ACTIVE'" flat round dense icon="block" :aria-label="`停用庫位 ${row.code}`" @click="binLifecycle(row, 'deactivate')" />
              <q-btn v-if="canManage && row.status === 'INACTIVE'" flat round dense icon="play_arrow" :aria-label="`重新啟用庫位 ${row.code}`" @click="binLifecycle(row, 'reactivate')" />
              <q-btn v-if="canManage" flat round dense color="negative" icon="delete" :aria-label="`永久刪除庫位 ${row.code}`" @click="binLifecycle(row, 'delete')" />
            </q-td></template>
          </DataTable>
          <q-card v-if="selectedBin" flat bordered class="q-mt-md"><q-card-section>
            <h3 class="text-subtitle1 q-mt-none q-mb-xs">庫位 {{ selectedBin.code }} 詳情</h3>
            <div>{{ blockerText(selectedBin, binBlockerLabels) }}</div>
            <div v-if="selectedBin.currentLock" class="text-warning q-mt-xs">盤點 {{ selectedBin.currentLock.stocktakeNumber }} 鎖定中</div>
          </q-card-section></q-card>
        </template>
        <q-card v-else flat bordered><q-card-section class="text-grey-7 text-center q-pa-xl">請先選擇倉庫以查看庫位</q-card-section></q-card>
      </section>
    </div>

    <q-dialog v-model="showForm" persistent><q-card class="form-dialog"><q-card-section><h2 class="text-h6 q-ma-none">{{ formTitle }}</h2></q-card-section><q-card-section class="q-pt-none">
      <FormPanel v-slot="{ fieldError, submitting }" :on-submit="submitForm" @success="afterSubmit">
        <q-banner v-if="formError" role="alert" class="bg-warning text-dark q-mb-md">{{ formError }}</q-banner>
        <div v-if="formEntity === 'warehouse'" class="q-gutter-md">
          <q-input v-model="warehouseForm.warehouseCode" filled label="倉庫代碼" maxlength="50" :rules="[(v) => !!v?.trim() || '請輸入倉庫代碼']" :error="!!fieldError('warehouseCode')" :error-message="fieldError('warehouseCode')" />
          <q-input v-model="warehouseForm.warehouseName" filled label="倉庫名稱" maxlength="190" :rules="[(v) => !!v?.trim() || '請輸入倉庫名稱']" :error="!!fieldError('warehouseName')" :error-message="fieldError('warehouseName')" />
          <q-input v-model="warehouseForm.address" filled type="textarea" label="地址" maxlength="500" :error="!!fieldError('address')" :error-message="fieldError('address')" />
          <q-input v-model="warehouseForm.description" filled type="textarea" label="說明" maxlength="500" :error="!!fieldError('description')" :error-message="fieldError('description')" />
        </div>
        <div v-else class="q-gutter-md">
          <q-input v-model="binForm.binCode" filled label="庫位代碼" maxlength="50" :rules="[(v) => !!v?.trim() || '請輸入庫位代碼']" :error="!!fieldError('binCode')" :error-message="fieldError('binCode')" />
          <q-input v-model="binForm.binName" filled label="庫位名稱" maxlength="190" :error="!!fieldError('binName')" :error-message="fieldError('binName')" />
          <q-input v-model="binForm.description" filled type="textarea" label="說明" maxlength="500" :error="!!fieldError('description')" :error-message="fieldError('description')" />
        </div>
        <div class="row justify-end q-gutter-sm q-mt-lg"><q-btn v-close-popup flat label="取消" :disable="submitting" /><q-btn type="submit" color="primary" unelevated label="儲存" :loading="submitting" /></div>
      </FormPanel>
    </q-card-section></q-card></q-dialog>
  </div>
</template>

<style scoped>
.inventory-master-detail { display: grid; grid-template-columns: minmax(360px, 2fr) minmax(520px, 3fr); gap: 16px; }
.filter-row { display: flex; flex-wrap: wrap; gap: 8px; }
.filter-row > * { min-width: 150px; flex: 1; }
.form-dialog { width: min(640px, calc(100vw - 32px)); }
.mobile-back { display: none; }
@media (max-width: 767px) {
  .inventory-master-detail { display: block; }
  .warehouse-panel.has-mobile-selection { display: none; }
  .bin-panel:not(.has-mobile-selection) { display: none; }
  .mobile-back { display: inline-flex; }
  .filter-row > * { min-width: 100%; }
}
</style>
