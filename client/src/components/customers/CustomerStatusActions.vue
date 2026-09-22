<script setup>
import { computed, nextTick, reactive, ref } from "vue";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";
import customerApprovalService from "@/services/customerApproval.js";
import customerService from "@/services/customer.js";

const props = defineProps({ customer: { type: Object, required: true }, canManage: Boolean, canApprove: Boolean, userId: { type: Number, default: undefined }, username: { type: String, default: "" } });
const emit = defineEmits(["refresh", "deleted"]);
const DEFINITIONS = Object.freeze({
  activate: { label: "啟用", target: "啟用或待審批", service: "activate", from: ["draft"], manage: true },
  suspend: { label: "暫停", target: "已暫停", service: "suspend", from: ["active"], manage: true, reason: true, password: true },
  reactivate: { label: "重新啟用", target: "啟用", service: "reactivate", from: ["suspended"], manage: true, reason: true, password: true },
  block: { label: "封鎖", target: "已封鎖", service: "block", from: ["active", "suspended"], approve: true, reason: true, password: true, device: true },
  unblock: { label: "解除封鎖", target: "已暫停", service: "unblock", from: ["blocked"], approve: true, reason: true, password: true, device: true },
  archive: { label: "封存", target: "已封存", service: "archive", from: ["draft", "active", "suspended"], manage: true, reason: true, password: true },
  restore: { label: "還原", target: "已暫停", service: "restore", from: ["archived"], manage: true, reason: true, password: true },
  deleteCustomer: { label: "永久刪除", target: "永久刪除", service: "deleteCustomer", from: ["draft"], manage: true, reason: true, password: true, device: true, destructive: true }
});
const actions = computed(() => Object.entries(DEFINITIONS).filter(([, action]) => action.from.includes(props.customer.status)).filter(([, action]) => (action.manage && props.canManage) || (action.approve && props.canApprove)).map(([key, action]) => ({ key, ...action })));
const open = ref(false); const selected = ref(null); const saving = ref(false); const error = ref(""); const errorRef = ref(null);
const approvalRequired = ref(false); const approvers = ref([]); const blockers = ref([]);
const form = reactive({ reason: "", password: "", approverUserId: null, requestNote: "" });
const valid = computed(() => selected.value && (!selected.value.reason || form.reason.trim().length >= 5) && (!selected.value.password || form.password) && (!approvalRequired.value || form.approverUserId));
function show(action) { selected.value = action; Object.assign(form, { reason: "", password: "", approverUserId: null, requestNote: "" }); error.value = ""; approvalRequired.value = false; approvers.value = []; blockers.value = []; open.value = true; }
async function submit() {
  if (!valid.value || saving.value) return; saving.value = true; error.value = "";
  try {
    const payload = { version: props.customer.version };
    if (selected.value.reason) payload.reason = form.reason.trim();
    if (selected.value.password) payload.password = form.password;
    if (approvalRequired.value) { payload.approverUserId = form.approverUserId; payload.requestNote = form.requestNote.trim(); }
    await customerService[selected.value.service](props.customer.id, payload);
    open.value = false; notifySuccess(`客戶 ${props.customer.code} 已完成${selected.value.label}`);
    if (selected.value.service === "deleteCustomer") emit("deleted"); else emit("refresh");
  } catch (e) {
    form.password = "";
    blockers.value = (e.details?.providers ?? []).filter((provider) => provider.status === "REFERENCE").map((provider) => ({ name: provider.id, count: provider.referenceCount }));
    if (e.code === "APPROVER_REQUIRED") {
      approvalRequired.value = true;
      error.value = "目前設定要求選擇另一名審批人。";
      try { approvers.value = (await customerApprovalService.eligibleApprovers({ excludeUserId: props.userId })).items.map((user) => ({ label: `${user.displayName || user.username}（${user.username}）`, value: user.id })); }
      catch (lookupError) { error.value = lookupError.message || "載入審批人失敗"; }
    } else error.value = e.code === "VERSION_CONFLICT" ? "狀態已被其他人修改，請載入最新資料後重新確認。" : e.message || "狀態操作失敗";
    notifyError(error.value); await nextTick(); errorRef.value?.focus();
  } finally { saving.value = false; }
}
</script>

<template>
  <div v-if="actions.length" class="row q-gutter-xs">
    <q-btn v-for="action in actions" :key="action.key" outline dense :color="action.destructive || action.key === 'block' ? 'negative' : 'primary'" :label="action.label" @click="show(action)" />
    <q-dialog v-model="open" persistent><q-card style="width:min(560px,94vw)"><q-form @submit.prevent="submit"><input class="reauth-username" type="text" autocomplete="username" :value="username" tabindex="-1" aria-hidden="true"><q-card-section><h2 class="text-h6 q-ma-none">{{ selected?.label }}客戶</h2></q-card-section><q-card-section class="q-pt-none"><q-banner class="bg-warning text-dark q-mb-md">客戶：{{ customer.code }} — {{ customer.legalName }}。完成後：{{ selected?.target }}。既有交易及稽核歷史不會被改寫；封存／永久刪除會先檢查下游引用。<span v-if="selected?.device"> 此操作還要求已核准裝置。</span></q-banner><div v-if="error" ref="errorRef" role="alert" tabindex="-1"><q-banner class="bg-negative text-white q-mb-md">{{ error }}<ul v-if="blockers.length" class="q-mb-none"><li v-for="blocker in blockers" :key="blocker.name">{{ blocker.name }}：{{ blocker.count }}</li></ul><template v-if="error.includes('載入最新')" #action><q-btn flat label="載入最新資料" @click="open = false; emit('refresh')" /></template></q-banner></div><q-select v-if="approvalRequired" v-model="form.approverUserId" :options="approvers" emit-value map-options outlined dense label="審批人 *" /><q-input v-if="approvalRequired" v-model="form.requestNote" outlined dense type="textarea" maxlength="500" label="提交備註（選填）" class="q-mt-md" /><q-input v-if="selected?.reason" v-model="form.reason" label="原因 *" type="textarea" outlined dense maxlength="500" hint="最少 5 個字元" /><q-input v-if="selected?.password" v-model="form.password" label="目前密碼 *" type="password" outlined dense maxlength="1024" autocomplete="current-password" class="q-mt-md" /></q-card-section><q-card-actions align="right"><q-btn flat label="取消" v-close-popup /><q-btn :color="selected?.destructive || selected?.key === 'block' ? 'negative' : 'primary'" :label="approvalRequired ? '確認提交審批' : `確認${selected?.label ?? ''}`" type="submit" :disable="!valid" :loading="saving" /></q-card-actions></q-form></q-card></q-dialog>
  </div>
</template>

<style scoped>.reauth-username{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}</style>
