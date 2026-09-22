<script setup>
import { onMounted, reactive, ref } from "vue";
import { promptPassword } from "@/framework/ui/confirm.js";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";
import customerCatalogService from "@/services/customerCatalog.js";

const props = defineProps({ catalog: { type: String, required: true }, title: { type: String, required: true } });
const items = ref([]); const loading = ref(true); const error = ref(""); const dialog = ref(false); const editing = ref(null); const saving = ref(false);
const form = reactive({ code: "", name: "", description: "", sortOrder: 0 });

async function load() {
  loading.value = true;
  try { items.value = (await customerCatalogService.list(props.catalog, { includeInactive: true })).items; error.value = ""; }
  catch (e) { error.value = e.message || `載入${props.title}失敗`; }
  finally { loading.value = false; }
}
function openCreate() { editing.value = null; Object.assign(form, { code: "", name: "", description: "", sortOrder: 0 }); dialog.value = true; }
function openEdit(item) { editing.value = item; Object.assign(form, { code: item.code, name: item.name, description: item.description, sortOrder: item.sortOrder }); dialog.value = true; }
async function save() {
  if (!form.code.trim() || !form.name.trim() || saving.value) return;
  const confirmation = await promptPassword({ title: editing.value ? `修改${props.title}` : `新增${props.title}`, message: "此操作要求已核准裝置，並會寫入稽核記錄。", okLabel: "確認儲存", requireReason: true });
  if (!confirmation) return;
  saving.value = true;
  try {
    const payload = { code: form.code.trim(), name: form.name.trim(), description: form.description.trim(), sortOrder: Number(form.sortOrder), ...confirmation };
    if (editing.value) await customerCatalogService.update(props.catalog, editing.value.id, { ...payload, version: editing.value.version });
    else await customerCatalogService.create(props.catalog, payload);
    dialog.value = false; notifySuccess(`${props.title}已儲存`); await load();
  } catch (e) { notifyError(e.message || `儲存${props.title}失敗`); }
  finally { saving.value = false; }
}
async function deactivate(item) {
  const confirmation = await promptPassword({ title: `停用${props.title}`, message: `${item.code} — ${item.name} 停用後不可再指派給新資料。`, okLabel: "確認停用", requireReason: true });
  if (!confirmation) return;
  try { await customerCatalogService.deactivate(props.catalog, item.id, { version: item.version, ...confirmation }); notifySuccess(`${props.title}已停用`); await load(); }
  catch (e) { notifyError(e.message || `停用${props.title}失敗`); }
}
onMounted(load);
</script>

<template>
  <q-card flat bordered>
    <q-card-section class="row items-center justify-between"><h2 class="text-subtitle1 q-ma-none">{{ title }}</h2><q-btn color="primary" dense :label="`新增${title}`" @click="openCreate" /></q-card-section>
    <q-card-section class="q-pt-none">
      <q-spinner-dots v-if="loading" size="2em" :aria-label="`載入${title}`" />
      <q-banner v-else-if="error" class="bg-negative text-white" role="alert">{{ error }}<template #action><q-btn flat label="重試" @click="load" /></template></q-banner>
      <q-markup-table v-else flat bordered dense separator="horizontal">
        <thead><tr><th class="text-left">代碼</th><th class="text-left">名稱</th><th class="text-left">狀態</th><th class="text-right">操作</th></tr></thead>
        <tbody><tr v-for="item in items" :key="item.id"><td>{{ item.code }}</td><td>{{ item.name }}</td><td>{{ item.status === 'active' ? '使用中' : '已停用' }}</td><td class="text-right"><q-btn flat dense label="編輯" :aria-label="`編輯${title} ${item.code}`" @click="openEdit(item)" /><q-btn v-if="item.status === 'active'" flat dense color="negative" label="停用" :aria-label="`停用${title} ${item.code}`" @click="deactivate(item)" /></td></tr><tr v-if="!items.length"><td colspan="4" class="text-center text-grey-7">尚未建立資料</td></tr></tbody>
      </q-markup-table>
    </q-card-section>
    <q-dialog v-model="dialog" persistent><q-card style="width:min(560px,94vw)"><q-form @submit.prevent="save"><q-card-section><h3 class="text-h6 q-ma-none">{{ editing ? `編輯${title}` : `新增${title}` }}</h3></q-card-section><q-card-section class="q-gutter-md q-pt-none"><q-input v-model="form.code" outlined dense label="代碼 *" maxlength="50" /><q-input v-model="form.name" outlined dense label="名稱 *" maxlength="100" /><q-input v-model="form.description" outlined dense type="textarea" label="說明" maxlength="500" /><q-input v-model.number="form.sortOrder" outlined dense type="number" min="0" max="1000000" label="排序" /></q-card-section><q-card-actions align="right"><q-btn flat label="取消" v-close-popup /><q-btn color="primary" label="儲存" type="submit" :disable="!form.code.trim() || !form.name.trim()" :loading="saving" /></q-card-actions></q-form></q-card></q-dialog>
  </q-card>
</template>
