import { useSyncExternalStore } from "react";
import type { ProjectSessionAction } from "./project-session-actions";

const actions = new Map<string, Set<ProjectSessionAction>>();
const listeners = new Set<() => void>();
const key = (cwd: string, path: string) => JSON.stringify([cwd, path]);
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function useProjectSessionPending(cwd: string, path: string) {
  return useSyncExternalStore(
    subscribe,
    () =>
      Array.from(actions.get(key(cwd, path)) ?? []).find((action) => action !== "generateTitle") ??
      (actions.get(key(cwd, path))?.has("generateTitle") ? "generateTitle" : null),
    () => null,
  );
}
export function startProjectSessionAction(cwd: string, path: string, action: ProjectSessionAction) {
  const id = key(cwd, path);
  const current = actions.get(id) ?? new Set<ProjectSessionAction>();
  if (current.size && !(action === "rename" && current.size === 1 && current.has("generateTitle")))
    return false;
  actions.set(id, new Set([...current, action]));
  listeners.forEach((listener) => listener());
  return true;
}
export function finishProjectSessionAction(
  cwd: string,
  path: string,
  action: ProjectSessionAction,
) {
  const id = key(cwd, path);
  const remaining = new Set(actions.get(id));
  remaining.delete(action);
  if (remaining.size) actions.set(id, remaining);
  else actions.delete(id);
  listeners.forEach((listener) => listener());
}
