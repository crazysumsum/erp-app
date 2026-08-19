import { describe, expect, it } from "vitest";
import { buildServiceRegistry, useService } from "@/framework/discovery/services.js";

describe("buildServiceRegistry", () => {
  it("用 service.name 做 key，default export 做拎到嗰個 service", () => {
    const orderApi = { list: () => [] };
    const registry = buildServiceRegistry({
      "../../services/order.js": { service: { name: "order" }, default: orderApi }
    });

    expect(registry.get("order")).toBe(orderApi);
  });

  it("檔案冇 export const service 會拋錯，指名邊個檔案", () => {
    expect(() => buildServiceRegistry({ "../../services/broken.js": { default: {} } })).toThrow(
      "../../services/broken.js"
    );
  });

  it("兩個檔案撞 service name 會拋錯", () => {
    const modules = {
      "../../services/order.js": { service: { name: "order" }, default: {} },
      "../../services/order2.js": { service: { name: "order" }, default: {} }
    };

    expect(() => buildServiceRegistry(modules)).toThrow('Service name 重複：「order」');
  });
});

describe("useService", () => {
  it("未註冊嘅 service 會即刻拋錯，指名個名", () => {
    expect(() => useService("order")).toThrow('Service "order" 未註冊');
  });
});
