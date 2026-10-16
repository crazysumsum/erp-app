<script setup>
import {onBeforeUnmount,ref,watch} from "vue";
import {useRouter} from "vue-router";
import {useSessionStore} from "@/stores/session.js";
import FormPanel from "@/framework/ui/FormPanel.vue";
import sales from "@/services/sales.js";
const props=defineProps({scope:{type:String,required:true},filters:{type:Object,required:true},disabled:Boolean});
const router=useRouter(),session=useSessionStore(),dialog=ref(false),intent=ref(null),attempted=ref(false);let controller=new AbortController();
watch(()=>session.user?.id,()=>{controller.abort();controller=new AbortController();intent.value=null;dialog.value=false;attempted.value=false;});onBeforeUnmount(()=>controller.abort());
function choose(){
 if(!intent.value){const filters=JSON.parse(JSON.stringify(props.filters));for(const key of ["customerId","warehouseId"])if(filters[key]!==undefined)filters[key]=Number(filters[key]);for(const key of ["hasBackorder","descending"])if(["true","false"].includes(filters[key]))filters[key]=filters[key]==="true";if(typeof filters.status==="string")filters.status=[filters.status];intent.value={eventId:crypto.randomUUID(),scope:props.scope,filters};}
 dialog.value=true;
}
async function submit(){const signal=controller.signal;attempted.value=true;try{await sales.createExport(intent.value,{signal});if(signal.aborted)return;intent.value=null;attempted.value=false;dialog.value=false;await router.push("/sales/exports");}catch(cause){if(signal.aborted)return;if(cause.status&&cause.status<500&&cause.status!==408)attempted.value=false;throw Error(cause.status&&cause.status<500&&cause.status!==408?"建立匯出遭拒；請確認篩選與查閱權限。":"匯出結果未確定；重試會沿用此篩選與原事件。");}}
function cancel(){if(!attempted.value)intent.value=null;dialog.value=false;}
</script>
<template><q-btn :label="attempted?'重試原匯出':'建立 CSV 匯出'" color="primary" :disable="disabled&&!attempted" @click="choose" /><q-dialog v-model="dialog" persistent aria-label="確認匯出篩選"><q-card class="sales-export-dialog"><q-card-section><h2 class="text-h6 q-mt-none">確認匯出篩選</h2><p>資料來源：{{ intent?.scope }}。匯出最多 250,000 筆，完成後檔案保留 7 天。</p><p>依此篩選匯出全部符合的訂單，不限目前頁面。</p><pre class="sales-export-snapshot">{{ JSON.stringify(intent?.filters,null,2) }}</pre><FormPanel :on-submit="submit" v-slot="{submitting}"><div class="row q-gutter-sm"><q-btn flat :label="attempted?'關閉（保留原事件）':'返回'" :disable="submitting" @click="cancel" /><q-btn type="submit" label="提交匯出" color="primary" :loading="submitting" /></div></FormPanel></q-card-section></q-card></q-dialog></template>
<style scoped>.sales-export-dialog{width:560px;max-width:calc(100vw - 32px)}.sales-export-snapshot{white-space:pre-wrap;overflow-wrap:anywhere}</style>
