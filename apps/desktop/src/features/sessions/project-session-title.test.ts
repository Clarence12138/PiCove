import { beforeEach, describe, expect, it, vi } from "vitest";
import { hostClient } from "../../lib/bridge/host-client";
import { withWorkspaceForAction } from "../../lib/commands/workspace-navigation";
import { useAppStore } from "../../lib/stores/app-store";
import type { SessionCatalogEntry } from "../../lib/stores/session-catalog";
import { generateProjectSessionTitle } from "./project-session-title";

vi.mock("../../lib/commands/workspace-navigation", () => ({
  withWorkspaceForAction: vi.fn(async (_cwd, action) => {
    await action();
    return true;
  }),
}));
const item: SessionCatalogEntry = {
  sessionId: "one",
  sessionPath: "/one",
  cwd: "/a",
  name: "Original",
  messageCount: 1,
  updatedAt: 1,
  runtimeState: "inactive",
};
function deferred() {
  let resolve!: (value: never) => void;
  const promise = new Promise<never>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
describe("project title generation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    useAppStore.setState({
      host: { hostInstanceId: "host" } as never,
      workspace: { id: "a", canonicalCwd: "/a", revision: 1, servicesReady: true } as never,
      session: null,
    });
    useAppStore.getState().replaceSessionCatalog("a", [item]);
  });
  it("releases workspace action queue while generation is still running", async () => {
    const response = deferred();
    vi.spyOn(hostClient, "request").mockReturnValue(response.promise);
    const pending = generateProjectSessionTitle("/a", item);
    await vi.waitFor(() => expect(withWorkspaceForAction).toHaveResolved());
    useAppStore.setState({ workspace: { id: "b", revision: 2 } as never });
    response.resolve({ ok: true, result: { sessionId: "one", name: "Generated" } } as never);
    expect(await pending).toBe(false);
    expect(useAppStore.getState().sessionCatalog.entries.one.name).toBe("Original");
  });
  it("does not replace a newer manual rename", async () => {
    const response = deferred();
    vi.spyOn(hostClient, "request").mockReturnValue(response.promise);
    const pending = generateProjectSessionTitle("/a", item);
    await vi.waitFor(() => expect(hostClient.request).toHaveBeenCalled());
    useAppStore.getState().updateSessionCatalogInfo("one", "Manual");
    response.resolve({ ok: true, result: { sessionId: "one", name: "Generated" } } as never);
    expect(await pending).toBe(false);
    expect(useAppStore.getState().sessionCatalog.entries.one.name).toBe("Manual");
  });
  it("updates only the title of the latest snapshot", async () => {
    const response = deferred();
    vi.spyOn(hostClient, "request").mockReturnValue(response.promise);
    const pending = generateProjectSessionTitle("/a", item);
    await vi.waitFor(() => expect(hostClient.request).toHaveBeenCalled());
    const messages = [{ role: "user", content: "arrived meanwhile" }];
    useAppStore.setState({ session: { sessionId: "one", messages, revision: 5 } as never });
    const apply = vi
      .spyOn(useAppStore.getState(), "applySessionSnapshot")
      .mockImplementation(() => {});
    response.resolve({ ok: true, result: { sessionId: "one", name: "Generated" } } as never);
    expect(await pending).toBe(true);
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Generated", messages, revision: 5 }),
    );
  });
});
