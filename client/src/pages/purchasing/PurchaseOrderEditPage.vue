<script>
export const page = { name: "purchase-order-edit", path: "/purchasing/purchase-orders/:id/edit", title: "編輯採購單", requires: { permissions: ["purchasing.view", "purchasing.mgmt"] } };
</script>
<script setup>
import { computed } from "vue";
import { useRouter } from "vue-router";
import PageHeader from "@/framework/layout/PageHeader.vue";
import PurchaseOrderForm from "@/components/purchasing/PurchaseOrderForm.vue";
import { warningText } from "@/components/purchasing/purchaseOrderPresentation.js";
import { usePurchaseOrder } from "@/composables/purchasing/usePurchaseOrder.js";
import { notifySuccess, notifyWarning } from "@/framework/ui/notify.js";
import { useSessionStore } from "@/stores/session.js";

const router = useRouter(), session = useSessionStore();
const { document, loading, error, load } = usePurchaseOrder();
const actor = computed(() => ({ id: session.user.id, label: session.user.displayName || session.user.username }));
const editable = computed(() => session.permissions.includes("purchasing.mgmt") && document.value?.allowedActions.includes("edit"));
async function saved(result) {
  notifySuccess(`採購單 ${result.number} 已儲存。`);
  result.warnings.forEach((warning) => notifyWarning(warningText(warning)));
  await load({ keep: true });
}
async function submitted(result) {
  notifySuccess(`採購單 ${result.number} 已提交。`);
  await router.push(`/purchasing/purchase-orders/${result.id}`);
}
</script>

<template>
  <div>
    <PageHeader :title="document ? `編輯 ${document.number}` : '編輯採購單'" />
    <div class="q-px-md q-pb-md">
      <q-skeleton v-if="loading" type="rect" aria-label="載入採購單" />
      <q-banner v-else-if="error" role="alert" class="bg-negative text-white">{{ error }}<template #action><q-btn flat label="重試" @click="load()" /><q-btn flat label="返回採購單列表" to="/purchasing/purchase-orders" /></template></q-banner>
      <PurchaseOrderForm v-else-if="editable" :document="document" :actor="actor" @saved="saved" @submitted="submitted" @reload="load({ keep: true })" />
      <q-banner v-else-if="document" role="status" class="bg-warning text-dark">目前狀態或權限不允許編輯此採購單。<template #action><q-btn flat label="查看採購單" :to="`/purchasing/purchase-orders/${document.id}`" /></template></q-banner>
    </div>
  </div>
</template>
