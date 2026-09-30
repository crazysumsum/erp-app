<script setup>
import { computed, ref, watch } from "vue";
import inventoryService from "@/services/inventory.js";
import { notifySuccess } from "@/framework/ui/notify.js";

const props = defineProps({ modelValue: Boolean, reservation: { type: Object, required: true }, canFefoOverride: Boolean });
const emit = defineEmits(["update:modelValue", "updated"]);
const quantity = ref(1);
const candidates = ref(null);
const picked = ref({});
const reason = ref("");
const error = ref("");
const conflict = ref("");
const loading = ref(false);
const saving = ref(false);
const version = ref(props.reservation.version);
const commandId = ref(crypto.randomUUID());
const rows = computed(() => candidates.value?.items ?? []);
const selected = computed(() => rows.value.filter((row) => Number(picked.value[row.balanceId]) > 0)
  .map((row) => ({ row, quantity: Number(picked.value[row.balanceId]) })));
const selectedTotal = computed(() => selected.value.reduce((sum, line) => sum + line.quantity, 0));
const target = computed(() => Number(quantity.value));
const validTarget = computed(() => Number.isSafeInteger(target.value) && target.value > 0 &&
  target.value <= props.reservation.outstandingQuantity);
const validSelection = computed(() => candidates.value && selected.value.length > 0 &&
  Object.values(picked.value).every((value) => value === "" || value === null ||
    (Number.isSafeInteger(Number(value)) && Number(value) >= 0)) &&
  selected.value.every(({ row, quantity: amount }) => Number.isSafeInteger(amount) && amount <= row.freeQuantity) &&
  selectedTotal.value === target.value);
const differs = computed(() => {
  if (!validSelection.value) return false;
  let left = target.value;
  return rows.value.map((row) => {
    const recommended = Math.min(left, row.freeQuantity);
    left -= recommended;
    return Number(picked.value[row.balanceId] || 0) !== recommended;
  }).some(Boolean);
});
const fefoDeviation = computed(() => differs.value && rows.value.some((row) => row.expiryDate));
const validReason = computed(() => reason.value.trim().length >= 5 && reason.value.trim().length <= 500);
const canSubmit = computed(() => validSelection.value && !loading.value && !saving.value &&
  (!fefoDeviation.value || props.canFefoOverride) && (!differs.value || validReason.value));

function reset() {
  quantity.value = 1;
  candidates.value = null;
  picked.value = {};
  reason.value = "";
  error.value = "";
  conflict.value = "";
  version.value = props.reservation.version;
  commandId.value = crypto.randomUUID();
}
watch(() => props.modelValue, (open) => { if (open) reset(); });
watch(quantity, () => { candidates.value = null; picked.value = {}; conflict.value = ""; });
watch(picked, () => { commandId.value = crypto.randomUUID(); conflict.value = ""; }, { deep: true });
watch(reason, () => { commandId.value = crypto.randomUUID(); });

async function loadCandidates({ preserve = false } = {}) {
  if (!validTarget.value) return;
  loading.value = true;
  error.value = "";
  try {
    const response = await inventoryService.listAllocationCandidates(props.reservation.id, { requestedQuantity: target.value, page: 1 });
    candidates.value = response;
    version.value = response.reservationVersion;
    if (preserve) {
      picked.value = Object.fromEntries(Object.entries(picked.value).filter(([id]) =>
        response.items.some((row) => String(row.balanceId) === id)));
    } else picked.value = {};
    return true;
  } catch (cause) {
    error.value = cause.message || "無法載入分配候選";
    return false;
  } finally {
    loading.value = false;
  }
}
async function loadMore() {
  if (!candidates.value?.hasMore || loading.value) return;
  loading.value = true;
  error.value = "";
  try {
    const next = await inventoryService.listAllocationCandidates(props.reservation.id,
      { requestedQuantity: target.value, page: candidates.value.page + 1 });
    if (next.reservationVersion !== candidates.value.reservationVersion) {
      if (await loadCandidates({ preserve: true })) conflict.value = "候選已重新載入；請核對數量與批次後再提交。";
      return;
    }
    candidates.value = { ...next, items: [...candidates.value.items, ...next.items] };
  } catch (cause) {
    error.value = cause.message || "無法載入更多候選";
  } finally {
    loading.value = false;
  }
}
async function create() {
  if (!canSubmit.value) return;
  saving.value = true;
  error.value = "";
  conflict.value = "";
  try {
    await inventoryService.createAllocation(props.reservation.id, {
      idempotencyKey: commandId.value,
      source: { module: "INVENTORY", documentType: "MANUAL_ALLOCATION", documentId: String(props.reservation.id),
        lineId: "", eventId: commandId.value },
      version: version.value,
      allocations: selected.value.map(({ row, quantity: amount }) =>
        ({ balanceId: row.balanceId, expectedVersion: row.balanceVersion, quantity: amount })),
      ...(differs.value ? { overrideReason: reason.value.trim() } : {})
    });
    notifySuccess("分配已建立");
    emit("update:modelValue", false);
    emit("updated");
  } catch (cause) {
    if (["VERSION_CONFLICT", "CONCURRENT_OPERATION", "ALLOCATION_INSUFFICIENT"].includes(cause.code)) {
      if (await loadCandidates({ preserve: true })) conflict.value = "候選已重新載入；請核對數量與批次後再提交。";
      commandId.value = crypto.randomUUID();
    } else error.value = cause.message || "無法建立分配";
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <q-dialog :model-value="modelValue" @update:model-value="emit('update:modelValue', $event)">
    <q-card class="allocation-panel" style="width: min(720px, 100%); max-width: 100%">
      <q-card-section class="row items-center">
        <h2 class="text-h6 q-ma-none">分配預留 {{ reservation.id }}</h2>
        <q-space />
        <q-btn flat round dense icon="close" aria-label="關閉分配" @click="emit('update:modelValue', false)" />
      </q-card-section>
      <q-card-section class="q-pt-none">
        <p class="text-body2">未完成 {{ reservation.outstandingQuantity }}；候選依 FEFO／FIFO 排序。</p>
        <div class="row q-col-gutter-sm items-start">
          <q-input class="col-12 col-sm-5" v-model.number="quantity" type="number" min="1"
            :max="reservation.outstandingQuantity" outlined dense label="分配數量"
            :error="!validTarget" error-message="請輸入不超過未完成數量的正整數" />
          <div class="col-12 col-sm-7"><q-btn color="primary" outline label="載入候選" :disable="!validTarget || loading" :loading="loading" @click="loadCandidates()" /></div>
        </div>
        <q-banner v-if="error" role="alert" class="bg-negative text-white q-mt-md">{{ error }}</q-banner>
        <q-banner v-if="conflict" role="status" class="bg-warning text-dark q-mt-md">{{ conflict }}</q-banner>
        <div v-if="loading" role="status" class="q-mt-md">正在載入候選…</div>
        <div v-else-if="candidates && !rows.length" role="status" class="q-mt-md">沒有符合條件的可用庫存。</div>
        <q-list v-else-if="rows.length" bordered separator class="q-mt-md">
          <q-item v-for="row in rows" :key="row.balanceId" class="items-center">
            <q-item-section>
              <q-item-label>庫位 #{{ row.binId }} · 批次 #{{ row.lotId ?? '無批次' }}</q-item-label>
              <q-item-label caption>順位 {{ row.rank }} · {{ row.selectionStrategy }} · 到期 {{ row.expiryDate || '無效期' }} · 可分配 {{ row.freeQuantity }}</q-item-label>
            </q-item-section>
            <q-item-section side class="allocation-quantity">
              <q-input v-model.number="picked[row.balanceId]" type="number" min="0" :max="row.freeQuantity" dense outlined
                :label="`庫位 ${row.binId} 分配數量`" />
            </q-item-section>
          </q-item>
        </q-list>
        <q-btn v-if="candidates?.hasMore" flat class="q-mt-sm" label="載入更多候選" :loading="loading" @click="loadMore" />
        <p v-if="rows.length" class="q-mt-md q-mb-none">已選 {{ selectedTotal }} / {{ target }}</p>
        <p v-if="fefoDeviation && !canFefoOverride" class="text-negative q-mt-md">需要 FEFO 偏離權限，請按建議順位分配。</p>
        <q-input v-if="differs && (!fefoDeviation || canFefoOverride)" v-model="reason" class="q-mt-md"
          type="textarea" autogrow outlined label="偏離原因" hint="請輸入 5–500 字" />
      </q-card-section>
      <q-card-actions align="right">
        <q-btn flat label="取消" @click="emit('update:modelValue', false)" />
        <q-btn color="primary" unelevated label="建立分配" :disable="!canSubmit" :loading="saving" @click="create" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<style scoped>
.allocation-quantity { width: 180px; }
@media (max-width: 599px) { .allocation-quantity { width: 145px; } }
</style>
