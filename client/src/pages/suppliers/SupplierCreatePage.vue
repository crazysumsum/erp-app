<script>
export const page = {
  name: "supplier-create",
  path: "/suppliers/new",
  title: "新增供應商",
  requires: { permissions: ["supplier.mgmt"] }
};
</script>

<script setup>
import { computed, nextTick, onUnmounted, reactive, ref, watch } from "vue";
import { onBeforeRouteLeave } from "vue-router";
import PageHeader from "@/framework/layout/PageHeader.vue";
import SupplierBasicForm from "@/components/suppliers/SupplierBasicForm.vue";
import { mapValidationDetailsToFieldErrors, unmatchedFieldErrors } from "@/framework/ui/validationIssues.js";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";
import supplierService from "@/services/supplier.js";

const form = reactive({
  supplierCode: "",
  supplierName: "",
  displayName: "",
  defaultCurrencyCode: null,
  defaultCurrencyVersion: undefined,
  defaultPaymentTermId: null,
  defaultPaymentTermVersion: undefined,
  generalPhone: "",
  generalEmail: "",
  website: "",
  notes: ""
});

const dirty = ref(false);
const submitting = ref(false);
const intendedActivation = ref(false);
const duplicateCandidates = ref([]);
const warnings = ref([]);
const created = ref(null);
const fieldErrors = ref({});
const summaryMessage = ref("");
const summaryIssues = ref([]);
const summaryRef = ref(null);
const knownFields = new Set(Object.keys(form));

watch(form, () => { dirty.value = true; }, { deep: true });

onBeforeRouteLeave(() => !dirty.value || window.confirm("有未儲存的變更，確定要離開這一頁嗎？"));
function beforeUnload(event) {
  if (!dirty.value) return;
  event.preventDefault();
  event.returnValue = "";
}
window.addEventListener("beforeunload", beforeUnload);
onUnmounted(() => window.removeEventListener("beforeunload", beforeUnload));

const hasErrors = computed(() => summaryMessage.value || summaryIssues.value.length || Object.keys(fieldErrors.value).length);
function fieldError(name) { return fieldErrors.value[name] ?? ""; }

async function focusSummary() {
  await nextTick();
  summaryRef.value?.focus();
}

function payload(activate) {
  return {
    supplierCode: form.supplierCode.trim(),
    supplierName: form.supplierName.trim(),
    displayName: form.displayName.trim(),
    defaultCurrencyCode: form.defaultCurrencyCode,
    defaultCurrencyVersion: form.defaultCurrencyVersion,
    defaultPaymentTermId: form.defaultPaymentTermId,
    ...(form.defaultPaymentTermId ? { defaultPaymentTermVersion: form.defaultPaymentTermVersion } : {}),
    generalPhone: form.generalPhone.trim(),
    generalEmail: form.generalEmail.trim(),
    website: form.website.trim(),
    notes: form.notes.trim(),
    activate
  };
}

function duplicateRows(result) {
  return result?.duplicateCandidates ?? result?.nameCandidates ?? result?.candidates ?? [];
}

async function requestCreate(activate) {
  if (submitting.value) return;
  submitting.value = true;
  fieldErrors.value = {};
  summaryMessage.value = "";
  summaryIssues.value = [];
  try {
    const result = await supplierService.create(payload(activate));
    created.value = result;
    warnings.value = result.warnings ?? [];
    duplicateCandidates.value = [];
    dirty.value = false;
    notifySuccess(`供應商 ${result.supplierCode} 已${result.status === "active" ? "啟用" : "儲存"}`);
  } catch (error) {
    fieldErrors.value = mapValidationDetailsToFieldErrors(error.details);
    summaryIssues.value = unmatchedFieldErrors(fieldErrors.value, knownFields);
    if (Object.keys(fieldErrors.value).length === 0 && summaryIssues.value.length === 0) {
      summaryMessage.value = error.message || "建立供應商失敗";
    }
    notifyError(error.message || "建立供應商失敗");
    await focusSummary();
  } finally {
    submitting.value = false;
  }
}

async function submit(activate) {
  intendedActivation.value = activate;
  duplicateCandidates.value = [];
  try {
    const result = await supplierService.checkDuplicates({
      supplierCode: form.supplierCode.trim(),
      supplierName: form.supplierName.trim()
    });
    duplicateCandidates.value = duplicateRows(result);
    if (duplicateCandidates.value.length > 0) return;
  } catch (error) {
    if (error.code === "SUPPLIER_CODE_TAKEN") {
      summaryMessage.value = error.message;
      await focusSummary();
      return;
    }
    // Duplicate-name lookup is advisory. The create transaction still enforces Code uniqueness.
  }
  await requestCreate(activate);
}
</script>

<template>
  <div>
    <PageHeader subtitle="只需 Supplier Code、Supplier Name 及有效貨幣即可先儲存；其他資料可稍後補充。" />

    <main class="q-pa-md" style="max-width: 900px">
      <q-banner v-if="created" class="bg-positive text-white q-mb-md" rounded role="status">
        <div class="text-subtitle1">供應商 {{ created.supplierCode }} 已建立</div>
        <div>狀態：{{ created.status === "active" ? "啟用" : created.status === "pending_approval" ? "待審批" : "草稿" }}</div>
        <div class="q-mt-xs">下一步：可前往供應商詳情補充地址、聯絡人、識別資料及付款資料。</div>
      </q-banner>

      <q-banner v-if="warnings.length" class="bg-warning text-dark q-mb-md" rounded>
        <div class="text-weight-medium">完整度提示（不阻擋建立）</div>
        <ul class="q-ma-none q-pl-md">
          <li v-for="warning in warnings" :key="`${warning.field}-${warning.code}`">{{ warning.message }}</li>
        </ul>
      </q-banner>

      <div v-if="hasErrors" ref="summaryRef" role="alert" tabindex="-1" class="q-mb-md">
        <q-banner class="bg-negative text-white">
          <div v-if="summaryMessage">{{ summaryMessage }}</div>
          <ul v-else-if="summaryIssues.length" class="q-ma-none q-pl-md">
            <li v-for="issue in summaryIssues" :key="issue.field">{{ issue.field }}：{{ issue.message }}</li>
          </ul>
          <div v-else>請檢查下面標示錯誤的欄位。</div>
        </q-banner>
      </div>

      <q-banner v-if="duplicateCandidates.length" class="bg-warning text-dark q-mb-md" rounded>
        <template #avatar><q-icon name="warning" /></template>
        <div class="text-weight-medium">找到名稱近似的供應商，請確認這不是重複建檔：</div>
        <ul class="q-ma-none q-pl-md">
          <li v-for="candidate in duplicateCandidates" :key="candidate.supplierId">
            {{ candidate.supplierCode }} — {{ candidate.supplierName }}
          </li>
        </ul>
        <template #action>
          <q-btn
            flat
            label="確認並繼續"
            aria-label="確認重複提示並繼續"
            @click="requestCreate(intendedActivation)"
          />
        </template>
      </q-banner>

      <SupplierBasicForm :model-value="form" :field-error="fieldError" />

      <div class="row q-gutter-sm q-mt-lg">
        <q-btn
          color="secondary"
          label="儲存 Draft"
          :loading="submitting"
          :aria-label="submitting ? '儲存 Draft 中' : '儲存 Draft'"
          @click="submit(false)"
        />
        <q-btn
          color="primary"
          label="直接啟用"
          :loading="submitting"
          :aria-label="submitting ? '直接啟用中' : '直接啟用'"
          @click="submit(true)"
        />
      </div>
      <div v-if="submitting" class="q-mt-sm text-caption" aria-live="polite">處理中，請稍候…</div>
    </main>
  </div>
</template>
