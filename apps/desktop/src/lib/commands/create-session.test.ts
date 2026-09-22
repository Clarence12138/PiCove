import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAppStore } from "../stores/app-store";
import { hostClient } from "../bridge/host-client";
import { createNewSession, isCreateSessionPending } from "./actions";

const initial = useAppStore.getState();
const busy = {
  ok: false,
  error: { code: "SERVICE_GRAPH_BUSY", message: "Service graph is busy", retryable: true },
};
let apply: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  apply = vi.fn();
  useAppStore.setState(
    {
      ...initial,
      connecting: false,
      rehydrating: false,
      desynchronized: false,
      host: {
        hostInstanceId: "host",
        workspaceId: "a",
        workspaceRevision: 1,
        sessionId: "old",
        sessionRevision: 1,
        packageRevision: 1,
      } as never,
      workspace: { id: "a", cwd: "/a", canonicalCwd: "/a", revision: 1, servicesReady: true },
      applySessionSnapshot: apply,
    },
    true,
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  useAppStore.setState(initial, true);
});
it("retries a rejected create after a transient graph read releases its lock", async () => {
  const request = vi
    .spyOn(hostClient, "request")
    .mockResolvedValueOnce(busy as never)
    .mockResolvedValueOnce({
      ok: true,
      result: { sessionId: "new" },
      hostInstanceId: "host",
      workspaceId: "a",
      workspaceRevision: 1,
      sessionId: "new",
      sessionRevision: 2,
      packageRevision: 1,
    } as never);
  const pending = createNewSession();
  expect(isCreateSessionPending()).toBe(true);
  await vi.runAllTimersAsync();
  expect(await pending).toBe(true);
  expect(request).toHaveBeenCalledTimes(2);
  expect(apply).toHaveBeenCalledTimes(1);
  expect(useAppStore.getState().notifications).toEqual([]);
  expect(isCreateSessionPending()).toBe(false);
});
it("does not retry business errors or hide a persistent busy failure", async () => {
  const request = vi.spyOn(hostClient, "request").mockResolvedValue({
    ...busy,
    error: { code: "SESSION_LIMIT", message: "limit", retryable: false },
  } as never);
  expect(await createNewSession()).toBe(false);
  expect(request).toHaveBeenCalledTimes(1);
  request.mockClear().mockResolvedValue(busy as never);
  const pending = createNewSession();
  await vi.runAllTimersAsync();
  expect(await pending).toBe(false);
  expect(apply).not.toHaveBeenCalled();
  expect(
    useAppStore.getState().notifications.some((item) => item.message === "Service graph is busy"),
  ).toBe(true);
});
it("cancels retries when the workspace changes", async () => {
  const request = vi.spyOn(hostClient, "request").mockResolvedValue(busy as never);
  const pending = createNewSession();
  await Promise.resolve();
  useAppStore.setState({
    host: { ...useAppStore.getState().host!, workspaceId: "b", workspaceRevision: 2 },
  });
  await vi.runAllTimersAsync();
  expect(await pending).toBe(false);
  expect(request).toHaveBeenCalledTimes(1);
  expect(apply).not.toHaveBeenCalled();
});
it("cancels retries when a newer navigation supersedes the create", async () => {
  const request = vi.spyOn(hostClient, "request").mockResolvedValue(busy as never);
  let current = true;
  const pending = createNewSession({ shouldContinue: () => current });
  await Promise.resolve();
  current = false;
  await vi.runAllTimersAsync();
  expect(await pending).toBe(false);
  expect(request).toHaveBeenCalledTimes(1);
});
