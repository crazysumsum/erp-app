<script setup>
import { computed, reactive, ref } from "vue";
import supplierService from "@/services/supplier.js";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";
import SupplierApprovalPanel from "./SupplierApprovalPanel.vue";

const props = defineProps({
  supplier: { type: Object, required: true },
  canManage: { type: Boolean, default: false },
  canApprove: { type: Boolean, default: false },
  username: { type: String, default: "" },
  compact: { type: Boolean, default: false }
});
const emit = defineEmits(["updated", "deleted", "conflict"]);

const definitions = Object.freeze({
  activate: { label: "啟用", target: "啟用", service: "activate", from: ["draft"], manage: true, reason: false, password: false },
  suspend: { label: "暫停", target: "已暫停", service: "suspend", from: ["active"], manage: true, reason: true, password: true },
  reactivate: { label: "重新啟用", target: "啟用", service: "reactivate", from: ["suspended"], manage: true, reason: true, password: true },
  block: { label: "封鎖", target: "已封鎖", service: "block", from: ["active", "suspended"], approve: true, reason: true, password: true, device: true },
  unblock: { label: "解除封鎖", target: "已暫停", service: "unblock", from: ["blocked"], approve: true, reason: true, password: true, device: true },
  archive: { label: "封存", target: "已封存", service: "archive", from: ["draft", "active", "suspended"], manage: true, reason: true, password: true },
  restore: { label: "還原", target: "已暫停", service: "restore", from: ["archived"], manage: true, reason: true, password: true },
  deleteSupplier: { label: "永久刪除", target: "永久刪除", service: "deleteSupplier", from: ["draft"], manage: true, reason: true, password: true, device: true, destructive: true }
});

const actions = computed(() => Object.entries(definitions)
  .filter(([, item]) => item.from.includes(props.supplier.status))
  .filter(([, item]) => (item.manage && props.canManage) || (item.approve && props.canApprove))
  .map(([key, item]) => ({ key, ...item })));

const showDialog = ref(false);
const selected = ref(null);
const submitting = ref(false);
const errorMessage = ref("");
const blockers = ref([]);
const form = reactive({ reason: "", password: "" });
// DEF-042（HD-138 A）：審批開咗嘅時候，「啟用」其實係提交審批，要喺度揀審批人（設計 §7.4，同新增頁同一個 panel）。
const approval = ref({ approverUserId: null, requestNote: "" });
const requireApproval = ref(false);
// 政策未讀完就唔准確認（REV-119 L-2）；讀失敗係 null，交返伺服器判斷。
const policyRead = ref(false);
// 政策喺對話框開住期間改咗：重新掛載 panel 令佢再讀一次（REV-119 L-1）。
const panelKey = ref(0);
const approverError = ref("");
const submitsForApproval = computed(() => selected.value?.key === "activate" && requireApproval.value);
const shown = computed(() => (submitsForApproval.value ? { ...selected.value, label: "提交審批", target: "待審批" } : selected.value));
const valid = computed(() => {
  if (!selected.value) return false;
  if (selected.value.key === "activate" && !policyRead.value) return false;
  if (submitsForApproval.value && !approval.value.approverUserId) return false;
  if (selected.value.reason && (form.reason.trim().length < 5 || form.reason.trim().length > 500)) return false;
  if (selected.value.password && !form.password) return false;
  return true;
});

function open(action) {
  selected.value = action;
  form.reason = "";
  form.password = "";
  approval.value = { approverUserId: null, requestNote: "" };
  requireApproval.value = false;
  policyRead.value = false;
  approverError.value = "";
  errorMessage.value = "";
  blockers.value = [];
  showDialog.value = true;
}

async function submit() {
  if (!valid.value || submitting.value) return;
  submitting.value = true;
  errorMessage.value = "";
  approverError.value = "";
  blockers.value = [];
  const action = selected.value;
  try {
    const payload = { version: props.supplier.version };
    if (action.reason) payload.reason = form.reason.trim();
    if (action.password) payload.password = form.password;
    const submitted = submitsForApproval.value;
    if (submitted) {
      payload.approverUserId = approval.value.approverUserId;
      if (approval.value.requestNote) payload.requestNote = approval.value.requestNote;
    }
    const result = await supplierService[action.service](props.supplier.id, payload);
    showDialog.value = false;
    if (action.service === "deleteSupplier") {
      emit("deleted", result);
      notifySuccess(`供應商 ${props.supplier.supplierCode} 已永久刪除`);
    } else {
      emit("updated", result);
      notifySuccess(submitted ? `供應商 ${props.supplier.supplierCode} 已提交審批` : `供應商 ${props.supplier.supplierCode} 已${action.target}`);
    }
  } catch (error) {
    form.password = "";
    if (error.code === "VERSION_CONFLICT") {
      errorMessage.value = "狀態已被其他人修改；請查看最新狀態後重新確認。";
      emit("conflict");
    } else {
      errorMessage.value = error.message || "狀態操作失敗";
    }
    // 審批人嘅錯誤標喺審批人欄（REV-119 L-3）；政策同畫面唔一致就重新讀政策（L-1）。
    if (error.details?.field === "approverUserId") approverError.value = error.message || "審批人不正確";
    if (error.code === "APPROVER_REQUIRED" || error.code === "APPROVER_NOT_REQUIRED") {
      approval.value = { approverUserId: null, requestNote: "" };
      policyRead.value = false;
      panelKey.value += 1;
    }
    blockers.value = Object.entries(error.details?.references ?? {}).map(([name, count]) => ({ name, count }));
    notifyError(error.message || "狀態操作失敗");
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div v-if="actions.length" class="row q-gutter-xs">
    <template v-if="!compact">
      <q-btn
        v-for="action in actions" :key="action.key" outline dense
        :color="action.destructive || action.key === 'block' ? 'negative' : 'primary'"
        :label="action.label" @click="open(action)"
      />
    </template>
    <q-btn-dropdown v-else flat dense icon="more_vert" aria-label="供應商狀態操作" dropdown-icon="none">
      <q-list style="min-width: 160px">
        <q-item v-for="action in actions" :key="action.key" clickable v-close-popup @click="open(action)">
          <q-item-section>{{ action.label }}</q-item-section>
        </q-item>
      </q-list>
    </q-btn-dropdown>

    <q-dialog v-model="showDialog" persistent>
      <q-card style="width: min(560px, 94vw)">
        <q-form @submit.prevent="submit">
          <input class="reauth-username" type="text" autocomplete="username" :value="username" tabindex="-1" aria-hidden="true">
          <q-card-section><div class="text-h6">{{ shown?.label }}供應商</div></q-card-section>
          <q-card-section class="q-pt-none">
            <q-banner class="bg-warning text-dark q-mb-md" rounded>
              供應商：{{ supplier.supplierCode }} — {{ supplier.supplierName }}。完成後狀態：{{ shown?.target }}。
              現有交易及稽核歷史會保留；永久刪除只允許從未引用的 Draft。
              <span v-if="selected?.device">此操作還要求已核准裝置。</span>
            </q-banner>
            <q-banner v-if="errorMessage" class="bg-negative text-white q-mb-md" rounded role="alert">
              {{ errorMessage }}
              <ul v-if="blockers.length" class="q-mb-none">
                <li v-for="blocker in blockers" :key="blocker.name">{{ blocker.name }}：{{ blocker.count }}</li>
              </ul>
            </q-banner>
            <SupplierApprovalPanel
              v-if="selected?.key === 'activate'" :key="panelKey" v-model="approval" :disable="submitting" :field-error="approverError"
              @policy="(value) => { requireApproval = Boolean(value); policyRead = true; }"
            />
            <q-input v-if="selected?.reason" v-model="form.reason" label="原因 *" type="textarea" outlined dense maxlength="500" hint="最少 5 個字元" />
            <q-input v-if="selected?.password" v-model="form.password" label="目前密碼 *" type="password" outlined dense maxlength="1024" class="q-mt-md" autocomplete="current-password" />
          </q-card-section>
          <q-card-actions align="right">
            <q-btn flat label="取消" v-close-popup />
            <q-btn
              :color="selected?.destructive || selected?.key === 'block' ? 'negative' : 'primary'"
              :label="`確認${shown?.label ?? ''}`" type="submit" :disable="!valid" :loading="submitting"
            />
          </q-card-actions>
        </q-form>
      </q-card>
    </q-dialog>
  </div>
</template>

<style scoped>
.reauth-username {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}
</style>
