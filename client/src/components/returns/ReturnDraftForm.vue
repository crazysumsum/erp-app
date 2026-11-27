<script setup>
import { computed, onBeforeUnmount, ref } from "vue";
import { useRouter } from "vue-router";
import { useCommandEvent } from "@/composables/purchasing/useCommandEvent.js";
import returns from "@/services/returns.js";

const props = defineProps({
  kind: { type: String, required: true },
  base: { type: String, required: true },
  resource: { type: String, required: true }
});
const router = useRouter(), command = useCommandEvent();
const reference = ref(""), source = ref(null), looking = ref(false), lookupError = ref(""), error = ref("");
const returnDate = ref(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", dateStyle: "short" }).format(new Date()));
const reason = ref(""), lines = ref([]);
const controller = new AbortController();
const uncertain = computed(() => command.isUncertain("create"));
const stockOptions = [
  { value: "AVAILABLE", label: "可用" }, { value: "QUARANTINED", label: "隔離" }, { value: "DAMAGED", label: "損壞" }
];
let key = 0;
onBeforeUnmount(() => controller.abort());

function addLine() {
  lines.value.push({ key: ++key, sourceDetailId: null, baseQuantity: "", binId: null, stockStatus: null });
}
function changeSource(line, id) {
  line.sourceDetailId = id;
  line.binId = null;
  line.stockStatus = source.value.details.find(detail => detail.id === id)?.stockStatus ?? null;
}
const required = value => Boolean(value) || "必填";
const quantity = value => /^[1-9][0-9]{0,15}$/u.test(value) && Number.isSafeInteger(Number(value)) || "請輸入正整數";
const eligible = computed(() => (source.value?.details ?? []).filter(detail => BigInt(detail.remainingBaseQuantity) > 0n));
const lineLabel = detail => `${detail.skuCode}${detail.lotNumber ? ` · ${detail.lotNumber}` : ""}（可退 ${detail.remainingBaseQuantity}）`;
const binOptions = line => {
  const warehouseId = source.value.details.find(detail => detail.id === line.sourceDetailId)?.warehouseId;
  return source.value.bins.filter(bin => bin.warehouseId === warehouseId);
};

async function lookup() {
  looking.value = true;
  source.value = null;
  lookupError.value = "";
  try {
    source.value = await returns.source(props.kind, reference.value.trim().toUpperCase(), controller.signal);
    lines.value = [];
    addLine();
  } catch (failure) {
    if (!controller.signal.aborted) lookupError.value = failure.message || "未能讀取來源單據";
  } finally {
    looking.value = false;
  }
}

async function save() {
  error.value = "";
  try {
    const payload = {
      sourceId: source.value.id,
      returnDate: returnDate.value,
      reason: reason.value.trim(),
      lines: lines.value.map(({ sourceDetailId, binId, baseQuantity, stockStatus }) => ({
        sourceDetailId, binId, baseQuantity, ...(props.kind === "supplier" ? { stockStatus } : {})
      }))
    };
    const result = await command.run(payload, body => returns.create(props.kind, body), "create", { action: "create" });
    await router.replace(`${props.base}/${result.id}`);
  } catch (failure) {
    error.value = failure.message || "未能建立退貨單";
  }
}
</script>

<template>
  <div role="search" aria-label="原單">
    <q-form class="q-mb-lg" aria-label="查找原單" @submit="lookup">
      <div class="row q-col-gutter-md items-start">
        <div class="col-12 col-sm-5">
          <q-input v-model="reference" :label="`原${resource}號 *`" name="source-reference" outlined dense maxlength="24"
            :rules="[required]" :disable="uncertain || command.isBusy('create')" />
        </div>
        <div class="col-auto">
          <q-btn type="submit" color="primary" outline label="查找原單" :loading="looking" :disable="uncertain || command.isBusy('create')" />
        </div>
      </div>
  </q-form>
  </div>
  <q-banner v-if="lookupError" role="alert" class="text-negative q-mb-md">{{ lookupError }}</q-banner>
  <template v-if="source">
    <p role="status">{{ resource }} {{ source.sourceNumber }}{{ eligible.length ? "" : " 已沒有可退數量。" }}</p>
    <q-form v-if="eligible.length" aria-label="建立退貨草稿" @submit="save">
      <div class="row q-col-gutter-md">
        <div class="col-12 col-sm-4">
          <q-input v-model="returnDate" label="退貨日期 *" name="return-date" type="date" outlined dense :rules="[required]" :disable="uncertain" />
        </div>
        <div class="col-12 col-sm-8">
          <q-input v-model="reason" label="退貨原因 *" type="textarea" name="reason" outlined dense autogrow maxlength="500"
            :rules="[value => required(value.trim())]" :disable="uncertain" />
        </div>
      </div>
      <fieldset v-for="(line, index) in lines" :key="line.key" class="q-mb-md" :disabled="uncertain || command.isBusy('create')">
        <legend>退貨明細 {{ index + 1 }}</legend>
        <div class="row q-col-gutter-sm">
          <div class="col-12 col-md-5">
            <q-select :model-value="line.sourceDetailId" :options="eligible" :option-label="lineLabel"
              option-value="id" emit-value map-options outlined dense label="原批次明細 *" :name="`detail-${line.key}`"
              :rules="[required]" @update:model-value="id => changeSource(line, id)" />
          </div>
          <div class="col-12 col-sm-6 col-md-3">
            <q-select v-model="line.binId" :options="binOptions(line)" :option-label="bin => `${bin.warehouseCode}／${bin.binCode}`"
              option-value="id" emit-value map-options outlined dense label="原倉庫位 *" :name="`bin-${line.key}`" :rules="[required]" />
          </div>
          <div class="col-12 col-sm-6 col-md-2">
            <q-input v-model="line.baseQuantity" label="基本數量 *" :name="`quantity-${line.key}`" inputmode="numeric" outlined dense :rules="[quantity]" />
          </div>
          <div v-if="kind === 'supplier'" class="col-12 col-md-2">
            <q-select v-model="line.stockStatus" label="庫存狀態 *" :name="`status-${line.key}`" :options="stockOptions"
              emit-value map-options outlined dense :rules="[required]" />
          </div>
        </div>
        <q-btn v-if="lines.length > 1" type="button" flat dense label="移除明細" :aria-label="`移除明細 ${index + 1}`" @click="lines.splice(index, 1)" />
      </fieldset>
      <q-banner v-if="error" role="alert" class="text-negative q-mb-md">{{ error }}</q-banner>
      <q-banner v-if="uncertain" role="status" class="q-mb-md">建立結果尚未確認。請再次提交同一草稿。</q-banner>
      <div class="row q-gutter-sm">
        <q-btn type="button" flat label="加入明細" :disable="uncertain || command.isBusy('create') || lines.length >= 100" @click="addLine" />
        <q-btn type="submit" color="primary" label="建立草稿" :loading="command.isBusy('create')" />
      </div>
    </q-form>
  </template>
</template>
