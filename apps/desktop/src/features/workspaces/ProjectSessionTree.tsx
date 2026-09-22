import { ChevronRight, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../../lib/stores/app-store";
import {
  persistDesktopSettings,
  notifyDesktopSettingsSaveFailure,
} from "../../lib/desktop-settings";
import { useT } from "../../lib/i18n/use-t";
import { switchWorkspace } from "../../lib/commands/workspace-navigation";
import { migrateProjectPins } from "../sessions/project-session-pins";
import { ProjectSessionRow } from "../sessions/ProjectSessionRow";
import { ProjectSessionGroup, MoreSessions } from "./ProjectSessionGroup";
import { addKnownWorkspace, removeKnownWorkspace, replaceKnownWorkspace } from "./WorkspacePicker";
import { useProjectCatalogs } from "./use-project-catalogs";
import { PROJECT_SESSION_PREVIEW_COUNT, recentProjectSessions } from "./project-catalog";
import {
  readExpanded,
  writeExpanded,
  readRecentExpanded,
  writeRecentExpanded,
} from "./project-tree-prefs";

const NO_WORKSPACES: string[] = [];

export function ProjectSessionTree() {
  const t = useT();
  const workspace = useAppStore((s) => s.workspace);
  const sessionId = useAppStore((s) => s.session?.sessionId);
  const host = useAppStore((s) => s.host);
  const known = useAppStore((s) => s.desktopSettings?.knownWorkspaces ?? NO_WORKSPACES);
  const cwd = workspace?.canonicalCwd;
  const paths = cwd ? addKnownWorkspace(known, cwd) : known;
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [recentOpen, setRecentOpen] = useState(readRecentExpanded);
  const [recentAll, setRecentAll] = useState(false);
  const previousSession = useRef<string | null | undefined>(sessionId);
  const isExpanded = (path: string) => expanded[path] ?? readExpanded(path, path === cwd);
  const needed = paths.filter((path) => recentOpen || isExpanded(path));
  const { catalogs, refresh } = useProjectCatalogs(needed);

  useEffect(() => {
    if (!cwd) return;
    migrateProjectPins(cwd);
    const next = replaceKnownWorkspace(known, workspace?.cwd ?? cwd, cwd);
    if (next.length === known.length && next.every((path, index) => path === known[index])) return;
    void persistDesktopSettings({ knownWorkspaces: next }).catch(notifyDesktopSettingsSaveFailure);
  }, [cwd, workspace?.cwd, known]);

  useEffect(() => {
    if (previousSession.current === sessionId) return;
    previousSession.current = sessionId;
    if (!cwd || !sessionId) return;
    writeExpanded(cwd, true);
    setExpanded((values) => ({ ...values, [cwd]: true }));
  }, [cwd, sessionId]);

  function toggleProject(path: string) {
    const value = !isExpanded(path);
    if (value && recentOpen) void refresh(path);
    writeExpanded(path, value);
    setExpanded((values) => ({ ...values, [path]: value }));
  }

  async function addProject() {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected === "string") await switchWorkspace(selected);
    } catch (error) {
      useAppStore
        .getState()
        .pushNotification(error instanceof Error ? error.message : String(error), "error");
    }
  }

  function removeProject(path: string) {
    void persistDesktopSettings({ knownWorkspaces: removeKnownWorkspace(known, path) }).catch(
      notifyDesktopSettingsSaveFailure,
    );
  }

  const recent = recentProjectSessions(paths, catalogs);
  const visibleRecent = recentAll ? recent : recent.slice(0, PROJECT_SESSION_PREVIEW_COUNT);
  const failures = paths.filter((path) => catalogs[path]?.error);
  const loadingRecent = paths.some((path) => !catalogs[path] || catalogs[path].loading);
  return (
    <>
      <div className="mb-1 flex h-7 items-center justify-between px-2">
        <span className="text-[11px] font-medium text-muted">{t("workspacesTitle")}</span>
        <button
          type="button"
          disabled={!host}
          onClick={() => void addProject()}
          aria-label={t("workspacesAdd")}
          title={t("workspacesAdd")}
          className="rounded p-1 text-muted hover:text-foreground"
        >
          <Plus size={15} />
        </button>
      </div>
      <div className="flex flex-col gap-0.5">
        {paths.map((path) => (
          <ProjectSessionGroup
            key={path}
            cwd={path}
            expanded={isExpanded(path)}
            catalog={catalogs[path]}
            toggle={() => toggleProject(path)}
            refresh={() => void refresh(path)}
            remove={() => removeProject(path)}
          />
        ))}
      </div>
      <section className="mt-4" data-recent-sessions>
        <button
          type="button"
          aria-expanded={recentOpen}
          aria-controls="recent-project-sessions"
          onClick={() => {
            if (!recentOpen) {
              for (const path of paths.filter(isExpanded)) void refresh(path);
            }
            writeRecentExpanded(!recentOpen);
            setRecentOpen(!recentOpen);
          }}
          className="flex h-7 w-full items-center gap-1 px-2 text-left text-[11px] font-medium text-muted hover:text-foreground"
        >
          <ChevronRight size={12} className={recentOpen ? "rotate-90" : ""} />
          {t("sessionsRecent")}
        </button>
        {recentOpen && (
          <div id="recent-project-sessions">
            {loadingRecent && (
              <p role="status" className="px-3 py-2 text-xs text-muted">
                {t("projectLoading")}
              </p>
            )}
            {failures.length > 0 && (
              <div role="alert" className="px-3 py-2 text-xs text-danger">
                {t("projectRecentIncomplete")}{" "}
                <button
                  type="button"
                  className="underline"
                  onClick={() => failures.forEach((path) => void refresh(path))}
                >
                  {t("projectRetry")}
                </button>
              </div>
            )}
            {!loadingRecent && !failures.length && !recent.length && (
              <p className="px-3 py-2 text-xs text-muted">{t("projectNoSessions")}</p>
            )}
            <ul>
              {visibleRecent.map(({ cwd: projectCwd, item }) => (
                <ProjectSessionRow
                  key={`${projectCwd}:${item.sessionId}`}
                  cwd={projectCwd}
                  item={item}
                  showProjectName
                  onChanged={() => void refresh(projectCwd)}
                />
              ))}
            </ul>
            {recent.length > PROJECT_SESSION_PREVIEW_COUNT && (
              <MoreSessions all={recentAll} toggle={() => setRecentAll(!recentAll)} />
            )}
          </div>
        )}
      </section>
    </>
  );
}
