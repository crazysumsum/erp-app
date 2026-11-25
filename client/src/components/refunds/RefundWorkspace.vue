<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { money, paymentMethodLabels, receiptStatusLabels, timestamp } from "@/components/ar/arPresentation.js";
import { useCommandEvent } from "@/composables/purchasing/useCommandEvent.js";
import { can } from "@/framework/authorization/can.js";
import PageHeader from "@/framework/layout/PageHeader.vue";
import { confirm, promptReason } from "@/framework/ui/confirm.js";
import DataTable from "@/framework/ui/DataTable.vue";
import refunds, { REFUND_REJECTIONS } from "@/services/refunds.js";
import { useSessionStore } from "@/stores/session.js";
import RefundDraftForm from "./RefundDraftForm.vue";

const props = defineProps({ area: { type: String, required: true }, id: { type: String, default: "" } });
const isCustomer = props.area === "ar";
const base = `/${props.area}/refunds`;
const title = isCustomer ? "客戶退款" : "供應商退款";
const party = isCustomer ? "客戶" : "供應商";
const creating = props.id === "new";
const session = useSessionStore(), command = useCommandEvent({ definitiveRejections: REFUND_REJECTIONS }), controller = new AbortController();
onBeforeUnmount(() => controller.abort());
const manage = computed(() => can(session, { permissions: [`${props.area}.refund.mgmt`] }));
const detail = ref(null), loading = ref(false), error = ref("");
const actions = computed(() => manage.value ? detail.value?.allowedActions ?? [] : []);
const busy = computed(() => command.isBusy());
const pending = computed(() => command.pending());
const commandLabels = { confirm: "確認退款記錄", cancel: "取消草稿", void: "作廢退款記錄" };
const number = row => row.number || `草稿 #${row.id}`;
const amount = row => `${row.currencyCode} ${money(row.amount, row.currencyDecimalPlaces)}`;
const columns = [
  { name: "number", label: "退款編號", field: number, align: "left" },
  { name: "status", label: "狀態", field: row => receiptStatusLabels[row.status], align: "left" },
  { name: "creditNoteNumber", label: "來源貸項單", field: "creditNoteNumber", align: "left" },
  { name: "party", label: party, field: "partyName", align: "left" },
  { name: "refundDate", label: "退款日期", field: "refundDate", align: "left" },
  { name: "amount", label: "金額", field: amount, align: "right" }
];
const fetchRows = params => refunds.list(props.area, { ...params, signal: controller.signal });

async function load() {
  if (!/^[1-9]\d{0,15}$/u.test(props.id) || !Number.isSafeInteger(Number(props.id))) {
    error.value = "找不到退款記錄";
    return;
  }
  loading.value = true;
  error.value = "";
  try {
    detail.value = await refunds.detail(props.area, props.id, controller.signal);
  } catch (failure) {
    if (!controller.signal.aborted) error.value = failure.message || "未能載入退款記錄";
  } finally {
    loading.value = false;
  }
}

async function submit(action, payload) {
  error.value = "";
  try {
    await command.run(payload, body => refunds.change(props.area, props.id, action, body), "", { action });
    if (!controller.signal.aborted) await load();
  } catch (failure) {
    if (controller.signal.aborted) return;
    if (["VERSION_CONFLICT", "REFUND_STATE_CONFLICT", "REFUND_CREDIT_STATE_CONFLICT"].includes(failure.code)) await load();
    error.value = failure.message || "未能更新退款記錄";
  }
}

async function ask(action) {
  const row = detail.value, label = commandLabels[action];
  const messages = {
    confirm: `確認後，貸項單的可用額會減少 ${amount(row)}。`,
    cancel: "取消後，這筆草稿無法再確認。",
    void: `作廢後，${amount(row)} 會回到貸項單的可用額。請填寫原因（至少 5 字）。`
  };
  const options = { title: label, message: messages[action], okLabel: label, cancelLabel: "返回" };
  const payload = { version: row.version };
  if (action === "void") {
    const reason = await promptReason(options);
    if (reason === null) return;
    payload.reason = reason.trim();
  } else if (!await confirm(options)) return;
  if (!controller.signal.aborted) await submit(action, payload);
}

onMounted(() => { if (props.id && !creating) void load(); });
</script>

<template>
  <PageHeader :title="creating ? `新增${title}` : detail ? number(detail) : title">
    <template #actions>
      <q-btn v-if="id" flat label="返回列表" :to="base" :disable="busy || !!pending" />
      <q-btn v-else-if="manage" color="primary" :label="`新增${title}`" :to="`${base}/new`" />
    </template>
  </PageHeader>
  <div class="q-px-md q-pb-md">
    <RefundDraftForm v-if="creating && manage" :area="area" :base="base" />
    <q-banner v-else-if="creating" role="alert">你沒有建立此退款記錄的權限。</q-banner>
    <DataTable v-else-if="!id" :columns="columns" :fetch="fetchRows">
      <template #body-cell-number="{ row }">
        <q-td><RouterLink :to="`${base}/${row.id}`">{{ number(row) }}</RouterLink></q-td>
      </template>
    </DataTable>
    <template v-else>
      <q-banner v-if="error" role="alert" class="text-negative q-mb-md">
        {{ error }}
        <template v-if="!detail" #action><q-btn flat label="重新載入" @click="load" /></template>
      </q-banner>
      <q-banner v-if="pending" role="status" class="q-mb-md">
        操作結果尚未確認。
        <template #action>
          <q-btn flat label="重試原操作" :loading="busy" @click="submit(pending.meta.action, pending.payload)" />
        </template>
      </q-banner>
      <p v-if="loading" role="status">載入退款記錄…</p>
      <template v-else-if="detail">
        <dl>
          <dt>狀態</dt><dd>{{ receiptStatusLabels[detail.status] }}</dd>
          <dt>來源貸項單</dt>
          <dd><RouterLink :to="`/${area}/credit-notes/${detail.creditNoteId}`">{{ detail.creditNoteNumber }}</RouterLink></dd>
          <dt>{{ party }}</dt><dd>{{ detail.partyName }}</dd>
          <dt>退款日期</dt><dd>{{ detail.refundDate }}</dd>
          <dt>退款金額</dt><dd>{{ amount(detail) }}</dd>
          <dt>退款方式</dt><dd>{{ paymentMethodLabels[detail.paymentMethod] }}</dd>
          <dt>參考號</dt><dd>{{ detail.reference || "—" }}</dd>
          <dt>備註</dt><dd class="refund-notes">{{ detail.notes || "—" }}</dd>
          <dt>建立</dt><dd>{{ detail.createdByLabel }}，{{ timestamp(detail.createdAt) }}</dd>
          <template v-if="detail.confirmedAt">
            <dt>確認</dt><dd>{{ detail.confirmedByLabel }}，{{ timestamp(detail.confirmedAt) }}</dd>
          </template>
          <template v-if="detail.voidedAt">
            <dt>作廢</dt><dd>{{ detail.voidedByLabel }}，{{ timestamp(detail.voidedAt) }}</dd>
            <dt>作廢原因</dt><dd class="refund-notes">{{ detail.voidReason }}</dd>
          </template>
        </dl>
        <div class="row q-gutter-sm q-mt-md">
          <q-btn v-for="action in actions" :key="action" :label="commandLabels[action]" :color="action === 'confirm' ? 'primary' : 'negative'"
            :flat="action !== 'confirm'" :disable="busy || !!pending" @click="ask(action)" />
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.refund-notes { white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
