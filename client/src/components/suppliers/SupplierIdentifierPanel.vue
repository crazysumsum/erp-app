<script setup>
import { nextTick, reactive, ref } from "vue";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";
import supplierService from "@/services/supplier.js";

const props = defineProps({
  supplierId: { type: Number, required: true },
  supplierCode: { type: String, required: true },
  identifiers: { type: Array, default: () => [] },
  canManage: { type: Boolean, default: false }
});
const emit = defineEmits(["refresh"]);

const TYPES = Object.freeze([
  { value: "business_registration", label: "商業登記" },
  { value: "company_registration", label: "公司註冊" },
  { value: "tax", label: "稅務識別" },
  { value: "other", label: "其他" }
]);
const TYPE_LABEL = Object.fromEntries(TYPES.map((item) => [item.value, item.label]));

const dialogOpen = ref(false);
const deleteDialogOpen = ref(false);
const submitting = ref(false);
const deleting = ref(false);
const editing = ref(null);
const deletingIdentifier = ref(null);
const errorMessage = ref("");
const errorRef = ref(null);
const deleteError = ref("");
const form = reactive({ identifierType: "business_registration", issuerCountryCode: "", identifierValue: "", notes: "", reason: "" });
const deleteReason = ref("");

function resetForm(identifier = null) {
  editing.value = identifier;
  errorMessage.value = "";
  Object.assign(form, {
    identifierType: identifier?.identifierType ?? "business_registration",
    issuerCountryCode: identifier?.issuerCountryCode ?? "",
    identifierValue: identifier?.identifierValue ?? "",
    notes: identifier?.notes ?? "",
    reason: ""
  });
}

function openCreate() { resetForm(); dialogOpen.value = true; }
function openEdit(identifier) { resetForm(identifier); dialogOpen.value = true; }

function payload() {
  return {
    identifierType: form.identifierType,
    issuerCountryCode: form.issuerCountryCode.trim().toUpperCase(),
    identifierValue: form.identifierValue.trim(),
    notes: form.notes.trim()
  };
}

async function submit() {
  if (submitting.value) return;
  submitting.value = true;
  errorMessage.value = "";
  try {
    const body = payload();
    if (editing.value) {
      await supplierService.updateIdentifier(props.supplierId, editing.value.id, {
        ...body, version: editing.value.version, reason: form.reason.trim()
      });
    } else {
      await supplierService.createIdentifier(props.supplierId, body);
    }
    notifySuccess(`供應商 ${props.supplierCode} 的識別資料「${body.identifierValue}」已${editing.value ? "更新" : "新增"}`);
    dialogOpen.value = false;
    emit("refresh");
  } catch (error) {
    errorMessage.value = error.code === "VERSION_CONFLICT"
      ? "這項識別資料已被其他人修改。你的輸入仍保留，請關閉後重新載入詳情再核對。"
      : error.message || "儲存識別資料失敗";
    notifyError(errorMessage.value);
    await nextTick();
    errorRef.value?.focus();
  } finally {
    submitting.value = false;
  }
}

function openDelete(identifier) {
  deletingIdentifier.value = identifier;
  deleteReason.value = "";
  deleteError.value = "";
  deleteDialogOpen.value = true;
}

async function confirmDelete() {
  if (deleting.value || !deletingIdentifier.value) return;
  deleting.value = true;
  deleteError.value = "";
  try {
    await supplierService.deleteIdentifier(props.supplierId, deletingIdentifier.value.id, {
      version: deletingIdentifier.value.version,
      reason: deleteReason.value.trim()
    });
    notifySuccess(`供應商 ${props.supplierCode} 的識別資料「${deletingIdentifier.value.identifierValue}」已刪除`);
    deleteDialogOpen.value = false;
    emit("refresh");
  } catch (error) {
    deleteError.value = error.message || "刪除識別資料失敗";
    notifyError(deleteError.value);
  } finally {
    deleting.value = false;
  }
}
</script>

<template>
  <section aria-labelledby="supplier-identifiers-heading">
    <div class="row items-center justify-between q-mb-md">
      <h2 id="supplier-identifiers-heading" class="text-h6 q-ma-none">識別資料</h2>
      <q-btn v-if="canManage" color="primary" flat icon="add" label="新增識別資料" @click="openCreate" />
    </div>
    <div v-if="!identifiers.length" class="text-grey-7">尚未設定識別資料</div>
    <q-list v-else bordered separator>
      <q-item v-for="identifier in identifiers" :key="identifier.id">
        <q-item-section>
          <q-item-label>{{ TYPE_LABEL[identifier.identifierType] ?? identifier.identifierType }}</q-item-label>
          <q-item-label caption>{{ identifier.issuerCountryCode }} — {{ identifier.identifierValue }}</q-item-label>
          <q-item-label v-if="identifier.notes" caption>{{ identifier.notes }}</q-item-label>
          <q-item-label v-if="identifier.canDelete === false" caption>已有引用，不可刪除</q-item-label>
        </q-item-section>
        <q-item-section v-if="canManage" side top class="row">
          <q-btn flat dense icon="edit" :aria-label="`編輯識別資料 ${identifier.identifierValue}`" @click="openEdit(identifier)" />
          <q-btn
            v-if="identifier.canDelete !== false" flat dense color="negative" icon="delete"
            :aria-label="`刪除識別資料 ${identifier.identifierValue}`" @click="openDelete(identifier)"
          />
        </q-item-section>
      </q-item>
    </q-list>

    <q-dialog v-model="dialogOpen" persistent>
      <q-card style="width: min(640px, 96vw); max-width: 640px">
        <q-card-section><h3 class="text-h6 q-ma-none">{{ editing ? "編輯識別資料" : "新增識別資料" }}</h3></q-card-section>
        <q-card-section class="q-pt-none">
          <div v-if="errorMessage" ref="errorRef" role="alert" tabindex="-1" class="q-mb-md">
            <q-banner class="bg-negative text-white">{{ errorMessage }}</q-banner>
          </div>
          <div class="row q-col-gutter-md">
            <q-select
              v-model="form.identifierType" class="col-12 col-sm-6" label="識別類型 *"
              :options="TYPES" emit-value map-options outlined dense
            />
            <q-input v-model="form.issuerCountryCode" class="col-12 col-sm-6" label="發證國家／地區 *" outlined dense maxlength="2" />
            <q-input v-model="form.identifierValue" class="col-12" label="識別值 *" outlined dense maxlength="190" />
            <q-input v-model="form.notes" class="col-12" label="備註" type="textarea" outlined dense maxlength="500" />
            <q-input
              v-if="editing" v-model="form.reason" class="col-12" label="修改原因 *"
              type="textarea" outlined dense maxlength="500"
            />
          </div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="取消" v-close-popup />
          <q-btn
            color="primary" label="儲存" :loading="submitting"
            :disable="!form.issuerCountryCode.trim() || !form.identifierValue.trim() || (editing && !form.reason.trim())"
            @click="submit"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="deleteDialogOpen" persistent>
      <q-card style="width: min(520px, 96vw); max-width: 520px">
        <q-card-section><h3 class="text-h6 q-ma-none">刪除識別資料</h3></q-card-section>
        <q-card-section class="q-pt-none">
          <p>即將刪除「{{ deletingIdentifier?.identifierValue }}」。這項操作只允許未被引用的資料。</p>
          <q-banner v-if="deleteError" class="bg-negative text-white q-mb-md" role="alert">{{ deleteError }}</q-banner>
          <q-input v-model="deleteReason" label="刪除原因 *" type="textarea" outlined dense maxlength="500" />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="取消" v-close-popup />
          <q-btn color="negative" label="確認刪除" :loading="deleting" :disable="!deleteReason.trim()" @click="confirmDelete" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </section>
</template>
