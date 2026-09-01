<script setup>
import { useRouter } from "vue-router";
import appConfig from "@config/app.js";
import { useSessionStore } from "@/stores/session.js";

defineEmits(["toggle-drawer"]);

const session = useSessionStore();
const router = useRouter();

function goToChangePassword() {
  router.push({ name: "change-password" });
}

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

    <!-- Phase 5 對既有版面唯一嘅改動（見 docs/user-management.md §4.5）：
         顯示名稱由純文字＋獨立登出按鈕，改做一個下拉選單。 -->
    <q-btn-dropdown flat no-caps :label="session.user?.displayName" icon="account_circle">
      <q-list>
        <q-item v-close-popup clickable @click="goToChangePassword">
          <q-item-section avatar>
            <q-icon name="password" />
          </q-item-section>
          <q-item-section>修改密碼</q-item-section>
        </q-item>

        <q-item v-close-popup clickable @click="handleLogout">
          <q-item-section avatar>
            <q-icon name="logout" />
          </q-item-section>
          <q-item-section>登出</q-item-section>
        </q-item>
      </q-list>
    </q-btn-dropdown>
  </q-toolbar>
</template>
