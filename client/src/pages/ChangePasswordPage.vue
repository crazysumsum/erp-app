<script>
// 冇 `requires`：validatePages.js 容許唔宣告，routeGuard.js 對「非
// public 且冇 meta.requires」嘅頁面淨係要求已登入——正係要嘅語意（見
// docs/user-management.md §4.1）。冇 `menu`，唔入菜單：入口喺
// AppTopbar.vue 個落拉選單。
export const page = {
  name: "change-password",
  path: "/password/change",
  title: "修改密碼"
};
</script>

<script setup>
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import FormPanel from "@/framework/ui/FormPanel.vue";
import { notifySuccess } from "@/framework/ui/notify.js";
import userService from "@/services/user.js";
import { useSessionStore } from "@/stores/session.js";

const session = useSessionStore();
const router = useRouter();

// 強制模式：mustChangePassword 為 true 嗰陣，換一套文案、唔顯示取消（見
// §4.5）。後端（jwtAuthStrategy 嘅 mcp claim 擋）先係真正嘅關卡，呢度
// 淨係等使用者見到一個講得通嘅畫面。
const forced = computed(() => !!session.user?.mustChangePassword);

const password = ref("");
const newPassword = ref("");
const confirmPassword = ref("");

const required = (val) => !!val || "必填";
const confirmMatches = (val) => val === newPassword.value || "同「新密碼」唔一致";

async function submit() {
  const result = await userService.changeOwnPassword({
    password: password.value,
    newPassword: newPassword.value
  });

  // 撤銷已經喺後端做咗（見 §3.4），呢度淨係清返本地 session 同導頁——
  // 唔叫 session.logout()：果個會再打一次 /api/v1/user/logout，但 token
  // 已經俾呢次改密碼撤銷咗，冇必要再打一次會 401 嘅請求。
  session.clear();
  router.push({ name: "login" });
  notifySuccess("密碼已更新，請用新密碼登入");

  return result;
}

function cancel() {
  router.back();
}
</script>

<template>
  <div class="row justify-center q-pa-lg">
    <q-card style="width: 420px" class="q-pa-md">
      <q-card-section>
        <div class="text-h6">{{ forced ? "首次登入必須修改密碼" : "修改密碼" }}</div>
        <div v-if="forced" class="text-caption text-grey-7">
          管理員為你設定咗初始密碼，第一次登入要先換一個只有你自己知道嘅密碼。
        </div>
      </q-card-section>

      <q-card-section>
        <FormPanel v-slot="{ fieldError, submitting }" :on-submit="submit">
          <div class="q-gutter-md">
            <q-input
              v-model="password"
              label="目前密碼"
              type="password"
              filled
              :rules="[required]"
              :error="!!fieldError('password')"
              :error-message="fieldError('password')"
            />
            <q-input
              v-model="newPassword"
              label="新密碼"
              type="password"
              filled
              hint="最短 12 字元，並同時包含大寫與小寫英文字母"
              :rules="[required]"
              :error="!!fieldError('newPassword')"
              :error-message="fieldError('newPassword')"
            />
            <q-input
              v-model="confirmPassword"
              label="確認新密碼"
              type="password"
              filled
              :rules="[required, confirmMatches]"
            />

            <div class="row justify-end q-gutter-sm">
              <q-btn v-if="!forced" flat label="取消" :disable="submitting" @click="cancel" />
              <q-btn type="submit" color="primary" label="更新密碼" unelevated :loading="submitting" />
            </div>
          </div>
        </FormPanel>
      </q-card-section>
    </q-card>
  </div>
</template>
