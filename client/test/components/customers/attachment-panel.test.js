import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { Quasar } from "quasar";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/customer.js", () => ({ default: {
  attachments: vi.fn(), uploadAttachment: vi.fn(), updateAttachment: vi.fn(), deactivateAttachment: vi.fn(),
  deleteAttachment: vi.fn(), authorizeAttachmentDownload: vi.fn(), attachmentContent: vi.fn()
} }));
vi.mock("@/framework/ui/confirm.js", () => ({ promptPassword: vi.fn(), promptReason: vi.fn() }));
vi.mock("@/framework/ui/notify.js", () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));

import CustomerAttachmentPanel from "@/components/customers/CustomerAttachmentPanel.vue";
import { promptPassword } from "@/framework/ui/confirm.js";
import customerService from "@/services/customer.js";

const GENERAL = { id: 4, customerId: 7, displayName: "Contract", documentType: "contract", sensitivity: "general", originalFilename: "contract.pdf", mimeType: "application/pdf", extension: "pdf", sizeBytes: 20, storageClass: "general_private", scanStatus: "clean", status: "active", sortOrder: 0, notes: "", version: 1, updatedAt: 1 };
const SENSITIVE = { ...GENERAL, id: 5, displayName: "Bank proof", documentType: "bank_proof", sensitivity: "bank_sensitive", originalFilename: "proof.pdf", storageClass: "bank_sensitive_private" };

async function mounted(props = {}) {
  const wrapper = mount(CustomerAttachmentPanel, {
    props: { customerId: 7, customerStatus: "draft", canManageGeneral: true, canViewSensitive: false, canManageSensitive: false, ...props },
    global: { plugins: [Quasar] }, attachTo: document.body
  });
  await flushPromises();
  return { wrapper, body: new DOMWrapper(document.body) };
}

describe("CustomerAttachmentPanel", () => {
  beforeEach(() => {
    document.body.innerHTML = ""; vi.clearAllMocks();
    customerService.attachments.mockResolvedValue({ items: [GENERAL], restrictedCount: 1 });
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:customer-preview"), revokeObjectURL: vi.fn() });
  });

  it("shows only server-authorized metadata and a restricted count", async () => {
    const { body } = await mounted();
    expect(body.text()).toContain("Contract");
    expect(body.text()).toContain("另有 1 份受限制文件");
    expect(body.text()).not.toContain("Bank proof");
    expect(body.text()).not.toContain("proof.pdf");
  });

  it("reauthenticates sensitive preview without putting the token in URL or storage", async () => {
    customerService.attachments.mockResolvedValue({ items: [SENSITIVE], restrictedCount: 0 });
    promptPassword.mockResolvedValue({ reason: "核對銀行證明附件", password: "pw" });
    customerService.authorizeAttachmentDownload.mockResolvedValue({ token: "short-secret-token", expiresAt: Date.now() + 60_000 });
    customerService.attachmentContent.mockResolvedValue({ blob: new Blob(["pdf"], { type: "application/pdf" }), contentType: "application/pdf" });
    const { body } = await mounted({ canViewSensitive: true, canManageSensitive: true });

    await body.find('button[aria-label="預覽 Bank proof"]').trigger("click"); await flushPromises();
    expect(customerService.attachmentContent).toHaveBeenCalledWith(7, 5, "preview", { sessionToken: "short-secret-token" });
    expect(window.location.href).not.toContain("short-secret-token");
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain("short-secret-token");
    window.dispatchEvent(new Event("pagehide")); await flushPromises();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:customer-preview");
  });

  it("does not reopen an in-flight sensitive preview after the route changes customer", async () => {
    customerService.attachments.mockResolvedValue({ items: [SENSITIVE], restrictedCount: 0 });
    promptPassword.mockResolvedValue({ reason: "核對銀行證明附件", password: "pw" });
    customerService.authorizeAttachmentDownload.mockResolvedValue({ token: "short-secret-token", expiresAt: Date.now() + 60_000 });
    let releaseContent;
    customerService.attachmentContent.mockReturnValue(new Promise((resolve) => { releaseContent = resolve; }));
    const { wrapper, body } = await mounted({ canViewSensitive: true, canManageSensitive: true });

    await body.find('button[aria-label="預覽 Bank proof"]').trigger("click"); await flushPromises();
    await wrapper.setProps({ customerId: 8 }); await flushPromises();
    releaseContent({ blob: new Blob(["old customer"], { type: "application/pdf" }), contentType: "application/pdf" });
    await flushPromises();

    expect(body.text()).not.toContain("預覽：Bank proof");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:customer-preview");
  });

  it("does not authorize an old attachment after the customer changes while reauthentication is open", async () => {
    customerService.attachments.mockResolvedValue({ items: [SENSITIVE], restrictedCount: 0 });
    let releasePassword;
    promptPassword.mockReturnValue(new Promise((resolve) => { releasePassword = resolve; }));
    const { wrapper, body } = await mounted({ canViewSensitive: true, canManageSensitive: true });

    await body.find('button[aria-label="預覽 Bank proof"]').trigger("click"); await flushPromises();
    await wrapper.setProps({ customerId: 8 }); await flushPromises();
    releasePassword({ reason: "核對銀行證明附件", password: "pw" }); await flushPromises();

    expect(customerService.authorizeAttachmentDownload).not.toHaveBeenCalled();
    expect(customerService.attachmentContent).not.toHaveBeenCalled();
  });

  it("does not mutate an old attachment after the customer changes while confirmation is open", async () => {
    let releaseConfirmation;
    promptPassword.mockReturnValue(new Promise((resolve) => { releaseConfirmation = resolve; }));
    const { wrapper, body } = await mounted();

    await body.find('button[aria-label="永久刪除 Contract"]').trigger("click"); await flushPromises();
    await wrapper.setProps({ customerId: 8 }); await flushPromises();
    releaseConfirmation({ reason: "刪除未引用附件", password: "pw" }); await flushPromises();

    expect(customerService.deleteAttachment).not.toHaveBeenCalled();
  });
});
