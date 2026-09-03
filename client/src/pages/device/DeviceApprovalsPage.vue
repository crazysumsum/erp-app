<script>
export const page = {
  name: "device-approvals",
  path: "/device/approvals",
  title: "設備審批",
  requires: { permissions: ["device.mgmt"] },
  menu: { group: "userManagement", icon: "devices", order: 10 }
};
</script>

<script setup>
import { ref } from "vue";
import DataTable from "@/framework/ui/DataTable.vue";
import PageHeader from "@/framework/layout/PageHeader.vue";
import { promptPassword } from "@/framework/ui/confirm.js";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";
import deviceService from "@/services/device.js";

const table = ref(null);
const busyId = ref(null);

const columns = [
  { name: "username", label: "帳號", field: "username", align: "left" },
  { name: "label", label: "裝置名稱", field: "label", align: "left" },
  { name: "deviceId", label: "設備編號", field: "deviceId", align: "left" },
  { name: "requestedAt", label: "申請時間", field: "requestedAt", align: "left" },
  { name: "from", label: "來源", field: "requestedIp", align: "left" },
  { name: "actions", label: "", field: "id", align: "right" }
];

// 後端一次回全部待審批（上限 200），冇分頁——審批佇列唔應該長到需要分頁，
// 長到嗰個地步代表冇人喺度審批，嗰個係營運問題唔係介面問題。
async function fetchPending() {
  const rows = await deviceService.listPending();
  return { rows, rowsNumber: rows.length };
}

function formatTime(epochMs) {
  return new Date(epochMs).toLocaleString();
}

async function act(row, { verb, label }) {
  // 核准／拒絕都要求再打一次密碼（後端 authType "jwt-password"）：核准會俾
  // 一台設備長期存取權，值得多呢一步確認。一個對話框同時做埋確認同收密碼。
  const password = await promptPassword({
    title: `${label}設備`,
    message: `確定要${label}「${row.username}」嘅設備「${row.label || "未命名"}」？請輸入你的密碼確認。`,
    okLabel: label
  });

  if (password === null) {
    return;
  }

  busyId.value = row.id;

  try {
    await deviceService[verb](row.id, password);
    notifySuccess(`已${label}`);
  } catch (error) {
    // 409 代表另一個審批者啱啱處理咗同一筆。呢個唔係錯誤，係要話返畀佢知
    // 佢見到嘅清單已經舊咗——所以無論成功定衝突都要重新載入。
    notifyError(error.message || `${label}失敗`);
  } finally {
    busyId.value = null;
    await table.value?.reload();
  }
}

const approve = (row) => act(row, { verb: "approve", label: "核准" });
const reject = (row) => act(row, { verb: "reject", label: "拒絕" });
</script>

<template>
  <div>
    <PageHeader title="設備審批" subtitle="每一台新設備都要經人手批准先可以使用系統" />

    <div class="q-px-md q-pb-md">
    <DataTable ref="table" :fetch="fetchPending" :columns="columns" row-key="id">
      <template #body-cell-deviceId="{ value }">
        <q-td class="text-left">
          <!-- 完整嘅 thumbprint 對人讀唔到亦記唔到，頭 16 個字元已經足夠喺
               兩台待審設備之間分辨，亦足夠同用戶電話對認。 -->
          <span class="text-caption">{{ value.slice(0, 16) }}…</span>
        </q-td>
      </template>

      <template #body-cell-requestedAt="{ value }">
        <q-td class="text-left">{{ formatTime(value) }}</q-td>
      </template>

      <template #body-cell-from="{ row }">
        <q-td class="text-left">
          <div class="text-caption">{{ row.requestedIp || "—" }}</div>
          <!-- UA 同 IP 係審批者唯一嘅判斷依據：冇佢哋，審批就只會退化成
               無腦按核准，而嗰陣呢道關卡就只係流程上嘅裝飾。 -->
          <div class="text-caption text-grey-7">{{ row.requestedUserAgent || "—" }}</div>
        </q-td>
      </template>

      <template #body-cell-actions="{ row }">
        <q-td class="text-right">
          <q-btn
            flat
            dense
            color="negative"
            label="拒絕"
            :loading="busyId === row.id"
            @click="reject(row)"
          />
          <q-btn
            unelevated
            dense
            color="primary"
            label="核准"
            class="q-ml-sm"
            :loading="busyId === row.id"
            @click="approve(row)"
          />
        </q-td>
      </template>
    </DataTable>
    </div>
  </div>
</template>
