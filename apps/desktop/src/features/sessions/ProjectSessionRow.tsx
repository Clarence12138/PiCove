import {
  Check,
  CircleAlert,
  LoaderCircle,
  MessageCircleQuestion,
  MoreHorizontal,
  Pin,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { navigateToSession } from "../../lib/commands/workspace-navigation";
import { contextMenuTrigger, openContextMenu } from "../../lib/context-menu";
import { shouldKeepNativeContextMenu } from "../../lib/context-menu-policy";
import { useT } from "../../lib/i18n/use-t";
import { useAppStore } from "../../lib/stores/app-store";
import { deriveExtensionUiWaitingBySession } from "../../lib/stores/extension-ui-state";
import type { SessionCatalogEntry } from "../../lib/stores/session-catalog";
import { useImeComposition } from "../../lib/use-ime-composition";
import { runProjectSessionAction, type ProjectSessionAction } from "./project-session-actions";
import { ProjectSessionConfirm } from "./project-session-dialog";
import { projectSessionMenu } from "./project-session-menu";
import {
  finishProjectSessionAction,
  startProjectSessionAction,
  useProjectSessionPending,
} from "./project-session-pending";
import { readProjectPins, toggleProjectPin } from "./project-session-pins";
import { sessionDisplayName, sessionStatusDotClass } from "./session-list-policy";

export type ProjectSessionRowProps = {
  item: SessionCatalogEntry;
  cwd: string;
  showProjectName?: boolean;
  onChanged: () => void;
};
export function ProjectSessionRow({
  item,
  cwd,
  showProjectName,
  onChanged,
}: ProjectSessionRowProps) {
  const t = useT();
  const currentCwd = useAppStore((state) => state.workspace?.canonicalCwd);
  const activeSessionId = useAppStore((state) => state.session?.sessionId);
  const unavailable = useAppStore((state) =>
    Boolean(
      state.connecting ||
      state.rehydrating ||
      state.desynchronized ||
      state.hostFatal ||
      !state.host,
    ),
  );
  const rowRef = useRef<HTMLLIElement>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const pending = useProjectSessionPending(cwd, item.sessionPath);
  const [pinRevision, setPinRevision] = useState(0);
  const ime = useImeComposition();
  useEffect(() => {
    const refresh = () => setPinRevision((value) => value + 1);
    window.addEventListener("project-session-pins-changed", refresh);
    return () => window.removeEventListener("project-session-pins-changed", refresh);
  }, []);
  void pinRevision;
  const pinned = readProjectPins(cwd).includes(item.sessionId);
  const active = !item.archived && currentCwd === cwd && activeSessionId === item.sessionId;
  const blocked = Boolean((pending && pending !== "generateTitle") || unavailable);
  useEffect(() => {
    if (active && !showProjectName) rowRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [active, showProjectName]);
  const title = sessionDisplayName(item, t("sessionsUntitled"));
  async function run(action: ProjectSessionAction) {
    if (!startProjectSessionAction(cwd, item.sessionPath, action)) return;
    try {
      if (!(await runProjectSessionAction({ cwd, item, action, name }))) return;
      setEditing(false);
      setConfirmDelete(false);
    } catch (error) {
      useAppStore
        .getState()
        .pushNotification(error instanceof Error ? error.message : String(error), "error");
    } finally {
      finishProjectSessionAction(cwd, item.sessionPath, action);
      onChanged();
    }
  }
  function open() {
    void navigateToSession({ cwd, sessionPath: item.sessionPath }).catch((error: unknown) => {
      useAppStore
        .getState()
        .pushNotification(error instanceof Error ? error.message : String(error), "error");
    });
  }
  function showMenu(event: MouseEvent, context = false) {
    if (context && shouldKeepNativeContextMenu(event.nativeEvent)) return;
    if (context && event.target instanceof Element && event.target.closest("input, textarea"))
      return;
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    openContextMenu({
      x: context ? event.clientX : rect.left,
      y: context ? event.clientY : rect.bottom,
      trigger: contextMenuTrigger(event.currentTarget),
      items: projectSessionMenu({
        item,
        cwd,
        pinned,
        blocked,
        generatingTitle: pending === "generateTitle",
        open,
        rename: () => {
          setName(title);
          setEditing(true);
        },
        confirmDelete: () => setConfirmDelete(true),
        pin: () => {
          toggleProjectPin(cwd, item.sessionId);
          onChanged();
        },
        run,
      }),
    });
  }
  return (
    <li
      ref={rowRef}
      data-ui="nav-item"
      data-session-path={item.sessionPath}
      data-state={active ? "active" : "inactive"}
      className={`interface-density-nav-row group flex min-h-9 items-center rounded-md text-[13px] ${active ? "theme-nav-active bg-nav-active text-nav-active-foreground" : "hover:bg-surface-overlay/70"}`}
      onContextMenu={(event) => showMenu(event, true)}
    >
      {editing ? (
        <form
          className="flex min-w-0 flex-1 items-center gap-1 px-1.5 py-1"
          onSubmit={(event) => {
            event.preventDefault();
            void run("rename");
          }}
        >
          <input
            autoFocus
            aria-label={t("sessionsNameAria")}
            value={name}
            maxLength={120}
            disabled={blocked}
            onChange={(event) => setName(event.target.value)}
            onCompositionStart={ime.onCompositionStart}
            onCompositionEnd={ime.onCompositionEnd}
            onKeyDown={(event) => {
              if (event.key === "Enter" && ime.isImeKey(event)) event.preventDefault();
              if (event.key === "Escape") setEditing(false);
            }}
            className="h-7 min-w-0 flex-1 rounded border border-accent bg-surface px-1.5 text-xs outline-none"
          />
          <button type="submit" title={t("sessionsSaveName")} disabled={blocked || !name.trim()}>
            <Check size={14} />
          </button>
          <button
            type="button"
            title={t("sessionsCancelRename")}
            disabled={blocked}
            onClick={() => setEditing(false)}
          >
            <X size={14} />
          </button>
        </form>
      ) : (
        <>
          <button
            type="button"
            aria-current={active ? "page" : undefined}
            onClick={open}
            disabled={blocked || item.archived || !item.sessionPath}
            className="min-w-0 flex-1 px-2.5 py-2 text-left"
            title={item.lastError ? `${title} — ${item.lastError}` : title}
          >
            <div className="flex min-w-0 items-center gap-1.5">
              <span className={`min-w-0 flex-1 truncate ${active ? "font-medium" : ""}`}>
                {title}
              </span>
              {pending === "generateTitle" && (
                <LoaderCircle
                  size={12}
                  className="animate-spin"
                  aria-label={t("sessionsGeneratingTitle")}
                />
              )}
              {pinned && <Pin size={10} aria-label={t("sessionsPinned")} />}
              <ProjectSessionStatus item={item} />
            </div>
            {showProjectName && (
              <span className="block truncate text-[11px] text-muted">
                {cwd.split(/[\\/]/u).filter(Boolean).at(-1) ?? cwd}
              </span>
            )}
          </button>
          <button
            type="button"
            aria-label={t("sessionsActionsTitle")}
            title={t("sessionsActionsTitle")}
            aria-haspopup="menu"
            onClick={(event) => showMenu(event)}
            className="mr-1 rounded p-1 text-muted opacity-0 hover:bg-surface-overlay group-hover:opacity-100 group-focus-within:opacity-100"
          >
            <MoreHorizontal size={14} />
          </button>
        </>
      )}
      {confirmDelete && (
        <ProjectSessionConfirm
          title={t("sessionsDeleteConfirmTitle")}
          body={`${t("sessionsDeleteConfirmBody", { name: title })}${currentCwd !== cwd ? ` ${t("projectSessionSwitchHint")}` : ""}`}
          pending={Boolean(pending)}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => void run("delete")}
        />
      )}
    </li>
  );
}
function ProjectSessionStatus({ item }: { item: SessionCatalogEntry }) {
  const t = useT();
  const request = useAppStore((state) => state.extensionUiRequest);
  const queue = useAppStore((state) => state.extensionUiQueue);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const next = [request, ...queue]
      .flatMap((entry) =>
        entry?.expiresAt && entry.expiresAt > Date.now() ? [entry.expiresAt] : [],
      )
      .sort((a, b) => a - b)[0];
    if (next === undefined) return;
    const timer = window.setTimeout(() => setTick((value) => value + 1), next - Date.now() + 1);
    return () => window.clearTimeout(timer);
  }, [request, queue, tick]);
  if (item.archived) return null;
  const waiting = deriveExtensionUiWaitingBySession(request, queue, Date.now())[item.sessionId];
  const dot = sessionStatusDotClass(item.runtimeState);
  return (
    <>
      {waiting && (
        <span
          aria-label={t(
            waiting.hasHighRisk ? "sessionsDecisionWaitingHighRisk" : "sessionsDecisionWaiting",
            { count: waiting.count },
          )}
          data-session-decision-count={waiting.count}
          className={`inline-flex items-center gap-1 text-[10px] ${waiting.hasHighRisk ? "text-warning" : "text-muted"}`}
        >
          {waiting.hasHighRisk ? <CircleAlert size={11} /> : <MessageCircleQuestion size={11} />}
          {waiting.count}
        </span>
      )}
      {dot && (
        <span aria-label={item.runtimeState} className={`size-1.5 shrink-0 rounded-full ${dot}`} />
      )}
    </>
  );
}
