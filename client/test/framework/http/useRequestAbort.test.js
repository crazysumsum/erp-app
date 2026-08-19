import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { useRequestAbort } from "@/framework/http/useRequestAbort.js";

const TestComponent = {
  setup() {
    const signal = useRequestAbort();
    return { signal };
  },
  template: "<div />"
};

describe("useRequestAbort", () => {
  it("元件卸載時會 abort signal", async () => {
    const wrapper = mount(TestComponent);
    const { signal } = wrapper.vm;

    expect(signal.aborted).toBe(false);
    wrapper.unmount();

    expect(signal.aborted).toBe(true);
  });
});
