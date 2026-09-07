<script setup>
/**
 * 建議零售價輸入——固定 HKD／`tax_not_applicable`，使用者只揀 amount（見
 * itemConstants.js 嘅 ITEM_PRICE_CURRENCY／ITEM_PRICE_TAX_BASIS，design_spec
 * §6.5：「request 只接受 amount，不接受 client 自行提交 currency／tax
 * basis」）。呢度淨係管使用者睇到嘅字串；轉做後端要求嘅
 * `^\d{1,15}\.\d{4}$` 四位小數格式由 ItemCreatePage 提交嗰陣做，唔喺呢度
 * 逼使用者一定要打齊四位小數先入到值。
 */
const model = defineModel({ type: String, default: "" });

defineProps({
  errorMessage: { type: String, default: "" },
  label: { type: String, default: "建議零售價" }
});
</script>

<template>
  <q-input
    v-model="model"
    :label="label"
    outlined
    dense
    prefix="HK$"
    suffix="（未稅）"
    :error="!!errorMessage"
    :error-message="errorMessage"
  />
</template>
