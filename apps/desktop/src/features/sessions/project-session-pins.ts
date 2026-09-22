import { readPinnedSessionIds } from "../../lib/session-pins";
import { useAppStore } from "../../lib/stores/app-store";

const PREFIX = "pideck.sessions.project-pins.";
export function readProjectPins(cwd: string): string[] {
  const raw = localStorage.getItem(`${PREFIX}${cwd}`);
  if (raw !== null) {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value) || value.some((id) => typeof id !== "string")) {
      throw new Error("Invalid project session pins");
    }
    return value;
  }
  const workspace = useAppStore.getState().workspace;
  return workspace?.canonicalCwd === cwd ? readPinnedSessionIds(workspace.id) : [];
}
function writeProjectPins(cwd: string, ids: string[]): void {
  localStorage.setItem(`${PREFIX}${cwd}`, JSON.stringify([...new Set(ids)]));
  window.dispatchEvent(new Event("project-session-pins-changed"));
}
export function toggleProjectPin(cwd: string, id: string): void {
  const pins = readProjectPins(cwd);
  writeProjectPins(cwd, pins.includes(id) ? pins.filter((pin) => pin !== id) : [...pins, id]);
}
export function removeProjectPins(cwd: string, ids: string[]): void {
  writeProjectPins(
    cwd,
    readProjectPins(cwd).filter((id) => !ids.includes(id)),
  );
}

export function migrateProjectPins(cwd: string): void {
  const workspace = useAppStore.getState().workspace;
  if (workspace?.canonicalCwd !== cwd || localStorage.getItem(`${PREFIX}${cwd}`) !== null) return;
  writeProjectPins(cwd, readPinnedSessionIds(workspace.id));
}
