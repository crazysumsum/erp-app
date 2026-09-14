<script>
export const page = {
  name: "business-master-payment-terms",
  path: "/system/business-master/payment-terms",
  title: "付款條款",
  requires: { permissions: ["business_master.view"] },
  menu: { group: "system", icon: "event_available", order: 50 }
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
import {
  BUSINESS_STATUS_COLOUR,
  BUSINESS_STATUS_LABEL,
  PAYMENT_RULE_LABEL,
  paymentRuleSummary,
  previewDueDate
} from "@/components/business-master/presentation.js";
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
  { name: "rule", label: "到期規則", field: "calculationType", align: "left" },
  { name: "description", label: "描述", field: "description", align: "left" },
  { name: "status", label: "狀態", field: "status", align: "left", sortable: true },
  { name: "updatedAt", label: "更新時間", field: "updatedAt", align: "left", sortable: true },
  { name: "actions", label: "", field: "id", align: "right" }
];
const statusOptions = [
  { label: "全部", value: null },
  { label: "啟用", value: "ACTIVE" },
  { label: "已停用", value: "INACTIVE" }
];
const ruleOptions = Object.entries(PAYMENT_RULE_LABEL).map(([value, label]) => ({ value, label }));

function syncUrl() {
  router.replace({ query: {
    page: currentRequest.value.page,
    sort: currentRequest.value.sortBy || undefined,
    descending: String(currentRequest.value.descending),
    q: searchText.value || undefined,
    status: statusFilter.value || undefined
  } });
}

function fetchTerms(request) {
  currentRequest.value = { page: request.page, sortBy: request.sortBy, descending: request.descending };
  syncUrl();
  return businessMasterService.paymentTermList({ ...request, status: statusFilter.value });
}

watch(statusFilter, () => dataTableRef.value?.reload());

const today = new Date().toISOString().slice(0, 10);
const showFormDialog = ref(false);
const formMode = ref("create");
const editing = ref(null);
const form = ref(emptyForm());
const formError = ref("");
const previewBaseDate = ref(today);
const duePreview = computed(() => previewDueDate(
  previewBaseDate.value,
  form.value.calculationType,
  form.value.calculationType === "NET_DAYS" ? form.value.dueDays : null
));

function emptyForm() {
  return { code: "", name: "", description: "", calculationType: "IMMEDIATE", dueDays: null };
}

watch(() => form.value.calculationType, (type) => {
  if (type !== "NET_DAYS") form.value.dueDays = null;
  else if (!Number.isInteger(form.value.dueDays)) form.value.dueDays = 0;
});

function openCreate() {
  formMode.value = "create";
  editing.value = null;
  formError.value = "";
  form.value = emptyForm();
  previewBaseDate.value = today;
  showFormDialog.value = true;
}

function openEdit(row) {
  formMode.value = "edit";
  editing.value = row;
  formError.value = "";
  form.value = {
    code: row.code,
    name: row.name,
    description: row.description,
    calculationType: row.calculationType,
    dueDays: row.dueDays
  };
  previewBaseDate.value = today;
  showFormDialog.value = true;
}

async function submitForm() {
  formError.value = "";
  try {
    if (formMode.value === "create") {
      return await businessMasterService.createPaymentTerm({
        ...form.value,
        dueDays: form.value.calculationType === "NET_DAYS" ? form.value.dueDays : null
      });
    }
    return await businessMasterService.updatePaymentTerm(editing.value.id, {
      name: form.value.name,
      description: form.value.description,
      version: editing.value.version
    });
  } catch (error) {
    if (error.code === "VERSION_CONFLICT") {
      await dataTableRef.value?.reload();
      formError.value = "資料已被其他人修改；列表已重新載入，你輸入的名稱及描述仍保留，請核對後再提交。";
    }
    throw error;
  }
}

function afterSubmit() {
  showFormDialog.value = false;
  notifySuccess(formMode.value === "create" ? "已新增付款條款" : "已更新付款條款");
  dataTableRef.value?.reload();
}

async function activate(row) {
  const reason = await promptReason({ title: "啟用付款條款", message: `啟用「${row.code} — ${row.name}」？`, okLabel: "啟用" });
  if (reason === null) return;
  try {
    await businessMasterService.activatePaymentTerm(row.id, { version: row.version, reason });
    notifySuccess(`付款條款「${row.code}」已啟用`);
    await dataTableRef.value?.reload();
  } catch (error) {
    notifyError(error.message || "啟用失敗");
  }
}

const showRuleDialog = ref(false);
const ruleTarget = ref(null);
const ruleForm = ref({ calculationType: "IMMEDIATE", dueDays: null, baseDate: today });
const ruleDuePreview = computed(() => previewDueDate(
  ruleForm.value.baseDate,
  ruleForm.value.calculationType,
  ruleForm.value.calculationType === "NET_DAYS" ? ruleForm.value.dueDays : null
));
watch(() => ruleForm.value.calculationType, (type) => {
  if (type !== "NET_DAYS") ruleForm.value.dueDays = null;
  else if (!Number.isInteger(ruleForm.value.dueDays)) ruleForm.value.dueDays = 0;
});

function openRule(row) {
  ruleTarget.value = row;
  ruleForm.value = { calculationType: row.calculationType, dueDays: row.dueDays, baseDate: today };
  showRuleDialog.value = true;
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
const impactOperationLabel = computed(() => impactOperation.value === "DEACTIVATE" ? "停用付款條款" : "變更付款條款規則");
const impactChanges = computed(() => impactOperation.value === "DEACTIVATE"
  ? [{ label: "狀態", before: BUSINESS_STATUS_LABEL.ACTIVE, after: BUSINESS_STATUS_LABEL.INACTIVE }]
  : [{
      label: "到期規則",
      before: paymentRuleSummary(impactTarget.value?.calculationType, impactTarget.value?.dueDays),
      after: paymentRuleSummary(ruleForm.value.calculationType, ruleForm.value.dueDays)
    }]);
const auditPath = computed(() => impactTarget.value
  ? `/system/business-master/audit?entityType=PAYMENT_TERM&entityKey=${impactTarget.value.id}`
  : "");

async function openImpact(row, operation) {
  impactTarget.value = row;
  impactOperation.value = operation;
  impactPreview.value = null;
  impactError.value = "";
  impactRetryMode.value = "PREVIEW";
  impactIdempotencyKey.value = crypto.randomUUID();
  showImpactDialog.value = true;
  showRuleDialog.value = false;
  await loadImpact();
}

async function loadImpact() {
  impactLoading.value = true;
  impactError.value = "";
  try {
    impactPreview.value = await businessMasterService.previewPaymentTermImpact(impactTarget.value.id, {
      operation: impactOperation.value,
      version: impactTarget.value.version,
      proposedChange: impactOperation.value === "DEACTIVATE"
        ? {}
        : { calculationType: ruleForm.value.calculationType, dueDays: ruleForm.value.dueDays }
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
      await businessMasterService.deactivatePaymentTerm(impactTarget.value.id, common);
    } else {
      await businessMasterService.changePaymentTermRule(impactTarget.value.id, {
        ...common,
        calculationType: ruleForm.value.calculationType,
        dueDays: ruleForm.value.dueDays
      });
    }
    notifySuccess(`付款條款「${impactTarget.value.code}」已${impactOperation.value === "DEACTIVATE" ? "停用" : "更新規則"}`);
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
function sameRule() {
  return ruleTarget.value?.calculationType === ruleForm.value.calculationType &&
    ruleTarget.value?.dueDays === ruleForm.value.dueDays;
}
</script>

<template>
  <div>
    <PageHeader subtitle="維護交易到期日規則；既有交易快照不會被回寫。">
      <template #actions><q-btn v-if="canManage" color="primary" unelevated icon="add" label="新增付款條款" @click="openCreate" /></template>
    </PageHeader>
    <div class="q-px-md q-pb-md row q-gutter-sm items-center">
      <q-input v-model="searchText" dense outlined debounce="300" label="搜尋代碼或名稱" style="width: 260px"><template #prepend><q-icon name="search" /></template></q-input>
      <q-select v-model="statusFilter" dense outlined emit-value map-options :options="statusOptions" label="狀態" style="width: 160px" />
    </div>
    <div class="q-px-md q-pb-md">
      <DataTable ref="dataTableRef" :fetch="fetchTerms" :columns="columns" :filter="searchText" :initial-pagination="initialPagination" row-key="id" sticky-actions>
        <template #body-cell-code="{ value }"><EllipsisCell :text="value" max-width="120px" /></template>
        <template #body-cell-name="{ value }"><EllipsisCell :text="value" max-width="180px" /></template>
        <template #body-cell-rule="{ row }"><q-td>{{ paymentRuleSummary(row.calculationType, row.dueDays) }}</q-td></template>
        <template #body-cell-description="{ value }"><EllipsisCell :text="value || '—'" max-width="260px" /></template>
        <template #body-cell-status="{ value }"><q-td><q-badge :color="BUSINESS_STATUS_COLOUR[value]" :label="BUSINESS_STATUS_LABEL[value] ?? value" /></q-td></template>
        <template #body-cell-updatedAt="{ value }"><q-td>{{ formatTime(value) }}</q-td></template>
        <template #body-cell-actions="{ row }">
          <q-td class="text-right"><q-btn v-if="canManage" flat round dense icon="more_vert" :aria-label="`「${row.code}」的操作`"><q-menu><q-list>
            <q-item v-close-popup clickable @click="openEdit(row)"><q-item-section>編輯資料</q-item-section></q-item>
            <q-item v-if="row.status === 'INACTIVE'" v-close-popup clickable @click="activate(row)"><q-item-section>啟用</q-item-section></q-item>
            <q-item v-if="row.status === 'ACTIVE'" v-close-popup clickable @click="openImpact(row, 'DEACTIVATE')"><q-item-section>停用</q-item-section></q-item>
            <q-item v-close-popup clickable @click="openRule(row)"><q-item-section>變更到期規則</q-item-section></q-item>
            <q-item :to="`/system/business-master/audit?entityType=PAYMENT_TERM&entityKey=${row.id}`"><q-item-section>稽核記錄</q-item-section></q-item>
          </q-list></q-menu></q-btn></q-td>
        </template>
      </DataTable>
    </div>

    <q-dialog v-model="showFormDialog" persistent><q-card class="form-dialog"><q-card-section><h2 class="text-h6 q-ma-none">{{ formMode === 'create' ? '新增付款條款' : '編輯付款條款' }}</h2></q-card-section><q-card-section class="q-pt-none">
      <FormPanel v-slot="{ fieldError, submitting }" :on-submit="submitForm" @success="afterSubmit"><div class="q-gutter-md">
        <q-banner v-if="formError" role="alert" class="bg-warning text-dark">{{ formError }}</q-banner>
        <q-input v-model="form.code" filled label="條款代碼" maxlength="50" :readonly="formMode === 'edit'" :rules="[(v) => !!v.trim() || '請輸入條款代碼']" :error="!!fieldError('code')" :error-message="fieldError('code')" />
        <q-input v-model="form.name" filled label="名稱" maxlength="100" :rules="[(v) => !!v.trim() || '請輸入名稱']" :error="!!fieldError('name')" :error-message="fieldError('name')" />
        <q-input v-model="form.description" filled type="textarea" label="描述" maxlength="500" counter :error="!!fieldError('description')" :error-message="fieldError('description')" />
        <template v-if="formMode === 'create'">
          <q-select v-model="form.calculationType" filled emit-value map-options label="到期規則" :options="ruleOptions" />
          <q-input v-if="form.calculationType === 'NET_DAYS'" v-model.number="form.dueDays" filled type="number" min="0" max="3650" label="到期日數" :rules="[(v) => Number.isInteger(v) && v >= 0 && v <= 3650 || '請輸入 0 至 3650 的整數']" />
          <div class="preview-box q-pa-md"><div class="text-caption text-grey-7">即時到期日預覽</div><q-input v-model="previewBaseDate" dense type="date" label="基準日期" />
            <div class="q-mt-sm">{{ duePreview?.requiresManualDueDate ? '需手動指定到期日' : (duePreview?.dueDate ? `到期日：${duePreview.dueDate}` : '請輸入有效日期及規則') }}</div>
          </div>
        </template>
        <div class="row justify-end q-gutter-sm"><q-btn flat label="取消" :disable="submitting" @click="showFormDialog = false" /><q-btn type="submit" color="primary" unelevated :label="formMode === 'create' ? '新增' : '儲存'" :loading="submitting" /></div>
      </div></FormPanel>
    </q-card-section></q-card></q-dialog>

    <q-dialog v-model="showRuleDialog" persistent><q-card class="form-dialog"><q-card-section><h2 class="text-h6 q-ma-none">變更付款條款規則</h2><div class="text-grey-7">{{ ruleTarget?.code }} — {{ ruleTarget?.name }}</div></q-card-section><q-card-section class="q-pt-none q-gutter-md">
      <q-select v-model="ruleForm.calculationType" filled emit-value map-options label="新到期規則" :options="ruleOptions" />
      <q-input v-if="ruleForm.calculationType === 'NET_DAYS'" v-model.number="ruleForm.dueDays" filled type="number" min="0" max="3650" label="到期日數" :rules="[(v) => Number.isInteger(v) && v >= 0 && v <= 3650 || '請輸入 0 至 3650 的整數']" />
      <div class="preview-box q-pa-md"><div class="text-caption text-grey-7">即時到期日預覽</div><q-input v-model="ruleForm.baseDate" dense type="date" label="基準日期" /><div class="q-mt-sm">{{ ruleDuePreview?.requiresManualDueDate ? '需手動指定到期日' : (ruleDuePreview?.dueDate ? `到期日：${ruleDuePreview.dueDate}` : '請輸入有效日期及規則') }}</div></div>
      <div class="row justify-end q-gutter-sm"><q-btn flat label="取消" @click="showRuleDialog = false" /><q-btn color="negative" unelevated label="預覽影響" :disable="sameRule() || !ruleDuePreview" @click="openImpact(ruleTarget, 'CHANGE_RULE')" /></div>
    </q-card-section></q-card></q-dialog>

    <ImpactConfirmationDialog v-model="showImpactDialog" :entity-label="impactTarget ? `${impactTarget.code} — ${impactTarget.name}` : ''" :operation-label="impactOperationLabel" :changes="impactChanges" :preview="impactPreview" :loading="impactLoading" :submitting="impactSubmitting" :error="impactError" :retry-label="impactRetryMode === 'PREVIEW' ? '重新預覽' : ''" :audit-path="auditPath" @retry="loadImpact" @confirm="confirmImpact" />
  </div>
</template>

<style scoped>
.form-dialog { width: min(560px, calc(100vw - 32px)); }
.preview-box { border: 1px solid var(--app-border); border-radius: 4px; background: var(--app-surface-muted); }
</style>
