import { Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { hostClient } from "../../lib/bridge/host-client";
import { workspaceContext } from "../../lib/bridge/host-context";
import { withWorkspaceForAction } from "../../lib/commands/workspace-navigation";
import { deleteSessionDrafts } from "../../lib/draft-persistence";
import { useT } from "../../lib/i18n/use-t";
import { useAppStore } from "../../lib/stores/app-store";
import type { SessionCatalogEntry } from "../../lib/stores/session-catalog";
import { readyWorkspace } from "./project-session-actions";
import { ProjectSessionConfirm } from "./project-session-dialog";
import { removeProjectPins } from "./project-session-pins";
import { removedArchivedSessionIds } from "./session-list-policy";

export function ProjectArchiveCleanup({
  cwd,
  items,
  onChanged,
  renderTrigger,
}: {
  cwd: string;
  items: SessionCatalogEntry[];
  onChanged: () => void;
  renderTrigger?: (open: () => void, disabled: boolean) => ReactNode;
}) {
  const t = useT();
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(false);
  const count = items.filter((item) => item.archived).length;
  async function cleanup() {
    setPending(true);
    try {
      const completed = await withWorkspaceForAction(cwd, async () => {
        const state = readyWorkspace();
        const context = workspaceContext(state.host, state.workspace);
        const before = await hostClient.request("session.list", context, null);
        if (!before.ok) throw new Error(before.error.message);
        const result = await hostClient.request("session.cleanupArchived", context, null);
        if (!result.ok) throw new Error(result.error.message);
        const after = await hostClient.request("session.list", context, null);
        if (!after.ok) throw new Error(after.error.message);
        const latest = readyWorkspace();
        if (
          latest.host.hostInstanceId !== state.host.hostInstanceId ||
          latest.workspace.id !== state.workspace.id ||
          latest.workspace.revision !== state.workspace.revision
        ) {
          throw new Error("Workspace changed while archive cleanup was running");
        }
        const removed = removedArchivedSessionIds(before.result.items, after.result.items);
        const removedIds = new Set(removed);
        useAppStore.setState((current) => ({
          sessionCatalog: {
            ...current.sessionCatalog,
            entries: Object.fromEntries(
              Object.entries(current.sessionCatalog.entries).filter(([id]) => !removedIds.has(id)),
            ),
            order: current.sessionCatalog.order.filter((id) => !removedIds.has(id)),
          },
        }));
        deleteSessionDrafts(state.workspace.canonicalCwd, removed);
        removeProjectPins(state.workspace.canonicalCwd, removed);
        state.replaceSessionCatalog(state.workspace.id, after.result.items);
        state.pushNotification(
          result.result.failedCount
            ? t("notifCleanupPartial", {
                deleted: result.result.deletedCount,
                failed: result.result.failedCount,
              })
            : t("notifCleanupDone", { deleted: result.result.deletedCount }),
          result.result.failedCount ? "warning" : "success",
        );
      });
      if (completed) setConfirm(false);
    } catch (error) {
      useAppStore
        .getState()
        .pushNotification(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setPending(false);
      onChanged();
    }
  }
  return (
    <>
      {renderTrigger ? (
        renderTrigger(() => setConfirm(true), !count || pending)
      ) : (
        <button
          type="button"
          title={t("sessionsClearArchivedTitle", { count })}
          aria-label={t("sessionsClearArchivedAria")}
          disabled={!count || pending}
          onClick={() => setConfirm(true)}
          className="rounded p-1 text-muted hover:text-danger"
        >
          <Trash2 size={13} /> {t("sessionsClearArchivedAria")}
        </button>
      )}
      {confirm && (
        <ProjectSessionConfirm
          title={t("sessionsCleanupConfirmTitle")}
          body={`${t("sessionsCleanupConfirmBody", { count })} ${t("projectSessionSwitchHint")}`}
          pending={pending}
          onCancel={() => setConfirm(false)}
          onConfirm={() => void cleanup()}
        />
      )}
    </>
  );
}
