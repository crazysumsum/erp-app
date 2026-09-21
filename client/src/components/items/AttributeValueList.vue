<script setup>
const props = defineProps({
  title: { type: String, required: true },
  values: { type: Array, required: true }
});

function displayValue(attribute) {
  if (attribute.option?.label) {
    return attribute.option.label;
  }
  if (attribute.value === null || attribute.value === "") {
    return "—";
  }
  if (attribute.dataType === "boolean") {
    return attribute.value ? "是" : "否";
  }
  if (attribute.dataType === "date") {
    return new Date(attribute.value).toLocaleDateString("zh-HK", {
      timeZone: "Asia/Hong_Kong",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });
  }
  return String(attribute.value);
}
</script>

<template>
  <section v-if="props.values.length > 0" class="q-mt-lg" data-testid="attribute-value-list">
    <div class="text-h6 q-mb-md">{{ props.title }}</div>
    <q-list bordered separator>
      <q-item v-for="attribute in props.values" :key="attribute.attributeId">
        <q-item-section>
          <q-item-label>{{ attribute.name }}</q-item-label>
          <q-item-label caption>{{ attribute.code }}</q-item-label>
        </q-item-section>
        <q-item-section side>
          <q-item-label>{{ displayValue(attribute) }}</q-item-label>
        </q-item-section>
      </q-item>
    </q-list>
  </section>
</template>
