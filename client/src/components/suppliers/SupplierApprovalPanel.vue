<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { notifyError } from "@/framework/ui/notify.js";
import { useSessionStore } from "@/stores/session.js";
import supplierApprovalService from "@/services/supplierApproval.js";

/**
 * 設計 §7.4：審批開啟時顯示 approver selector，只列 Active 而且**而家**仍然有
 * supplier.approval 嘅其他使用者；關閉時唔顯示，亦唔送 approverUserId。
 *
 * 政策由 HD-024 嗰條 lookup 讀。呢度唔自己判斷「應該」點：政策讀唔到就唔顯示
 * selector，等伺服器用 APPROVER_REQUIRED 講返畀使用者聽，唔會靜靜哋當唔使審批。
 */

const props = defineProps({
  // 呢個 panel 唔擁有 approverUserId，佢只係報告揀咗邊個。
  modelValue: { type: Object, default: () => ({ approverUserId: null, requestNote: "" }) },
  disable: { type: Boolean, default: false }
});
const emit = defineEmits(["update:modelValue", "policy"]);

const session = useSessionStore();
const requireApproval = ref(false);
const policyKnown = ref(false);
const approvers = ref([]);
const loading = ref(false);
const search = ref("");

const options = computed(() => approvers.value.map((approver) => ({
  label: approver.displayName ? `${approver.displayName}（${approver.username}）` : approver.username,
  value: approver.id
})));

async function loadApprovers() {
  loading.value = true;
  try {
    // AC-009：唔可以揀自己。伺服器一樣會拒絕，但唔應該俾使用者揀完先話佢知。
    const { items } = await supplierApprovalService.eligibleApprovers({
      q: search.value,
      excludeUserId: session.user?.id
    });
    approvers.value = items;
  } catch (error) {
    approvers.value = [];
    notifyError(error.message || "載入可選審批人失敗");
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  try {
    const { requireActivationApproval } = await supplierApprovalService.activationPolicy();
    requireApproval.value = requireActivationApproval;
    policyKnown.value = true;
    emit("policy", requireActivationApproval);
    if (requireActivationApproval) await loadApprovers();
  } catch (error) {
    // 政策讀唔到：唔顯示 selector，亦都唔假設答案。伺服器係權威。
    policyKnown.value = false;
    notifyError(error.message || "無法確認是否需要審批");
  }
});

let searchTimer = null;
watch(search, () => {
  if (!requireApproval.value) return;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadApprovers, 300);
});

function update(patch) {
  emit("update:modelValue", { ...props.modelValue, ...patch });
}
</script>

<template>
  <section v-if="policyKnown && requireApproval" class="q-mt-md" aria-labelledby="supplier-approval-panel-heading">
    <h2 id="supplier-approval-panel-heading" class="text-subtitle1 q-mb-sm">啟用審批</h2>
    <p class="text-body2 q-mb-sm">
      目前設定要求啟用前由另一名具審批權限的使用者批准，請選擇審批人。
    </p>
    <q-select
      :model-value="modelValue.approverUserId"
      :options="options"
      :loading="loading"
      :disable="disable"
      label="審批人"
      emit-value
      map-options
      use-input
      input-debounce="0"
      clearable
      @filter="(value, update_) => { search = value; update_(() => {}); }"
      @update:model-value="(value) => update({ approverUserId: value })"
    >
      <template #no-option>
        <q-item><q-item-section class="text-grey">沒有其他具備審批權限的有效使用者</q-item-section></q-item>
      </template>
    </q-select>
    <q-input
      :model-value="modelValue.requestNote"
      :disable="disable"
      label="給審批人的備註（選填）"
      maxlength="500"
      class="q-mt-sm"
      @update:model-value="(value) => update({ requestNote: value })"
    />
  </section>
</template>
