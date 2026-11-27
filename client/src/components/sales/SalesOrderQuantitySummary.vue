<script setup>
import { formatMoney } from "@/framework/ui/numberFormat.js";
import { computed } from "vue";
import { previewTotal } from "./salesEditorMath.js";
const props=defineProps({lines:{type:Array,required:true},currencyCode:{type:String,default:""},savedTotal:{type:String,default:null},savedCurrencyCode:{type:String,default:""}});
const total=computed(()=>previewTotal(props.lines));
</script>
<template><div role="status" class="q-mt-md">{{ lines.length }} 項明細；{{ currencyCode || '未選貨幣' }} 預計總額 {{ formatMoney(total, currencyCode) }}；以儲存後伺服器總額為準。<span v-if="savedTotal!==null"> 上次儲存總額 {{ savedCurrencyCode || currencyCode }} {{ formatMoney(savedTotal, savedCurrencyCode || currencyCode) }}</span></div></template>
