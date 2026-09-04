<script setup>
import { useRouter } from "vue-router";
import appConfig from "@config/app.js";
import { useSessionStore } from "@/stores/session.js";

defineEmits(["toggle-drawer"]);

const session = useSessionStore();
const router = useRouter();

function goToProfile() {
  router.push({ name: "profile" });
}

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
    <!-- 同登入頁 (LoginPage.vue) 同一套「M」花體字徽章，呢度背景係白色
         topbar，所以用返深色實心徽章（配白色 M）嗰個版本，唔係登入頁嗰
         種半透明版本——半透明喺白底度會睇唔清。 -->
    <div class="app-topbar__brand-mark q-ml-sm" aria-hidden="true">
      <span class="app-topbar__brand-monogram">M</span>
    </div>
    <q-toolbar-title class="q-pl-sm">{{ appConfig.title }}</q-toolbar-title>

    <!-- Phase 5 對既有版面唯一嘅改動（見 docs/user_management/design_spec.md §4.5）：
         顯示名稱由純文字＋獨立登出按鈕，改做一個下拉選單。 -->
    <q-btn-dropdown flat no-caps :label="session.user?.displayName" icon="account_circle">
      <q-list>
        <q-item v-close-popup clickable @click="goToProfile">
          <q-item-section avatar>
            <q-icon name="account_circle" />
          </q-item-section>
          <q-item-section>個人資料</q-item-section>
        </q-item>

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

<style scoped>
.app-topbar__brand-mark {
  width: 32px;
  height: 32px;
  min-width: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: var(--q-primary);
}

.app-topbar__brand-monogram {
  font-family: Georgia, "Times New Roman", "Noto Serif TC", serif;
  font-style: italic;
  font-weight: 700;
  font-size: 18px;
  line-height: 1;
  color: white;
}
</style>
