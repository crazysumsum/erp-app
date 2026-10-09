<script setup>
import DataTable from "@/framework/ui/DataTable.vue";
import EllipsisCell from "@/framework/ui/EllipsisCell.vue";
defineProps({fetch:{type:Function,required:true}});
const columns=[{name:"rowNo",label:"來源行",field:"rowNo",align:"left"},{name:"field",label:"欄位",field:"field",align:"left"},{name:"code",label:"錯誤代碼",field:"code",align:"left"},{name:"message",label:"原因",field:"message",align:"left"}];
</script>
<template><DataTable :fetch="fetch" :columns="columns"><template #body-cell-field="{value}"><EllipsisCell :text="value" /></template><template #body-cell-message="{value}"><EllipsisCell :text="value" max-width="300px" /></template><template #no-data><p role="status">此來源沒有驗證錯誤。</p></template></DataTable></template>
