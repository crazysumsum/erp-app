<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { promptPassword, promptReason } from "@/framework/ui/confirm.js";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";
import customerService from "@/services/customer.js";

const props = defineProps({
  customerId: { type: Number, required: true }, customerStatus: { type: String, required: true },
  canManageGeneral: Boolean, canViewSensitive: Boolean, canManageSensitive: Boolean
});
const items = ref([]); const restrictedCount = ref(0); const loading = ref(true); const error = ref("");
const editing = ref(false); const editId = ref(null); const file = ref(null); const saving = ref(false);
const preview = reactive({ open: false, url: "", type: "", name: "" });
let previewGeneration = 0;
let customerGeneration = 0;
const form = reactive({ displayName: "", documentType: "contract", sensitivity: "general", sortOrder: 0, notes: "", reason: "" });
const allDocumentTypes = [
  { label: "商業證明", value: "business_certificate" }, { label: "信用申請", value: "credit_application" },
  { label: "合約", value: "contract" }, { label: "銀行證明", value: "bank_proof" }, { label: "其他", value: "other" }
];
const documentTypes = computed(() => allDocumentTypes.filter(({ value }) => value !== "bank_proof" || props.canManageSensitive));
const sensitivityOptions = computed(() => [
  { label: "一般", value: "general" }, ...(props.canManageSensitive ? [{ label: "銀行敏感", value: "bank_sensitive" }] : [])
]);

function reset() { Object.assign(form, { displayName: "", documentType: "contract", sensitivity: "general", sortOrder: 0, notes: "", reason: "" }); file.value = null; editId.value = null; }
function start(item = null) {
  reset(); editing.value = true;
  if (item) Object.assign(form, { displayName: item.displayName, documentType: item.documentType, sensitivity: item.sensitivity, sortOrder: item.sortOrder, notes: item.notes, reason: "" });
  editId.value = item?.id ?? null;
}
function cancel() { reset(); editing.value = false; }
function captureCustomer() { return { id: props.customerId, generation: customerGeneration }; }
function isCurrentCustomer(context) { return context.id === props.customerId && context.generation === customerGeneration; }
function canManageSensitivity(sensitivity) { return sensitivity === "bank_sensitive" ? props.canManageSensitive : props.canManageGeneral; }
function clearPreview() {
  previewGeneration += 1;
  if (preview.url) URL.revokeObjectURL(preview.url);
  Object.assign(preview, { open: false, url: "", type: "", name: "" });
}
async function load() {
  const context = captureCustomer();
  loading.value = true; error.value = "";
  try { const result = await customerService.attachments(context.id); if (isCurrentCustomer(context)) { items.value = result.items; restrictedCount.value = result.restrictedCount; } }
  catch (e) { if (isCurrentCustomer(context)) error.value = e.message || "載入附件失敗"; }
  finally { if (isCurrentCustomer(context)) loading.value = false; }
}
async function save() {
  if (saving.value || form.reason.trim().length < 5 || (!editId.value && !file.value)) return;
  const context = captureCustomer();
  saving.value = true; error.value = "";
  try {
    const metadata = { displayName: form.displayName.trim(), documentType: form.documentType, sensitivity: form.sensitivity, sortOrder: Number(form.sortOrder), notes: form.notes.trim(), reason: form.reason.trim() };
    if (editId.value) {
      const current = items.value.find(({ id }) => id === editId.value);
      const update = { ...metadata }; delete update.sensitivity;
      await customerService.updateAttachment(context.id, editId.value, { ...update, version: current.version });
    } else {
      let password;
      if (form.sensitivity === "bank_sensitive") {
        password = await promptPassword({ title: "上傳銀行敏感附件", message: "敏感附件會加密保存並留下安全稽核。", okLabel: "確認上傳" });
        if (!password) return;
        if (!isCurrentCustomer(context) || !canManageSensitivity(metadata.sensitivity)) return;
      }
      await customerService.uploadAttachment(context.id, { file: file.value, password, ...metadata });
    }
    if (!isCurrentCustomer(context)) return;
    cancel(); await load(); notifySuccess("附件已儲存");
  } catch (e) { if (isCurrentCustomer(context)) { error.value = e.message || "儲存附件失敗"; notifyError(error.value); } }
  finally { saving.value = false; }
}
async function deactivate(item) {
  const context = captureCustomer();
  const reason = await promptReason({ title: "停用附件", message: item.displayName, okLabel: "確認停用" });
  if (!reason || !isCurrentCustomer(context) || !canManage(item)) return;
  try { await customerService.deactivateAttachment(context.id, item.id, { version: item.version, reason }); if (!isCurrentCustomer(context)) return; await load(); notifySuccess("附件已停用"); }
  catch (e) { if (isCurrentCustomer(context)) { error.value = e.message || "停用附件失敗"; notifyError(error.value); } }
}
async function remove(item) {
  const context = captureCustomer();
  const confirmation = await promptPassword({ title: "永久刪除附件", message: "只可刪除未引用的 Draft 客戶附件；此操作不能復原。", okLabel: "永久刪除", requireReason: true });
  if (!confirmation || !isCurrentCustomer(context) || !canManage(item)) return;
  try { await customerService.deleteAttachment(context.id, item.id, { version: item.version, ...confirmation }); if (!isCurrentCustomer(context)) return; await load(); notifySuccess("附件已永久刪除"); }
  catch (e) { if (isCurrentCustomer(context)) { error.value = e.message || "刪除附件失敗"; notifyError(error.value); } }
}
async function open(item, mode) {
  clearPreview();
  const generation = previewGeneration; const customerId = props.customerId;
  try {
    let sessionToken;
    if (item.sensitivity === "bank_sensitive") {
      const confirmation = await promptPassword({ title: mode === "preview" ? "預覽敏感附件" : "下載敏感附件", message: "存取會留下安全稽核。", okLabel: mode === "preview" ? "預覽" : "下載", requireReason: true });
      if (!confirmation) return;
      if (generation !== previewGeneration || customerId !== props.customerId || !props.canViewSensitive) return;
      sessionToken = (await customerService.authorizeAttachmentDownload(customerId, item.id, { mode, ...confirmation })).token;
      if (generation !== previewGeneration || customerId !== props.customerId || !props.canViewSensitive) return;
    }
    const { blob, contentType } = await customerService.attachmentContent(customerId, item.id, mode, { sessionToken });
    const url = URL.createObjectURL(blob);
    if (generation !== previewGeneration || customerId !== props.customerId || (item.sensitivity === "bank_sensitive" && !props.canViewSensitive)) { URL.revokeObjectURL(url); return; }
    if (mode === "preview") Object.assign(preview, { open: true, url, type: contentType, name: item.displayName });
    else { const anchor = document.createElement("a"); anchor.href = url; anchor.download = item.originalFilename; anchor.click(); URL.revokeObjectURL(url); }
  } catch (e) { if (generation === previewGeneration && customerId === props.customerId) { error.value = e.message || "無法取得附件"; notifyError(error.value); } }
}
function canManage(item) { return canManageSensitivity(item.sensitivity); }
function onVisibility() { if (document.hidden) clearPreview(); }
watch(() => [props.customerId, props.canViewSensitive, props.canManageGeneral, props.canManageSensitive], () => { customerGeneration += 1; clearPreview(); cancel(); items.value = []; void load(); });
watch(() => form.documentType, (value) => { if (value === "bank_proof") form.sensitivity = "bank_sensitive"; });
onMounted(() => { window.addEventListener("pagehide", clearPreview); document.addEventListener("visibilitychange", onVisibility); load(); });
onBeforeUnmount(() => { customerGeneration += 1; clearPreview(); window.removeEventListener("pagehide", clearPreview); document.removeEventListener("visibilitychange", onVisibility); });
</script>

<template>
  <section aria-labelledby="customer-attachment-heading">
    <div class="row items-center justify-between q-mb-sm"><div><h2 id="customer-attachment-heading" class="text-h6 q-my-none">附件</h2><p class="text-caption text-grey-8 q-my-xs">附件為選填；銀行敏感文件需重新驗證才能預覽或下載。</p></div><q-btn v-if="canManageGeneral && !editing" color="primary" flat label="新增附件" @click="start()" /></div>
    <q-banner v-if="error" class="bg-negative text-white q-mb-md" role="alert">{{ error }}<template #action><q-btn v-if="!editing" flat label="重試" @click="load" /></template></q-banner>
    <q-banner v-if="restrictedCount" class="bg-grey-2 q-mb-md" role="status">另有 {{ restrictedCount }} 份受限制文件</q-banner>
    <q-skeleton v-if="loading" type="rect" height="100px" aria-label="載入附件" />
    <q-card v-else-if="editing" flat bordered><q-card-section><div class="row q-col-gutter-sm">
      <div v-if="!editId" class="col-12"><q-file v-model="file" outlined dense label="檔案 *" accept="application/pdf,image/png,image/jpeg,image/webp" /></div>
      <div class="col-12 col-md-6"><q-input v-model="form.displayName" outlined dense label="顯示名稱 *" maxlength="190" /></div>
      <div class="col-12 col-md-6"><q-select v-model="form.documentType" :options="documentTypes" emit-value map-options outlined dense label="文件類型 *" /></div>
      <div v-if="!editId" class="col-12 col-md-6"><q-select v-model="form.sensitivity" :options="sensitivityOptions" emit-value map-options outlined dense label="敏感級別 *" /></div>
      <div class="col-12 col-md-6"><q-input v-model.number="form.sortOrder" type="number" min="0" outlined dense label="排序" /></div>
      <div class="col-12"><q-input v-model="form.notes" outlined dense type="textarea" autogrow label="備註" maxlength="500" /></div>
      <div class="col-12"><q-input v-model="form.reason" outlined dense type="textarea" autogrow label="操作原因 *" maxlength="500" hint="最少 5 個字元；會寫入稽核記錄。" /></div>
    </div></q-card-section><q-card-actions align="right"><q-btn flat label="取消" @click="cancel" /><q-btn color="primary" label="儲存附件" :loading="saving" :disable="!form.displayName.trim() || form.reason.trim().length < 5 || (!editId && !file)" @click="save" /></q-card-actions></q-card>
    <q-banner v-else-if="items.length === 0" class="bg-grey-2">尚未上傳附件；不影響客戶啟用。</q-banner>
    <q-list v-else bordered separator><q-item v-for="item in items" :key="item.id"><q-item-section><q-item-label>{{ item.displayName }} <q-badge :label="item.sensitivity === 'bank_sensitive' ? '銀行敏感' : '一般'" :color="item.sensitivity === 'bank_sensitive' ? 'negative' : 'primary'" /></q-item-label><q-item-label caption>{{ item.documentType }} · {{ item.originalFilename }} · {{ item.sizeBytes }} bytes · {{ item.status === 'active' ? '有效' : '已停用' }}</q-item-label></q-item-section><q-item-section side><div class="row q-gutter-xs"><q-btn flat dense label="預覽" :aria-label="`預覽 ${item.displayName}`" @click="open(item, 'preview')" /><q-btn flat dense label="下載" :aria-label="`下載 ${item.displayName}`" @click="open(item, 'download')" /><q-btn v-if="item.status === 'active' && canManage(item)" flat dense label="編輯" :aria-label="`編輯 ${item.displayName}`" @click="start(item)" /><q-btn v-if="item.status === 'active' && canManage(item)" flat dense color="negative" label="停用" :aria-label="`停用 ${item.displayName}`" @click="deactivate(item)" /><q-btn v-if="customerStatus === 'draft' && canManage(item)" flat dense color="negative" label="永久刪除" :aria-label="`永久刪除 ${item.displayName}`" @click="remove(item)" /></div></q-item-section></q-item></q-list>
    <q-dialog v-model="preview.open" @hide="clearPreview"><q-card style="width:min(900px, 95vw);max-width:95vw"><q-card-section class="row items-center"><h3 class="text-h6 q-my-none">預覽：{{ preview.name }}</h3><q-space /><q-btn v-close-popup flat round icon="close" aria-label="關閉附件預覽" /></q-card-section><q-card-section><img v-if="preview.type.startsWith('image/')" :src="preview.url" :alt="preview.name" style="max-width:100%;max-height:70vh" /><iframe v-else :src="preview.url" :title="`預覽 ${preview.name}`" sandbox style="width:100%;height:70vh;border:0" /></q-card-section></q-card></q-dialog>
  </section>
</template>
