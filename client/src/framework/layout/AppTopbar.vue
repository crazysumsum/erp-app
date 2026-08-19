<script setup>
import { useRouter } from "vue-router";
import appConfig from "@config/app.js";
import { useSessionStore } from "@/stores/session.js";

defineEmits(["toggle-drawer"]);

const session = useSessionStore();
const router = useRouter();

async function handleLogout() {
  // session.logout() 就算後端請求失敗都會清返本地 session（見
  // stores/session.js），所以呢度唔使理會後端有冇成功撤銷，用戶一撳登出
  // 一定會返到登入頁。
  await session.logout().catch(() => {});
  router.push({ name: "login" });
}
</script>

<template>
  <q-toolbar>
    <q-btn flat round dense icon="menu" aria-label="開關側邊欄" @click="$emit('toggle-drawer')" />
    <q-toolbar-title>{{ appConfig.title }}</q-toolbar-title>
    <div class="q-mr-sm">{{ session.user?.displayName }}</div>
    <q-btn flat round dense icon="logout" aria-label="登出" @click="handleLogout" />
  </q-toolbar>
</template>
