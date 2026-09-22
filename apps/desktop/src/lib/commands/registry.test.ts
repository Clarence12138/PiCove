import { afterEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../stores/app-store";
import { appCommands } from "./registry";
import { createSessionInWorkspace } from "./workspace-navigation";

vi.mock("./workspace-navigation", () => ({ createSessionInWorkspace: vi.fn(async () => true) }));

afterEach(() => {
  useAppStore.getState().setWorkspace(null);
  vi.clearAllMocks();
});

describe("new session command", () => {
  it("uses the shared navigator and the workspace current at invocation", async () => {
    useAppStore.getState().setWorkspace({
      id: "project",
      cwd: "/alias",
      canonicalCwd: "/canonical",
      revision: 1,
      servicesReady: true,
    });
    await appCommands.find((command) => command.id === "session.new")!.run();
    expect(createSessionInWorkspace).toHaveBeenCalledWith("/canonical");
  });

  it("does not submit navigation without a current project", async () => {
    useAppStore.getState().setWorkspace(null);
    await appCommands.find((command) => command.id === "session.new")!.run();
    expect(createSessionInWorkspace).not.toHaveBeenCalled();
  });
});
