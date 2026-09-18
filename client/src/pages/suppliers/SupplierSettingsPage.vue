<script>
export const page = {
  name: "supplier-settings",
  path: "/suppliers/settings",
  title: "供應商設定",
  requires: { permissions: ["supplier.settings"] },
  menu: { group: "suppliers", icon: "settings", order: 90 }
};
</script>

<script setup>
import { computed, onMounted, ref } from "vue";
import PageHeader from "@/framework/layout/PageHeader.vue";
import { can } from "@/framework/authorization/can.js";
import { promptPassword } from "@/framework/ui/confirm.js";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";
import { useSessionStore } from "@/stores/session.js";
import supplierSettingsService from "@/services/supplierSettings.js";

/**
 * 設計 §7.7。呢一頁刻意只做一件事：啟用審批開關。
 *
 * Currency／Payment Term 喺度**只讀**——Business Master 先係佢哋嘅 owner（設計
 * §2.2、DES-001）。所以呢頁冇任何 create／update／deactivate 控制，亦唔會發任何
 * Supplier write request 去改目錄；佢只顯示 provider 就緒狀態同一條去 Business
 * Master 管理頁嘅連結。
 */

const BUSINESS_MASTER_LINKS = Object.freeze([
  { label: "貨幣", path: "/system/business-master/currencies" },
  { label: "付款條款", path: "/system/business-master/payment-terms" }
]);

const session = useSessionStore();

const settings = ref(null);
const readiness = ref(null);
const loading = ref(true);
const saving = ref(false);
const readinessError = ref("");
const settingsError = ref("");

// 唯讀連結導向 Business Master，嗰邊自己閘 business_master.view。冇權限就唔扮有得
// 㩒——設計 §7.7 講「唯讀連結**或**狀態提示」，所以呢度二選一。
const canOpenBusinessMaster = computed(() => can(session, { permissions: ["business_master.view"] }));

const readinessColor = computed(() => (readiness.value?.status === "READY" ? "positive" : "warning"));
const readinessLabel = computed(() => (readiness.value?.status === "READY" ? "可用" : "未就緒"));

const missingParts = computed(() => {
  if (!readiness.value || readiness.value.status === "READY") return [];
  return [
    { ready: readiness.value.schemaReady, label: "資料表尚未建立或版本不符" },
    { ready: readiness.value.hkdReady, label: "HKD 基準貨幣尚未就緒" },
    { ready: readiness.value.permissionsReady, label: "Business Master 權限尚未種入" }
  ].filter((part) => !part.ready).map((part) => part.label);
});

async function loadSettings() {
  settings.value = await supplierSettingsService.get();
}

async function loadReadiness() {
  try {
    readiness.value = await supplierSettingsService.businessMasterReadiness();
    readinessError.value = "";
  } catch (error) {
    // 依賴狀態讀唔到唔應該令成頁死——開關本身同 Business Master 無關。
    readiness.value = null;
    readinessError.value = error.message || "無法讀取 Business Master 狀態";
  }
}

async function load() {
  loading.value = true;
  try {
    await Promise.all([loadSettings(), loadReadiness()]);
    settingsError.value = "";
  } catch (error) {
    // 讀唔到設定唔可以淨係彈個 toast 就算：`settings` 會留喺 null，而下面個
    // template 會即刻 dereference 佢，變成一個 raw TypeError 出街（REV-028 H-1）。
    // 所以要有自己嘅狀態。
    settingsError.value = error.message || "載入供應商設定失敗";
    notifyError(settingsError.value);
  } finally {
    loading.value = false;
  }
}

onMounted(load);

async function toggleApproval(next) {
  const target = Boolean(next);
  const confirmation = await promptPassword({
    title: target ? "開啟啟用審批" : "關閉啟用審批",
    message: target
      ? "開啟後，之後提交的啟用操作需要另一名具審批權限的使用者批准。已在審批中的申請不受影響。"
      : "關閉後，之後提交的啟用操作會直接啟用。已在審批中的申請不會自動批准，仍需處理。",
    okLabel: "確認儲存",
    requireReason: true
  });
  if (!confirmation) return;

  saving.value = true;
  try {
    settings.value = await supplierSettingsService.update({
      requireActivationApproval: target,
      version: settings.value.version,
      reason: confirmation.reason,
      password: confirmation.password
    });
    notifySuccess(target ? "已開啟啟用審批" : "已關閉啟用審批");
  } catch (error) {
    // VERSION_CONFLICT 唔自動重試：重新載入最新值，要求使用者對住新狀態再決定一次
    // （設計 §7.4 同 §7.7 同一條規矩）。
    if (error.code === "VERSION_CONFLICT") {
      await loadSettings();
      notifyError("設定已被其他人修改，已重新載入目前值，請確認後再儲存");
    } else {
      notifyError(error.message || "儲存設定失敗");
    }
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div>
    <PageHeader subtitle="管理供應商模組的啟用審批參數。" />

    <div v-if="loading" class="q-pa-md">
      <q-spinner-dots size="2em" aria-label="載入中" />
    </div>

    <div v-else-if="!settings" class="q-pa-md">
      <q-banner class="bg-negative text-white">
        {{ settingsError || "載入供應商設定失敗" }}
        <template #action>
          <q-btn flat label="重新載入" @click="load" />
        </template>
      </q-banner>
    </div>

    <div v-else class="column q-gutter-md q-pa-md">
      <q-card flat bordered>
        <q-card-section>
          <h2 class="text-subtitle1 q-ma-none">啟用審批</h2>
        </q-card-section>
        <q-card-section class="q-pt-none">
          <q-toggle
            :model-value="settings.requireActivationApproval"
            :disable="saving"
            label="啟用供應商前需要另一名使用者審批"
            @update:model-value="toggleApproval"
          />
          <p class="text-body2 q-mt-md q-mb-none">
            預設為關閉。目前為
            <strong>{{ settings.requireActivationApproval ? "開啟" : "關閉" }}</strong>。
          </p>
          <p class="text-caption text-grey-8 q-mb-none">
            設定只影響之後提交的啟用操作，不追溯處理已在審批中的申請。
          </p>
        </q-card-section>
      </q-card>

      <q-card flat bordered>
        <q-card-section class="row items-center justify-between">
          <h2 class="text-subtitle1 q-ma-none">貨幣與付款條款</h2>
          <q-chip v-if="readiness" :color="readinessColor" text-color="white" :label="readinessLabel" />
        </q-card-section>
        <q-card-section class="q-pt-none">
          <p class="text-body2 q-mb-sm">
            這兩項主資料由 Business Master 擁有，供應商模組只讀取與引用，不在這裡新增或修改。
          </p>

          <p v-if="readinessError" class="text-body2 text-negative q-mb-sm">{{ readinessError }}</p>

          <template v-else-if="readiness">
            <p class="text-body2 q-mb-sm">
              可用貨幣 {{ readiness.activeCurrencyCount }} 項、可用付款條款
              {{ readiness.activePaymentTermCount }} 項。
            </p>
            <ul v-if="missingParts.length" class="text-body2 text-warning q-mt-none">
              <li v-for="part in missingParts" :key="part">{{ part }}</li>
            </ul>
          </template>

          <div v-if="canOpenBusinessMaster" class="q-gutter-sm">
            <q-btn
              v-for="link in BUSINESS_MASTER_LINKS"
              :key="link.path"
              flat
              dense
              color="primary"
              icon-right="open_in_new"
              :label="`前往管理${link.label}`"
              :to="link.path"
            />
          </div>
          <p v-else class="text-caption text-grey-8 q-mb-none">
            需要 Business Master 檢視權限才能開啟管理頁面。
          </p>
        </q-card-section>
      </q-card>
    </div>
  </div>
</template>
