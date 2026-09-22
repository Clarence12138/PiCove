const PROJECT_EXPANDED_PREFIX = "pideck.sidebar.projectExpanded.";
const RECENT_EXPANDED_KEY = "pideck.sidebar.recentExpanded";

export function readExpanded(cwd: string, active: boolean): boolean {
  const value = globalThis.localStorage?.getItem(`${PROJECT_EXPANDED_PREFIX}${cwd}`);
  return value === null || value === undefined ? active : value === "1";
}
export function writeExpanded(cwd: string, expanded: boolean): void {
  globalThis.localStorage?.setItem(`${PROJECT_EXPANDED_PREFIX}${cwd}`, expanded ? "1" : "0");
}
export function readRecentExpanded(): boolean {
  return globalThis.localStorage?.getItem(RECENT_EXPANDED_KEY) === "1";
}
export function writeRecentExpanded(expanded: boolean): void {
  globalThis.localStorage?.setItem(RECENT_EXPANDED_KEY, expanded ? "1" : "0");
}
