import type { SessionSnapshot } from "@pideck/protocol";
import {
  runtimeStateFromSnapshot,
  type SessionCatalogState,
  type SessionRuntimeState,
} from "../../lib/stores/session-catalog";

export function workspaceDisplayName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? "Workspace";
}

/** Renderer path identity uses only Host-canonical strings. */
function samePath(a: string, b: string): boolean {
  return a === b;
}

export function addKnownWorkspace(list: string[], path: string): string[] {
  return list.some((entry) => samePath(entry, path)) ? list : [...list, path];
}

export function removeKnownWorkspace(list: string[], path: string): string[] {
  return list.filter((entry) => !samePath(entry, path));
}

export function replaceKnownWorkspace(
  list: string[],
  requestedPath: string,
  canonicalPath: string,
): string[] {
  const next = list.map((entry) => (samePath(entry, requestedPath) ? canonicalPath : entry));
  if (!next.some((entry) => samePath(entry, canonicalPath))) next.push(canonicalPath);
  return next.filter((entry, index) => next.indexOf(entry) === index);
}

function isCurrentWorkspacePath(
  path: string,
  workspace: { cwd: string; canonicalCwd: string } | null,
): boolean {
  return Boolean(
    workspace && (samePath(path, workspace.canonicalCwd) || samePath(path, workspace.cwd)),
  );
}

function snapshotBelongsToWorkspace(
  snapshotCwd: string,
  path: string,
  workspace: { cwd: string; canonicalCwd: string } | null,
): boolean {
  if (samePath(snapshotCwd, path)) return true;
  return (
    isCurrentWorkspacePath(path, workspace) &&
    (samePath(snapshotCwd, workspace!.canonicalCwd) || samePath(snapshotCwd, workspace!.cwd))
  );
}

function preferVisibleRuntime(
  current: SessionRuntimeState | null,
  next: SessionRuntimeState,
): SessionRuntimeState | null {
  if (next === "running") return "running";
  if (next === "queued" && current !== "running") return "queued";
  if (next === "error" && current !== "running" && current !== "queued") return "error";
  return current;
}

/** Live Session indicator for a sidebar Workspace row. Parked drafts keep other Workspaces visible. */
export function workspaceLiveRuntimeState(args: {
  path: string;
  workspace: { cwd: string; canonicalCwd: string } | null;
  session: SessionSnapshot | null;
  catalog: SessionCatalogState;
  drafts: Record<string, SessionSnapshot>;
}): SessionRuntimeState | null {
  let visible: SessionRuntimeState | null = null;
  const current = isCurrentWorkspacePath(args.path, args.workspace);
  if (current) {
    if (args.session) {
      visible = preferVisibleRuntime(visible, runtimeStateFromSnapshot(args.session));
    }
    for (const entry of Object.values(args.catalog.entries)) {
      visible = preferVisibleRuntime(visible, entry.runtimeState);
    }
  }
  for (const draft of Object.values(args.drafts)) {
    if (!snapshotBelongsToWorkspace(draft.cwd, args.path, args.workspace)) continue;
    visible = preferVisibleRuntime(visible, runtimeStateFromSnapshot(draft));
  }
  return visible;
}
