import { hostClient } from "../../lib/bridge/host-client";
import {
  activeSessionContext,
  mergeHostIdentity,
  workspaceContext,
} from "../../lib/bridge/host-context";
import { withWorkspaceForAction } from "../../lib/commands/workspace-navigation";
import { createNewSession } from "../../lib/commands/actions";
import { persistDesktopSettings } from "../../lib/desktop-settings";
import { deleteSessionDrafts } from "../../lib/draft-persistence";
import { tCurrent } from "../../lib/i18n/use-t";
import { useAppStore } from "../../lib/stores/app-store";
import type { SessionCatalogEntry } from "../../lib/stores/session-catalog";
import {
  canArchiveSession,
  canDeleteSession,
  canRenameSession,
  requestSessionRpcWithRetry,
} from "./session-list-policy";
import { generateProjectSessionTitle } from "./project-session-title";
import { removeProjectPins } from "./project-session-pins";

export type ProjectSessionAction =
  "rename" | "generateTitle" | "archive" | "restore" | "delete" | "reload";
export function readyWorkspace() {
  const state = useAppStore.getState();
  if (!state.host || !state.workspace?.servicesReady) throw new Error("Workspace is not ready");
  return { ...state, host: state.host, workspace: state.workspace };
}
function requireSameWorkspace(start: ReturnType<typeof readyWorkspace>): void {
  const latest = readyWorkspace();
  if (
    latest.host.hostInstanceId !== start.host.hostInstanceId ||
    latest.workspace.id !== start.workspace.id ||
    latest.workspace.revision !== start.workspace.revision
  ) {
    throw new Error("Workspace changed while the session operation was running");
  }
}
async function clearSessionFiles(cwd: string, item: SessionCatalogEntry, deleted: boolean) {
  if (deleted) {
    deleteSessionDrafts(cwd, [item.sessionId]);
    removeProjectPins(cwd, [item.sessionId]);
  }
  if (useAppStore.getState().desktopSettings?.lastSessionPath === item.sessionPath) {
    await persistDesktopSettings({ lastSessionPath: null });
  }
}
function applyFileResult(
  result: { sessionId: string } & ({ deleted: true } | { sessionPath: string; archived: boolean }),
) {
  useAppStore.setState((state) => {
    const catalog = state.sessionCatalog;
    if (catalog.workspaceId !== state.workspace?.id) return state;
    const existing = catalog.entries[result.sessionId];
    if (!existing) return state;
    const entries = { ...catalog.entries };
    if ("deleted" in result) delete entries[result.sessionId];
    else
      entries[result.sessionId] = {
        ...existing,
        sessionPath: result.sessionPath,
        archived: result.archived,
        runtimeState: "inactive",
      };
    return {
      sessionCatalog: {
        ...catalog,
        entries,
        order:
          "deleted" in result
            ? catalog.order.filter((id) => id !== result.sessionId)
            : catalog.order,
      },
    };
  });
}
async function mutateFile(action: "archive" | "restore" | "delete", item: SessionCatalogEntry) {
  const state = readyWorkspace();
  const allowed =
    action === "restore" ||
    (action === "archive"
      ? canArchiveSession(item, state.session)
      : canDeleteSession(item, state.session));
  if (!allowed)
    throw new Error(tCurrent(action === "archive" ? "sessionsArchiveWait" : "sessionsDeleteWait"));
  if (action !== "restore" && !item.archived && state.session?.sessionId === item.sessionId) {
    if (!(await createNewSession())) throw new Error(tCurrent("notifCreateSessionFailed"));
  }
  requireSameWorkspace(state);
  const latest = readyWorkspace();
  const response = await requestSessionRpcWithRetry(() =>
    hostClient.request(`session.${action}`, workspaceContext(latest.host, latest.workspace), {
      sessionId: item.sessionId,
      sessionPath: item.sessionPath,
    }),
  );
  requireSameWorkspace(state);
  if (!response.ok) {
    if (action === "delete" && response.error.code === "SESSION_NOT_FOUND") {
      applyFileResult({ sessionId: item.sessionId, deleted: true });
      await clearSessionFiles(latest.workspace.canonicalCwd, item, true);
    }
    throw new Error(response.error.message);
  }
  applyFileResult(response.result);
  if (action !== "restore")
    await clearSessionFiles(latest.workspace.canonicalCwd, item, action === "delete");
  useAppStore
    .getState()
    .pushNotification(
      tCurrent(
        action === "archive"
          ? "notifSessionArchived"
          : action === "restore"
            ? "notifSessionRestored"
            : "notifSessionDeleted",
      ),
      "success",
    );
}
async function changeName(item: SessionCatalogEntry, name: string) {
  const state = readyWorkspace();
  const latestItem = state.sessionCatalog.entries[item.sessionId] ?? item;
  if (!canRenameSession(latestItem, state.session)) throw new Error(tCurrent("notifRenameFailed"));
  const target = { sessionId: item.sessionId, sessionPath: item.sessionPath };
  const context = workspaceContext(state.host, state.workspace);
  const response = await hostClient.request("session.rename", context, { ...target, name });
  if (!response.ok) throw new Error(response.error.message);
  requireSameWorkspace(state);
  const latest = useAppStore.getState();
  latest.updateSessionCatalogInfo(response.result.sessionId, response.result.name);
  if (latest.session?.sessionId === response.result.sessionId) {
    latest.applySessionSnapshot({ ...latest.session, name: response.result.name });
  }
}
async function reload(item: SessionCatalogEntry) {
  const state = readyWorkspace();
  if (state.session?.sessionId !== item.sessionId || !state.session.isIdle) {
    throw new Error(tCurrent("notifSessionReloadFailed"));
  }
  const response = await hostClient.request(
    "session.reload",
    activeSessionContext(state.host, state.workspace, state.session),
    null,
  );
  if (!response.ok) throw new Error(response.error.message);
  requireSameWorkspace(state);
  const latest = useAppStore.getState();
  latest.applySessionSnapshot(response.result);
  if (latest.host) {
    const identity = mergeHostIdentity(latest.host, response);
    if (identity) latest.setHost(identity);
  }
}
export async function runProjectSessionAction(options: {
  cwd: string;
  item: SessionCatalogEntry;
  action: ProjectSessionAction;
  name?: string;
}): Promise<boolean> {
  if (options.action === "rename" && !options.name?.trim())
    throw new Error(tCurrent("notifSessionNameEmpty"));
  const { action, item, name } = options;
  if (action === "generateTitle") return generateProjectSessionTitle(options.cwd, item);
  return withWorkspaceForAction(options.cwd, async () => {
    if (action === "reload") return reload(item);
    if (action === "rename") return changeName(item, name!.trim());
    return mutateFile(action, item);
  });
}
