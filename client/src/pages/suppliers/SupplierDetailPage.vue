<script>
export const page = {
  name: "supplier-detail",
  path: "/suppliers/:id",
  title: "供應商詳情",
  requires: { permissions: ["supplier.view"] }
};
</script>

<script setup>
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import PageHeader from "@/framework/layout/PageHeader.vue";
import SupplierAddressPanel from "@/components/suppliers/SupplierAddressPanel.vue";
import SupplierCompletenessBanner from "@/components/suppliers/SupplierCompletenessBanner.vue";
import SupplierContactPanel from "@/components/suppliers/SupplierContactPanel.vue";
import SupplierIdentifierPanel from "@/components/suppliers/SupplierIdentifierPanel.vue";
import { can } from "@/framework/authorization/can.js";
import supplierService from "@/services/supplier.js";
import { useSessionStore } from "@/stores/session.js";

const STATUS_LABEL = Object.freeze({
  draft: "草稿", pending_approval: "待審批", active: "啟用", suspended: "已暫停",
  blocked: "已封鎖", archived: "已封存"
});
const route = useRoute();
const session = useSessionStore();
const canManage = computed(() => can(session, { permissions: ["supplier.mgmt"] }));
const supplier = ref(null);
const loading = ref(true);
const error = ref(null);
const tab = ref("overview");
const unavailableForPurchasing = computed(() => supplier.value && supplier.value.status !== "active");

async function load() {
  loading.value = true;
  error.value = null;
  try {
    supplier.value = await supplierService.getById(Number(route.params.id));
  } catch (loadError) {
    error.value = loadError;
  } finally {
    loading.value = false;
  }
}
onMounted(load);
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
        </div>

        <SupplierCompletenessBanner :warnings="supplier.warnings" />

        <q-tabs v-model="tab" align="left" active-color="primary" class="q-mb-md">
          <q-tab name="overview" label="概覽" />
          <q-tab name="addresses" :label="`地址 (${supplier.addresses.length})`" />
          <q-tab name="contacts" :label="`聯絡人 (${supplier.contacts.length})`" />
          <q-tab name="identifiers" :label="`識別資料 (${supplier.identifiers.length})`" />
          <q-tab name="bank" :label="`銀行資料 (${supplier.bankAccounts.length})`" />
        </q-tabs>

        <q-tab-panels v-model="tab" animated>
          <q-tab-panel name="overview" class="q-pa-none">
            <q-list bordered separator>
              <q-item><q-item-section><q-item-label caption>顯示名稱</q-item-label><q-item-label>{{ supplier.displayName || "—" }}</q-item-label></q-item-section></q-item>
              <q-item><q-item-section><q-item-label caption>預設貨幣</q-item-label><q-item-label>{{ supplier.defaultCurrencyCode }}</q-item-label></q-item-section></q-item>
              <q-item><q-item-section><q-item-label caption>付款條件</q-item-label><q-item-label>{{ supplier.defaultPaymentTermId ?? "未設定" }}</q-item-label></q-item-section></q-item>
              <q-item><q-item-section><q-item-label caption>電話／電郵</q-item-label><q-item-label>{{ supplier.generalPhone || "—" }}／{{ supplier.generalEmail || "—" }}</q-item-label></q-item-section></q-item>
            </q-list>
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
            <div v-if="!supplier.bankAccounts.length" class="text-grey-7">尚未設定銀行資料</div>
            <q-list v-else bordered separator>
              <q-item v-for="bank in supplier.bankAccounts" :key="bank.id">
                <q-item-section><q-item-label>{{ bank.bankName }}</q-item-label><q-item-label caption>{{ bank.maskedAccountNumber }}</q-item-label></q-item-section>
                <q-item-section side><q-badge v-if="bank.isDefault" label="預設" /></q-item-section>
              </q-item>
            </q-list>
          </q-tab-panel>
        </q-tab-panels>
      </template>
    </div>
  </div>
</template>
