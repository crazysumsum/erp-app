<script>
export const page = {
  name: "login",
  path: "/login",
  title: "登入",
  public: true
};
</script>

<script setup>
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import authConfig from "@config/auth.js";
import { DEVICE_BLOCKED_CODES, useSessionStore } from "@/stores/session.js";

const route = useRoute();
const router = useRouter();
const session = useSessionStore();

const username = ref("");
const password = ref("");
const submitting = ref(false);
const errorMessage = ref("");

const required = (val) => !!val || "必填";

async function handleSubmit() {
  submitting.value = true;
  errorMessage.value = "";

  try {
    await session.login(username.value, password.value);
    const redirect = typeof route.query.redirect === "string" ? route.query.redirect : authConfig.homePath;
    router.push(redirect);
  } catch (error) {
    // 設備被擋唔係「登入失敗」：密碼係啱嘅。留喺登入頁淨係顯示一句紅字嘅話，
    // 用戶只會不停重試密碼，然後撞上登入節流——真正要做嘅事（等審批、搵管理員）
    // 一件都唔會發生。所以送佢去一頁講得清楚嘅畫面。
    if (DEVICE_BLOCKED_CODES.includes(error.code)) {
      router.push(authConfig.devicePendingPath);
      return;
    }

    // 後端登入失敗同「session 已經失效」共用同一個 code（"Unauthorized
    // Access"，見 errorMessages.js），單靠 code 分唔到係邊一種——但呢度係
    // 登入頁，401 一定係帳號密碼錯（節流、臨時密碼過期都有自己獨立嘅
    // code，唔會行到呢一行），所以喺呢度直接寫死，唔用共用嗰句「登入已
    // 失效」。
    errorMessage.value =
      error.code === "TEMPORARY_PASSWORD_EXPIRED"
        ? error.message
        : error.status === 401
          ? "帳號或密碼不正確"
          : error.message || "登入失敗";
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <!--
    登入頁單獨用自己嗰份版面，冇再攞 AuthLayout：404/403/設備待審批嗰三頁
    淨係一句訊息，套用大幅品牌色版面會顯得小題大做；但登入頁係成個系統
    俾人嘅第一印象，值得洗多少少功夫。左邊品牌欄純 CSS 做（漸層 + 點陣
    紋理），冇用第三方圖片或 emoji。
  -->
  <div class="login-page">
    <div class="login-card">
      <div class="login-card__brand">
        <div class="login-card__brand-pattern" aria-hidden="true" />
        <div class="login-card__brand-content">
          <!-- F&M 徽章：改編自公司官網（f-m.com.hk）嘅深色徽章 + 花體「M」
               標誌，用返呢個 ERP 嘅深藍青色（唔係官網原本嘅純黑）先融入
               成個登入頁嘅視覺。用真正文字（斜體襯線字）畫「M」，唔係
               點陣圖，任何尺寸都清晰。 -->
          <div class="login-card__brand-mark" aria-hidden="true">
            <span class="login-card__brand-monogram">M</span>
          </div>
          <div class="login-card__brand-name">F&amp;M ERP</div>
          <div class="login-card__brand-tagline">企業資源規劃系統</div>
        </div>
      </div>

      <div class="login-card__form">
        <div class="login-card__form-inner">
          <h1 class="text-h5 q-ma-none">登入</h1>
          <div class="text-body2 text-grey-7 q-mt-sm q-mb-lg">請輸入帳號密碼以繼續使用系統</div>

          <q-form class="q-gutter-y-md" @submit.prevent="handleSubmit">
            <q-input v-model="username" label="帳號" filled autofocus :rules="[required]">
              <template #prepend><q-icon name="person" /></template>
            </q-input>
            <q-input v-model="password" label="密碼" type="password" filled :rules="[required]">
              <template #prepend><q-icon name="lock" /></template>
            </q-input>

            <q-banner v-if="errorMessage" class="bg-negative text-white" dense rounded>
              {{ errorMessage }}
            </q-banner>

            <q-btn
              type="submit"
              color="primary"
              label="登入"
              :loading="submitting"
              class="full-width login-card__submit"
              unelevated
            />
          </q-form>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--app-bg);
  padding: 24px 16px;
}

.login-card {
  width: 100%;
  max-width: 880px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  background: white;
  border-radius: var(--app-radius);
  overflow: hidden;
  box-shadow:
    0 1px 2px rgba(15, 23, 42, 0.06),
    0 12px 32px rgba(15, 23, 42, 0.1);
}

.login-card__brand {
  position: relative;
  display: flex;
  align-items: center;
  padding: 48px 40px;
  background: linear-gradient(135deg, var(--q-primary) 0%, #0b2f3a 100%);
  color: white;
  overflow: hidden;
}

/* 純 CSS 點陣紋理，俾左邊品牌欄多一層質感，唔使外部圖片。透明度好低
   （14%），純粹裝飾，唔會影響上面文字嘅對比度。 */
.login-card__brand-pattern {
  position: absolute;
  inset: 0;
  background-image: radial-gradient(circle, rgba(255, 255, 255, 0.14) 1px, transparent 1px);
  background-size: 22px 22px;
}

.login-card__brand-content {
  position: relative;
  z-index: 1;
}

.login-card__brand-mark {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.14);
  margin-bottom: 20px;
}

.login-card__brand-monogram {
  font-family: Georgia, "Times New Roman", "Noto Serif TC", serif;
  font-style: italic;
  font-weight: 700;
  font-size: 26px;
  line-height: 1;
  color: white;
}

.login-card__brand-name {
  font-size: 1.4rem;
  font-weight: 600;
  line-height: 1.3;
}

.login-card__brand-tagline {
  margin-top: 8px;
  font-size: 0.875rem;
  color: rgba(255, 255, 255, 0.76);
}

.login-card__form {
  display: flex;
  align-items: center;
  padding: 48px 40px;
}

.login-card__form-inner {
  width: 100%;
}

.login-card__submit {
  height: 44px;
}

/* 窄螢幕：品牌欄收做頂部一條橫幅（放棄 tagline 慳返高度），表單全寬
   單欄疊落去。920px 唔係隨便揀嘅斷點——係 480(brand最細闊度) + 420(表單
   最細闊度) + 少少邊界，兩欄擠埋一齊嗰陣先會轉單欄，避免中間尺寸兩欄都
   窄得核突。 */
@media (max-width: 920px) {
  .login-card {
    grid-template-columns: 1fr;
    max-width: 420px;
  }

  .login-card__brand {
    padding: 24px;
  }

  .login-card__brand-mark {
    width: 40px;
    height: 40px;
    margin-bottom: 0;
  }

  .login-card__brand-monogram {
    font-size: 21px;
  }

  .login-card__brand-content {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .login-card__brand-name {
    font-size: 1.1rem;
  }

  .login-card__brand-tagline {
    display: none;
  }

  .login-card__form {
    padding: 32px 24px;
  }
}
</style>
