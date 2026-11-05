<script>
export const page = { name: "purchase-order-create", path: "/purchasing/purchase-orders/new", title: "新增採購單", requires: { permissions: ["purchasing.view", "purchasing.mgmt"] } };
</script>
<script setup>
import { computed } from "vue";
import { useRouter } from "vue-router";
import PageHeader from "@/framework/layout/PageHeader.vue";
import PurchaseOrderForm from "@/components/purchasing/PurchaseOrderForm.vue";
import { warningText } from "@/components/purchasing/purchaseOrderPresentation.js";
import { notifySuccess, notifyWarning } from "@/framework/ui/notify.js";
import { useSessionStore } from "@/stores/session.js";

const router = useRouter(), session = useSessionStore();
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
    <div class="q-px-md q-pb-md"><PurchaseOrderForm :actor="actor" @saved="saved" /></div>
  </div>
</template>
