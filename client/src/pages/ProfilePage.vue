<script>
// 冇 `requires`：validatePages.js 容許唔宣告，routeGuard.js 對「非
// public 且冇 meta.requires」嘅頁面淨係要求已登入——正係要嘅語意（見
// docs/user_management/design_spec.md §4.5）。冇 `menu`，唔入側欄：入口喺
// AppTopbar.vue 個落拉選單。
export const page = {
  name: "profile",
  path: "/account/profile",
  title: "個人資料"
};
</script>

<script setup>
import { ref } from "vue";
import DataTable from "@/framework/ui/DataTable.vue";
import EllipsisCell from "@/framework/ui/EllipsisCell.vue";
import FormPanel from "@/framework/ui/FormPanel.vue";
import PageHeader from "@/framework/layout/PageHeader.vue";
import { notifySuccess } from "@/framework/ui/notify.js";
import { currentDeviceId } from "@/framework/auth/deviceKey.js";
import userService from "@/services/user.js";
import deviceService from "@/services/device.js";
import { useSessionStore } from "@/stores/session.js";

const session = useSessionStore();

const displayName = ref(session.user?.displayName ?? "");
const email = ref(session.user?.email ?? "");

const required = (val) => !!val || "必填";

async function submit() {
  const result = await userService.updateOwnProfile({
    displayName: displayName.value,
    email: email.value
  });

  // 直接改 session.user 個欄位（Pinia state 本身係 reactive），令 AppTopbar
  // 嘅顯示名稱即刻反映新值——唔使成個 user 物件掉包，亦唔會動到 roles／
  // permissions 呢啲呢支 API 冇改過嘅欄位。
  if (session.user) {
    session.user.displayName = result.displayName;
    session.user.email = result.email;
  }

  notifySuccess("個人資料已更新");
  return result;
}

/* ---------------- 我的設備（唯讀，原 MyDevicesPage.vue 搬過嚟） ---------------- */

const thisDeviceId = ref("");

const deviceColumns = [
  { name: "label", label: "裝置名稱", field: "label", align: "left" },
  { name: "status", label: "狀態", field: "status", align: "left" },
  { name: "deviceId", label: "設備編號", field: "deviceId", align: "left" },
  { name: "lastUsedAt", label: "最後使用", field: "lastUsedAt", align: "left" },
  { name: "requestedAt", label: "申請時間", field: "requestedAt", align: "left" }
];

const DEVICE_STATUS = {
  approved: { label: "已核准", colour: "positive" },
  pending: { label: "等待審批", colour: "warning" },
  rejected: { label: "已拒絕", colour: "negative" },
  revoked: { label: "已停用", colour: "grey" }
};

async function fetchMyDevices() {
  // 順手記低自己而家坐緊邊一台，等清單可以標出嚟——一個人有幾台已核准設備
  // 嘅時候，「邊個係我而家用緊嗰個」淨係睇 thumbprint 分唔出。
  thisDeviceId.value = await currentDeviceId().catch(() => "");

  const rows = await deviceService.listMine();
  return { rows, rowsNumber: rows.length };
}

function formatTime(epochMs) {
  // null 代表從來未成功用過（仲喺等審批，或者核准咗但用戶再冇返嚟）。
  // 顯示 0 會變成 1970 年。
  return epochMs === null ? "—" : new Date(epochMs).toLocaleString();
}
</script>

<template>
  <div>
    <PageHeader title="個人資料" />

    <div class="row justify-center q-px-md q-pb-md">
      <q-card style="width: 100%; max-width: 640px" class="q-pa-md">
        <q-card-section>
          <FormPanel v-slot="{ fieldError, submitting }" :on-submit="submit">
            <div class="q-gutter-md">
              <q-input :model-value="session.user?.username" label="帳號" filled readonly />
              <q-input
                v-model="displayName"
                label="顯示名稱"
                filled
                :rules="[required]"
                :error="!!fieldError('displayName')"
                :error-message="fieldError('displayName')"
              />
              <q-input
                v-model="email"
                label="電子郵件"
                filled
                :error="!!fieldError('email')"
                :error-message="fieldError('email')"
              />

              <div class="row justify-end">
                <q-btn type="submit" color="primary" label="儲存" unelevated :loading="submitting" />
              </div>
            </div>
          </FormPanel>
        </q-card-section>

        <q-separator />

        <q-card-section>
          <div class="text-subtitle2 q-mb-sm">我的角色</div>
          <div v-if="session.roles.length === 0" class="text-grey-7">沒有任何角色</div>
          <q-chip v-for="role in session.roles" :key="role" dense>{{ role }}</q-chip>
        </q-card-section>

        <q-separator />

        <q-card-section>
          <div class="text-subtitle2 q-mb-sm">我的設備</div>
          <DataTable :fetch="fetchMyDevices" :columns="deviceColumns" row-key="id">
            <template #body-cell-label="{ value }">
              <EllipsisCell :text="value || '（未命名）'" max-width="160px" />
            </template>

            <template #body-cell-status="{ value }">
              <q-td class="text-left">
                <q-badge :color="DEVICE_STATUS[value]?.colour ?? 'grey'" :label="DEVICE_STATUS[value]?.label ?? value" />
              </q-td>
            </template>

            <template #body-cell-deviceId="{ value }">
              <q-td class="text-left">
                <span class="text-caption">
                  {{ value.slice(0, 16) }}…
                  <q-tooltip>{{ value }}</q-tooltip>
                </span>
                <q-badge v-if="value === thisDeviceId" color="primary" class="q-ml-sm" label="目前這台" />
              </q-td>
            </template>

            <template #body-cell-lastUsedAt="{ value }">
              <q-td class="text-left">{{ formatTime(value) }}</q-td>
            </template>

            <template #body-cell-requestedAt="{ value }">
              <q-td class="text-left">{{ formatTime(value) }}</q-td>
            </template>
          </DataTable>
        </q-card-section>
      </q-card>
    </div>
  </div>
</template>
