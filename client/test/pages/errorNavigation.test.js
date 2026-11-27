import { flushPromises, mount } from "@vue/test-utils";
import { Quasar } from "quasar";
import { createMemoryHistory, createRouter } from "vue-router";
import { expect, it } from "vitest";
import ForbiddenView from "@/framework/auth/ForbiddenView.vue";
import NotFoundView from "@/framework/routing/NotFoundView.vue";

it.each([
  ["/403", ForbiddenView],
  ["/missing", NotFoundView]
])("%s 提供可返回首頁的連結", async (path, view) => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "home", component: { template: "<div />" } },
      { path, component: view }
    ]
  });
  await router.push(path);
  const wrapper = mount(view, { global: { plugins: [Quasar, router] } });
  const link = wrapper.get('a[href="/"]');
  expect(link.text()).toBe("回首頁");
  await link.trigger("click");
  await flushPromises();
  expect(router.currentRoute.value.name).toBe("home");
});
