<script setup>
import { computed, onBeforeUnmount, ref, useId } from "vue";
import { useCommandEvent } from "@/composables/purchasing/useCommandEvent.js";
import purchasing from "@/services/purchasing.js";

const props = defineProps({ receipt: { type: Object, required: true } });
const emit = defineEmits(["posted"]);
const dialog = ref(null), titleId = useId();
const command = useCommandEvent();
const key = "receipt-reversal";
const preview = ref(null), loading = ref(false), checking = ref(false);
const quantities = ref({}), reason = ref(""), password = ref(""), error = ref(""), eventId = ref("");
const stale = ref(false);
const uncertain = computed(() => command.isUncertain(key));
const busy = computed(() => command.isBusy(key) || checking.value);
const available = computed(() => {
  const byId = new Map(preview.value?.details.map(detail => [detail.id, detail.remainingBaseQuantity]));
  return props.receipt.lines.flatMap(line => line.details.flatMap(detail => {
    const remaining = byId.get(detail.id);
    if (!remaining || remaining === "0") return [];
    const location = [detail.warehouseCode, detail.binCode, detail.lotNumber].filter(Boolean).join(" / ");
    return [{ id: detail.id, remaining, label: `明細 ${detail.detailNumber} · ${line.skuCode} · ${location}` }];
  }));
});
let previewRequest;

async function refreshPreview() {
  previewRequest?.abort();
  previewRequest = new AbortController();
  const { signal } = previewRequest;
  loading.value = true;
  error.value = "";
  try {
    const result = await purchasing.previewGoodsReceiptReversal(props.receipt.id, { signal });
    if (!signal.aborted) {
      preview.value = result;
      stale.value = false;
    }
  } catch (failure) {
    if (!signal.aborted) error.value = failure.message || "未能載入可沖銷數量。";
  } finally {
    if (!signal.aborted) loading.value = false;
  }
}

function open(event) {
  // Quasar can focus its internal ripple target before emitting a pointer click.
  event.currentTarget.focus({ preventScroll: true });
  dialog.value.showModal();
  if (uncertain.value) return;
  preview.value = null;
  quantities.value = {};
  reason.value = "";
  void refreshPreview();
}

function clearPassword() {
  password.value = "";
  previewRequest?.abort();
}

function posted(result) {
  eventId.value = "";
  dialog.value.close();
  emit("posted", result);
}

async function submit() {
  if (busy.value || !preview.value || stale.value) return;
  error.value = "";
  const details = [];
  for (const { id, remaining, label } of available.value) {
    const quantity = String(quantities.value[id] ?? "").trim();
    if (quantity === "") continue;
    if (!/^[1-9][0-9]*$/u.test(quantity) || !Number.isSafeInteger(Number(quantity)) || BigInt(quantity) > BigInt(remaining)) {
      error.value = `${label}的沖銷數量須為 1 至 ${remaining} 的整數。`;
      return;
    }
    details.push({ goodsReceiptDetailId: id, baseQuantity: Number(quantity) });
  }
  if (!details.length) { error.value = "請至少填寫一項沖銷數量。"; return; }
  const reasonText = reason.value.trim();
  if ([...reasonText].length < 5 || new TextEncoder().encode(reasonText).length > 500 || /[\t\r\n]/u.test(reasonText)) {
    error.value = "原因須為單行，至少 5 個字，且不超過 500 位元組。";
    return;
  }
  const currentPassword = password.value;
  password.value = "";
  try {
    const result = await command.run({ version: preview.value.version, reason: reasonText, details }, body => {
      eventId.value = body.eventId;
      return purchasing.reverseGoodsReceipt(props.receipt.id, { ...body, password: currentPassword });
    }, key, { action: "reverse" });
    posted(result);
  } catch (failure) {
    stale.value = ["VERSION_CONFLICT", "GR_REVERSAL_QUANTITY_EXCEEDED"].includes(failure.code) && !uncertain.value;
    error.value = uncertain.value ? "沖銷結果尚未確認。請查詢結果，或以相同內容重試。" : failure.message || "未能沖銷收貨單。";
  }
}

async function checkResult() {
  if (busy.value || !uncertain.value) return;
  checking.value = true;
  error.value = "";
  const pendingEvent = eventId.value;
  try {
    const operation = await purchasing.getOperationByEvent(pendingEvent);
    if (operation.status === "COMPLETED" && operation.resultType === "REVERSAL" && command.confirmCompleted(key, pendingEvent)) {
      posted(operation.resultSummary);
    } else {
      error.value = "沖銷結果尚未確認。";
    }
  } catch (failure) {
    error.value = failure.status === 404 ? "尚未查到沖銷結果。請稍後再查，或以相同內容重試。" : failure.message || "未能查詢沖銷結果。";
  } finally { checking.value = false; }
}

onBeforeUnmount(clearPassword);
</script>

<template>
  <q-btn v-if="receipt.allowedActions.includes('reverse') || uncertain" flat color="negative"
    :label="uncertain ? '跟進沖銷結果' : '沖銷收貨'" @click="open" />
  <dialog ref="dialog" class="receipt-reversal-dialog q-pa-md text-body1" :aria-labelledby="titleId"
    :class="$q.dark.isActive ? 'bg-dark text-white' : 'bg-white text-dark'"
    @cancel="busy && $event.preventDefault()" @close="clearPassword">
    <h1 :id="titleId" class="text-h6 q-mt-none">沖銷收貨 {{ receipt.number }}</h1>
    <p v-if="loading" role="status">載入可沖銷數量…</p>
    <p v-if="error" class="text-negative" role="alert">{{ error }}</p>
    <p v-if="preview && !available.length">這張收貨單沒有可沖銷的數量。</p>
    <q-form v-if="!loading && available.length" @submit="submit">
      <p>請填寫要沖銷的基本數量。留空的明細會略過。</p>
      <q-input v-for="line in available" :key="line.id" v-model="quantities[line.id]" outlined dense
        :label="`沖銷數量 · ${line.label}`" :aria-describedby="`${titleId}-limit-${line.id}`" inputmode="numeric" maxlength="16"
        :readonly="busy || uncertain" class="q-mb-sm">
        <template #hint><span :id="`${titleId}-limit-${line.id}`">最多 {{ line.remaining }}</span></template>
      </q-input>
      <q-input v-model="reason" outlined dense label="沖銷原因" maxlength="500" required
        :readonly="busy || uncertain" class="q-mb-md" />
      <q-input v-model="password" outlined dense label="登入密碼" type="password" autocomplete="current-password"
        required :readonly="busy" />
      <div class="q-mt-md row q-gutter-sm justify-end">
        <q-btn v-if="uncertain" flat label="查詢處理結果" :loading="checking" :disable="command.isBusy(key)" @click="checkResult" />
        <q-btn color="negative" type="submit" :label="uncertain ? '重試原沖銷' : '確認沖銷'" :disable="busy || stale" />
      </div>
    </q-form>
    <div class="q-mt-md row q-gutter-sm justify-end">
      <q-btn v-if="!loading && (!preview || stale)" flat label="重新載入數量" :disable="busy" @click="refreshPreview" />
      <form method="dialog">
        <q-btn type="submit" flat label="關閉" autofocus :disable="busy" />
      </form>
    </div>
  </dialog>
</template>

<style scoped>
.receipt-reversal-dialog {
  width: min(36rem, calc(100vw - 2rem));
  max-height: calc(100dvh - 2rem);
  border: 0;
  border-radius: 4px;
}
.receipt-reversal-dialog:modal {
  overscroll-behavior: contain;
}
.receipt-reversal-dialog::backdrop {
  overflow: hidden;
  overscroll-behavior: contain;
  background: rgb(0 0 0 / 55%);
}
</style>
