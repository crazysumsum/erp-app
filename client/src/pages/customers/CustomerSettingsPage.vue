<script>
export const page = { name: "customer-settings", path: "/customer-settings", title: "客戶設定", requires: { permissions: ["customer.view", "customer.settings"] }, menu: { group: "customers", icon: "settings", order: 90 } };
</script>
<script setup>
import { onMounted, ref } from "vue";
import PageHeader from "@/framework/layout/PageHeader.vue";
import CustomerCatalogPanel from "@/components/customers/CustomerCatalogPanel.vue";
import { promptPassword } from "@/framework/ui/confirm.js";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";
import customerSettingsService from "@/services/customerSettings.js";

const settings = ref(null); const loading = ref(true); const saving = ref(false); const error = ref("");
async function loadSettings() { settings.value = await customerSettingsService.get(); error.value = ""; }
async function load() { loading.value = true; try { await loadSettings(); } catch (e) { error.value = e.message || "載入客戶設定失敗"; } finally { loading.value = false; } }
onMounted(load);
async function toggle(next) {
  const target = Boolean(next);
  const confirmation = await promptPassword({ title: target ? "開啟啟用審批" : "關閉啟用審批", message: "這項設定只影響之後提交的啟用操作；現有待審批申請不會被追溯更改。", okLabel: "確認儲存", requireReason: true });
  if (!confirmation) return; saving.value = true;
  try { settings.value = await customerSettingsService.update({ requireActivationApproval: target, version: settings.value.version, ...confirmation }); notifySuccess(target ? "已開啟客戶啟用審批" : "已關閉客戶啟用審批"); }
  catch (e) {
    if (e.code === "VERSION_CONFLICT") {
      try { await loadSettings(); notifyError("設定已被其他人修改，已載入目前值，請重新確認"); }
      catch (reloadError) { notifyError(reloadError.message || "設定已被修改，但重新載入失敗，請重新整理頁面"); }
    } else notifyError(e.message || "儲存設定失敗");
  }
  finally { saving.value = false; }
}
</script>
<template><div><PageHeader subtitle="管理客戶啟用審批與分類目錄。" /><main class="column q-gutter-md q-pa-md" style="max-width:1000px"><q-spinner-dots v-if="loading" size="2em" aria-label="載入客戶設定" /><q-banner v-else-if="error || !settings" class="bg-negative text-white" role="alert">{{ error || '載入客戶設定失敗' }}<template #action><q-btn flat label="重新載入" @click="load" /></template></q-banner><q-card v-else flat bordered><q-card-section><h2 class="text-subtitle1 q-ma-none">啟用審批</h2></q-card-section><q-card-section class="q-pt-none"><q-toggle :model-value="settings.requireActivationApproval" :disable="saving" label="啟用客戶前需要另一名使用者審批" @update:model-value="toggle" /><p>目前為 <strong>{{ settings.requireActivationApproval ? '開啟' : '關閉' }}</strong>。</p><p class="text-caption text-grey-8">只影響之後提交的啟用操作；現有待審批申請維持原狀。</p></q-card-section></q-card><CustomerCatalogPanel catalog="categories" title="客戶分類" /><CustomerCatalogPanel catalog="industries" title="行業" /><CustomerCatalogPanel catalog="territories" title="地區" /></main></div></template>
