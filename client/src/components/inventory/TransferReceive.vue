<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import FormPanel from "@/framework/ui/FormPanel.vue";
import inventory from "@/services/inventory.js";
const props = defineProps({ detail: { type: Object, required: true } });
const emit = defineEmits(["saved", "close"]);
const lines = ref(props.detail.lines.map(line => ({ id: line.id, quantity: line.quantity, destinationBinId: null, stockStatus: line.dispatchStockStatus })));
const reason = ref(""), bins = ref([]), page = ref(0), total = ref(0), loading = ref(false), saving = ref(false), error = ref("");
const commandId = ref(crypto.randomUUID());
watch([lines, reason], () => { commandId.value = crypto.randomUUID(); }, { deep: true });
const quarantine = computed(() => lines.value.some(line => line.stockStatus === "QUARANTINED"));
const dirty = computed(() => !!reason.value || lines.value.some((line, index) => line.destinationBinId || line.stockStatus !== props.detail.lines[index].dispatchStockStatus));
const valid = computed(() => lines.value.every(line => bins.value.some(bin => bin.id === line.destinationBinId)) &&
  (!quarantine.value || reason.value.trim()) && new TextEncoder().encode(reason.value).length <= 500 && !/[\p{Cc}]/u.test(reason.value));
async function loadBins() {
  if (loading.value) return;
  loading.value = true; error.value = "";
  try {
    const response = await inventory.listBins(props.detail.destinationWarehouseId, { page: page.value + 1, rowsPerPage: 100, status: "ACTIVE" });
    bins.value.push(...response.rows); page.value++; total.value = response.rowsNumber;
  } catch (cause) { error.value = cause.message || "無法載入目的庫位，請重試。"; }
  finally { loading.value = false; }
}
async function save() {
  if (!valid.value || saving.value) throw new Error("請為每行選擇目的庫位；待驗收貨必須輸入原因。");
  saving.value = true;
  try {
    const result = await inventory.receiveTransfer(props.detail.id, { version: props.detail.version, lines: lines.value, reason: reason.value,
      idempotencyKey: commandId.value, source: { module: "INVENTORY", documentType: "TRANSFER", documentId: String(props.detail.id), lineId: "", eventId: commandId.value } });
    emit("saved", result); return result;
  } catch (cause) { throw new Error(`${cause.message || '無法收貨'}。輸入內容仍保留；請重載詳情核對後再提交。`); }
  finally { saving.value = false; }
}
function beforeUnload(event) { if (dirty.value || saving.value) { event.preventDefault(); event.returnValue = ""; } }
onMounted(() => { loadBins(); window.addEventListener("beforeunload", beforeUnload); });
onUnmounted(() => window.removeEventListener("beforeunload", beforeUnload));
function canDiscard() { return !saving.value && (!dirty.value || window.confirm("有未儲存的收貨輸入，確定要離開嗎？")); }
defineExpose({ canDiscard });
</script>

<template>
  <FormPanel :on-submit="save" class="q-pa-md">
    <h2 class="text-h6 q-mt-none">整張收貨 {{ detail.number }}</h2>
    <p>目的倉庫 #{{ detail.destinationWarehouseId }}；所有行按原數量收貨，不支援部分。</p>
    <q-banner v-if="error" role="alert" class="bg-negative text-white q-mb-md">{{ error }}</q-banner>
    <q-card v-for="(line, index) in lines" :key="line.id" flat bordered class="q-mb-sm">
      <q-card-section>
        <h3 class="text-subtitle1 q-mt-none">{{ detail.lines[index].skuCode }} · {{ detail.lines[index].lotNumber || '無批次' }} · 數量 {{ line.quantity }}</h3>
        <div class="row q-col-gutter-sm">
          <q-select class="col-12 col-sm-6" v-model="line.destinationBinId" :options="bins" option-value="id" option-label="code" emit-value map-options
            outlined dense :label="`第 ${index + 1} 行目的庫位`" :loading="loading" :disable="saving" />
          <q-select class="col-12 col-sm-6" v-model="line.stockStatus" :options="[...new Set([detail.lines[index].dispatchStockStatus, 'QUARANTINED'])]"
            outlined dense :label="`第 ${index + 1} 行收貨狀態`" :disable="saving" />
        </div>
      </q-card-section>
    </q-card>
    <q-btn v-if="bins.length < total || !bins.length" flat label="載入目的庫位" :loading="loading" @click="loadBins" />
    <q-input v-model="reason" outlined autogrow type="textarea" :label="quarantine ? '待驗原因（必填）' : '收貨原因'" :disable="saving" />
    <div class="row justify-end q-gutter-sm q-mt-md">
      <q-btn flat label="取消收貨" :disable="saving" @click="canDiscard() && emit('close')" />
      <q-btn type="submit" color="primary" unelevated label="整張收貨" :disable="!valid || saving" :loading="saving" />
    </div>
  </FormPanel>
</template>
