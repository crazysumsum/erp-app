<script setup>
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from "vue";
import DataTable from "@/framework/ui/DataTable.vue";
import shipment, { shipmentFailure, shipmentOperationReference, shipmentOriginalReference } from "@/services/shipment.js";
import { useSessionStore } from "@/stores/session.js";
import { useShipmentOperationPolling } from "./useShipmentOperationPolling.js";

const props = defineProps({ document: { type: Object, required: true }, disabled: Boolean });
const emit = defineEmits(["settled"]);
const session = useSessionStore();
const dialog = ref(null), dialogError = ref(null), pageError = ref(null), titleId = useId();
const preview = ref(null), loading = ref(false), busy = ref(false), reference = ref(null);
const reason = ref(""), controlled = ref(false), inBins = ref(false), error = ref(""), storageBlocked = ref(false);
const permitted = computed(() => ["fulfillment.view", "fulfillment.reverse"].every(name => session.permissions.includes(name)));
const allowed = computed(() => permitted.value && props.document.status === "SHIPPED" && props.document.allowedActions.includes("reverse"));
const storageKey = `shipment.reverse:${session.user?.id}:${props.document.id}`;
const { operation, error: pollError, loading: checking, polling, resolvedReference, refresh } = useShipmentOperationPolling({
  reference, shipmentId: () => props.document.id, actorId: () => session.user?.id, successStatus: "REVERSED"
});
const reasonValid = computed(() => {
  const length = [...reason.value.trim()].length;
  return length >= 5 && length <= 500;
});
const issueColumns = [
  { name: "sku", label: "SKU", field: "skuCode", align: "left" },
  { name: "bin", label: "原庫位", field: "binCode", align: "left" },
  { name: "lot", label: "批次", field: row => row.lotNumber || "—", align: "left" },
  { name: "quantity", label: "回補數量", field: row => `${row.issuedBaseQuantity} ${row.baseUomCode}`, align: "right" }
];
let previewRequest, submitRequest, disposed = false;

function saveReference(value) {
  try {
    if (value) sessionStorage.setItem(storageKey, JSON.stringify(value));
    else sessionStorage.removeItem(storageKey);
    return true;
  } catch {
    storageBlocked.value = true;
    error.value = "無法保存原沖銷識別碼，請保留此頁並聯絡管理員。";
    return false;
  }
}

watch(permitted, value => {
  if (!value) {
    reference.value = null;
    dialog.value?.close();
    return;
  }
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
    if (saved) {
      const original = shipmentOriginalReference(saved.eventId, saved.correlationId);
      if (saved.statusUrl !== original.statusUrl || Object.keys(saved).length !== 3) throw new TypeError();
      reference.value = original;
    }
  } catch {
    storageBlocked.value = true;
    error.value = "無法讀取原沖銷識別碼，請保留此頁並聯絡管理員。";
  }
}, { immediate: true });

watch(resolvedReference, value => { if (value) saveReference(value); });
watch(() => operation.value?.status, status => {
  if (!["SUCCEEDED", "FAILED"].includes(status)) return;
  error.value = status === "FAILED" ? shipmentFailure({ status: 409, code: operation.value.publicErrorCode }).message : "";
  if (saveReference(null)) reference.value = null;
  emit("settled");
});
watch([error, pollError], async () => {
  if (error.value || pollError.value) {
    await nextTick();
    (dialog.value?.open ? dialogError.value : pageError.value)?.focus();
  }
});
onBeforeUnmount(() => {
  disposed = true;
  previewRequest?.abort();
  submitRequest?.abort();
});

function closePreview() {
  previewRequest?.abort();
  preview.value = null;
}

async function open(event) {
  if (!allowed.value || props.disabled || storageBlocked.value || reference.value || busy.value || dialog.value.open) return;
  event.currentTarget.focus({ preventScroll: true });
  dialog.value.showModal();
  error.value = "";
  controlled.value = false;
  inBins.value = false;
  previewRequest = new AbortController();
  const { signal } = previewRequest, { id, version } = props.document;
  const ids = new Set(), rows = [];
  loading.value = true;
  try {
    let cursor, lines;
    do {
      const { shipment: current } = await shipment.getShipment(id, { issueAfterId: cursor, signal });
      if (signal.aborted) return;
      if (current.version !== version || !current.allowedActions.includes("reverse")) throw { status: 409, code: "VERSION_CONFLICT" };
      lines ??= current.lines;
      for (const issue of current.issues.items) {
        if (ids.has(issue.id)) throw { code: "FULFILLMENT_DEPENDENCY_UNAVAILABLE" };
        ids.add(issue.id);
        rows.push(issue);
      }
      cursor = current.issues.hasMore ? current.issues.nextCursor : undefined;
      if (rows.length > 5000 || current.issues.hasMore && (!cursor || cursor !== rows.at(-1)?.id || current.issues.items.length === 0)) {
        throw { code: "FULFILLMENT_DEPENDENCY_UNAVAILABLE" };
      }
    } while (cursor);
    if (!rows.length) throw { code: "FULFILLMENT_DEPENDENCY_UNAVAILABLE" };
    preview.value = { version, lines, rows };
  } catch (cause) {
    if (!signal.aborted) {
      error.value = shipmentFailure(cause).message;
      if (cause?.code === "VERSION_CONFLICT") { dialog.value.close(); emit("settled"); }
    }
  } finally {
    if (!signal.aborted) loading.value = false;
  }
}

async function submit() {
  if (!allowed.value || props.disabled || busy.value || reference.value || storageBlocked.value || !preview.value ||
      !reasonValid.value || !controlled.value || !inBins.value) return;
  if (preview.value.version !== props.document.version) {
    error.value = shipmentFailure({ status: 409, code: "VERSION_CONFLICT" }).message;
    dialog.value.close();
    emit("settled");
    return;
  }
  const original = shipmentOriginalReference(crypto.randomUUID());
  if (!saveReference(original)) return;
  const id = props.document.id;
  const body = { eventId: original.eventId, version: preview.value.version, reason: reason.value.trim(),
    goodsUnderCompanyControl: true, goodsReturnedToOriginalBins: true };
  submitRequest = new AbortController();
  busy.value = true;
  error.value = "";
  try {
    const result = await shipment.reverse(id, body, { signal: submitRequest.signal });
    if (disposed || !permitted.value) return;
    dialog.value.close();
    if (result.outcome === "REVERSING") {
      reference.value = shipmentOperationReference(result);
      emit("settled");
    } else {
      saveReference(null);
      emit("settled");
    }
  } catch (cause) {
    if (disposed || !permitted.value) return;
    const failure = shipmentFailure(cause);
    error.value = failure.message;
    if (failure.action === "recover") {
      dialog.value.close();
      reference.value = original;
    } else {
      saveReference(null);
      if (cause?.code === "VERSION_CONFLICT" || cause?.code === "SHIPMENT_ALREADY_REVERSED" || cause?.status === 403) {
        dialog.value.close();
        emit("settled");
      }
    }
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section v-if="permitted && (allowed || reference || error || storageBlocked)" aria-label="出貨沖銷" class="q-mt-lg">
    <p v-if="(error || pollError) && !dialog?.open" ref="pageError" role="alert" tabindex="-1">{{ error || pollError.message }}</p>
    <q-btn v-if="allowed && !reference && !storageBlocked" outline color="negative" label="沖銷出貨"
      :disable="disabled || busy" @click="open" />
    <q-banner v-if="reference" role="status" class="bg-warning text-dark">
      <p>原沖銷事件：{{ reference.eventId }}</p>
      <p v-if="resolvedReference?.correlationId">關聯識別碼：{{ resolvedReference.correlationId }}</p>
      <p>{{ polling ? "正在查詢原沖銷結果" : "結果尚待確認，請繼續查詢原事件" }}</p>
      <template #action><q-btn flat label="重查原沖銷結果" :loading="checking" :disable="polling" @click="refresh" /></template>
    </q-banner>
    <dialog ref="dialog" class="shipment-reversal-dialog q-pa-md" :aria-labelledby="titleId" :aria-busy="loading || busy"
      :class="$q.dark.isActive ? 'bg-dark text-white' : 'bg-white text-dark'" @close="closePreview" @cancel="busy && $event.preventDefault()">
      <h2 :id="titleId" class="text-h6 q-mt-none">沖銷出貨 {{ document.number }}</h2>
      <p>只適用於仍由公司控制的錯誤出貨。貨物已交給客戶時，請辦理客戶退貨。</p>
      <p>沖銷會回補整張出貨單的原庫位與預留，並更新 Sales Order 已履約數量。需要再次出貨時，請重新履約。</p>
      <p v-if="error" ref="dialogError" role="alert" tabindex="-1">{{ error }}</p>
      <p v-if="loading" role="status">正在核對出貨及原庫位明細…</p>
      <p v-if="busy" role="status">正在提交，請稍候。</p>
      <form v-if="preview" id="shipment-reversal-form" @submit.prevent="submit">
        <h3 class="text-subtitle1">整張出貨單</h3>
        <ul><li v-for="line in preview.lines" :key="line.id">{{ line.skuCode }} — {{ line.shippedBaseQuantity }} {{ line.baseUomCode }}</li></ul>
        <h3 class="text-subtitle1">原庫位明細</h3>
        <DataTable :rows="preview.rows" :columns="issueColumns" :initial-pagination="{page: 1, rowsPerPage: 10}" />
        <q-input v-model="reason" outlined type="textarea" label="沖銷原因" required :disable="busy"
          :hint="'5 至 500 字'" />
        <q-checkbox v-model="controlled" label="確認貨物仍由公司控制" :disable="busy" />
        <q-checkbox v-model="inBins" label="確認所有貨物已放回原庫位" :disable="busy" />
      </form>
      <div class="row q-mt-md q-gutter-sm justify-end">
        <q-btn v-if="preview" form="shipment-reversal-form" type="submit" color="negative" label="確認沖銷整張出貨單"
          :loading="busy" :disable="!reasonValid || !controlled || !inBins || storageBlocked || !allowed" />
        <form method="dialog"><q-btn type="submit" flat label="取消" autofocus :disable="busy" /></form>
      </div>
    </dialog>
  </section>
</template>

<style scoped>
.shipment-reversal-dialog { width: min(42rem, calc(100% - 2rem)); max-height: calc(100dvh - 2rem); border: 0; border-radius: 4px; }
.shipment-reversal-dialog:modal { overscroll-behavior: contain; }
.shipment-reversal-dialog::backdrop { overflow: hidden; overscroll-behavior: contain; background: rgb(0 0 0 / 45%); }
</style>
