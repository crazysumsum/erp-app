<script setup>
import { computed } from "vue";

const props = defineProps({ received: { type: String, required: true }, ordered: { type: String, required: true } });
// Base 數量係 BIGINT 字串，超過 2^53 用 Number 除會失準。ordered 有 DB CHECK > 0。
const ratio = computed(() => {
  const percent = (BigInt(props.received) * 100n) / BigInt(props.ordered);
  return Number(percent > 100n ? 100n : percent) / 100;
});
</script>

<template>
  <div class="po-progress">
    <div>{{ received }}／{{ ordered }}</div>
    <q-linear-progress :value="ratio" color="primary" track-color="grey-4" size="6px" :aria-label="`已收 ${received}，訂購 ${ordered}`" />
  </div>
</template>

<style scoped>
.po-progress { min-width: 5rem; }
</style>
