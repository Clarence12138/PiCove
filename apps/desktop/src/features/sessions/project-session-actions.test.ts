import { beforeEach, describe, expect, it, vi } from "vitest";
import { hostClient } from "../../lib/bridge/host-client";
import { useAppStore } from "../../lib/stores/app-store";
import type { SessionCatalogEntry } from "../../lib/stores/session-catalog";
import { runProjectSessionAction } from "./project-session-actions";

vi.mock("../../lib/commands/workspace-navigation", () => ({
  withWorkspaceForAction: vi.fn(async (_cwd, action) => {
    await action();
    return true;
  }),
}));
vi.mock("../../lib/draft-persistence", () => ({ deleteSessionDrafts: vi.fn() }));
vi.mock("./project-session-pins", () => ({ removeProjectPins: vi.fn() }));
const item: SessionCatalogEntry = {
  sessionId: "one",
  sessionPath: "/one",
  cwd: "/a",
  name: "Original",
  messageCount: 1,
  updatedAt: 1,
  runtimeState: "idle",
};
describe("project session file mutations", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAppStore.setState({
      host: { hostInstanceId: "host" } as never,
      workspace: { id: "a", canonicalCwd: "/a", revision: 1, servicesReady: true } as never,
      session: null,
      desktopSettings: null,
    });
    useAppStore.getState().clearSessionCatalog();
    useAppStore.getState().replaceSessionCatalog("a", [item]);
  });
  it("removes a deleted idle session before a catalog refresh can retain it", async () => {
    vi.spyOn(hostClient, "request").mockResolvedValue({
      ok: true,
      result: { sessionId: "one", deleted: true },
    } as never);
    expect(await runProjectSessionAction({ cwd: "/a", item, action: "delete" })).toBe(true);
    expect(useAppStore.getState().sessionCatalog.entries.one).toBeUndefined();
    expect(useAppStore.getState().sessionCatalog.order).toEqual([]);
    useAppStore.getState().replaceSessionCatalog("a", []);
    expect(useAppStore.getState().sessionCatalog.entries.one).toBeUndefined();
  });
  it.each([true, false])(
    "adopts the host file path and archived=%s immediately",
    async (archived) => {
      vi.spyOn(hostClient, "request").mockResolvedValue({
        ok: true,
        result: {
          sessionId: "one",
          sessionPath: archived ? "/archive/one" : "/restored/one",
          archived,
        },
      } as never);
      await runProjectSessionAction({ cwd: "/a", item, action: archived ? "archive" : "restore" });
      expect(useAppStore.getState().sessionCatalog.entries.one).toMatchObject({
        sessionPath: archived ? "/archive/one" : "/restored/one",
        archived,
        runtimeState: "inactive",
      });
    },
  );
  it("rejects a late response after workspace identity changes", async () => {
    vi.spyOn(hostClient, "request").mockImplementation(async () => {
      useAppStore.setState({
        workspace: { id: "b", canonicalCwd: "/b", revision: 2, servicesReady: true } as never,
      });
      useAppStore.getState().replaceSessionCatalog("b", [{ ...item, name: "Other workspace" }]);
      return { ok: true, result: { sessionId: "one", deleted: true } } as never;
    });
    await expect(runProjectSessionAction({ cwd: "/a", item, action: "delete" })).rejects.toThrow(
      "Workspace changed",
    );
    expect(useAppStore.getState().sessionCatalog.entries.one.name).toBe("Other workspace");
  });
});
