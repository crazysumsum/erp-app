<script>
export const page = {
  name: "supplier-detail",
  path: "/suppliers/:id",
  title: "供應商詳情",
  requires: { permissions: ["supplier.view"] }
};
</script>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from "vue";
import { onBeforeRouteLeave, useRoute, useRouter } from "vue-router";
import PageHeader from "@/framework/layout/PageHeader.vue";
import SupplierAddressPanel from "@/components/suppliers/SupplierAddressPanel.vue";
import SupplierBankPanel from "@/components/suppliers/SupplierBankPanel.vue";
import SupplierCompletenessBanner from "@/components/suppliers/SupplierCompletenessBanner.vue";
import SupplierContactPanel from "@/components/suppliers/SupplierContactPanel.vue";
import SupplierIdentifierPanel from "@/components/suppliers/SupplierIdentifierPanel.vue";
import SupplierPaymentDefaults from "@/components/suppliers/SupplierPaymentDefaults.vue";
import SupplierStatusActions from "@/components/suppliers/SupplierStatusActions.vue";
import { can } from "@/framework/authorization/can.js";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";
import { mapValidationDetailsToFieldErrors, unmatchedFieldErrors } from "@/framework/ui/validationIssues.js";
import supplierService from "@/services/supplier.js";
import { useSessionStore } from "@/stores/session.js";

const STATUS_LABEL = Object.freeze({
  draft: "草稿", pending_approval: "待審批", active: "啟用", suspended: "已暫停",
  blocked: "已封鎖", archived: "已封存"
});
const route = useRoute();
const router = useRouter();
const session = useSessionStore();
const canManage = computed(() => can(session, { permissions: ["supplier.mgmt"] }));
const canApprove = computed(() => can(session, { permissions: ["supplier.view", "supplier.approval"] }));
const supplier = ref(null);
const completeness = ref({ issues: [], warnings: [] });
const loading = ref(true);
const error = ref(null);
const tab = ref("overview");
const unavailableForPurchasing = computed(() => supplier.value && supplier.value.status !== "active");
const editing = ref(false);
const submitting = ref(false);
const fieldErrors = ref({});
const editError = ref("");
const editErrorRef = ref(null);
const staleNotice = ref(false);
const duplicateCandidates = ref([]);
const savedSnapshot = ref("");
// SupplierPaymentDefaults uses component v-model and may replace the model binding.
// eslint-disable-next-line prefer-const
let form = reactive({
  supplierName: "", displayName: "", defaultCurrencyCode: null, defaultCurrencyVersion: undefined,
  defaultPaymentTermId: null, defaultPaymentTermVersion: undefined, website: "", generalPhone: "",
  generalEmail: "", notes: "", reason: ""
});
const knownFields = new Set(Object.keys(form));

function formValues() {
  return {
    supplierName: form.supplierName,
    displayName: form.displayName,
    defaultCurrencyCode: form.defaultCurrencyCode,
    defaultCurrencyVersion: form.defaultCurrencyVersion,
    defaultPaymentTermId: form.defaultPaymentTermId,
    defaultPaymentTermVersion: form.defaultPaymentTermVersion,
    website: form.website,
    generalPhone: form.generalPhone,
    generalEmail: form.generalEmail,
    notes: form.notes,
    reason: form.reason
  };
}

function loadForm(data) {
  Object.assign(form, {
    supplierName: data.supplierName,
    displayName: data.displayName,
    defaultCurrencyCode: data.defaultCurrencyCode,
    defaultCurrencyVersion: undefined,
    defaultPaymentTermId: data.defaultPaymentTermId,
    defaultPaymentTermVersion: undefined,
    website: data.website,
    generalPhone: data.generalPhone,
    generalEmail: data.generalEmail,
    notes: data.notes,
    reason: ""
  });
  savedSnapshot.value = JSON.stringify(formValues());
}

const dirty = computed(() => editing.value && JSON.stringify(formValues()) !== savedSnapshot.value);
const currencyChanged = computed(() => form.defaultCurrencyCode !== supplier.value?.defaultCurrencyCode);
const editValid = computed(() => {
  if (!form.supplierName.trim() || !form.defaultCurrencyCode) return false;
  if (!currencyChanged.value) return true;
  const reasonLength = form.reason.trim().length;
  return reasonLength >= 5 && reasonLength <= 500;
});
const hasEditErrors = computed(() => editError.value || Object.keys(fieldErrors.value).length > 0);

onBeforeRouteLeave(() => !dirty.value || window.confirm("有未儲存的變更，確定要離開這一頁嗎？"));
function beforeUnload(event) {
  if (!dirty.value) return;
  event.preventDefault();
  event.returnValue = "";
}

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const [detail, status] = await Promise.all([
      supplierService.getById(Number(route.params.id)),
      supplierService.completeness(Number(route.params.id))
    ]);
    supplier.value = detail;
    completeness.value = status;
    if (!editing.value) loadForm(detail);
  } catch (loadError) {
    error.value = loadError;
  } finally {
    loading.value = false;
  }
}

async function lifecycleUpdated(updated) {
  supplier.value = updated;
  completeness.value = await supplierService.completeness(updated.id);
  if (!editing.value) loadForm(updated);
}

async function lifecycleConflict() {
  await load();
}

function lifecycleDeleted() {
  router.push("/suppliers");
}
onMounted(() => { window.addEventListener("beforeunload", beforeUnload); void load(); });
onUnmounted(() => window.removeEventListener("beforeunload", beforeUnload));

function startEdit() {
  loadForm(supplier.value);
  fieldErrors.value = {};
  editError.value = "";
  staleNotice.value = false;
  duplicateCandidates.value = [];
  editing.value = true;
}

function cancelEdit() {
  if (dirty.value && !window.confirm("放棄未儲存的變更？")) return;
  loadForm(supplier.value);
  editing.value = false;
  staleNotice.value = false;
}

function fieldError(name) {
  return fieldErrors.value[name] ?? "";
}

async function focusEditError() {
  await nextTick();
  editErrorRef.value?.focus();
}

function updatePayload() {
  return {
    supplierName: form.supplierName.trim(),
    displayName: form.displayName.trim(),
    defaultCurrencyCode: form.defaultCurrencyCode,
    ...(form.defaultCurrencyVersion ? { defaultCurrencyVersion: form.defaultCurrencyVersion } : {}),
    defaultPaymentTermId: form.defaultPaymentTermId,
    ...(form.defaultPaymentTermId && form.defaultPaymentTermVersion ? { defaultPaymentTermVersion: form.defaultPaymentTermVersion } : {}),
    website: form.website.trim(),
    generalPhone: form.generalPhone.trim(),
    generalEmail: form.generalEmail.trim(),
    notes: form.notes.trim(),
    ...(currencyChanged.value ? { reason: form.reason.trim() } : {}),
    version: supplier.value.version
  };
}

async function saveEdit() {
  if (!editValid.value || submitting.value || staleNotice.value) return;
  submitting.value = true;
  fieldErrors.value = {};
  editError.value = "";
  try {
    const updated = await supplierService.update(supplier.value.id, updatePayload());
    supplier.value = updated;
    duplicateCandidates.value = updated.duplicateCandidates ?? [];
    completeness.value = await supplierService.completeness(updated.id);
    loadForm(updated);
    editing.value = false;
    notifySuccess(`供應商 ${updated.supplierCode} 的一般資料已更新`);
  } catch (saveError) {
    if (saveError.code === "VERSION_CONFLICT") {
      staleNotice.value = true;
      try {
        supplier.value = await supplierService.getById(supplier.value.id);
      } catch {
        // Keep the last known version and, most importantly, the user's draft.
      }
      editError.value = `供應商已被其他人修改（最新版本 ${supplier.value.version}）；你的輸入仍然保留，請先複製所需內容再載入最新資料。`;
    } else {
      fieldErrors.value = mapValidationDetailsToFieldErrors(saveError.details);
      const summary = unmatchedFieldErrors(fieldErrors.value, knownFields);
      editError.value = summary.length ? summary.map((item) => `${item.field}：${item.message}`).join("；") : (saveError.message || "更新失敗");
    }
    notifyError(saveError.message || "更新失敗");
    await focusEditError();
  } finally {
    submitting.value = false;
  }
}

function reloadLatest() {
  loadForm(supplier.value);
  staleNotice.value = false;
  editError.value = "";
  fieldErrors.value = {};
}

const showCodeDialog = ref(false);
const codeSubmitting = ref(false);
const codeError = ref("");
const codeStale = ref(false);
const codeForm = reactive({ supplierCode: "", reason: "", password: "" });
const codeValid = computed(() => codeForm.supplierCode.trim() && codeForm.reason.trim().length >= 5 && codeForm.password.length > 0 && !codeStale.value);

function openCodeDialog() {
  Object.assign(codeForm, { supplierCode: supplier.value.supplierCode, reason: "", password: "" });
  codeError.value = "";
  codeStale.value = false;
  showCodeDialog.value = true;
}

async function submitCodeChange() {
  if (!codeValid.value || codeSubmitting.value) return;
  codeSubmitting.value = true;
  codeError.value = "";
  try {
    const updated = await supplierService.changeCode(supplier.value.id, {
      supplierCode: codeForm.supplierCode.trim(),
      reason: codeForm.reason.trim(),
      password: codeForm.password,
      version: supplier.value.version
    });
    supplier.value = updated;
    loadForm(updated);
    showCodeDialog.value = false;
    notifySuccess(`Supplier Code 已修正為 ${updated.supplierCode}`);
  } catch (changeError) {
    codeForm.password = "";
    if (changeError.code === "VERSION_CONFLICT") {
      codeStale.value = true;
      try { supplier.value = await supplierService.getById(supplier.value.id); } catch { /* Preserve current display and draft. */ }
      codeError.value = `供應商已更新至版本 ${supplier.value.version}；修正草稿已保留，請重新確認。`;
    } else {
      codeError.value = changeError.message || "修正 Supplier Code 失敗";
    }
    notifyError(changeError.message || "修正 Supplier Code 失敗");
  } finally {
    codeSubmitting.value = false;
  }
}
</script>

<template>
  <div>
    <PageHeader :title="supplier ? `${supplier.supplierCode} — ${supplier.supplierName}` : '供應商詳情'" />
    <div class="q-px-md q-pb-md" style="max-width: 1100px">
      <q-skeleton v-if="loading" type="rect" height="180px" aria-label="載入供應商詳情" />
      <q-banner v-else-if="error" class="bg-negative text-white" role="alert">
        {{ error.message || "載入供應商失敗" }}
        <template #action>
          <q-btn v-if="error.code === 'SUPPLIER_NOT_FOUND'" flat label="返回供應商列表" to="/suppliers" />
          <q-btn v-else flat label="重試" @click="load" />
        </template>
      </q-banner>

      <template v-else-if="supplier">
        <div class="row items-center q-gutter-sm q-mb-md">
          <q-badge :color="supplier.status === 'active' ? 'positive' : 'warning'" :label="STATUS_LABEL[supplier.status] ?? supplier.status" />
          <span v-if="unavailableForPurchasing" class="text-negative text-weight-medium">
            <q-icon name="block" /> 不可用於新採購
          </span>
          <span class="text-caption text-grey-7">版本 {{ supplier.version }}</span>
          <SupplierStatusActions
            :supplier="supplier" :can-manage="canManage" :can-approve="canApprove"
            :username="session.user?.username ?? ''"
            @updated="lifecycleUpdated" @conflict="lifecycleConflict" @deleted="lifecycleDeleted"
          />
        </div>

        <SupplierCompletenessBanner :issues="completeness.issues" :warnings="completeness.warnings" />

        <q-tabs v-model="tab" align="left" active-color="primary" class="q-mb-md">
          <q-tab name="overview" label="概覽" />
          <q-tab name="addresses" :label="`地址 (${supplier.addresses.length})`" />
          <q-tab name="contacts" :label="`聯絡人 (${supplier.contacts.length})`" />
          <q-tab name="identifiers" :label="`識別資料 (${supplier.identifiers.length})`" />
          <!--
            冇數字：supplier detail 個 bankAccounts 恒空（toSupplierDetailResponse
            嗰個 default `[]` 冇人填），所以之前個 "(0)" 由頭到尾都係假嘅。真實數量
            由 SupplierBankPanel 自己叫 GET /suppliers/:id/bank-accounts 攞。
          -->
          <q-tab name="bank" label="銀行資料" />
        </q-tabs>

        <q-tab-panels v-model="tab" animated>
          <q-tab-panel name="overview" class="q-pa-none">
            <div class="row q-gutter-sm q-mb-md">
              <q-btn v-if="canManage && !editing && supplier.status !== 'archived'" color="primary" label="編輯一般資料" @click="startEdit" />
              <q-btn v-if="canManage && !editing && supplier.status !== 'archived'" outline color="negative" label="受控修正 Supplier Code" @click="openCodeDialog" />
            </div>

            <q-list v-if="!editing" bordered separator>
              <q-item><q-item-section><q-item-label caption>顯示名稱</q-item-label><q-item-label>{{ supplier.displayName || "—" }}</q-item-label></q-item-section></q-item>
              <q-item><q-item-section><q-item-label caption>預設貨幣</q-item-label><q-item-label>{{ supplier.defaultCurrencyCode }}</q-item-label></q-item-section></q-item>
              <q-item><q-item-section><q-item-label caption>付款條件</q-item-label><q-item-label>{{ supplier.defaultPaymentTermId ?? "未設定" }}</q-item-label></q-item-section></q-item>
              <q-item><q-item-section><q-item-label caption>網站</q-item-label><q-item-label>{{ supplier.website || "—" }}</q-item-label></q-item-section></q-item>
              <q-item><q-item-section><q-item-label caption>電話／電郵</q-item-label><q-item-label>{{ supplier.generalPhone || "—" }}／{{ supplier.generalEmail || "—" }}</q-item-label></q-item-section></q-item>
              <q-item><q-item-section><q-item-label caption>備註</q-item-label><q-item-label class="pre-line">{{ supplier.notes || "—" }}</q-item-label></q-item-section></q-item>
            </q-list>

            <q-card v-else flat bordered>
              <q-card-section>
                <div v-if="hasEditErrors" ref="editErrorRef" role="alert" tabindex="-1" class="q-mb-md">
                  <q-banner class="bg-negative text-white" rounded>
                    {{ editError || "請檢查下面標示錯誤的欄位。" }}
                    <template v-if="staleNotice" #action>
                      <q-btn flat label="載入最新資料" @click="reloadLatest" />
                    </template>
                  </q-banner>
                </div>
                <q-banner v-if="duplicateCandidates.length" class="bg-warning text-dark q-mb-md" rounded>
                  名稱相近的供應商：
                  <span v-for="candidate in duplicateCandidates" :key="candidate.supplierId" class="q-ml-sm">
                    {{ candidate.supplierCode }} — {{ candidate.supplierName }}
                  </span>
                </q-banner>
                <div class="row q-col-gutter-md">
                  <div class="col-12 col-md-6">
                    <q-input :model-value="supplier.supplierCode" label="Supplier Code" outlined dense readonly hint="一般編輯不可修改；請使用獨立受控修正功能。" />
                  </div>
                  <div class="col-12 col-md-6">
                    <q-input v-model="form.supplierName" label="Supplier Name *" outlined dense maxlength="190" :error="!!fieldError('supplierName')" :error-message="fieldError('supplierName')" />
                  </div>
                  <div class="col-12 col-md-6">
                    <q-input v-model="form.displayName" label="顯示名稱" outlined dense maxlength="190" :error="!!fieldError('displayName')" :error-message="fieldError('displayName')" />
                  </div>
                </div>

                <div class="text-subtitle2 q-mt-lg q-mb-sm">付款預設</div>
                <SupplierPaymentDefaults v-model="form" :field-error="fieldError" />
                <q-input
                  v-if="currencyChanged" v-model="form.reason" class="q-mt-sm"
                  label="修改預設幣別原因 *" type="textarea" outlined dense maxlength="500"
                  hint="最少 5 個字元；會寫入稽核記錄。"
                />

                <div class="row q-col-gutter-md q-mt-sm">
                  <div class="col-12 col-md-6"><q-input v-model="form.generalPhone" label="一般電話（選填）" outlined dense maxlength="50" /></div>
                  <div class="col-12 col-md-6"><q-input v-model="form.generalEmail" label="一般電郵（選填）" type="email" outlined dense maxlength="254" :error="!!fieldError('generalEmail')" :error-message="fieldError('generalEmail')" /></div>
                  <div class="col-12"><q-input v-model="form.website" label="網站（選填）" type="url" outlined dense maxlength="500" :error="!!fieldError('website')" :error-message="fieldError('website')" /></div>
                  <div class="col-12"><q-input v-model="form.notes" label="備註（選填）" type="textarea" outlined dense maxlength="2000" autogrow /></div>
                </div>
              </q-card-section>
              <q-card-actions align="right">
                <q-btn flat label="取消" @click="cancelEdit" />
                <q-btn color="primary" label="儲存一般資料" :disable="!editValid || staleNotice" :loading="submitting" @click="saveEdit" />
              </q-card-actions>
            </q-card>
          </q-tab-panel>
          <q-tab-panel name="addresses">
            <SupplierAddressPanel
              :supplier-id="supplier.id" :supplier-code="supplier.supplierCode"
              :addresses="supplier.addresses" :can-manage="canManage" @refresh="load"
            />
          </q-tab-panel>
          <q-tab-panel name="contacts">
            <SupplierContactPanel
              :supplier-id="supplier.id" :supplier-code="supplier.supplierCode"
              :contacts="supplier.contacts" :can-manage="canManage" @refresh="load"
            />
          </q-tab-panel>
          <q-tab-panel name="identifiers">
            <SupplierIdentifierPanel
              :supplier-id="supplier.id" :supplier-code="supplier.supplierCode"
              :identifiers="supplier.identifiers" :can-manage="canManage" @refresh="load"
            />
          </q-tab-panel>
          <q-tab-panel name="bank">
            <SupplierBankPanel :supplier-id="supplier.id" :supplier-code="supplier.supplierCode" @refresh="load" />
          </q-tab-panel>
        </q-tab-panels>
      </template>
    </div>

    <q-dialog v-model="showCodeDialog" persistent>
      <q-card style="width: min(560px, 94vw)">
        <q-form @submit.prevent="submitCodeChange">
          <input class="reauth-username" type="text" autocomplete="username" :value="session.user?.username ?? ''" tabindex="-1" aria-hidden="true">
        <q-card-section><div class="text-h6">受控修正 Supplier Code</div></q-card-section>
        <q-card-section class="q-pt-none">
          <q-banner class="bg-warning text-dark q-mb-md" rounded>
            只允許未被任何交易或設定引用的供應商。修正後舊交易快照不會被改寫，操作會留下原因及稽核記錄。
          </q-banner>
          <q-banner v-if="codeError" class="bg-negative text-white q-mb-md" rounded role="alert">{{ codeError }}</q-banner>
          <q-input v-model="codeForm.supplierCode" label="新 Supplier Code *" outlined dense maxlength="64" autofocus />
          <q-input v-model="codeForm.reason" label="修正原因 *" type="textarea" outlined dense maxlength="500" class="q-mt-md" hint="最少 5 個字元" />
          <q-input v-model="codeForm.password" label="目前密碼 *" type="password" outlined dense maxlength="1024" class="q-mt-md" autocomplete="current-password" />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="取消" v-close-popup />
          <q-btn color="negative" label="確認修正" type="submit" :disable="!codeValid" :loading="codeSubmitting" />
        </q-card-actions>
        </q-form>
      </q-card>
    </q-dialog>
  </div>
</template>

<style scoped>
.pre-line { white-space: pre-line; }
.reauth-username {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}
</style>
