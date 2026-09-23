/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BuiltinProviderModelChoice, HostStatusSnapshot } from "@pideck/protocol";
import { hostClient } from "../../lib/bridge/host-client";
import { useAppStore } from "../../lib/stores/app-store";
import { ProviderLoginPage } from "./ProviderLoginSection";

const HOST_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const MODEL_COUNT = 9;

function host(): HostStatusSnapshot {
  return {
    protocolVersion: 1,
    hostInstanceId: HOST_ID,
    workspaceId: WORKSPACE_ID,
    workspaceRevision: 1,
    sessionId: null,
    sessionRevision: 0,
    packageRevision: 1,
    sdkVersion: "0.84.2",
    nodeVersion: process.version,
    agentDir: "/agent",
    phase: "ready",
    capabilities: { packageUpdateCheck: true, extensionUi: true, sessionExport: true },
    modelConfigHealth: { state: "ok", source: "ModelRegistry.getError" },
  };
}

function models(): BuiltinProviderModelChoice[] {
  return Array.from({ length: MODEL_COUNT }, (_, index) => ({
    id: `model-${index + 1}`,
    name: `Model ${index + 1}`,
    enabled: true,
  }));
}

function response(method: string, result: unknown) {
  return {
    protocolVersion: 1,
    id: "test-request",
    method,
    hostInstanceId: HOST_ID,
    workspaceId: WORKSPACE_ID,
    workspaceRevision: 1,
    packageRevision: 1,
    ok: true,
    result,
  };
}

type SaveHandler = (params: { providerId: string; modelIds: string[] }) => unknown;
function mockRequests(save?: SaveHandler) {
  let persisted = models();
  return vi.spyOn(hostClient, "request").mockImplementation((async (
    method: string,
    _context: unknown,
    params: { providerId: string; modelIds: string[] },
  ) => {
    if (method === "provider.authStatus") {
      return response(method, {
        providers: ["Provider A", "Provider B"].map((name) => ({
          providerId: name,
          name,
          configured: true,
          enabled: true,
          supportsOauth: true,
          supportsApiKeyLogin: true,
          hasStoredCredential: true,
        })),
      });
    }
    if (method === "provider.builtinModels") {
      return response(method, { providerId: params.providerId, models: persisted });
    }
    if (method === "provider.setBuiltinModels") {
      if (save) return save(params);
      persisted = persisted.map((model) => ({
        ...model,
        enabled: params.modelIds.includes(model.id),
      }));
      return response(method, { providerId: params.providerId, models: persisted });
    }
    throw new Error(`Unexpected request: ${method}`);
  }) as never);
}

function saveCalls(spy: ReturnType<typeof mockRequests>) {
  return spy.mock.calls.filter(([method]) => method === "provider.setBuiltinModels");
}

async function openPanel(user: ReturnType<typeof userEvent.setup>, provider = "Provider A") {
  await user.click(await screen.findByRole("button", { name: `Choose models ${provider}` }));
  await screen.findByRole("checkbox", { name: /model-1/ });
}

beforeEach(() => {
  useAppStore.getState().setDesktopSettings({
    theme: "system",
    language: "en",
    restoreLastSession: true,
    autoRestartHostOnce: true,
    extensionDecisionPresentation: "legacy-modal",
    terminalProfile: "auto",
  });
  useAppStore.getState().setHost(host());
  useAppStore.getState().setWorkspace({
    id: WORKSPACE_ID,
    cwd: "/workspace",
    canonicalCwd: "/workspace",
    revision: 1,
    servicesReady: true,
  });
  useAppStore.getState().clearProviderLogin();
  useAppStore.getState().clearNotifications();
});

afterEach(() => {
  cleanup();
  useAppStore.getState().setWorkspace(null);
  useAppStore.getState().setHost(null);
  useAppStore.getState().setDesktopSettings(null);
  vi.restoreAllMocks();
});

describe("builtin provider model drafts", () => {
  it("clears selections locally and saves only explicitly selected models", async () => {
    const spy = mockRequests();
    const user = userEvent.setup();
    render(<ProviderLoginPage onClose={vi.fn()} />);
    await openPanel(user);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Select none" }));
    expect(
      screen.getAllByRole("checkbox").every((input) => !(input as HTMLInputElement).checked),
    ).toBe(true);
    expect(saveCalls(spy)).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByText(/select at least one model/i)).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: /model-2/ }));
    expect(saveCalls(spy)).toHaveLength(0);
    const revision = useAppStore.getState().providerConfigRevision;
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saveCalls(spy)).toHaveLength(1));
    expect(saveCalls(spy)[0][2]).toEqual({ providerId: "Provider A", modelIds: ["model-2"] });
    expect(useAppStore.getState().providerConfigRevision).toBe(revision + 1);
    await user.click(screen.getByRole("button", { name: "Choose models Provider A" }));
    await openPanel(user);
    expect(screen.getByRole("checkbox", { name: /model-1/ })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /model-2/ })).toBeChecked();
  });

  it("cancels drafts and applies bulk actions to all models while searching", async () => {
    const spy = mockRequests();
    const user = userEvent.setup();
    render(<ProviderLoginPage onClose={vi.fn()} />);
    await openPanel(user);
    await user.type(screen.getByPlaceholderText("Search models"), "Model 1");
    await user.click(screen.getByRole("button", { name: "Select none" }));
    await user.clear(screen.getByPlaceholderText("Search models"));
    expect(
      screen.getAllByRole("checkbox").every((input) => !(input as HTMLInputElement).checked),
    ).toBe(true);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.getAllByRole("checkbox").every((input) => (input as HTMLInputElement).checked),
    ).toBe(true);
    await user.click(screen.getByRole("button", { name: "Select none" }));
    await user.type(screen.getByPlaceholderText("Search models"), "Model 1");
    await user.click(screen.getByRole("button", { name: "Select all" }));
    await user.clear(screen.getByPlaceholderText("Search models"));
    expect(
      screen.getAllByRole("checkbox").every((input) => (input as HTMLInputElement).checked),
    ).toBe(true);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(saveCalls(spy)).toHaveLength(0);
  });

  it("retains a failed draft for retry and disables editing while saving", async () => {
    let resolveSave!: (value: unknown) => void;
    let attempt = 0;
    const spy = mockRequests(() => {
      attempt += 1;
      if (attempt === 1)
        return {
          ...response("provider.setBuiltinModels", null),
          ok: false,
          error: { code: "INTERNAL_ERROR", message: "Save failed", retryable: true },
        };
      return new Promise((resolve) => {
        resolveSave = resolve;
      });
    });
    const user = userEvent.setup();
    render(<ProviderLoginPage onClose={vi.fn()} />);
    await openPanel(user);
    await user.click(screen.getByRole("checkbox", { name: /model-1/ }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(
        useAppStore.getState().notifications.some((item) => item.message === "Save failed"),
      ).toBe(true),
    );
    expect(screen.getByRole("checkbox", { name: /model-1/ })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(
      screen.getAllByRole("checkbox").every((input) => (input as HTMLInputElement).disabled),
    ).toBe(true);
    expect(screen.getByRole("button", { name: "Select all" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(saveCalls(spy)).toHaveLength(2);
    await act(async () =>
      resolveSave(
        response("provider.setBuiltinModels", {
          providerId: "Provider A",
          models: models().map((model) => ({ ...model, enabled: model.id === "model-2" })),
        }),
      ),
    );
    expect(saveCalls(spy)).toHaveLength(2);
    expect(saveCalls(spy)[1][2]).toEqual(saveCalls(spy)[0][2]);
    expect(screen.getByRole("checkbox", { name: /model-3/ })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("exposes rejected saves without discarding the draft", async () => {
    const spy = mockRequests(() => Promise.reject(new Error("Connection lost")));
    const user = userEvent.setup();
    render(<ProviderLoginPage onClose={vi.fn()} />);
    await openPanel(user);
    await user.click(screen.getByRole("checkbox", { name: /model-1/ }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(
        useAppStore.getState().notifications.some((item) => item.message === "Connection lost"),
      ).toBe(true),
    );
    expect(screen.getByRole("checkbox", { name: /model-1/ })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(saveCalls(spy)).toHaveLength(1);
  });

  it("discards drafts when collapsing, switching providers, or remounting", async () => {
    const spy = mockRequests();
    const user = userEvent.setup();
    const view = render(<ProviderLoginPage onClose={vi.fn()} />);
    await openPanel(user);
    await user.click(screen.getByRole("button", { name: "Select none" }));
    await user.click(screen.getByRole("button", { name: "Choose models Provider A" }));
    await openPanel(user);
    expect(
      screen.getAllByRole("checkbox").every((input) => (input as HTMLInputElement).checked),
    ).toBe(true);
    await user.click(screen.getByRole("button", { name: "Select none" }));
    await openPanel(user, "Provider B");
    await openPanel(user);
    expect(
      screen.getAllByRole("checkbox").every((input) => (input as HTMLInputElement).checked),
    ).toBe(true);
    await user.click(screen.getByRole("button", { name: "Select none" }));
    view.unmount();
    render(<ProviderLoginPage onClose={vi.fn()} />);
    await openPanel(user);
    expect(
      screen.getAllByRole("checkbox").every((input) => (input as HTMLInputElement).checked),
    ).toBe(true);
    expect(saveCalls(spy)).toHaveLength(0);
  });
});
