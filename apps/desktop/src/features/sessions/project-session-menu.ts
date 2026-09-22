import {
  Archive,
  ArchiveRestore,
  Copy,
  FileOutput,
  FolderOpen,
  Pencil,
  Pin,
  PinOff,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { MenuItem } from "../../lib/context-menu";
import { requestExport } from "../../lib/export-actions";
import { tCurrent as t } from "../../lib/i18n/use-t";
import { useAppStore } from "../../lib/stores/app-store";
import type { SessionCatalogEntry } from "../../lib/stores/session-catalog";
import {
  canArchiveSession,
  canDeleteSession,
  canReloadSession,
  canRenameSession,
} from "./session-list-policy";
import type { ProjectSessionAction } from "./project-session-actions";

export function projectSessionMenu(options: {
  item: SessionCatalogEntry;
  cwd: string;
  pinned: boolean;
  blocked: boolean;
  generatingTitle: boolean;
  open: () => void;
  rename: () => void;
  confirmDelete: () => void;
  pin: () => void;
  run: (action: ProjectSessionAction) => Promise<void>;
}): MenuItem[] {
  const { item, blocked, run } = options;
  const state = useAppStore.getState();
  const sameProject = state.workspace?.canonicalCwd === options.cwd;
  const session = sameProject ? state.session : null;
  const active = session?.sessionId === item.sessionId && !item.archived;
  const mutable = canRenameSession(item, session) && !blocked;
  const items: MenuItem[] = [
    {
      id: "session.open",
      label: t("menuOpenSession"),
      disabled: blocked || item.archived || !item.sessionPath,
      onSelect: options.open,
    },
    {
      id: "session.rename",
      label: t("sessionsRename"),
      icon: Pencil,
      disabled: !mutable,
      onSelect: options.rename,
    },
    {
      id: "session.generateTitle",
      label: t("sessionsGenerateTitle"),
      icon: Sparkles,
      disabled: !mutable || !item.messageCount || options.generatingTitle,
      onSelect: () => run("generateTitle"),
    },
    {
      id: "session.pin",
      label: t(options.pinned ? "sessionsUnpin" : "sessionsPin"),
      icon: options.pinned ? PinOff : Pin,
      onSelect: options.pin,
    },
    {
      id: item.archived ? "session.restore" : "session.archive",
      label: t(item.archived ? "sessionsRestore" : "sessionsArchive"),
      icon: item.archived ? ArchiveRestore : Archive,
      separatorBefore: true,
      disabled: blocked || (!item.archived && !canArchiveSession(item, session)),
      onSelect: () => run(item.archived ? "restore" : "archive"),
    },
    {
      id: "session.reload",
      label: t("sessionsReload"),
      icon: RefreshCw,
      disabled: blocked || !canReloadSession(item, session),
      onSelect: () => run("reload"),
    },
    {
      id: "session.exportHtml",
      label: t("statsExportHtml"),
      icon: FileOutput,
      disabled: blocked || !active || !session?.isIdle,
      onSelect: () => requestExport("html"),
    },
    {
      id: "session.exportJsonl",
      label: t("statsExportJsonl"),
      icon: FileOutput,
      disabled: blocked || !active || !session?.isIdle,
      onSelect: () => requestExport("jsonl"),
    },
    {
      id: "session.reveal",
      label: t("menuRevealSession"),
      icon: FolderOpen,
      separatorBefore: true,
      onSelect: async () => {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("desktop_open_path", { path: item.sessionPath, mode: "reveal" });
        } catch (error) {
          state.pushNotification(`${t("sessionsRevealFailed")}: ${String(error)}`, "error");
        }
      },
    },
    {
      id: "session.copyPath",
      label: t("menuCopySessionPath"),
      icon: Copy,
      onSelect: async () => {
        try {
          await navigator.clipboard.writeText(item.sessionPath);
          state.pushNotification(t("sessionsPathCopied"), "info");
        } catch (error) {
          state.pushNotification(`${t("sessionsCopyPathFailed")}: ${String(error)}`, "error");
        }
      },
    },
    {
      id: "session.delete",
      label: t("commonDelete"),
      icon: Trash2,
      danger: true,
      separatorBefore: true,
      disabled: blocked || !canDeleteSession(item, session),
      onSelect: options.confirmDelete,
    },
  ];
  if (!sameProject)
    items.unshift({
      id: "session.workspaceHint",
      label: t("projectSessionSwitchHint"),
      disabled: true,
      onSelect: () => {},
    });
  return items;
}
