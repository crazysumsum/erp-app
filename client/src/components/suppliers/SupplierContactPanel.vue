<script setup>
import { nextTick, reactive, ref } from "vue";
import { confirm } from "@/framework/ui/confirm.js";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";
import supplierService from "@/services/supplier.js";

const props = defineProps({
  supplierId: { type: Number, required: true },
  supplierCode: { type: String, required: true },
  contacts: { type: Array, default: () => [] },
  canManage: { type: Boolean, default: false }
});
const emit = defineEmits(["refresh"]);

const PURPOSES = Object.freeze([
  ["general", "一般聯絡"], ["orders", "訂單聯絡"], ["sales", "銷售聯絡"],
  ["accounts_payable", "應付帳款"], ["returns", "退貨聯絡"], ["emergency", "緊急聯絡"]
]);
const PURPOSE_LABEL = Object.fromEntries(PURPOSES);

const dialogOpen = ref(false);
const submitting = ref(false);
const editing = ref(null);
const errorMessage = ref("");
const errorRef = ref(null);
const form = reactive({
  name: "", jobTitle: "", department: "", email: "", phone: "", mobile: "", preferredLanguage: "", notes: "",
  selectedPurposes: {}, primaryPurposes: {}
});

function resetForm(contact = null) {
  editing.value = contact;
  errorMessage.value = "";
  Object.assign(form, {
    name: contact?.name ?? "", jobTitle: contact?.jobTitle ?? "", department: contact?.department ?? "",
    email: contact?.email ?? "", phone: contact?.phone ?? "", mobile: contact?.mobile ?? "",
    preferredLanguage: contact?.preferredLanguage ?? "", notes: contact?.notes ?? "",
    selectedPurposes: Object.fromEntries(PURPOSES.map(([code]) => [code, Boolean(contact?.purposes.some((purpose) => purpose.purposeCode === code))])),
    primaryPurposes: Object.fromEntries(PURPOSES.map(([code]) => [code, Boolean(contact?.purposes.some((purpose) => purpose.purposeCode === code && purpose.isPrimary))]))
  });
}

function openCreate() { resetForm(); dialogOpen.value = true; }
function openEdit(contact) { resetForm(contact); dialogOpen.value = true; }

function payload() {
  return {
    name: form.name.trim(), jobTitle: form.jobTitle.trim(), department: form.department.trim(), email: form.email.trim(),
    phone: form.phone.trim(), mobile: form.mobile.trim(), preferredLanguage: form.preferredLanguage.trim(), notes: form.notes.trim(),
    purposes: PURPOSES.filter(([code]) => form.selectedPurposes[code]).map(([purposeCode]) => ({
      purposeCode, isPrimary: Boolean(form.primaryPurposes[purposeCode])
    }))
  };
}

async function submit() {
  if (submitting.value) return;
  submitting.value = true;
  errorMessage.value = "";
  try {
    const body = payload();
    if (editing.value) await supplierService.updateContact(props.supplierId, editing.value.id, { ...body, version: editing.value.version });
    else await supplierService.createContact(props.supplierId, body);
    notifySuccess(`供應商 ${props.supplierCode} 的聯絡人「${body.name}」已${editing.value ? "更新" : "新增"}`);
    dialogOpen.value = false;
    emit("refresh");
  } catch (error) {
    errorMessage.value = error.code === "VERSION_CONFLICT"
      ? "這項聯絡人資料已被其他人修改。你的輸入仍保留，請關閉後重新載入詳情再核對。"
      : error.message || "儲存聯絡人失敗";
    notifyError(errorMessage.value);
    await nextTick();
    errorRef.value?.focus();
  } finally {
    submitting.value = false;
  }
}

async function deactivate(contact) {
  const accepted = await confirm({
    title: "停用聯絡人", message: `停用「${contact.name}」？其主要用途標記會一併清除。`, okLabel: "停用"
  });
  if (!accepted) return;
  try {
    await supplierService.deactivateContact(props.supplierId, contact.id, { version: contact.version });
    notifySuccess(`供應商 ${props.supplierCode} 的聯絡人「${contact.name}」已停用`);
    emit("refresh");
  } catch (error) {
    notifyError(error.message || "停用聯絡人失敗");
  }
}

function purposeText(contact) {
  return contact.purposes.map((purpose) => `${PURPOSE_LABEL[purpose.purposeCode] ?? purpose.purposeCode}${purpose.isPrimary ? "（主要）" : ""}`).join("、") || "未指定用途";
}

function contactText(contact) {
  return [contact.email, contact.phone, contact.mobile].filter(Boolean).join("／") || "未填聯絡方式";
}
</script>

<template>
  <section aria-labelledby="supplier-contacts-heading">
    <div class="row items-center justify-between q-mb-md">
      <h2 id="supplier-contacts-heading" class="text-h6 q-ma-none">聯絡人</h2>
      <q-btn v-if="canManage" color="primary" flat icon="add" label="新增聯絡人" @click="openCreate" />
    </div>
    <div v-if="!contacts.length" class="text-grey-7">尚未設定聯絡人</div>
    <q-list v-else bordered separator>
      <q-item v-for="contact in contacts" :key="contact.id">
        <q-item-section>
          <q-item-label>
            {{ contact.name }}
            <q-badge v-if="contact.status === 'inactive'" color="grey" label="已停用" />
          </q-item-label>
          <q-item-label v-if="contact.jobTitle || contact.department" caption>
            {{ [contact.jobTitle, contact.department].filter(Boolean).join("／") }}
          </q-item-label>
          <q-item-label caption>{{ contactText(contact) }}</q-item-label>
          <q-item-label caption>{{ purposeText(contact) }}</q-item-label>
        </q-item-section>
        <q-item-section v-if="canManage && contact.status === 'active'" side top class="row">
          <q-btn flat dense icon="edit" :aria-label="`編輯聯絡人 ${contact.name}`" @click="openEdit(contact)" />
          <q-btn flat dense color="negative" icon="block" :aria-label="`停用聯絡人 ${contact.name}`" @click="deactivate(contact)" />
        </q-item-section>
      </q-item>
    </q-list>

    <q-dialog v-model="dialogOpen" persistent>
      <q-card style="width: min(760px, 96vw); max-width: 760px">
        <q-card-section><h3 class="text-h6 q-ma-none">{{ editing ? "編輯聯絡人" : "新增聯絡人" }}</h3></q-card-section>
        <q-card-section class="q-pt-none">
          <div v-if="errorMessage" ref="errorRef" role="alert" tabindex="-1" class="q-mb-md">
            <q-banner class="bg-negative text-white">{{ errorMessage }}</q-banner>
          </div>
          <div class="row q-col-gutter-md">
            <q-input v-model="form.name" class="col-12 col-sm-6" label="姓名 *" outlined dense maxlength="190" />
            <q-input v-model="form.preferredLanguage" class="col-12 col-sm-6" label="語言偏好" outlined dense maxlength="20" />
            <q-input v-model="form.jobTitle" class="col-12 col-sm-6" label="職位" outlined dense maxlength="100" />
            <q-input v-model="form.department" class="col-12 col-sm-6" label="部門" outlined dense maxlength="100" />
            <q-input v-model="form.email" class="col-12 col-sm-6" label="Email" type="email" outlined dense maxlength="254" />
            <q-input v-model="form.phone" class="col-12 col-sm-6" label="電話" type="tel" outlined dense maxlength="50" />
            <q-input v-model="form.mobile" class="col-12 col-sm-6" label="流動電話" type="tel" outlined dense maxlength="50" />
            <q-input v-model="form.notes" class="col-12" label="備註" type="textarea" outlined dense maxlength="500" />
          </div>
          <fieldset class="q-mt-md supplier-purpose-fieldset">
            <legend>聯絡人用途</legend>
            <div v-for="([code, label]) in PURPOSES" :key="code" class="row items-center q-gutter-sm">
              <q-checkbox
                v-model="form.selectedPurposes[code]" :label="label"
                @update:model-value="(selected) => { if (!selected) form.primaryPurposes[code] = false; }"
              />
              <q-toggle v-model="form.primaryPurposes[code]" label="主要" :disable="!form.selectedPurposes[code]" />
            </div>
          </fieldset>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="取消" v-close-popup />
          <q-btn color="primary" label="儲存" :loading="submitting" :disable="!form.name.trim()" @click="submit" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </section>
</template>

<style scoped>
.supplier-purpose-fieldset { border: 1px solid var(--app-border); border-radius: var(--app-radius); }
</style>
