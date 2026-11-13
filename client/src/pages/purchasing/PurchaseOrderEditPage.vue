<script>
export const page = { name: "purchase-order-edit", path: "/purchasing/purchase-orders/:id/edit", title: "編輯採購單", requires: { permissions: ["purchasing.view", "purchasing.mgmt"] } };
</script>
<script setup>
import { computed, onBeforeUnmount, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import PageHeader from "@/framework/layout/PageHeader.vue";
import PurchaseOrderForm from "@/components/purchasing/PurchaseOrderForm.vue";
import { warningText } from "@/components/purchasing/purchaseOrderPresentation.js";
import { usePurchaseOrder } from "@/composables/purchasing/usePurchaseOrder.js";
import { notifyError, notifySuccess, notifyWarning } from "@/framework/ui/notify.js";
import purchasing from "@/services/purchasing.js";
import { useSessionStore } from "@/stores/session.js";
import { useCommandEvent } from "@/composables/purchasing/useCommandEvent.js";

const route = useRoute(), router = useRouter(), session = useSessionStore();
const { document, loading, error, load } = usePurchaseOrder();
// 呢個頁係儲存／提交 record 嘅穩定 owner：Form 會因 loading／error／權限 v-if 卸載，record 唔可以跟住冇咗。
// 結果經 owner handler 交付，用發出時嘅 generation 判斷：真正換 PO、換 actor 或者離開就唔再通知、跳頁或者重新載入。
let generation = 0;
watch([() => route.params.id, () => session.user?.id], () => { generation += 1; });
onBeforeUnmount(() => { generation += 1; });
const live = (gen, handle) => (value) => { if (gen === generation) handle(value); };
const commands = { save: useCommandEvent(), submit: useCommandEvent(), generation: () => generation,
  saved: (result, gen) => live(gen, saved)(result), submitted: (result, gen) => live(gen, submitted)(result),
  failed: (failure, gen) => live(gen, (value) => notifyError(value.message || "操作失敗"))(failure) };
const actor = computed(() => ({ id: session.user.id, label: session.user.displayName || session.user.username }));
const editable = computed(() => session.permissions.includes("purchasing.mgmt") && document.value?.allowedActions.includes("edit"));
// Form 冇顯示（例如提交其實成功但回應丟失，GET 返嚟已經唔可以編輯；或者讀取失敗、冇權）時，未確定嘅原操作喺頁面顯示：
// 當下有 view＋mgmt 就用原 action／目標／body 重試；冇權只顯示被擋。唔當目前狀態係原 event 嘅結果。
const poId = computed(() => Number(route.params.id));
const keyOf = (action) => `${session.user?.id}:${poId.value}:${action}`;
const formShown = computed(() => !loading.value && !error.value && editable.value);
const hiddenUnknown = computed(() => (formShown.value ? [] : ["save", "submit"].map((action) => commands[action].pending(keyOf(action))).filter(Boolean)));
const canManage = computed(() => ["purchasing.view", "purchasing.mgmt"].every((permission) => session.permissions.includes(permission)));
async function replay(record) {
  const { action } = record.meta, gen = generation, id = poId.value;
  const send = action === "save" ? (body) => purchasing.updatePurchaseOrder(id, body) : (body) => purchasing.submitPurchaseOrder(id, body);
  try {
    const result = await commands[action].run(record.payload, send, record.key, record.meta);
    live(gen, action === "save" ? saved : submitted)(result);
  } catch (failure) {
    if (gen === generation && !commands[action].isUncertain(record.key)) notifyError(failure.message || "操作失敗");
  }
}
async function saved(result) {
  notifySuccess(`採購單 ${result.number} 已儲存。`);
  result.warnings.forEach((warning) => notifyWarning(warningText(warning)));
  await load({ keep: true });
}
async function submitted(result) {
  notifySuccess(result.outcome === "PENDING_APPROVAL" ? `採購單 ${result.number} 已提交審批。` : `採購單 ${result.number} 已提交並確認。`);
  await router.push(`/purchasing/purchase-orders/${result.id}`);
}
</script>

<template>
  <div>
    <PageHeader :title="document ? `編輯 ${document.number}` : '編輯採購單'" />
    <div class="q-px-md q-pb-md">
      <q-banner v-for="record in hiddenUnknown" :key="record.key" role="status" class="bg-warning text-dark q-mb-md" data-testid="po-hidden-unknown">
        {{ record.meta.action === "save" ? "儲存" : "提交" }}結果尚未確認；目前畫面不能當作原操作的結果。
        <template #action>
          <q-btn v-if="canManage" flat :label="`以原內容重試${record.meta.action === 'save' ? '儲存' : '提交'}`" :loading="commands[record.meta.action].isBusy(record.key)" @click="replay(record)" />
          <span v-else>你目前沒有採購管理權限，未能重試確認；請聯絡管理員。</span>
        </template>
      </q-banner>
      <q-skeleton v-if="loading" type="rect" aria-label="載入採購單" />
      <q-banner v-else-if="error" role="alert" class="bg-negative text-white">{{ error }}<template #action><q-btn flat label="重試" @click="load()" /><q-btn flat label="返回採購單列表" to="/purchasing/purchase-orders" /></template></q-banner>
      <PurchaseOrderForm v-else-if="editable" :commands="commands" :document="document" :actor="actor" @reload="load({ keep: true })" />
      <q-banner v-else-if="document" role="status" class="bg-warning text-dark">目前狀態或權限不允許編輯此採購單。<template #action><q-btn flat label="查看採購單" :to="`/purchasing/purchase-orders/${document.id}`" /></template></q-banner>
    </div>
  </div>
</template>
