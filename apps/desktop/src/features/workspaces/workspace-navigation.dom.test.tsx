/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  HostResponseEnvelope,
  HostStatusSnapshot,
  SessionSnapshot,
  WorkspaceSnapshot,
} from "@pideck/protocol";
import { hostClient } from "../../lib/bridge/host-client";
import { createNewSession } from "../../lib/commands/actions";
import { useAppStore } from "../../lib/stores/app-store";
import { ensureFileCanChangeWorkspace } from "../dock/file-session";
import { WorkspacePicker } from "./WorkspacePicker";
import { WorkspaceSwitchTransition } from "./WorkspaceSwitchTransition";
import { navigateToWorkspace } from "./workspace-navigation";

vi.mock("../dock/file-session", () => ({ ensureFileCanChangeWorkspace: vi.fn() }));
vi.mock("../../lib/desktop-settings", () => ({
  persistDesktopSettings: vi.fn().mockResolvedValue(undefined),
  notifyDesktopSettingsSaveFailure: vi.fn(),
}));

const HOST_ID = "11111111-1111-4111-8111-111111111111";
const ids = {
  a: "22222222-2222-4222-8222-222222222222",
  b: "33333333-3333-4333-8333-333333333333",
  c: "44444444-4444-4444-8444-444444444444",
  d: "55555555-5555-4555-8555-555555555555",
};

function workspace(name: keyof typeof ids, revision: number): WorkspaceSnapshot {
  return {
    id: ids[name],
    cwd: `/proj/${name}`,
    canonicalCwd: `/proj/${name}`,
    revision,
    servicesReady: true,
  };
}

function session(
  ws: WorkspaceSnapshot,
  revision = 1,
  sessionPath = `${ws.cwd}/default.jsonl`,
): SessionSnapshot {
  const sessionId = `${revision.toString().padStart(8, "0")}-6666-4666-8666-666666666666`;
  return {
    sessionId,
    sessionPath,
    cwd: ws.canonicalCwd,
    revision,
    isStreaming: false,
    isIdle: true,
    isCompacting: false,
    isRetrying: false,
    thinkingLevel: "off",
    autoCompactionEnabled: true,
    autoRetryEnabled: true,
    steeringMode: "all",
    followUpMode: "all",
    pending: { revision: 1, steering: [], followUp: [] },
    messages: [],
    tools: {
      revision: 1,
      workspaceId: ws.id,
      sessionId,
      sessionRevision: revision,
      tools: [],
      active: [],
    },
  };
}

function identity(ws: WorkspaceSnapshot, snapshot: SessionSnapshot) {
  return {
    hostInstanceId: HOST_ID,
    workspaceId: ws.id,
    workspaceRevision: ws.revision,
    sessionId: snapshot.sessionId,
    sessionRevision: snapshot.revision,
    packageRevision: 1,
  };
}

function host(): HostStatusSnapshot {
  const ws = workspace("a", 1);
  return {
    protocolVersion: 1,
    ...identity(ws, session(ws)),
    sdkVersion: "test",
    nodeVersion: process.version,
    agentDir: "/agent",
    phase: "ready",
    capabilities: { packageUpdateCheck: true, extensionUi: true, sessionExport: true },
    modelConfigHealth: { state: "ok", source: "ModelRegistry.getError" },
  };
}

function switched(
  name: keyof typeof ids,
  revision: number,
): HostResponseEnvelope<"workspace.setCurrent"> & { ok: true } {
  const ws = workspace(name, revision);
  const snapshot = session(ws);
  return {
    protocolVersion: 1,
    id: "test-request",
    method: "workspace.setCurrent",
    ...identity(ws, snapshot),
    ok: true,
    result: { workspace: ws, session: snapshot },
  };
}

function opened(
  ws: WorkspaceSnapshot,
  revision: number,
  path: string,
): HostResponseEnvelope<"session.open"> & { ok: true } {
  const snapshot = session(ws, revision, path);
  return {
    protocolVersion: 1,
    id: "test-request",
    method: "session.open",
    ...identity(ws, snapshot),
    ok: true,
    result: snapshot,
  };
}

function busy(
  method: "workspace.setCurrent" | "session.open" = "workspace.setCurrent",
): HostResponseEnvelope {
  return {
    ...switched("a", 1),
    method,
    ok: false,
    error: { code: "SERVICE_GRAPH_BUSY", message: "Service graph is busy", retryable: true },
  } as HostResponseEnvelope;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function flush() {
  await act(() => vi.advanceTimersByTimeAsync(0));
}

function commit(response: ReturnType<typeof switched>) {
  const ws = response.result.workspace;
  const snapshot = response.result.session!;
  useAppStore.getState().setHost({ ...host(), ...identity(ws, snapshot) });
  useAppStore.getState().applyWorkspaceSnapshot(ws);
  useAppStore.getState().applySessionSnapshot(snapshot);
}

describe("workspace navigation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(ensureFileCanChangeWorkspace).mockReset().mockResolvedValue(true);
    useAppStore.getState().beginHostEpoch(host());
    useAppStore.getState().applyWorkspaceSnapshot(workspace("a", 1));
    useAppStore.getState().applySessionSnapshot(session(workspace("a", 1)));
    useAppStore.setState({
      connecting: false,
      workspaceSwitchTarget: null,
      workspaceSwitchError: null,
      notifications: [],
      draftTexts: {},
      draftTargets: {},
      draftEditVersions: {},
      desktopSettings: { knownWorkspaces: ["/proj/a", "/proj/b", "/proj/c", "/proj/d"] } as never,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("retries transient read contention without notifying the user", async () => {
    const request = vi
      .spyOn(hostClient, "request")
      .mockResolvedValueOnce(busy() as never)
      .mockResolvedValueOnce(switched("b", 2));
    const navigation = navigateToWorkspace({ cwd: "/proj/b" });
    expect(useAppStore.getState().workspaceSwitchTarget).toBe("/proj/b");
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(80);
    expect(await navigation).toEqual({ status: "completed" });
    expect(useAppStore.getState().workspace?.canonicalCwd).toBe("/proj/b");
    expect(useAppStore.getState().workspaceSwitchTarget).toBeNull();
    expect(useAppStore.getState().workspaceSwitchError).toBeNull();
    expect(useAppStore.getState().notifications).toEqual([]);
  });

  it("bounds retries, preserves the current draft, and offers one working retry", async () => {
    const request = vi.spyOn(hostClient, "request").mockResolvedValue(busy() as never);
    useAppStore
      .getState()
      .setDraftTextLocal({ kind: "new-conversation", canonicalCwd: "/proj/a" }, "unsent draft");
    render(
      <WorkspaceSwitchTransition>
        <p>conversation</p>
      </WorkspaceSwitchTransition>,
    );
    let navigation!: ReturnType<typeof navigateToWorkspace>;
    act(() => {
      navigation = navigateToWorkspace({ cwd: "/proj/b" });
    });
    await act(() => vi.advanceTimersByTimeAsync(1_480));
    expect(await navigation).toMatchObject({ status: "failed" });
    expect(request).toHaveBeenCalledTimes(6);
    expect(useAppStore.getState().workspace?.canonicalCwd).toBe("/proj/a");
    expect(useAppStore.getState().draftTexts["new:/proj/a"]).toBe("unsent draft");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert")).not.toHaveTextContent("SERVICE_GRAPH_BUSY");
    expect(useAppStore.getState().notifications).toEqual([]);

    request.mockResolvedValue(switched("b", 2));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await flush();
    expect(useAppStore.getState().workspace?.canonicalCwd).toBe("/proj/b");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(useAppStore.getState().draftTexts["new:/proj/a"]).toBe("unsent draft");
  });

  it("finishes B in flight and skips C, sending D with B's committed identity", async () => {
    const first = deferred<ReturnType<typeof switched>>();
    const last = deferred<ReturnType<typeof switched>>();
    const request = vi
      .spyOn(hostClient, "request")
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(last.promise);
    const targets: Array<string | null> = [];
    const unsubscribe = useAppStore.subscribe((state, previous) => {
      if (state.workspaceSwitchTarget !== previous.workspaceSwitchTarget)
        targets.push(state.workspaceSwitchTarget);
    });
    const b = navigateToWorkspace({ cwd: "/proj/b" });
    await flush();
    const c = navigateToWorkspace({ cwd: "/proj/c" });
    const d = navigateToWorkspace({ cwd: "/proj/d" });
    expect(await c).toEqual({ status: "superseded" });
    expect(request).toHaveBeenCalledTimes(1);
    first.resolve(switched("b", 2));
    await flush();
    expect(await b).toEqual({ status: "superseded" });
    expect(request).toHaveBeenNthCalledWith(
      2,
      "workspace.setCurrent",
      {
        expectedHostInstanceId: HOST_ID,
        expectedWorkspaceId: ids.b,
        expectedWorkspaceRevision: 2,
      },
      { cwd: "/proj/d" },
      180_000,
    );
    expect(targets).toEqual(["/proj/b", "/proj/c", "/proj/d"]);
    last.resolve(switched("d", 3));
    expect(await d).toEqual({ status: "completed" });
    expect(targets).toEqual(["/proj/b", "/proj/c", "/proj/d", null]);
    unsubscribe();
  });

  it("drops an obsolete busy retry immediately when the user chooses another directory", async () => {
    const request = vi
      .spyOn(hostClient, "request")
      .mockResolvedValueOnce(busy() as never)
      .mockResolvedValueOnce(switched("c", 2));
    const b = navigateToWorkspace({ cwd: "/proj/b" });
    await flush();
    const c = navigateToWorkspace({ cwd: "/proj/c" });
    await flush();
    expect(await b).toEqual({ status: "superseded" });
    expect(await c).toEqual({ status: "completed" });
    expect(request.mock.calls.map((call) => call[2])).toEqual([
      { cwd: "/proj/b" },
      { cwd: "/proj/c" },
    ]);
  });

  it("allows selecting the original directory again while a switch is in flight", async () => {
    const first = deferred<ReturnType<typeof switched>>();
    const request = vi
      .spyOn(hostClient, "request")
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(switched("a", 3));
    const b = navigateToWorkspace({ cwd: "/proj/b" });
    await flush();
    const a = navigateToWorkspace({ cwd: "/proj/a" });
    first.resolve(switched("b", 2));
    expect(await b).toEqual({ status: "superseded" });
    expect(await a).toEqual({ status: "completed" });
    expect(request.mock.calls.map((call) => call[2])).toEqual([
      { cwd: "/proj/b" },
      { cwd: "/proj/a" },
    ]);
  });

  it("never opens the superseded target's session after its workspace commits", async () => {
    const first = deferred<ReturnType<typeof switched>>();
    const request = vi
      .spyOn(hostClient, "request")
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(switched("c", 3));
    const b = navigateToWorkspace({ cwd: "/proj/b", sessionPath: "/proj/b/found.jsonl" });
    await flush();
    const c = navigateToWorkspace({ cwd: "/proj/c" });
    first.resolve(switched("b", 2));
    expect(await b).toEqual({ status: "superseded" });
    expect(await c).toEqual({ status: "completed" });
    expect(request.mock.calls.map((call) => call[0])).toEqual([
      "workspace.setCurrent",
      "workspace.setCurrent",
    ]);
  });

  it("waits for an already-sent session open before dispatching the next workspace", async () => {
    const opening = deferred<ReturnType<typeof opened>>();
    const request = vi
      .spyOn(hostClient, "request")
      .mockResolvedValueOnce(switched("b", 2))
      .mockReturnValueOnce(opening.promise)
      .mockResolvedValueOnce(switched("c", 3));
    const b = navigateToWorkspace({ cwd: "/proj/b", sessionPath: "/proj/b/found.jsonl" });
    await flush();
    expect(request.mock.calls.map((call) => call[0])).toEqual([
      "workspace.setCurrent",
      "session.open",
    ]);
    const c = navigateToWorkspace({ cwd: "/proj/c" });
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
    opening.resolve(opened(workspace("b", 2), 2, "/proj/b/found.jsonl"));
    expect(await b).toEqual({ status: "superseded" });
    expect(await c).toEqual({ status: "completed" });
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("retains the opened directory after a session failure and retries only the session", async () => {
    const request = vi
      .spyOn(hostClient, "request")
      .mockResolvedValueOnce(switched("b", 2))
      .mockResolvedValueOnce({
        ...busy("session.open"),
        error: { code: "SESSION_NOT_FOUND", message: "Session unavailable", retryable: false },
      } as never)
      .mockResolvedValueOnce(opened(workspace("b", 2), 2, "/proj/b/found.jsonl"));
    const target = { cwd: "/proj/b", sessionPath: "/proj/b/found.jsonl" };
    expect(await navigateToWorkspace(target)).toEqual({
      status: "failed",
      message: "Session unavailable",
    });
    expect(useAppStore.getState().workspace?.canonicalCwd).toBe("/proj/b");
    expect(useAppStore.getState().workspaceSwitchError?.target).toEqual(target);
    expect(await navigateToWorkspace(target)).toEqual({ status: "completed" });
    expect(request.mock.calls.map((call) => call[0])).toEqual([
      "workspace.setCurrent",
      "session.open",
      "session.open",
    ]);
    expect(useAppStore.getState().session?.sessionPath).toBe(target.sessionPath);
  });

  it("refreshes a session ticket after a temporary busy response", async () => {
    const request = vi
      .spyOn(hostClient, "request")
      .mockResolvedValueOnce(busy("session.open") as never)
      .mockResolvedValueOnce(opened(workspace("a", 1), 5, "/proj/a/found.jsonl"));
    const navigation = navigateToWorkspace({ cwd: "/proj/a", sessionPath: "/proj/a/found.jsonl" });
    await flush();
    useAppStore.getState().applySessionSnapshot(session(workspace("a", 1), 4));
    await vi.advanceTimersByTimeAsync(80);
    expect(await navigation).toEqual({ status: "completed" });
    expect(request.mock.calls[1]?.[1]).toMatchObject({ expectedSessionRevision: 4 });
  });

  it.each(["host status", "workspace snapshot"])(
    "ignores an older workspace response after a newer %s",
    async (kind) => {
      const response = deferred<ReturnType<typeof switched>>();
      vi.spyOn(hostClient, "request").mockReturnValue(response.promise);
      const navigation = navigateToWorkspace({ cwd: "/proj/b" });
      await flush();
      if (kind === "host status") commit(switched("c", 3));
      else useAppStore.getState().applyWorkspaceSnapshot(workspace("c", 3));
      response.resolve(switched("b", 2));
      expect(await navigation).toEqual({ status: "superseded" });
      expect(useAppStore.getState().workspace?.canonicalCwd).toBe("/proj/c");
      expect(useAppStore.getState().host?.workspaceId).toBe(kind === "host status" ? ids.c : ids.a);
    },
  );

  it("does not report completion or regress state for an obsolete session response", async () => {
    const response = deferred<ReturnType<typeof opened>>();
    vi.spyOn(hostClient, "request").mockReturnValue(response.promise);
    const navigation = navigateToWorkspace({ cwd: "/proj/a", sessionPath: "/proj/a/found.jsonl" });
    await flush();
    useAppStore
      .getState()
      .applySessionSnapshot(session(workspace("a", 1), 5, "/proj/a/newer.jsonl"));
    response.resolve(opened(workspace("a", 1), 2, "/proj/a/found.jsonl"));
    expect(await navigation).toEqual({ status: "superseded" });
    expect(useAppStore.getState().session?.sessionPath).toBe("/proj/a/newer.jsonl");
    expect(useAppStore.getState().host?.sessionRevision).toBe(5);
  });

  it.each(["host replacement", "recovery"])(
    "invalidates active and queued work on %s",
    async (kind) => {
      const response = deferred<ReturnType<typeof switched>>();
      const request = vi.spyOn(hostClient, "request").mockReturnValue(response.promise);
      const b = navigateToWorkspace({ cwd: "/proj/b" });
      await flush();
      const c = navigateToWorkspace({ cwd: "/proj/c" });
      if (kind === "host replacement")
        useAppStore.getState().beginHostEpoch({ ...host(), hostInstanceId: ids.d });
      else useAppStore.getState().setConnecting(true);
      expect(await c).toEqual({ status: "superseded" });
      response.resolve(switched("b", 2));
      expect(await b).toEqual({ status: "superseded" });
      expect(request).toHaveBeenCalledTimes(1);
      expect(useAppStore.getState().workspace?.canonicalCwd).not.toBe("/proj/b");
      expect(useAppStore.getState().workspaceSwitchTarget).toBeNull();
      expect(useAppStore.getState().workspaceSwitchError).toBeNull();
    },
  );

  it("does not dispatch or show an error when dirty-file confirmation is cancelled", async () => {
    vi.mocked(ensureFileCanChangeWorkspace).mockResolvedValue(false);
    const request = vi.spyOn(hostClient, "request");
    expect(await navigateToWorkspace({ cwd: "/proj/b" })).toEqual({ status: "cancelled" });
    expect(request).not.toHaveBeenCalled();
    expect(useAppStore.getState().workspaceSwitchTarget).toBeNull();
    expect(useAppStore.getState().workspaceSwitchError).toBeNull();
  });

  it("sends only the latest destination after a dirty-file dialog is accepted", async () => {
    const confirmation = deferred<boolean>();
    vi.mocked(ensureFileCanChangeWorkspace).mockReturnValueOnce(confirmation.promise);
    const request = vi.spyOn(hostClient, "request").mockResolvedValue(switched("c", 2));
    const b = navigateToWorkspace({ cwd: "/proj/b" });
    const c = navigateToWorkspace({ cwd: "/proj/c" });
    confirmation.resolve(true);
    expect(await b).toEqual({ status: "superseded" });
    expect(await c).toEqual({ status: "completed" });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[2]).toEqual({ cwd: "/proj/c" });
  });

  it("cancels queued departures too when the shared dirty-file dialog is declined", async () => {
    const confirmation = deferred<boolean>();
    vi.mocked(ensureFileCanChangeWorkspace).mockReturnValueOnce(confirmation.promise);
    const request = vi.spyOn(hostClient, "request").mockResolvedValue(switched("c", 2));
    const b = navigateToWorkspace({ cwd: "/proj/b" });
    const c = navigateToWorkspace({ cwd: "/proj/c" });
    confirmation.resolve(false);
    expect(await b).toEqual({ status: "cancelled" });
    expect(await c).toEqual({ status: "cancelled" });
    expect(request).not.toHaveBeenCalled();
    expect(ensureFileCanChangeWorkspace).toHaveBeenCalledTimes(1);
  });

  it("does not let late startup selection replace the user's navigation", async () => {
    const response = deferred<ReturnType<typeof switched>>();
    const request = vi.spyOn(hostClient, "request").mockReturnValue(response.promise);
    const b = navigateToWorkspace({ cwd: "/proj/b" });
    expect(await navigateToWorkspace({ cwd: "/proj/c" }, { recovery: true })).toEqual({
      status: "superseded",
    });
    await flush();
    response.resolve(switched("b", 2));
    expect(await b).toEqual({ status: "completed" });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("keeps directory choices enabled and acknowledges the latest click immediately", async () => {
    const response = deferred<ReturnType<typeof switched>>();
    const request = vi
      .spyOn(hostClient, "request")
      .mockReturnValueOnce(response.promise)
      .mockResolvedValueOnce(switched("d", 3));
    render(<WorkspacePicker collapsed={false} onToggleCollapsed={() => {}} />);
    const a = screen.getByRole("button", { name: "a" });
    const b = screen.getByRole("button", { name: "b" });
    const c = screen.getByRole("button", { name: "c" });
    const d = screen.getByRole("button", { name: "d" });
    expect(a).toBeDisabled();
    fireEvent.click(b);
    expect(b).toHaveAttribute("aria-busy", "true");
    expect(a).toBeEnabled();
    expect(c).toBeEnabled();
    await flush();
    fireEvent.click(c);
    fireEvent.click(d);
    expect(d).toHaveAttribute("aria-busy", "true");
    expect(d.closest("li")).toHaveClass("font-medium");
    expect(b).not.toHaveAttribute("aria-busy");
    expect(b.closest("li")).not.toHaveClass("font-medium");
    response.resolve(switched("b", 2));
    await flush();
    expect(request.mock.calls.map((call) => call[2])).toEqual([
      { cwd: "/proj/b" },
      { cwd: "/proj/d" },
    ]);
    expect(d).toBeDisabled();
  });

  it("blocks new-session shortcuts until the destination is settled", async () => {
    const request = vi.spyOn(hostClient, "request");
    useAppStore.getState().setWorkspaceSwitchTarget("/proj/b");
    expect(await createNewSession()).toBe(false);
    expect(request).not.toHaveBeenCalled();
    useAppStore.getState().setWorkspaceSwitchTarget(null);
  });
});
