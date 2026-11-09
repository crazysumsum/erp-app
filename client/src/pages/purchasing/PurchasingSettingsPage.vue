<script>
export const page = { name: "purchasing-settings", path: "/purchasing/settings", title: "採購設定", requires: { permissions: ["purchasing.settings"] },
  menu: { group: "purchasingReceiving", icon: "tune", order: 90 } };
</script>
<script setup>
import { onBeforeUnmount, onMounted, ref } from "vue";
import appConfig from "@config/app.js";
import PageHeader from "@/framework/layout/PageHeader.vue";
import DataTable from "@/framework/ui/DataTable.vue";
import EllipsisCell from "@/framework/ui/EllipsisCell.vue";
import { timestamp } from "@/components/purchasing/purchaseOrderPresentation.js";
import { useCommandEvent } from "@/composables/purchasing/useCommandEvent.js";
import { notifySuccess } from "@/framework/ui/notify.js";
import purchasing from "@/services/purchasing.js";

// §5.4：改設定只影響之後提交嘅 PO；要已註冊裝置簽署兼再輸入密碼。密碼唔入 intent，出錯清走，原因保留。
const settings = ref(null), loading = ref(false), loadError = ref("");
const target = ref(false), reason = ref(""), password = ref(""), saving = ref(false), saveError = ref(""), stale = ref(false);
const command = useCommandEvent();
const controller = new AbortController();
onBeforeUnmount(() => controller.abort());
const columns = [
  { name: "occurredAt", label: "時間", field: "occurredAt", align: "left" },
  { name: "requirePoApproval", label: "採購單審批", field: "requirePoApproval", align: "left" },
  { name: "version", label: "版本", field: "version", align: "right" },
  { name: "actorLabel", label: "修改人", field: "actorLabel", align: "left" },
  { name: "reason", label: "原因", field: "reason", align: "left" }
];
const label = (value) => (value ? "需要審批" : "不需審批");

async function load() {
  loading.value = true; loadError.value = ""; stale.value = false;
  try {
    settings.value = await purchasing.getSettings({ signal: controller.signal });
    target.value = settings.value.requirePoApproval;
    command.reset();
  } catch (failure) {
    if (!controller.signal.aborted) loadError.value = failure.message || "載入採購設定失敗";
  } finally { loading.value = false; }
}
onMounted(load);

async function save() {
  const text = reason.value.trim();
  saveError.value = text.length < 5 || text.length > 500 ? "原因須為 5–500 字" : password.value ? "" : "請輸入密碼";
  if (saveError.value) return;
  saving.value = true;
  const secret = password.value;
  try {
    const result = await command.run({ version: settings.value.version, requirePoApproval: target.value, reason: text },
      (body) => purchasing.updateSettings({ ...body, password: secret }));
    notifySuccess(`採購單審批已設為「${label(result.requirePoApproval)}」，只影響之後提交的採購單。`);
    reason.value = "";
    await load();
  } catch (failure) {
    stale.value = failure.code === "VERSION_CONFLICT";
    saveError.value = command.uncertain.value ? "結果尚未確認；請再輸入密碼，重試同一操作以確認結果。" : failure.message || "儲存失敗";
  } finally {
    password.value = "";
    saving.value = false;
  }
}
</script>

<template>
  <div>
    <PageHeader subtitle="設定提交採購單時是否需要指定審批人。變更只影響之後提交的採購單，已在審批中的不受影響。" />
    <div class="q-px-md q-pb-md">
      <q-skeleton v-if="loading && !settings" type="rect" aria-label="載入採購設定" />
      <q-banner v-else-if="loadError" role="alert" class="bg-negative text-white">{{ loadError }}<template #action><q-btn flat label="重試" @click="load" /></template></q-banner>
      <template v-else-if="settings">
        <q-card flat bordered class="q-mb-md">
          <q-card-section>
            <h2 class="text-h6 q-ma-none q-mb-sm">採購單審批</h2>
            <p>目前：<strong>{{ label(settings.requirePoApproval) }}</strong>（版本 {{ settings.version }}；{{ settings.updatedByLabel }}，{{ timestamp(settings.updatedAt) }}）</p>
            <q-banner v-if="saveError" role="alert" class="bg-negative text-white q-mb-sm">{{ saveError }}<template v-if="stale" #action><q-btn flat label="載入最新設定" @click="load" /></template></q-banner>
            <q-toggle v-model="target" label="提交採購單時需要審批" :disable="command.uncertain.value" />
            <q-input v-model="reason" label="變更原因 *" type="textarea" autogrow maxlength="500" counter :readonly="command.uncertain.value" class="q-mt-sm" outlined dense />
            <q-input v-model="password" label="密碼 *" type="password" autocomplete="current-password" class="q-mt-sm" outlined dense />
            <q-btn color="primary" class="q-mt-sm" :label="command.uncertain.value ? '重試確認結果' : '儲存設定'" :loading="saving"
              :disable="!command.uncertain.value && target === settings.requirePoApproval" @click="save" />
          </q-card-section>
        </q-card>
        <h2 class="text-h6 q-ma-none q-mb-md">變更紀錄（最近 50 次）</h2>
        <DataTable :rows="settings.history" :columns="columns" row-key="version" :initial-pagination="{ page: 1, rowsPerPage: appConfig.defaultPageSize, sortBy: null, descending: false }">
          <template #body-cell-occurredAt="{ row }"><q-td>{{ timestamp(row.occurredAt) }}</q-td></template>
          <template #body-cell-requirePoApproval="{ row }"><q-td>{{ label(row.requirePoApproval) }}</q-td></template>
          <template #body-cell-reason="{ row }"><EllipsisCell :text="row.reason" /></template>
          <template #no-data><p role="status" class="q-ma-none">尚未有變更紀錄。</p></template>
        </DataTable>
      </template>
    </div>
  </div>
</template>
