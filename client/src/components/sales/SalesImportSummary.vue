<script>
export const importStatusLabels={UPLOADED:"已上傳",VALIDATING:"預檢中",READY:"預檢完成",QUEUED:"已排程",PROCESSING:"匯入中",COMPLETED:"已完成",PARTIAL_SUCCESS:"部分成功",FAILED:"失敗",CANCELLED:"已取消"};
</script>
<script setup>
defineProps({job:{type:Object,required:true},canImport:{type:Boolean,default:false},busy:{type:Boolean,default:false}});
defineEmits(["action"]);
const counts={sourceOrderCount:"來源訂單",totalRowCount:"來源行",validCount:"有效",invalidCount:"無效",duplicateCount:"重複",successCount:"成功",failedCount:"失敗",warningCount:"警告"};
</script>
<template><q-card><q-card-section><h2 class="text-h6 q-ma-none">匯入摘要</h2><div role="status" aria-live="polite" class="q-mt-sm"><p>{{ importStatusLabels[job.status] }}</p><div class="row q-col-gutter-sm"><div v-for="(label,key) in counts" :key="key" class="col-6 col-md-3">{{ label }} {{ job[key] ?? '—' }}</div></div></div><p v-if="job.filesPurgedAt" class="q-mt-md">檔案已到期；結構化結果仍可查閱。</p></q-card-section><q-card-actions v-if="canImport && job.allowedActions?.length"><q-btn v-for="action in job.allowedActions" :key="action" :label="action==='confirm'?'確認匯入':'取消匯入'" :color="action==='confirm'?'primary':undefined" :disable="busy" @click="$emit('action',action)" /></q-card-actions></q-card></template>
