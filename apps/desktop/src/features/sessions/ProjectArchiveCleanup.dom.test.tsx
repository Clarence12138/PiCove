/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { hostClient } from "../../lib/bridge/host-client";
import { useAppStore } from "../../lib/stores/app-store";
import { ProjectArchiveCleanup } from "./ProjectArchiveCleanup";
import type { SessionCatalogEntry } from "../../lib/stores/session-catalog";

vi.mock("../../lib/commands/workspace-navigation", () => ({
  withWorkspaceForAction: vi.fn(async (_cwd, action) => {
    await action();
    return true;
  }),
}));
const initial = useAppStore.getState();
const item: SessionCatalogEntry = {
  sessionId: "old",
  sessionPath: "/archive/old",
  cwd: "/a",
  name: "Archived",
  archived: true,
  messageCount: 1,
  updatedAt: 1,
  runtimeState: "idle",
};
beforeEach(() => {
  localStorage.clear();
  useAppStore.setState(
    {
      ...initial,
      host: { hostInstanceId: "host" } as never,
      workspace: { id: "a", cwd: "/a", canonicalCwd: "/a", revision: 1, servicesReady: true },
      connecting: false,
      rehydrating: false,
    },
    true,
  );
  useAppStore.getState().replaceSessionCatalog("a", [item]);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useAppStore.setState(initial, true);
});
function confirmCleanup() {
  render(<ProjectArchiveCleanup cwd="/a" items={[item]} onChanged={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Clear archived sessions" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
}
it("removes deleted archived entries before replacing the catalog", async () => {
  vi.spyOn(hostClient, "request")
    .mockResolvedValueOnce({ ok: true, result: { items: [item] } } as never)
    .mockResolvedValueOnce({ ok: true, result: { deletedCount: 1, failedCount: 0 } } as never)
    .mockResolvedValueOnce({ ok: true, result: { items: [] } } as never);
  confirmCleanup();
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(useAppStore.getState().sessionCatalog.entries).toEqual({});
});
it("does not replace a different workspace catalog after a late response", async () => {
  vi.spyOn(hostClient, "request")
    .mockResolvedValueOnce({ ok: true, result: { items: [item] } } as never)
    .mockResolvedValueOnce({ ok: true, result: { deletedCount: 1, failedCount: 0 } } as never)
    .mockImplementationOnce(async () => {
      useAppStore.setState({
        workspace: { id: "b", cwd: "/b", canonicalCwd: "/b", revision: 2, servicesReady: true },
      });
      useAppStore
        .getState()
        .replaceSessionCatalog("b", [{ ...item, sessionId: "kept", archived: false }]);
      return { ok: true, result: { items: [] } } as never;
    });
  confirmCleanup();
  await waitFor(() =>
    expect(
      useAppStore
        .getState()
        .notifications.some((notification) => notification.message.includes("Workspace changed")),
    ).toBe(true),
  );
  expect(useAppStore.getState().sessionCatalog.entries.kept).toBeDefined();
  expect(screen.getByRole("dialog")).toBeVisible();
});
