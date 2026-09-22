import { describe, expect, it, vi } from "vitest";
import { createWorkspaceNavigator } from "./workspace-navigation";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function setup() {
  const dependencies = {
    captureValidity: () => () => true,
    switchWorkspace: vi.fn(async (_cwd: string) => true),
    openSession: vi.fn(async (_path: string) => true),
    createSession: vi.fn(async () => true),
    reportError: vi.fn(),
  };
  return { dependencies, navigator: createWorkspaceNavigator(dependencies) };
}

describe("workspace navigator", () => {
  it("finishes an in-flight switch then opens only the final requested session", async () => {
    const { dependencies, navigator } = setup();
    const switched = deferred<boolean>();
    dependencies.switchWorkspace.mockImplementationOnce(() => switched.promise);
    const first = navigator.navigateToSession({ cwd: "/a", sessionPath: "/a/one" });
    await Promise.resolve();
    const second = navigator.navigateToSession({ cwd: "/b", sessionPath: "/b/two" });
    const last = navigator.navigateToSession({ cwd: "/c", sessionPath: "/c/three" });
    switched.resolve(true);
    expect(await first).toBe(false);
    expect(await second).toBe(false);
    expect(await last).toBe(true);
    expect(dependencies.switchWorkspace.mock.calls.map(([cwd]) => cwd)).toEqual(["/a", "/c"]);
    expect(dependencies.openSession.mock.calls.map(([path]) => path)).toEqual(["/c/three"]);
  });

  it("reports a switch failure, skips its action and allows later navigation", async () => {
    const { dependencies, navigator } = setup();
    dependencies.switchWorkspace.mockRejectedValueOnce(new Error("switch failed"));
    expect(await navigator.createSessionInWorkspace("/a")).toBe(false);
    expect(dependencies.createSession).not.toHaveBeenCalled();
    expect(dependencies.reportError).toHaveBeenCalledWith(new Error("switch failed"));
    expect(await navigator.navigateToSession({ cwd: "/b", sessionPath: "/b/two" })).toBe(true);
  });

  it("retains submitted actions and keeps later navigation behind their completion", async () => {
    const { dependencies, navigator } = setup();
    const actionComplete = deferred<void>();
    const action = vi.fn(() => actionComplete.promise);
    const mutation = navigator.withWorkspaceForAction("/a", action);
    await vi.waitFor(() => expect(action).toHaveBeenCalledOnce());
    const next = navigator.navigateToSession({ cwd: "/b", sessionPath: "/b/two" });
    expect(dependencies.switchWorkspace).toHaveBeenCalledTimes(1);
    actionComplete.resolve();
    expect(await mutation).toBe(true);
    expect(await next).toBe(true);
    expect(dependencies.switchWorkspace.mock.calls.map(([cwd]) => cwd)).toEqual(["/a", "/b"]);
  });

  it("invalidates captured intents on recovery even when the host becomes available again", async () => {
    const { dependencies } = setup();
    let epoch = 0;
    dependencies.captureValidity = () => {
      const captured = epoch;
      return () => captured === epoch;
    };
    const navigator = createWorkspaceNavigator(dependencies);
    const switched = deferred<boolean>();
    dependencies.switchWorkspace.mockImplementationOnce(() => switched.promise);
    const pending = navigator.navigateToSession({ cwd: "/a", sessionPath: "/a/one" });
    await Promise.resolve();
    epoch += 1;
    switched.resolve(true);
    expect(await pending).toBe(false);
    expect(dependencies.openSession).not.toHaveBeenCalled();
    expect(await navigator.createSessionInWorkspace("/b")).toBe(true);
  });

  it("checks validity before executing queued work and does not continue a rejected switch", async () => {
    const { dependencies, navigator } = setup();
    dependencies.switchWorkspace.mockResolvedValueOnce(false);
    const action = vi.fn(async () => {});
    expect(await navigator.withWorkspaceForAction("/a", action)).toBe(false);
    expect(action).not.toHaveBeenCalled();
  });
});
