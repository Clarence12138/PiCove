import { ChevronRight, Folder, FolderOpen, Plus, MoreHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { openContextMenu, contextMenuTrigger } from "../../lib/context-menu";
import { useT } from "../../lib/i18n/use-t";
import { useAppStore } from "../../lib/stores/app-store";
import { prioritizePinnedSessions } from "../../lib/session-pins";
import { createSessionInWorkspace } from "../../lib/commands/workspace-navigation";
import { ProjectSessionRow } from "../sessions/ProjectSessionRow";
import { readProjectPins } from "../sessions/project-session-pins";
import { ProjectArchiveCleanup } from "../sessions/ProjectArchiveCleanup";
import { sessionStatusDotClass } from "../sessions/session-list-policy";
import { workspaceDisplayName, workspaceLiveRuntimeState } from "./WorkspacePicker";
import {
  PROJECT_SESSION_PREVIEW_COUNT,
  PROJECT_SESSION_PAGE_SIZE,
  type ProjectCatalog,
} from "./project-catalog";

function CatalogStatus({ catalog, retry }: { catalog?: ProjectCatalog; retry: () => void }) {
  const t = useT();
  if (catalog?.error)
    return (
      <div role="alert" className="px-3 py-2 text-xs text-danger">
        {catalog.error}{" "}
        <button type="button" className="underline" onClick={retry}>
          {t("projectRetry")}
        </button>
      </div>
    );
  if (!catalog?.loaded || catalog.loading)
    return (
      <p role="status" className="px-3 py-2 text-xs text-muted">
        {t("projectLoading")}
      </p>
    );
  return null;
}

export function MoreSessions({ all, toggle }: { all: boolean; toggle: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={toggle}
      className="px-3 py-2 text-xs text-muted hover:text-foreground"
    >
      {t(all ? "projectShowLess" : "projectShowMore")}
    </button>
  );
}

type Props = {
  cwd: string;
  expanded: boolean;
  catalog?: ProjectCatalog;
  toggle: () => void;
  refresh: () => void;
  remove: () => void;
};
export function ProjectSessionGroup({ cwd, expanded, catalog, toggle, refresh, remove }: Props) {
  const t = useT();
  const workspace = useAppStore((s) => s.workspace);
  const sessionId = useAppStore((s) => s.session?.sessionId);
  const host = useAppStore((s) => s.host);
  const session = useAppStore((s) => s.session);
  const currentCatalog = useAppStore((s) => s.sessionCatalog);
  const drafts = useAppStore((s) => s.transcriptDrafts);
  const [visibleCount, setVisibleCount] = useState(PROJECT_SESSION_PREVIEW_COUNT);
  useEffect(() => {
    if (!expanded) setVisibleCount(PROJECT_SESSION_PREVIEW_COUNT);
  }, [expanded]);
  const [archived, setArchived] = useState(false);
  const active = workspace?.canonicalCwd === cwd;
  const lastSession = useRef(sessionId);
  useEffect(() => {
    if (active && sessionId !== lastSession.current) setArchived(false);
    lastSession.current = sessionId;
  }, [active, sessionId]);
  const items = prioritizePinnedSessions(
    (catalog?.items ?? [])
      .filter((item) => !!item.archived === archived)
      .sort((a, b) => b.updatedAt - a.updatedAt),
    readProjectPins(cwd),
  );
  const activeIndex = active ? items.findIndex((item) => item.sessionId === sessionId) : -1;
  const lastRevealedSession = useRef(sessionId);
  useEffect(() => {
    if (!active || activeIndex < 0 || sessionId === lastRevealedSession.current) return;
    lastRevealedSession.current = sessionId;
    setVisibleCount((count) => Math.max(count, activeIndex + 1));
  }, [active, activeIndex, sessionId]);
  const visible = items.slice(0, visibleCount);
  const live =
    catalog?.items.find((item) => item.runtimeState === "running") ??
    catalog?.items.find((item) => item.runtimeState === "queued");
  const liveState = workspaceLiveRuntimeState({
    path: cwd,
    workspace,
    session,
    catalog: currentCatalog,
    drafts,
  });
  const dot = sessionStatusDotClass(liveState ?? live?.runtimeState ?? "inactive");
  const regionId = `project-${encodeURIComponent(cwd)}`;
  return (
    <section data-project-cwd={cwd}>
      <div
        className={`group flex items-center rounded-md ${active ? "bg-surface-overlay" : "hover:bg-surface-overlay/70"}`}
      >
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={regionId}
          title={cwd}
          onClick={toggle}
          className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left text-[13px]"
        >
          <ChevronRight size={12} className={expanded ? "rotate-90" : ""} />
          {expanded ? (
            <FolderOpen size={16} className={active ? "text-accent" : "text-muted"} />
          ) : (
            <Folder size={16} className={active ? "text-accent" : "text-muted"} />
          )}
          <span className="min-w-0 flex-1 truncate">{workspaceDisplayName(cwd)}</span>
          {dot && (
            <span
              aria-label={t("sessionsRunningInBackground")}
              className={`size-1.5 rounded-full ${dot}`}
            />
          )}
        </button>
        <button
          type="button"
          disabled={!host}
          title={t("projectNewSession")}
          aria-label={t("projectNewSession")}
          onClick={() => void createSessionInWorkspace(cwd)}
          className="rounded p-1 text-muted hover:text-foreground"
        >
          <Plus size={15} />
        </button>
        <ProjectArchiveCleanup
          cwd={cwd}
          items={catalog?.items ?? []}
          onChanged={refresh}
          renderTrigger={(openCleanup, cleanupDisabled) => (
            <button
              type="button"
              aria-label={t("projectActions")}
              title={t("projectActions")}
              aria-haspopup="menu"
              className="mr-1 rounded p-1 text-muted hover:text-foreground"
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                openContextMenu({
                  x: rect.left,
                  y: rect.bottom,
                  trigger: contextMenuTrigger(event.currentTarget),
                  items: [
                    {
                      id: "project.archived",
                      label: t(archived ? "projectActiveSessions" : "projectArchivedSessions"),
                      onSelect: () => {
                        setArchived(!archived);
                        setVisibleCount(PROJECT_SESSION_PREVIEW_COUNT);
                        if (!expanded) toggle();
                      },
                    },
                    {
                      id: "project.cleanup",
                      label: t("sessionsClearArchivedAria"),
                      disabled: cleanupDisabled,
                      onSelect: openCleanup,
                    },
                    {
                      id: "project.remove",
                      label: t("workspacesRemoveTitle"),
                      disabled: active,
                      onSelect: remove,
                    },
                  ],
                });
              }}
            >
              <MoreHorizontal size={15} />
            </button>
          )}
        />
      </div>
      {expanded && (
        <div id={regionId} className="ml-5 pb-2">
          {archived && (
            <p className="px-3 pt-2 text-xs text-muted">{t("projectArchivedSessions")}</p>
          )}
          <CatalogStatus catalog={catalog} retry={refresh} />
          {catalog?.loaded && !catalog.error && items.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted">{t("projectNoSessions")}</p>
          )}
          <ul>
            {visible.map((item) => (
              <ProjectSessionRow
                key={item.sessionId}
                item={item}
                cwd={catalog?.canonicalCwd ?? cwd}
                onChanged={refresh}
              />
            ))}
          </ul>
          {items.length > visibleCount && (
            <button
              type="button"
              onClick={() => setVisibleCount((count) => count + PROJECT_SESSION_PAGE_SIZE)}
              className="px-3 py-2 text-xs text-muted hover:text-foreground"
            >
              {t("projectLoadMore")}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
