<script setup>
import { computed, ref } from "vue";
import ReferencePicker from "@/framework/ui/ReferencePicker.vue";
import { useSessionStore } from "@/stores/session.js";
import customer from "@/services/customer.js";

const props = defineProps({ rows: { type: Array, default: () => [] }, disable: Boolean });
const emit = defineEmits(["submit"]);
const customerId = defineModel({ type: String, default: "" });
const session = useSessionStore();
const canSearch = computed(() => session.permissions.includes("customer.view"));
const chosen = ref(null);
const selection = computed({
  get() {
    const id = customerId.value;
    if (!id) return null;
    if (String(chosen.value?.id) === id) return chosen.value;
    const row = props.rows.find((item) => String(item.customerId) === id);
    return { id, code: row?.customerCode, name: row?.customerName ?? "已套用客戶" };
  },
  set(row) {
    chosen.value = row;
    customerId.value = row ? String(row.id) : "";
  }
});

async function search(query, signal) {
  const { rows } = await customer.list({ page: 1, rowsPerPage: 20, filter: query, includeArchived: true, signal });
  return rows.map(({ id, code, displayName, legalName }) => ({ id, code, name: displayName || legalName }));
}
</script>

<template>
  <ReferencePicker v-if="canSearch" v-model="selection" label="客戶" hint="按客戶代碼或名稱搜尋。"
    :search="search" :disable="disable" />
  <q-input v-else v-model="customerId" label="客戶 ID" hint="數字 ID" mask="################"
    :disable="disable" outlined dense @keyup.enter="emit('submit')" />
</template>
