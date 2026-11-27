<script setup>
import { ref, useId, watch } from "vue";

const props = defineProps({ target: { type: Object, default: null } });
const emit = defineEmits(["cancel", "confirm"]);
const titleId = useId(), impactId = useId();
const reason = ref("");
const lineIds = ref([]);

watch(() => props.target, (target) => {
  if (!target) return;
  reason.value = "";
  lineIds.value = [];
});

function validReason(value) {
  const { length } = [...value.trim()];
  return (length >= 5 && length <= 500) || "請輸入 5 至 500 字的原因。";
}

function submit() {
  const { lines } = props.target;
  if (lines.length && !lineIds.value.length) return;
  emit("confirm", { reason: reason.value.trim(), ...(lines.length ? { lineIds: [...lineIds.value] } : {}) });
}
</script>

<template>
  <q-dialog :model-value="!!target" no-backdrop-dismiss :aria-labelledby="titleId" :aria-describedby="impactId"
    @update:model-value="value => { if (!value) emit('cancel'); }">
    <q-card v-if="target" class="po-lifecycle-dialog">
      <q-form @submit="submit">
        <q-card-section>
          <h2 :id="titleId" class="text-h6 q-ma-none">{{ target.label }}</h2>
          <p :id="impactId" class="q-mt-sm q-mb-none">{{ target.number }}。{{ target.impact }}</p>
        </q-card-section>
        <q-card-section class="q-pt-none">
          <fieldset v-if="target.lines.length" class="po-lifecycle-lines q-pa-none q-mb-md">
            <legend class="text-weight-medium">勾選要結清的明細</legend>
            <q-checkbox v-for="line in target.lines" :key="line.id" v-model="lineIds" :val="line.id" class="block"
              :label="`第 ${line.lineNumber} 行 ${line.skuCode} — ${line.skuName}，將結清 ${line.outstandingBaseQuantity} ${line.baseUomCode}`" />
          </fieldset>
          <q-input v-model="reason" label="原因（必填）" aria-required="true" type="textarea"
            hint="請輸入 5 至 500 字" outlined dense lazy-rules :rules="[validReason]" />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn type="button" flat label="返回" autofocus @click="emit('cancel')" />
          <q-btn type="submit" color="negative" :label="target.label" :disable="target.lines.length > 0 && !lineIds.length" />
        </q-card-actions>
      </q-form>
    </q-card>
  </q-dialog>
</template>

<style scoped>
.po-lifecycle-dialog {
  width: 34rem;
  max-width: calc(100vw - 32px);
}

.po-lifecycle-lines {
  min-inline-size: 0;
  border: 0;
}
</style>
