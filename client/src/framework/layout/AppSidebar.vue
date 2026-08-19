<script setup>
import { useRoute } from "vue-router";

// menu 由 AppShell 傳落嚟（AppShell 用 buildMenu() 算），Sidebar 淨係負責
// 畫——group 用 QExpansionItem 做到可摺疊，當前路由用 route.name 對比嚟
// highlight。
defineProps({
  menu: { type: Array, required: true }
});

const route = useRoute();
</script>

<template>
  <q-list>
    <q-expansion-item
      v-for="group in menu"
      :key="group.name"
      :icon="group.icon"
      :label="group.label"
      default-opened
    >
      <q-item
        v-for="item in group.items"
        :key="item.name"
        clickable
        :to="{ name: item.name }"
        :active="route.name === item.name"
        active-class="text-primary bg-blue-1"
      >
        <q-item-section avatar>
          <q-icon :name="item.icon" />
        </q-item-section>
        <q-item-section>{{ item.title }}</q-item-section>
      </q-item>
    </q-expansion-item>
  </q-list>
</template>
