import type { HostIdentity, HostResponseEnvelope, WorkspaceSnapshot } from "@pideck/protocol";
import { hostClient } from "../../lib/bridge/host-client";
import { mergeHostIdentity, workspaceContext } from "../../lib/bridge/host-context";
import {
  requestSessionOpenWithRetry,
  SESSION_OPEN_TIMEOUT_MS,
} from "../../lib/bridge/session-open-request";
import { tCurrent } from "../../lib/i18n/use-t";
import { useAppStore } from "../../lib/stores/app-store";
import { ensureFileCanChangeWorkspace } from "../dock/file-session";

type Destination = { cwd: string; sessionPath?: string };
type NavigationOutcome =
  { status: "completed" | "superseded" | "cancelled" } | { status: "failed"; message: string };
type Navigation = {
  target: Destination;
  hostId: string;
  recovery: boolean;
  controller: AbortController;
  resolve: (outcome: NavigationOutcome) => void;
};

let active: Navigation | null = null;
let queued: Navigation | null = null;
let draining = false;

function clearQueued(outcome: NavigationOutcome): void {
  const navigation = queued;
  queued = null;
  navigation?.controller.abort();
  navigation?.resolve(outcome);
}

function sameWorkspace(workspace: WorkspaceSnapshot | null, cwd: string): boolean {
  return workspace?.canonicalCwd === cwd || workspace?.cwd === cwd;
}

function available(navigation: Navigation): boolean {
  const state = useAppStore.getState();
  return (
    state.host?.hostInstanceId === navigation.hostId &&
    !state.hostFatal &&
    (navigation.recovery || (!state.connecting && !state.rehydrating && !state.desynchronized))
  );
}

function current(navigation: Navigation): boolean {
  return !navigation.controller.signal.aborted && available(navigation);
}

function waitForRetry(navigation: Navigation, delayMs: number): Promise<void> {
  const signal = navigation.controller.signal;
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, delayMs);
    signal.addEventListener("abort", finish, { once: true });
  });
}

/** Accept the Host's committed generation, including a superseded in-flight destination. */
function adoptIdentity(navigation: Navigation, identity: HostIdentity): boolean {
  if (!available(navigation)) return false;
  const { host, workspace } = useAppStore.getState();
  if (
    !host ||
    identity.hostInstanceId !== navigation.hostId ||
    identity.workspaceRevision < host.workspaceRevision ||
    (identity.workspaceRevision === host.workspaceRevision &&
      identity.workspaceId !== host.workspaceId) ||
    // workspace.changed can arrive before the matching Host status update.
    (workspace !== null &&
      (identity.workspaceRevision < workspace.revision ||
        (identity.workspaceRevision === workspace.revision &&
          identity.workspaceId !== workspace.id)))
  ) {
    return false;
  }
  const next = mergeHostIdentity(host, identity);
  if (next) useAppStore.getState().setHost(next);
  return Boolean(next);
}

function adoptWorkspace(
  navigation: Navigation,
  response: HostResponseEnvelope<"workspace.setCurrent"> & { ok: true },
): boolean {
  if (!adoptIdentity(navigation, response)) return false;
  const state = useAppStore.getState();
  const { workspace, session } = response.result;
  if (state.workspace?.id !== workspace.id || state.workspace.revision !== workspace.revision) {
    state.applyWorkspaceSnapshot(workspace);
  }
  const applied = useAppStore.getState().session;
  const host = useAppStore.getState().host;
  if (
    session &&
    host?.sessionId === session.sessionId &&
    host.sessionRevision === session.revision &&
    (applied?.sessionId !== session.sessionId || applied.revision !== session.revision)
  ) {
    useAppStore.getState().applySessionSnapshot(session);
  }
  return true;
}

async function perform(navigation: Navigation): Promise<NavigationOutcome> {
  if (!current(navigation)) return { status: "superseded" };
  const { target } = navigation;
  if (!sameWorkspace(useAppStore.getState().workspace, target.cwd)) {
    // HostClient also protects direct callers. Check here first so a newer
    // destination can supersede this one while the shared file dialog is open.
    if (!(await ensureFileCanChangeWorkspace(target.cwd))) return { status: "cancelled" };
    if (!current(navigation)) return { status: "superseded" };
    const switched = await requestSessionOpenWithRetry(
      () => {
        const state = useAppStore.getState();
        return hostClient.request(
          "workspace.setCurrent",
          workspaceContext(state.host!, state.workspace),
          { cwd: target.cwd },
          SESSION_OPEN_TIMEOUT_MS,
        );
      },
      (delayMs) => waitForRetry(navigation, delayMs),
      () => current(navigation),
    );
    if (switched?.ok && !adoptWorkspace(navigation, switched)) return { status: "superseded" };
    if (!current(navigation) || !switched) return { status: "superseded" };
    if (!switched.ok) {
      return {
        status: "failed",
        message:
          switched.error.code === "SERVICE_GRAPH_BUSY"
            ? tCurrent("workspacesBusyRetry")
            : switched.error.message,
      };
    }
  }

  const state = useAppStore.getState();
  const workspace = state.workspace;
  if (!workspace || !current(navigation)) return { status: "superseded" };
  if (!target.sessionPath || state.session?.sessionPath === target.sessionPath) {
    return { status: "completed" };
  }

  // Keep the destination workspace fixed while refreshing only the session
  // ticket. Another committed workspace must never receive this session path.
  const opened = await requestSessionOpenWithRetry(
    () => {
      const host = useAppStore.getState().host!;
      return hostClient.request(
        "session.open",
        {
          ...workspaceContext(host, workspace),
          expectedSessionId: host.sessionId,
          expectedSessionRevision: host.sessionRevision,
        },
        { sessionPath: target.sessionPath! },
        SESSION_OPEN_TIMEOUT_MS,
      );
    },
    (delayMs) => waitForRetry(navigation, delayMs),
    () => {
      const latest = useAppStore.getState().workspace;
      return (
        current(navigation) && latest?.id === workspace.id && latest.revision === workspace.revision
      );
    },
  );
  if (opened?.ok) {
    if (!adoptIdentity(navigation, opened)) return { status: "superseded" };
    const applied = useAppStore.getState().session;
    const host = useAppStore.getState().host;
    if (
      host?.sessionId !== opened.result.sessionId ||
      host.sessionRevision !== opened.result.revision
    ) {
      return { status: "superseded" };
    }
    if (
      applied?.sessionId !== opened.result.sessionId ||
      applied.revision !== opened.result.revision
    ) {
      useAppStore.getState().applySessionSnapshot(opened.result);
    }
  }
  if (!current(navigation) || !opened) return { status: "superseded" };
  return opened.ok
    ? { status: "completed" }
    : {
        status: "failed",
        message:
          opened.error.code === "SERVICE_GRAPH_BUSY"
            ? tCurrent("workspacesBusyRetry")
            : opened.error.message,
      };
}

async function drain(): Promise<void> {
  draining = true;
  const unsubscribe = useAppStore.subscribe(() => {
    if (active && !available(active)) active.controller.abort();
    if (queued && !available(queued)) {
      clearQueued({ status: "superseded" });
    }
  });
  try {
    while (queued) {
      const navigation: Navigation = queued;
      queued = null;
      active = navigation;
      let outcome: NavigationOutcome;
      try {
        outcome = await perform(navigation);
      } catch (error) {
        outcome = current(navigation)
          ? {
              status: "failed",
              message: error instanceof Error ? error.message : tCurrent("notifSetWorkspaceFailed"),
            }
          : { status: "superseded" };
      }
      // The shared dialog asks whether to leave the current dirty file. A
      // cancellation also declines destinations queued while it was open.
      if (outcome.status === "cancelled") clearQueued(outcome);
      if (outcome.status === "failed" && current(navigation)) {
        useAppStore
          .getState()
          .setWorkspaceSwitchError({ target: navigation.target, message: outcome.message });
      }
      navigation.resolve(outcome);
    }
  } finally {
    unsubscribe();
    active = null;
    draining = false;
    useAppStore.getState().setWorkspaceSwitchTarget(null);
  }
}

/** One shared navigation owner: finish sent mutations, retain only the latest choice. */
export function navigateToWorkspace(
  target: Destination,
  options: { recovery?: boolean } = {},
): Promise<NavigationOutcome> {
  const state = useAppStore.getState();
  if (
    !state.host ||
    state.hostFatal ||
    (!options.recovery && (state.connecting || state.rehydrating || state.desynchronized))
  ) {
    return Promise.resolve({ status: "superseded" });
  }
  // A late startup selection cannot replace navigation or a selected workspace.
  if (options.recovery && (draining || state.host.workspaceId !== null)) {
    return Promise.resolve({ status: "superseded" });
  }
  active?.controller.abort();
  clearQueued({ status: "superseded" });
  const promise = new Promise<NavigationOutcome>((resolve) => {
    queued = {
      target: { ...target },
      hostId: state.host!.hostInstanceId,
      recovery: options.recovery === true,
      controller: new AbortController(),
      resolve,
    };
  });
  state.setWorkspaceSwitchError(null);
  state.setWorkspaceSwitchTarget(target.cwd);
  if (!draining) void drain();
  return promise;
}

// A queue and its callers must share one coordinator across development updates.
if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
}
