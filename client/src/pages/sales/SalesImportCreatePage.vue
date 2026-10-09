<script>
export const page={name:"sales-import-create",path:"/sales/imports/new",title:"上傳銷售 CSV",requires:{permissions:["sales.view","sales.import"]}};
</script>
<script setup>
import {ref,watch} from "vue";
import {useRouter} from "vue-router";
import PageHeader from "@/framework/layout/PageHeader.vue";
import FormPanel from "@/framework/ui/FormPanel.vue";
import {useRequestAbort} from "@/framework/http/useRequestAbort.js";
import {notifyError} from "@/framework/ui/notify.js";
import sales from "@/services/sales.js";
const router=useRouter(),signal=useRequestAbort(),file=ref(null),eventId=ref(crypto.randomUUID()),templateBusy=ref(false);
watch(file,()=>{eventId.value=crypto.randomUUID();});
async function upload(){if(!file.value||!file.value.name.toLowerCase().endsWith('.csv')||file.value.size<1||file.value.size>52428800)throw Error("請選擇非空 CSV，大小不得超過 50 MiB。");return sales.uploadImport({file:file.value,eventId:eventId.value,signal});}
async function template(){templateBusy.value=true;try{const {blob,fileName}=await sales.downloadImportTemplate({signal});if(signal.aborted)return;const url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download=fileName??"sales-import-template.csv";link.click();URL.revokeObjectURL(url);}catch{if(!signal.aborted)notifyError("範本下載失敗，請重試。");}finally{templateBusy.value=false;}}
function uploaded(result){if(!signal.aborted)router.push(`/sales/imports/${result.importJob.id}`);}
</script>
<template><div><PageHeader subtitle="CSV 1.0：UTF-8，最多 50 MiB／100,000 行／10,000 張來源訂單。"><template #actions><q-btn flat label="返回批次" to="/sales/imports" /></template></PageHeader><div class="q-px-md q-pb-md"><q-card><q-card-section><h2 class="text-h6 q-ma-none">選擇檔案</h2><p>先下載範本；同一來源訂單須使用相同來源 key 及一致訂單表頭，行可以不連續。上傳只會建立預檢工作，確認前不會建立銷售訂單。</p><q-btn label="下載 CSV 範本" outline color="primary" :loading="templateBusy" @click="template" /><FormPanel class="q-mt-md" :on-submit="upload" @success="uploaded" v-slot="{submitting}"><q-file v-model="file" label="銷售 CSV 檔案" aria-label="銷售 CSV 檔案" accept=".csv,text/csv" outlined :disable="submitting" :rules="[v=>!!v||'請選擇 CSV 檔案']" /><p class="text-body2">連線中斷時，可重試目前檔案；同一事件 ID 會保留，避免重複建立工作。</p><div class="row q-gutter-sm"><q-btn label="上傳並預檢" type="submit" color="primary" :loading="submitting" /></div></FormPanel></q-card-section></q-card></div></div></template>
