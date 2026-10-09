<script>
export const page={name:"sales-imports",path:"/sales/imports",title:"批量匯入",requires:{permissions:["sales.view"]},menu:{group:"salesOrderManagement",icon:"upload_file",order:30}};
</script>
<script setup>
import {computed,ref} from "vue";
import {useRoute,useRouter} from "vue-router";
import PageHeader from "@/framework/layout/PageHeader.vue";
import DataTable from "@/framework/ui/DataTable.vue";
import EllipsisCell from "@/framework/ui/EllipsisCell.vue";
import {useRequestAbort} from "@/framework/http/useRequestAbort.js";
import {importStatusLabels} from "@/components/sales/SalesImportSummary.vue";
import {can} from "@/framework/authorization/can.js";
import {useSessionStore} from "@/stores/session.js";
import sales from "@/services/sales.js";
const route=useRoute(),router=useRouter(),session=useSessionStore(),signal=useRequestAbort();
const write=computed(()=>can(session,{permissions:["sales.import"]})),status=ref(route.query.status??null),fileName=ref(route.query.fileName??"");
const columns=[{name:"batchNumber",label:"批次編號",field:"batchNumber",align:"left",sortable:true},{name:"fileName",label:"檔案",field:"fileName",align:"left"},{name:"status",label:"狀態",field:"status",align:"left",sortable:true},{name:"counts",label:"成功／無效／重複／失敗",field:"successCount"},{name:"createdAt",label:"建立時間",field:"createdAt",sortable:true},{name:"actions",label:"操作",align:"right"}];
const options=Object.entries(importStatusLabels).map(([value,label])=>({value,label}));
function apply(){router.replace({query:{...(status.value?{status:status.value}:{}),...(fileName.value?{fileName:fileName.value}:{})}});}
function fetchRows(params){return sales.listImports({...params,status:route.query.status,fileName:route.query.fileName,signal});}
</script>
<template><div><PageHeader subtitle="先預檢，再確認匯入有效來源；每個來源獨立處理。"><template #actions><q-btn v-if="write" label="上傳 CSV" color="primary" to="/sales/imports/new" /></template></PageHeader><div class="q-px-md q-pb-md"><div class="row q-col-gutter-md"><div class="col-12 col-md-4"><q-select v-model="status" label="匯入狀態" :options="options" emit-value map-options clearable outlined dense /></div><div class="col-12 col-md-5"><q-input v-model="fileName" label="檔案名稱" maxlength="255" outlined dense @keyup.enter="apply" /></div><div class="col-12 col-md-3"><q-btn label="搜尋批次" color="primary" @click="apply" /></div></div></div><div class="q-px-md q-pb-md"><DataTable :key="JSON.stringify(route.query)" :fetch="fetchRows" :columns="columns" sticky-actions :initial-pagination="{page:1,rowsPerPage:20,rowsNumber:0,sortBy:'createdAt',descending:true}"><template #body-cell-fileName="{value}"><EllipsisCell :text="value" /></template><template #body-cell-status="{value}"><q-td>{{ importStatusLabels[value] }}</q-td></template><template #body-cell-counts="{row}"><q-td>{{ row.successCount }}／{{ row.invalidCount }}／{{ row.duplicateCount }}／{{ row.failedCount }}</q-td></template><template #body-cell-createdAt="{value}"><q-td>{{ new Date(value).toLocaleString('zh-HK',{timeZone:'Asia/Hong_Kong'}) }}</q-td></template><template #body-cell-actions="{row}"><q-td><q-btn flat :label="`查看 ${row.batchNumber}`" :to="`/sales/imports/${row.id}`" /></q-td></template><template #no-data><p role="status">沒有符合條件的匯入批次。</p></template></DataTable></div></div></template>
