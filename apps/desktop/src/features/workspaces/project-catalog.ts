import type { SessionSummary } from "@pideck/protocol";
import type { SessionCatalogEntry } from "../../lib/stores/session-catalog";

export const PROJECT_SESSION_PREVIEW_COUNT = 5;
export const PROJECT_SESSION_PAGE_SIZE = 10;
export type ProjectCatalog = {
  canonicalCwd: string;
  items: SessionCatalogEntry[];
  loading: boolean;
  loaded: boolean;
  error?: string;
};
export type ProjectCatalogs = Record<string, ProjectCatalog>;

export function catalogEntries(items: SessionSummary[]): SessionCatalogEntry[] {
  return items.map((item) => ({ ...item, runtimeState: item.runtimeState ?? "inactive" }));
}

export function recentProjectSessions(paths: string[], catalogs: ProjectCatalogs) {
  const unique = new Map<string, { cwd: string; item: SessionCatalogEntry }>();
  for (const path of paths) {
    const catalog = catalogs[path];
    if (!catalog) continue;
    for (const item of catalog.items) {
      if (item.archived) continue;
      unique.set(`${catalog.canonicalCwd}\0${item.sessionId}`, { cwd: catalog.canonicalCwd, item });
    }
  }
  return [...unique.values()].sort((a, b) => b.item.updatedAt - a.item.updatedAt);
}
