import { hostClient } from "../../lib/bridge/host-client";
import { workspaceContext } from "../../lib/bridge/host-context";
import { withWorkspaceForAction } from "../../lib/commands/workspace-navigation";
import { tCurrent } from "../../lib/i18n/use-t";
import { useAppStore } from "../../lib/stores/app-store";
import type { SessionCatalogEntry } from "../../lib/stores/session-catalog";
import { canRenameSession } from "./session-list-policy";

export async function generateProjectSessionTitle(
  cwd: string,
  item: SessionCatalogEntry,
): Promise<boolean> {
  let completion: Promise<boolean> | undefined;
  const started = await withWorkspaceForAction(cwd, async () => {
    const state = useAppStore.getState();
    if (!state.host || !state.workspace) throw new Error("Workspace is not ready");
    const target = state.sessionCatalog.entries[item.sessionId] ?? item;
    if (!canRenameSession(target, state.session) || !target.messageCount)
      throw new Error(tCurrent("notifGenerateTitleFailed"));
    const hostId = state.host.hostInstanceId;
    const workspace = state.workspace;
    completion = hostClient
      .request("session.generateTitle", workspaceContext(state.host, workspace), {
        sessionId: item.sessionId,
        sessionPath: item.sessionPath,
      })
      .then((response) => {
        const latest = useAppStore.getState();
        if (
          latest.host?.hostInstanceId !== hostId ||
          latest.workspace?.id !== workspace.id ||
          latest.workspace.revision !== workspace.revision
        )
          return false;
        if (!response.ok) throw new Error(response.error.message);
        const current = latest.sessionCatalog.entries[item.sessionId];
        if (
          !current ||
          current.sessionPath !== item.sessionPath ||
          (current.name !== target.name && current.name !== response.result.name)
        )
          return false;
        latest.updateSessionCatalogInfo(item.sessionId, response.result.name);
        if (latest.session?.sessionId === item.sessionId)
          latest.applySessionSnapshot({ ...latest.session, name: response.result.name });
        return true;
      });
    // Attach an immediate rejection handler while the navigation queue releases its lock.
    void completion.catch(() => {});
  });
  return started && completion ? completion : false;
}
