<script>
export const page = {
  name: "business-master-currencies",
  path: "/system/business-master/currencies",
  title: "貨幣",
  requires: { permissions: ["business_master.view"] },
  menu: { group: "system", icon: "currency_exchange", order: 40 }
};
</script>

<script setup>
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import appConfig from "@config/app.js";
import ImpactConfirmationDialog from "@/components/business-master/ImpactConfirmationDialog.vue";
import PageHeader from "@/framework/layout/PageHeader.vue";
import DataTable from "@/framework/ui/DataTable.vue";
import EllipsisCell from "@/framework/ui/EllipsisCell.vue";
import FormPanel from "@/framework/ui/FormPanel.vue";
import { can } from "@/framework/authorization/can.js";
import { BUSINESS_STATUS_COLOUR, BUSINESS_STATUS_LABEL } from "@/components/business-master/presentation.js";
import { promptReason } from "@/framework/ui/confirm.js";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";
import businessMasterService from "@/services/businessMaster.js";
import { useSessionStore } from "@/stores/session.js";

const session = useSessionStore();
const canManage = computed(() => can(session, { permissions: ["business_master.mgmt"] }));
const route = useRoute();
const router = useRouter();
const initialQuery = route.query;
const searchText = ref(typeof initialQuery.q === "string" ? initialQuery.q : "");
const statusFilter = ref(["ACTIVE", "INACTIVE"].includes(initialQuery.status) ? initialQuery.status : null);
const initialPagination = {
  page: Number(initialQuery.page) > 0 ? Number(initialQuery.page) : 1,
  rowsPerPage: appConfig.defaultPageSize,
  rowsNumber: 0,
  sortBy: ["code", "name", "status", "updatedAt"].includes(initialQuery.sort) ? initialQuery.sort : "code",
  descending: initialQuery.descending === "true"
};
const currentRequest = ref({ page: initialPagination.page, sortBy: initialPagination.sortBy, descending: initialPagination.descending });
const dataTableRef = ref(null);

const columns = [
  { name: "code", label: "代碼", field: "code", align: "left", sortable: true },
  { name: "name", label: "名稱", field: "name", align: "left", sortable: true },
  { name: "decimalPlaces", label: "小數位", field: "decimalPlaces", align: "right" },
  { name: "status", label: "狀態", field: "status", align: "left", sortable: true },
  { name: "updatedAt", label: "更新時間", field: "updatedAt", align: "left", sortable: true },
  { name: "actions", label: "", field: "code", align: "right" }
];
const statusOptions = [
  { label: "全部", value: null },
  { label: "啟用", value: "ACTIVE" },
  { label: "已停用", value: "INACTIVE" }
];

function syncUrl() {
  router.replace({ query: {
    page: currentRequest.value.page,
    sort: currentRequest.value.sortBy || undefined,
    descending: String(currentRequest.value.descending),
    q: searchText.value || undefined,
    status: statusFilter.value || undefined
  } });
}

function fetchCurrencies(request) {
  currentRequest.value = { page: request.page, sortBy: request.sortBy, descending: request.descending };
  syncUrl();
  return businessMasterService.currencyList({ ...request, status: statusFilter.value });
}

watch(statusFilter, () => dataTableRef.value?.reload());

const showFormDialog = ref(false);
const formMode = ref("create");
const editing = ref(null);
const form = ref({ code: "", name: "", decimalPlaces: 2 });
const formError = ref("");

function openCreate() {
  formMode.value = "create";
  editing.value = null;
  formError.value = "";
  form.value = { code: "", name: "", decimalPlaces: 2 };
  showFormDialog.value = true;
}

function openEdit(row) {
  formMode.value = "edit";
  editing.value = row;
  formError.value = "";
  form.value = { code: row.code, name: row.name, decimalPlaces: row.decimalPlaces };
  showFormDialog.value = true;
}

async function submitForm() {
  formError.value = "";
  try {
    if (formMode.value === "create") return await businessMasterService.createCurrency(form.value);
    return await businessMasterService.updateCurrency(editing.value.code, {
      name: form.value.name,
      version: editing.value.version
    });
  } catch (error) {
    if (error.code === "VERSION_CONFLICT") {
      await dataTableRef.value?.reload();
      formError.value = "資料已被其他人修改；列表已重新載入，你輸入的名稱仍保留，請核對後再提交。";
    }
    throw error;
  }
}

function afterSubmit() {
  showFormDialog.value = false;
  notifySuccess(formMode.value === "create" ? "已新增貨幣" : "已更新貨幣");
  dataTableRef.value?.reload();
}

async function activate(row) {
  const reason = await promptReason({ title: "啟用貨幣", message: `啟用「${row.code} — ${row.name}」？`, okLabel: "啟用" });
  if (reason === null) return;
  try {
    await businessMasterService.activateCurrency(row.code, { version: row.version, reason });
    notifySuccess(`貨幣「${row.code}」已啟用`);
    await dataTableRef.value?.reload();
  } catch (error) {
    notifyError(error.message || "啟用失敗");
  }
}

const showPrecisionDialog = ref(false);
const precisionTarget = ref(null);
const nextPrecision = ref(2);
function openPrecision(row) {
  precisionTarget.value = row;
  nextPrecision.value = row.decimalPlaces;
  showPrecisionDialog.value = true;
}

const showImpactDialog = ref(false);
const impactTarget = ref(null);
const impactOperation = ref("");
const impactPreview = ref(null);
const impactLoading = ref(false);
const impactSubmitting = ref(false);
const impactError = ref("");
const impactRetryMode = ref("PREVIEW");
const impactIdempotencyKey = ref("");
const impactOperationLabel = computed(() => impactOperation.value === "DEACTIVATE" ? "停用貨幣" : "變更貨幣小數位");
const impactChanges = computed(() => impactOperation.value === "DEACTIVATE"
  ? [{ label: "狀態", before: BUSINESS_STATUS_LABEL.ACTIVE, after: BUSINESS_STATUS_LABEL.INACTIVE }]
  : [{ label: "小數位", before: `${impactTarget.value?.decimalPlaces} 位`, after: `${nextPrecision.value} 位` }]);
const auditPath = computed(() => impactTarget.value
  ? `/system/business-master/audit?entityType=CURRENCY&entityKey=${encodeURIComponent(impactTarget.value.code)}`
  : "");

async function openImpact(row, operation) {
  impactTarget.value = row;
  impactOperation.value = operation;
  impactPreview.value = null;
  impactError.value = "";
  impactRetryMode.value = "PREVIEW";
  impactIdempotencyKey.value = crypto.randomUUID();
  showImpactDialog.value = true;
  showPrecisionDialog.value = false;
  await loadImpact();
}

async function loadImpact() {
  impactLoading.value = true;
  impactError.value = "";
  try {
    impactPreview.value = await businessMasterService.previewCurrencyImpact(impactTarget.value.code, {
      operation: impactOperation.value,
      version: impactTarget.value.version,
      proposedChange: impactOperation.value === "DEACTIVATE" ? {} : { decimalPlaces: nextPrecision.value }
    });
  } catch (error) {
    impactPreview.value = null;
    impactError.value = error.message || "無法取得引用影響，操作已被阻止";
  } finally {
    impactLoading.value = false;
  }
}

async function confirmImpact(reason) {
  if (impactSubmitting.value) return;
  impactSubmitting.value = true;
  impactError.value = "";
  try {
    const common = {
      version: impactTarget.value.version,
      reason,
      impactToken: impactPreview.value.impactToken,
      idempotencyKey: impactIdempotencyKey.value
    };
    if (impactOperation.value === "DEACTIVATE") {
      await businessMasterService.deactivateCurrency(impactTarget.value.code, common);
    } else {
      await businessMasterService.changeCurrencyPrecision(impactTarget.value.code, { ...common, decimalPlaces: nextPrecision.value });
    }
    notifySuccess(`貨幣「${impactTarget.value.code}」已${impactOperation.value === "DEACTIVATE" ? "停用" : "更新小數位"}`);
    showImpactDialog.value = false;
    await dataTableRef.value?.reload();
  } catch (error) {
    if (["NETWORK_ERROR", "TIMEOUT", "REQUEST_TIMEOUT"].includes(error.code)) {
      impactRetryMode.value = "COMMAND";
      impactError.value = "操作結果尚未確認；請再次按確認，系統會使用相同識別碼查回原結果。";
    } else {
      impactRetryMode.value = "PREVIEW";
      impactIdempotencyKey.value = crypto.randomUUID();
      const message = error.code === "VERSION_CONFLICT"
        ? "資料已被其他人修改；列表已重新載入，請重新預覽影響後再確認。"
        : (error.message || "操作失敗，請重新預覽");
      await dataTableRef.value?.reload();
      await loadImpact();
      impactError.value = message;
    }
  } finally {
    impactSubmitting.value = false;
  }
}

function formatTime(value) { return new Date(value).toLocaleString("zh-HK"); }
</script>

<template>
  <div>
    <PageHeader subtitle="維護 ISO 4217 貨幣名稱、顯示精度及使用狀態。">
      <template #actions><q-btn v-if="canManage" color="primary" unelevated icon="add" label="新增貨幣" @click="openCreate" /></template>
    </PageHeader>
    <div class="q-px-md q-pb-md row q-gutter-sm items-center">
      <q-input v-model="searchText" dense outlined debounce="300" label="搜尋代碼或名稱" style="width: 260px"><template #prepend><q-icon name="search" /></template></q-input>
      <q-select v-model="statusFilter" dense outlined emit-value map-options :options="statusOptions" label="狀態" style="width: 160px" />
    </div>
    <div class="q-px-md q-pb-md">
      <DataTable ref="dataTableRef" :fetch="fetchCurrencies" :columns="columns" :filter="searchText" :initial-pagination="initialPagination" row-key="code" sticky-actions>
        <template #body-cell-code="{ value }"><EllipsisCell :text="value" max-width="90px" /></template>
        <template #body-cell-name="{ value }"><EllipsisCell :text="value" max-width="240px" /></template>
        <template #body-cell-decimalPlaces="{ value }"><q-td class="text-right">{{ value }} 位</q-td></template>
        <template #body-cell-status="{ value }"><q-td><q-badge :color="BUSINESS_STATUS_COLOUR[value]" :label="BUSINESS_STATUS_LABEL[value] ?? value" /></q-td></template>
        <template #body-cell-updatedAt="{ value }"><q-td>{{ formatTime(value) }}</q-td></template>
        <template #body-cell-actions="{ row }">
          <q-td class="text-right"><q-btn v-if="canManage" flat round dense icon="more_vert" :aria-label="`「${row.code}」的操作`"><q-menu><q-list>
            <q-item v-close-popup clickable @click="openEdit(row)"><q-item-section>編輯名稱</q-item-section></q-item>
            <q-item v-if="row.status === 'INACTIVE'" v-close-popup clickable @click="activate(row)"><q-item-section>啟用</q-item-section></q-item>
            <q-item v-if="row.status === 'ACTIVE'" v-close-popup clickable @click="openImpact(row, 'DEACTIVATE')"><q-item-section>停用</q-item-section></q-item>
            <q-item v-close-popup clickable @click="openPrecision(row)"><q-item-section>變更小數位</q-item-section></q-item>
            <q-item :to="`/system/business-master/audit?entityType=CURRENCY&entityKey=${row.code}`"><q-item-section>稽核記錄</q-item-section></q-item>
          </q-list></q-menu></q-btn></q-td>
        </template>
      </DataTable>
    </div>

    <q-dialog v-model="showFormDialog" persistent><q-card class="form-dialog"><q-card-section><h2 class="text-h6 q-ma-none">{{ formMode === 'create' ? '新增貨幣' : '編輯貨幣' }}</h2></q-card-section><q-card-section class="q-pt-none">
      <FormPanel v-slot="{ fieldError, submitting }" :on-submit="submitForm" @success="afterSubmit"><div class="q-gutter-md">
        <q-banner v-if="formError" role="alert" class="bg-warning text-dark">{{ formError }}</q-banner>
        <q-input v-model="form.code" filled label="ISO 4217 代碼" maxlength="3" :readonly="formMode === 'edit'" :rules="[(v) => /^[A-Z]{3}$/.test(v) || '請輸入 3 個大寫英文字母']" :error="!!fieldError('code')" :error-message="fieldError('code')" />
        <q-input v-model="form.name" filled label="名稱" maxlength="100" :rules="[(v) => !!v.trim() || '請輸入名稱']" :error="!!fieldError('name')" :error-message="fieldError('name')" />
        <q-select v-if="formMode === 'create'" v-model="form.decimalPlaces" filled label="小數位" :options="[0, 1, 2, 3, 4]" />
        <div class="row justify-end q-gutter-sm"><q-btn flat label="取消" :disable="submitting" @click="showFormDialog = false" /><q-btn type="submit" color="primary" unelevated :label="formMode === 'create' ? '新增' : '儲存'" :loading="submitting" /></div>
      </div></FormPanel>
    </q-card-section></q-card></q-dialog>

    <q-dialog v-model="showPrecisionDialog" persistent><q-card class="form-dialog"><q-card-section><h2 class="text-h6 q-ma-none">變更貨幣小數位</h2><div class="text-grey-7">{{ precisionTarget?.code }} — {{ precisionTarget?.name }}</div></q-card-section><q-card-section class="q-pt-none">
      <q-select v-model="nextPrecision" filled label="新小數位" :options="[0, 1, 2, 3, 4]" />
      <div class="row justify-end q-gutter-sm q-mt-md"><q-btn flat label="取消" @click="showPrecisionDialog = false" /><q-btn color="negative" unelevated label="預覽影響" :disable="nextPrecision === precisionTarget?.decimalPlaces" @click="openImpact(precisionTarget, 'CHANGE_PRECISION')" /></div>
    </q-card-section></q-card></q-dialog>

    <ImpactConfirmationDialog v-model="showImpactDialog" :entity-label="impactTarget ? `${impactTarget.code} — ${impactTarget.name}` : ''" :operation-label="impactOperationLabel" :changes="impactChanges" :preview="impactPreview" :loading="impactLoading" :submitting="impactSubmitting" :error="impactError" :retry-label="impactRetryMode === 'PREVIEW' ? '重新預覽' : ''" :audit-path="auditPath" @retry="loadImpact" @confirm="confirmImpact" />
  </div>
</template>

<style scoped>
.form-dialog { width: min(520px, calc(100vw - 32px)); }
</style>
