<script setup>
import { useId } from "vue";

const rows = defineModel({ type: Array, required: true });
defineProps({ locked: Boolean });
const heading = useId();
let nextId = 0;

function append() { rows.value = [...rows.value, { key: `expense-${++nextId}`, description: "", lineAmount: "" }]; }
function remove(key) { rows.value = rows.value.filter((row) => row.key !== key); }
</script>

<template>
  <fieldset class="q-pa-md q-mb-md" :aria-labelledby="heading">
    <legend :id="heading">費用行</legend>
    <div v-for="(row, index) in rows" :key="row.key" class="row items-start q-col-gutter-sm q-mb-sm">
      <div class="col-12 col-sm">
        <q-input v-model="row.description" :label="`費用 ${index + 1} 說明`" :name="`expenseDescription${index}`" maxlength="500" required outlined dense :disable="locked" />
      </div>
      <div class="col-8 col-sm-4">
        <q-input v-model="row.lineAmount" :label="`費用 ${index + 1} 金額`" :name="`expenseAmount${index}`" inputmode="decimal" required outlined dense :disable="locked" />
      </div>
      <div class="col-auto">
        <q-btn flat color="negative" label="移除" type="button" :aria-label="`移除費用 ${index + 1}`" :disable="locked" @click="remove(row.key)" />
      </div>
    </div>
    <q-btn flat color="primary" label="新增費用行" type="button" :disable="locked" @click="append" />
  </fieldset>
</template>
