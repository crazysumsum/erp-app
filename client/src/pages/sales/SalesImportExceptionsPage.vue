<script>
export const page={name:"sales-import-exceptions",path:"/sales/imports/exceptions",title:"匯入例外",requires:{permissions:["sales.view"]},menu:{group:"salesOrderManagement",icon:"report_problem",order:40}};
</script>
<script setup>
import {computed,onMounted,ref} from "vue";
import {useRoute,useRouter} from "vue-router";
import PageHeader from "@/framework/layout/PageHeader.vue";
import DataTable from "@/framework/ui/DataTable.vue";
import EllipsisCell from "@/framework/ui/EllipsisCell.vue";
import Errors from "@/components/sales/SalesImportErrorTable.vue";
import {useRequestAbort} from "@/framework/http/useRequestAbort.js";
import sales from "@/services/sales.js";
const route=useRoute(),router=useRouter(),signal=useRequestAbort(),jobs=ref([]),lookupError=ref(false),errorCode=ref(route.query.errorCode??""),externalOrderId=ref(route.query.externalOrderId??""),source=ref(route.query.sourceOrderKey??""),status=ref(route.query.status??"INVALID");
const jobId=computed(()=>Number(route.query.jobId)||null),orderId=computed(()=>Number(route.query.orderId)||null);
const columns=[{name:"sourceOrderKey",label:"來源訂單",field:"sourceOrderKey",align:"left"},{name:"status",label:"來源狀態",field:"status"},{name:"resultCode",label:"結果",field:"resultCode"},{name:"actions",label:"操作",align:"right"}];
async function loadJobs(value=""){try{lookupError.value=false;const result=await sales.listImports({page:1,pageSize:100,fileName:value,signal});if(!signal.aborted)jobs.value=result.rows.map(row=>({value:row.id,label:row.batchNumber}));}catch{if(!signal.aborted)lookupError.value=true;}}
onMounted(()=>loadJobs());
function filterJobs(value,update){update(()=>{});loadJobs(value);}
function select(value){router.replace({query:{jobId:String(value)}});}
function apply(){router.replace({query:{jobId:String(jobId.value),...(status.value?{status:status.value}:{}),...(source.value?{sourceOrderKey:source.value}:{}),...(errorCode.value?{errorCode:errorCode.value}:{}),...(externalOrderId.value?{externalOrderId:externalOrderId.value}:{})}});}
function orders(params){return sales.listImportOrders(jobId.value,{...params,status:route.query.status??'INVALID',sourceOrderKey:route.query.sourceOrderKey,errorCode:route.query.errorCode,externalOrderId:route.query.externalOrderId,signal});}
function errors(params){return sales.listImportErrors(jobId.value,orderId.value,{...params,signal});}
</script>
<template><div><PageHeader subtitle="選擇批次及來源訂單，查閱安全的欄位錯誤。"><template #actions><q-btn flat label="返回批次" to="/sales/imports" /></template></PageHeader><div class="q-px-md q-pb-md"><q-banner v-if="lookupError" role="alert" class="bg-negative text-white q-mb-md">批次清單讀取失敗。<template #action><q-btn flat label="重試批次清單" @click="loadJobs()" /></template></q-banner><div class="row q-col-gutter-md"><div class="col-12 col-md-4"><q-select :model-value="jobId" label="匯入批次" :options="jobs" use-input emit-value map-options outlined dense @filter="filterJobs" @update:model-value="select" /></div><div class="col-12 col-md-3"><q-select v-model="status" label="來源狀態" :options="[{value:'INVALID',label:'預檢無效'},{value:'FAILED',label:'處理失敗'},{value:'DUPLICATE',label:'重複來源'},{value:'SUCCEEDED',label:'成功來源'}]" emit-value map-options outlined dense /></div><div class="col-12 col-md-3"><q-input v-model="source" label="來源訂單（精確）" maxlength="190" outlined dense /></div><div class="col-12 col-md-3"><q-input v-model="errorCode" label="錯誤代碼（精確）" maxlength="80" outlined dense /></div><div class="col-12 col-md-4"><q-input v-model="externalOrderId" label="External ID（精確）" maxlength="190" outlined dense /></div><div class="col-12 col-md-2"><q-btn label="搜尋來源" color="primary" :disable="!jobId" @click="apply" /></div></div><p v-if="!jobId" role="status">請先選擇匯入批次。</p><template v-else><q-btn flat class="q-my-md" label="查看批次摘要" :to="`/sales/imports/${jobId}`" /><DataTable :key="JSON.stringify(route.query)" :fetch="orders" :columns="columns" sticky-actions :initial-pagination="{page:1,rowsPerPage:20,rowsNumber:0,sortBy:'firstRowNo',descending:false}"><template #body-cell-sourceOrderKey="{value}"><EllipsisCell :text="value" /></template><template #body-cell-actions="{row}"><q-td><q-btn flat :label="`欄位錯誤 ${row.sourceOrderKey}`" :to="{path:route.path,query:{...route.query,orderId:String(row.id)}}" /><q-btn v-if="row.salesOrderId&&!row.isArchived" flat :label="row.salesOrderNumber" :to="`/sales/orders/${row.salesOrderId}`" /><span v-else-if="row.isArchived">{{ row.salesOrderNumber }}（已封存）</span></q-td></template><template #no-data><p role="status">沒有符合條件的來源。</p></template></DataTable><template v-if="orderId"><h2 class="text-h6 q-my-md">來源 #{{ orderId }} 欄位錯誤</h2><Errors :key="`${jobId}:${orderId}`" :fetch="errors" /></template></template></div></div></template>
