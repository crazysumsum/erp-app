<script>
export const page = { name: "purchase-order-create", path: "/purchasing/purchase-orders/new", title: "新增採購單", requires: { permissions: ["purchasing.view", "purchasing.mgmt"] } };
</script>
<script setup>
import { computed, onBeforeUnmount, watch } from "vue";
import { useRouter } from "vue-router";
import PageHeader from "@/framework/layout/PageHeader.vue";
import PurchaseOrderForm from "@/components/purchasing/PurchaseOrderForm.vue";
import { warningText } from "@/components/purchasing/purchaseOrderPresentation.js";
import { notifyError, notifySuccess, notifyWarning } from "@/framework/ui/notify.js";
import { useSessionStore } from "@/stores/session.js";
import { useCommandEvent } from "@/composables/purchasing/useCommandEvent.js";

const router = useRouter(), session = useSessionStore();
// 呢個頁係儲存 record 嘅穩定 owner；結果經 owner handler 交付，換 actor 或者離開之後就唔再通知或者跳頁。
let generation = 0;
watch(() => session.user?.id, () => { generation += 1; });
onBeforeUnmount(() => { generation += 1; });
const commands = { save: useCommandEvent(), submit: useCommandEvent(), generation: () => generation,
  saved: (result, gen) => { if (gen === generation) saved(result); }, submitted: () => {},
  failed: (failure, gen) => { if (gen === generation) notifyError(failure.message || "儲存失敗"); } };
const actor = computed(() => ({ id: session.user.id, label: session.user.displayName || session.user.username }));
async function saved(result) {
  notifySuccess(`採購單 ${result.number} 已儲存為草稿。`);
  result.warnings.forEach((warning) => notifyWarning(warningText(warning)));
  await router.replace(`/purchasing/purchase-orders/${result.id}/edit`);
}
</script>

<template>
  <div>
    <PageHeader subtitle="儲存為草稿；提交前不影響收貨。" />
    <div class="q-px-md q-pb-md"><PurchaseOrderForm :commands="commands" :actor="actor" /></div>
  </div>
</template>
