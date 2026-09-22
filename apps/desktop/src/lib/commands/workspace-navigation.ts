import type { SessionSnapshot } from "@pideck/protocol";
import { hostClient } from "../bridge/host-client";
import {
  mergeHostIdentity,
  nullableSessionContext,
  workspaceContext,
} from "../bridge/host-context";
import {
  requestSessionOpenWithRetry,
  SESSION_OPEN_TIMEOUT_MS,
} from "../bridge/session-open-request";
import { tCurrent } from "../i18n/use-t";
import { useAppStore } from "../stores/app-store";
import { createNewSession } from "./actions";

const WORKSPACE_SWITCH_TIMEOUT_MS = 60_000;
type Continuation = () => boolean;
type WorkspaceAction = () => Promise<void | boolean>;

type NavigationDependencies = {
  captureValidity: () => Continuation;
  switchWorkspace: (cwd: string, valid: Continuation) => Promise<boolean>;
  openSession: (path: string, valid: Continuation) => Promise<boolean>;
  createSession: (valid: Continuation) => Promise<boolean>;
  reportError: (error: unknown) => void;
};

/** Serialize Host mutations; obsolete navigation stops after its in-flight RPC settles. */
export function createWorkspaceNavigator(deps: NavigationDependencies) {
  let revision = 0;
  let tail: Promise<unknown> = Promise.resolve();

  function enqueue(
    cwd: string,
    action: (valid: Continuation) => Promise<void | boolean>,
    latestOnly: boolean,
  ) {
    const intent = ++revision;
    const validEpoch = deps.captureValidity();
    const valid = () => validEpoch() && (!latestOnly || intent === revision);
    const task = tail
      .then(async () => {
        if (!valid()) return false;
        if (!(await deps.switchWorkspace(cwd, valid)) || !valid()) return false;
        const result = await action(valid);
        return result !== false && valid();
      })
      .catch((error: unknown) => {
        deps.reportError(error);
        return false;
      });
    tail = task;
    return task;
  }

  return {
    navigateToSession: ({ cwd, sessionPath }: { cwd: string; sessionPath: string }) =>
      enqueue(cwd, (valid) => deps.openSession(sessionPath, valid), true),
    createSessionInWorkspace: (cwd: string) =>
      enqueue(cwd, (valid) => deps.createSession(valid), true),
    switchWorkspace: (cwd: string) => enqueue(cwd, async () => true, true),
    // Submitted mutations are retained even when a later navigation arrives.
    withWorkspaceForAction: (cwd: string, action: WorkspaceAction) => enqueue(cwd, action, false),
  };
}

function unavailable(state: ReturnType<typeof useAppStore.getState>): boolean {
  return (
    !state.host ||
    state.connecting ||
    state.rehydrating ||
    state.desynchronized ||
    Boolean(state.hostFatal)
  );
}

let recoveryEpoch = 0;
useAppStore.subscribe((state, previous) => {
  if (
    state.host?.hostInstanceId !== previous.host?.hostInstanceId ||
    (unavailable(state) && !unavailable(previous))
  )
    recoveryEpoch += 1;
});

function captureValidity(): Continuation {
  const epoch = recoveryEpoch;
  const hostId = useAppStore.getState().host?.hostInstanceId;
  return () => {
    const current = useAppStore.getState();
    return (
      epoch === recoveryEpoch && current.host?.hostInstanceId === hostId && !unavailable(current)
    );
  };
}

async function performWorkspaceSwitch(cwd: string, valid: Continuation): Promise<boolean> {
  const epoch = recoveryEpoch;
  const current = useAppStore.getState();
  if (!current.host || !valid()) return false;
  if (current.workspace?.canonicalCwd === cwd) return true;
  current.setWorkspaceSwitchTarget(cwd);
  try {
    const response = await hostClient.request(
      "workspace.setCurrent",
      workspaceContext(current.host, current.workspace),
      { cwd },
      WORKSPACE_SWITCH_TIMEOUT_MS,
    );
    const latest = useAppStore.getState();
    if (epoch !== recoveryEpoch || latest.host?.hostInstanceId !== current.host.hostInstanceId)
      return false;
    if (!response.ok)
      throw new Error(response.error?.message ?? tCurrent("notifSetWorkspaceFailed"));
    const merged = mergeHostIdentity(latest.host, response);
    if (
      !merged ||
      merged.workspaceId !== response.workspaceId ||
      merged.workspaceRevision !== response.workspaceRevision
    )
      return false;
    // Apply the completed mutation even if another intent is queued: its next RPC
    // must use the identity returned by this switch, never the captured old host.
    if (
      latest.workspace?.id !== response.result.workspace.id ||
      latest.workspace.revision !== response.result.workspace.revision
    ) {
      latest.setWorkspace(response.result.workspace);
    }
    if (response.result.session) applySnapshotIfChanged(response.result.session);
    latest.setHost(merged);
    return valid();
  } finally {
    useAppStore.getState().setWorkspaceSwitchTarget(null);
  }
}

function applySnapshotIfChanged(snapshot: SessionSnapshot): void {
  const current = useAppStore.getState();
  if (
    current.session?.sessionId !== snapshot.sessionId ||
    current.session.revision !== snapshot.revision
  ) {
    current.applySessionSnapshot(snapshot);
  }
}

function requestSessionOpen(sessionPath: string) {
  const latest = useAppStore.getState();
  if (!latest.host || !latest.workspace) throw new Error(tCurrent("notifOpenSessionFailed"));
  return hostClient.request(
    "session.open",
    nullableSessionContext(latest.host, latest.workspace),
    { sessionPath },
    SESSION_OPEN_TIMEOUT_MS,
  );
}

async function performSessionOpen(sessionPath: string, valid: Continuation): Promise<boolean> {
  const epoch = recoveryEpoch;
  const start = useAppStore.getState();
  if (!start.host || !start.workspace || !valid()) return false;
  if (start.session?.sessionPath === sessionPath) return true;
  const sameWorkspace = () => {
    const latest = useAppStore.getState();
    return (
      valid() &&
      latest.workspace?.id === start.workspace!.id &&
      latest.workspace.revision === start.workspace!.revision
    );
  };
  const response = await requestSessionOpenWithRetry(
    () => requestSessionOpen(sessionPath),
    undefined,
    sameWorkspace,
  );
  if (!response) return false;
  const current = useAppStore.getState();
  if (
    epoch !== recoveryEpoch ||
    current.host?.hostInstanceId !== start.host.hostInstanceId ||
    current.workspace?.id !== start.workspace.id ||
    current.workspace.revision !== start.workspace.revision
  )
    return false;
  return applyOpenResponse(response) && sameWorkspace();
}

function applyOpenResponse(response: Awaited<ReturnType<typeof requestSessionOpen>>): boolean {
  const current = useAppStore.getState();
  if (!current.host) return false;
  if (!response.ok)
    throw new Error(
      response.error?.code === "SESSION_LIMIT"
        ? tCurrent("sessionsLimitReached")
        : (response.error?.message ?? tCurrent("notifOpenSessionFailed")),
    );
  const merged = mergeHostIdentity(current.host, response);
  if (
    !merged ||
    merged.sessionId !== response.sessionId ||
    merged.sessionRevision !== response.sessionRevision
  )
    return false;
  applySnapshotIfChanged(response.result);
  current.setHost(merged);
  return true;
}

const navigator = createWorkspaceNavigator({
  captureValidity,
  switchWorkspace: performWorkspaceSwitch,
  openSession: performSessionOpen,
  createSession: (shouldContinue) => createNewSession({ shouldContinue }),
  reportError: (error) =>
    useAppStore
      .getState()
      .pushNotification(
        error instanceof Error ? error.message : tCurrent("notifOpenSessionFailed"),
        "error",
      ),
});

async function showChatOnSuccess(result: Promise<boolean>): Promise<boolean> {
  const success = await result;
  if (success) useAppStore.getState().setPage("chat");
  return success;
}

export function navigateToSession(target: { cwd: string; sessionPath: string }): Promise<boolean> {
  return showChatOnSuccess(navigator.navigateToSession(target));
}

export function createSessionInWorkspace(cwd: string): Promise<boolean> {
  return showChatOnSuccess(navigator.createSessionInWorkspace(cwd));
}

export const { switchWorkspace, withWorkspaceForAction } = navigator;
